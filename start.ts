import {
  BigNumberish,
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  LiquidityStateV4,
  MARKET_STATE_LAYOUT_V3,
  MarketStateV3,
  Token,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Keypair,
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  KeyedAccountInfo,
  TransactionMessage,
  VersionedTransaction,
  Commitment,
} from '@solana/web3.js';
import { 
  getTokenAccounts, 
  RAYDIUM_LIQUIDITY_PROGRAM_ID_V4, 
  OPENBOOK_PROGRAM_ID, 
  createPoolKeys,
  analyzeLiquidityPool,
  calculateOptimalSwapAmount
} from './liquidity/liquidity';
import { 
  retry, 
  retrieveEnvVariable, 
  retrieveTokenValueByAddress,
  analyzeMarketConditions,
  calculatePositionSize,
  getOptimalComputeUnitPrice,
  loadSnipeListAsync,
  getSnipeList,
  shouldBuy,
  sendDiagnostics,
  checkTokenSecurity,
  checkPriceImpact,
  getMarketSentiment,
  shouldTradeBasedOnSentiment,
  SentimentLevel
} from './utils/utils';
import { 
  getMinimalMarketV3, 
  batchGetMinimalMarkets,
  getMarketStatistics
} from './market/market';
import { MintLayout } from './types';
import pino from 'pino';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import NodeCache from 'node-cache';

// Initialize cache for token accounts and other data
const tokenAccountCache = new NodeCache({ stdTTL: 60, checkperiod: 15 });

const PROFIT_FILE = './totalProfit.json';

const logo = `
░▒▓███████▓▒░ ░▒▓██████▓▒░▒▓████████▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░ 
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░   ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░        
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░        
░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░ ░▒▓█▓▒░   ░▒▓█▓▒░░▒▓█▓▒▒▓█▓▒░░▒▓██████▓▒░   
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░   ░▒▓█▓▒░ ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░        
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░   ░▒▓█▓▒░ ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░        
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░   ░▒▓█▓▒░  ░▒▓██▓▒░  ░▒▓████████▓▒░ 

          Version: 2.0.0
   The Best Sniper Bot On The Planet!
`;

console.log('\x1b[31m', logo); 

const transport = pino.transport({
  targets: [
    {
      level: 'trace',
      target: 'pino-pretty',
      options: {},
    },
  ],
});

export const logger = pino(
  {
    level: 'trace',
    redact: ['poolKeys'],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  transport,
);

const network = 'mainnet-beta';
const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);

// Create connection with optimized settings
const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: 'confirmed', // Use confirmed for faster responses
  disableRetryOnRateLimit: false,
  confirmTransactionInitialTimeout: 60000,
});

export type MinimalTokenAccountData = {
  mint: PublicKey;
  address: PublicKey;
  buyValue?: number;
  poolKeys?: LiquidityPoolKeys;
  market?: any;
  lastUpdated?: number;
};

// Use Sets and Maps for faster lookups
let existingLiquidityPools: Set<string> = new Set<string>();
let existingOpenBookMarkets: Set<string> = new Set<string>();
let existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();

// Track active transactions to prevent duplicates
let activeTransactions: Set<string> = new Set<string>();

let wallet: Keypair;
let quoteToken: Token;
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;
let quoteMinPoolSizeAmount: TokenAmount;
let commitment: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;

// Load configuration settings
const TAKE_PROFIT = Number(retrieveEnvVariable('TAKE_PROFIT', logger));
const STOP_LOSS = Number(retrieveEnvVariable('STOP_LOSS', logger));
const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true';
const CHECK_IF_MINT_IS_FREEZABLE = retrieveEnvVariable('CHECK_IF_MINT_IS_FREEZABLE', logger) === 'true';
const CHECK_IF_MINT_IS_MINTABLE = retrieveEnvVariable('CHECK_IF_MINT_IS_MINTABLE', logger) === 'true';
const USE_SNIPE_LIST = retrieveEnvVariable('USE_SNIPE_LIST', logger) === 'true';
const SNIPE_LIST_REFRESH_INTERVAL = Number(retrieveEnvVariable('SNIPE_LIST_REFRESH_INTERVAL', logger));
const AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger) === 'true';
const MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger));
const MIN_POOL_SIZE = retrieveEnvVariable('MIN_POOL_SIZE', logger);
const MAX_CONCURRENT_TRANSACTIONS = Number(retrieveEnvVariable('MAX_CONCURRENT_TRANSACTIONS', logger) || '3');
const DYNAMIC_POSITION_SIZING = retrieveEnvVariable('DYNAMIC_POSITION_SIZING', logger) === 'true';
const MAX_SLIPPAGE_PERCENT = Number(retrieveEnvVariable('MAX_SLIPPAGE_PERCENT', logger) || '1.0');

// New feature 1: Risk management settings
const RISK_LEVEL = retrieveEnvVariable('RISK_LEVEL', logger) || 'medium';
const MAX_DAILY_TRADES = Number(retrieveEnvVariable('MAX_DAILY_TRADES', logger) || '20');
const MAX_DAILY_LOSS_PERCENT = Number(retrieveEnvVariable('MAX_DAILY_LOSS_PERCENT', logger) || '5');

// New feature 2: Trading hours settings
const TRADING_HOURS_ENABLED = retrieveEnvVariable('TRADING_HOURS_ENABLED', logger) === 'true';
const TRADING_START_HOUR = Number(retrieveEnvVariable('TRADING_START_HOUR', logger) || '0');
const TRADING_END_HOUR = Number(retrieveEnvVariable('TRADING_END_HOUR', logger) || '24');

// Risk management tracking
let dailyTradeCount = 0;
let dailyProfitLoss = 0;
let lastDayReset = new Date().setHours(0, 0, 0, 0);

async function init(): Promise<void> {
  // Get wallet
  const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);
  wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  await sendDiagnostics(`Bot sniping has started from the solana address: ${wallet.publicKey}`);
  logger.info(`Wallet Address: ${wallet.publicKey}`);

  // Get quote mint and amount
  const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
  const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
  switch (QUOTE_MINT) {
    case 'WSOL': {
      quoteToken = Token.WSOL;
      quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
      quoteMinPoolSizeAmount = new TokenAmount(quoteToken, MIN_POOL_SIZE, false);
      break;
    }
    case 'USDC': {
      quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
      quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
      quoteMinPoolSizeAmount = new TokenAmount(quoteToken, MIN_POOL_SIZE, false);
      break;
    }
    default: {
      throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
    }
  }

  logger.info(`Snipe list: ${USE_SNIPE_LIST}`);
  logger.info(`Check mint renounced: ${CHECK_IF_MINT_IS_RENOUNCED}`);
  logger.info(`Check if mint is freezeable: ${CHECK_IF_MINT_IS_FREEZABLE}`);
  logger.info(`Check if mint is mintable: ${CHECK_IF_MINT_IS_MINTABLE}`)
  logger.info(
    `Min pool size: ${quoteMinPoolSizeAmount.isZero() ? 'false' : quoteMinPoolSizeAmount.toFixed()} ${quoteToken.symbol}`,
  );
  logger.info(`Buy amount: ${quoteAmount.toFixed()} ${quoteToken.symbol}`);
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Dynamic position sizing: ${DYNAMIC_POSITION_SIZING}`);
  logger.info(`Max concurrent transactions: ${MAX_CONCURRENT_TRANSACTIONS}`);
  
  // Log new feature settings
  logger.info(`Risk level: ${RISK_LEVEL}`);
  logger.info(`Max daily trades: ${MAX_DAILY_TRADES}`);
  logger.info(`Max daily loss: ${MAX_DAILY_LOSS_PERCENT}%`);
  logger.info(`Trading hours: ${TRADING_HOURS_ENABLED ? `${TRADING_START_HOUR}:00-${TRADING_END_HOUR}:00` : 'Disabled (24/7)'}`);

  // Check existing wallet for associated token account of quote mint
  const tokenAccounts = await getTokenAccounts(solanaConnection, wallet.publicKey, commitment);

  for (const ta of tokenAccounts) {
    existingTokenAccounts.set(ta.accountInfo.mint.toString(), <MinimalTokenAccountData>{
      mint: ta.accountInfo.mint,
      address: ta.pubkey,
      lastUpdated: Date.now(),
    });
  }

  const tokenAccount = tokenAccounts.find((acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString())!;

  if (!tokenAccount) {
    throw new Error(`No ${quoteToken.symbol} found in wallet, convert some SOL to WSOL for sniping: ${wallet.publicKey}`);
  }

  quoteTokenAssociatedAddress = tokenAccount.pubkey;

  // Load tokens to snipe
  await loadSnipeListAsync();

  // Set up periodic refresh of token accounts
  setInterval(async () => {
    try {
      const accounts = await getTokenAccounts(solanaConnection, wallet.publicKey, commitment);
      for (const ta of accounts) {
        const mintStr = ta.accountInfo.mint.toString();
        const existing = existingTokenAccounts.get(mintStr);
        
        if (existing) {
          existing.address = ta.pubkey;
          existing.lastUpdated = Date.now();
        } else {
          existingTokenAccounts.set(mintStr, <MinimalTokenAccountData>{
            mint: ta.accountInfo.mint,
            address: ta.pubkey,
            lastUpdated: Date.now(),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to refresh token accounts:', error);
    }
  }, 60000); // Refresh every minute
  
  // Set up daily reset for risk management
  setInterval(() => {
    const currentDayStart = new Date().setHours(0, 0, 0, 0);
    if (currentDayStart > lastDayReset) {
      // Reset daily counters
      dailyTradeCount = 0;
      dailyProfitLoss = 0;
      lastDayReset = currentDayStart;
      logger.info('Daily risk management counters reset');
    }
  }, 60000); // Check every minute
}

function saveTokenAccount(mint: PublicKey, accountData: any): MinimalTokenAccountData {
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const tokenAccount = <MinimalTokenAccountData>{
    address: ata,
    mint: mint,
    market: {
      bids: accountData.bids,
      asks: accountData.asks,
      eventQueue: accountData.eventQueue,
    },
    lastUpdated: Date.now(),
  };
  existingTokenAccounts.set(mint.toString(), tokenAccount);
  return tokenAccount;
}

export async function checkMintable(vault: PublicKey): Promise<boolean | undefined> {
  const cacheKey = `mintable_${vault.toString()}`;
  const cachedResult = tokenAccountCache.get<boolean>(cacheKey);
  
  if (cachedResult !== undefined) {
    return cachedResult;
  }
  
  try {
    let { data } = (await solanaConnection.getAccountInfo(vault)) || {};
    if (!data) {
      return;
    }
    const deserialize = MintLayout.decode(data);
    logger.debug(`Deserialized data: ${JSON.stringify(deserialize)}`);
    
    const result = deserialize.mintAuthorityOption === 0;
    tokenAccountCache.set(cacheKey, result, 300); // Cache for 5 minutes
    
    return result;
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: vault }, `Failed to check if mint is renounced`);
  }
}

// Check if trading is allowed based on trading hours
function isTradingAllowed(): boolean {
  if (!TRADING_HOURS_ENABLED) {
    return true; // Trading allowed 24/7
  }
  
  const currentHour = new Date().getHours();
  
  if (TRADING_START_HOUR <= TRADING_END_HOUR) {
    // Normal time range (e.g., 9-17)
    return currentHour >= TRADING_START_HOUR && currentHour < TRADING_END_HOUR;
  } else {
    // Overnight time range (e.g., 22-6)
    return currentHour >= TRADING_START_HOUR || currentHour < TRADING_END_HOUR;
  }
}

// Check if trade is allowed based on risk management
function isTradeAllowedByRiskManagement(): boolean {
  // Check daily trade count limit
  if (dailyTradeCount >= MAX_DAILY_TRADES) {
    logger.warn(`Daily trade limit reached (${dailyTradeCount}/${MAX_DAILY_TRADES})`);
    return false;
  }
  
  // Check daily loss limit
  if (dailyProfitLoss < 0 && Math.abs(dailyProfitLoss) > MAX_DAILY_LOSS_PERCENT) {
    logger.warn(`Daily loss limit reached (${dailyProfitLoss.toFixed(2)}%, max: -${MAX_DAILY_LOSS_PERCENT}%)`);
    return false;
  }
  
  return true;
}

// Adjust position size based on risk level
function adjustPositionSizeByRisk(baseSize: number): number {
  switch (RISK_LEVEL.toLowerCase()) {
    case 'low':
      return baseSize * 0.5; // 50% of base size
    case 'medium':
      return baseSize; // 100% of base size
    case 'high':
      return baseSize * 1.5; // 150% of base size
    default:
      return baseSize;
  }
}

export async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {
  // Skip if we're already processing too many transactions
  if (activeTransactions.size >= MAX_CONCURRENT_TRANSACTIONS) {
    return;
  }
  
  // Check if trading is allowed based on trading hours
  if (!isTradingAllowed()) {
    logger.debug('Trading not allowed during current hours');
    return;
  }
  
  // Check if trade is allowed based on risk management
  if (!isTradeAllowedByRiskManagement()) {
    return;
  }
  
  // Check if we should buy this token
  if (!shouldBuy(poolState.baseMint.toString())) {
    return;
  }

  // Enhanced token security checks
  const securityCheck = await checkTokenSecurity(poolState.baseMint);
  if (!securityCheck.isSafe) {
    logger.warn({ mint: poolState.baseMint, reason: securityCheck.reason }, 'Skipping token due to security check failure');
    return;
  }

  // Analyze pool before buying
  const basePrice = await retrieveTokenValueByAddress(poolState.baseMint.toString()) || 0;
  const poolAnalysis = analyzeLiquidityPool(poolState, basePrice);
  
  if (poolAnalysis.recommendation !== 'buy') {
    logger.info({ 
      mint: poolState.baseMint,
      score: poolAnalysis.tradingScore,
      liquidity: poolAnalysis.liquidity,
      slippage: poolAnalysis.slippage
    }, 'Skipping, pool analysis does not recommend buying');
    return;
  }

  // Price impact protection
  const ENABLE_PRICE_IMPACT_PROTECTION = retrieveEnvVariable('ENABLE_PRICE_IMPACT_PROTECTION', logger) === 'true';
  const MAX_PRICE_IMPACT_PERCENT = Number(retrieveEnvVariable('MAX_PRICE_IMPACT_PERCENT', logger) || '3.0');
  
  if (ENABLE_PRICE_IMPACT_PROTECTION) {
    // Calculate optimal swap amount based on pool data
    const optimalAmount = calculateOptimalSwapAmount(accountData, MAX_SLIPPAGE_PERCENT);
    const finalAmount = BigInt(Math.min(Number(positionSize), optimalAmount));
    
    // Check price impact
    const priceImpactCheck = checkPriceImpact(poolState, finalAmount, false, MAX_PRICE_IMPACT_PERCENT);
    
    if (!priceImpactCheck.shouldProceed) {
      logger.warn({ 
        mint: poolState.baseMint, 
        priceImpact: priceImpactCheck.priceImpact.toFixed(2) + '%',
        maxAllowed: MAX_PRICE_IMPACT_PERCENT + '%'
      }, 'Skipping due to high price impact');
      return;
    }
    
    logger.info({ 
      mint: poolState.baseMint, 
      priceImpact: priceImpactCheck.priceImpact.toFixed(2) + '%' 
    }, 'Price impact within acceptable range');
  }
  
  // Market sentiment analysis
  const ENABLE_SENTIMENT_ANALYSIS = retrieveEnvVariable('ENABLE_SENTIMENT_ANALYSIS', logger) === 'true';
  const MIN_SENTIMENT_CONFIDENCE = Number(retrieveEnvVariable('MIN_SENTIMENT_CONFIDENCE', logger) || '60');
  const REQUIRED_SENTIMENT_LEVEL = retrieveEnvVariable('REQUIRED_SENTIMENT_LEVEL', logger) || 'NEUTRAL';
  
  if (ENABLE_SENTIMENT_ANALYSIS) {
    try {
      // Get market statistics for analysis
      const marketStats = await getMarketStatistics(solanaConnection, accountData.marketId);
      
      // Get price changes and volumes for sentiment analysis
      const priceChanges = {
        m5: marketStats?.priceChanges?.m5 || 0,
        h1: marketStats?.priceChanges?.h1 || 0,
        h6: marketStats?.priceChanges?.h6 || 0,
        h24: marketStats?.priceChanges?.h24 || 0
      };
      
      const volumes = {
        m5: marketStats?.volumes?.m5 || 0,
        h1: marketStats?.volumes?.h1 || 0,
        h6: marketStats?.volumes?.h6 || 0,
        h24: marketStats?.volumes?.h24 || 0
      };
      
      // Get current and previous liquidity
      const currentLiquidity = poolAnalysis.liquidity;
      const previousLiquidity = marketStats?.previousLiquidity || currentLiquidity * 0.9; // Fallback if no previous data
      
      // Get market sentiment
      const sentiment = await getMarketSentiment(
        poolState.baseMint,
        priceChanges,
        volumes,
        currentLiquidity,
        previousLiquidity
      );
      
      // Check if we should trade based on sentiment
      if (!shouldTradeBasedOnSentiment(
        sentiment, 
        MIN_SENTIMENT_CONFIDENCE, 
        SentimentLevel[REQUIRED_SENTIMENT_LEVEL as keyof typeof SentimentLevel]
      )) {
        logger.warn({ 
          mint: poolState.baseMint,
          sentiment: sentiment.level,
          score: sentiment.score,
          confidence: sentiment.confidence + '%'
        }, 'Skipping due to market sentiment');
        return;
      }
      
      logger.info({ 
        mint: poolState.baseMint,
        sentiment: sentiment.level,
        score: sentiment.score,
        confidence: sentiment.confidence + '%'
      }, 'Market sentiment favorable for trading');
    } catch (error) {
      logger.warn({ mint: poolState.baseMint, error }, 'Error analyzing market sentiment, proceeding anyway');
    }
  }

  await buy(id, poolState);
}

export async function processOpenBookMarket(updatedAccountInfo: KeyedAccountInfo) {
  // Skip if we're already processing too many transactions
  if (activeTransactions.size >= MAX_CONCURRENT_TRANSACTIONS) {
    return;
  }
  
  // Check if trading is allowed based on trading hours
  if (!isTradingAllowed()) {
    logger.debug('Trading not allowed during current hours');
    return;
  }
  
  // Check if trade is allowed based on risk management
  if (!isTradeAllowedByRiskManagement()) {
    return;
  }
  
  let accountData: MarketStateV3 | undefined;
  try {
    accountData = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);

    // To be competitive, we collect market data before buying the token
    if (existingTokenAccounts.has(accountData.baseMint.toString())) {
      return;
    }

    saveTokenAccount(accountData.baseMint, accountData);
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData?.baseMint }, `Failed to process market`);
  }
}

async function buy(accountId: PublicKey, accountData: LiquidityStateV4): Promise<void> {
  const mintAddress = accountData.baseMint.toString();
  
  // Prevent duplicate transactions for the same mint
  if (activeTransactions.has(mintAddress)) {
    return;
  }
  
  activeTransactions.add(mintAddress);
  
  try {
    let tokenAccount = existingTokenAccounts.get(mintAddress);

    if (!tokenAccount) {
      // It's possible that we didn't have time to fetch open book data
      const market = await getMinimalMarketV3(solanaConnection, accountData.marketId, commitment);
      tokenAccount = saveTokenAccount(accountData.baseMint, market);
    }

    // Get market statistics for analysis
    const marketStats = await getMarketStatistics(solanaConnection, accountData.marketId);
    
    // Analyze market conditions if we have price data
    let positionSize = quoteAmount.raw;
    if (DYNAMIC_POSITION_SIZING) {
      const basePrice = await retrieveTokenValueByAddress(mintAddress);
      if (basePrice) {
        // This is a placeholder - in a real implementation, we would get actual market data
        const marketConditions = analyzeMarketConditions(
          { m5: 2, h1: 5, h6: 10, h24: 15 }, // Price changes
          { m5: 1000, h1: 5000, h6: 20000, h24: 50000 }, // Volumes
          { 
            m5: { buys: 10, sells: 5 },
            h1: { buys: 50, sells: 30 }
          } // Transactions
        );
        
        // Calculate position size based on market conditions
        const calculatedSize = calculatePositionSize(
          Number(quoteAmount.raw),
          marketConditions
        );
        
        if (calculatedSize > 0) {
          // Apply risk adjustment to position size
          const riskAdjustedSize = adjustPositionSizeByRisk(calculatedSize);
          positionSize = BigInt(Math.floor(riskAdjustedSize));
          
          logger.info(
            { mint: accountData.baseMint, confidence: marketConditions.confidence },
            `Using dynamic position size: ${riskAdjustedSize} (${marketConditions.reason}, risk: ${RISK_LEVEL})`
          );
        } else {
          logger.info(
            { mint: accountData.baseMint },
            `Skipping buy due to market conditions: ${marketConditions.reason}`
          );
          activeTransactions.delete(mintAddress);
          return;
        }
      }
    }
    
    // Calculate optimal swap amount based on pool data
    const optimalAmount = calculateOptimalSwapAmount(accountData, MAX_SLIPPAGE_PERCENT);
    const finalAmount = BigInt(Math.min(Number(positionSize), optimalAmount));
    
    if (Number(finalAmount) <= 0) {
      logger.info(
        { mint: accountData.baseMint },
        `Skipping buy due to insufficient optimal swap amount`
      );
      activeTransactions.delete(mintAddress);
      return;
    }

    tokenAccount.poolKeys = createPoolKeys(accountId, accountData, tokenAccount.market!);
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: tokenAccount.poolKeys,
        userKeys: {
          tokenAccountIn: quoteTokenAssociatedAddress,
          tokenAccountOut: tokenAccount.address,
          owner: wallet.publicKey,
        },
        amountIn: finalAmount,
        minAmountOut: 0,
      },
      tokenAccount.poolKeys.version,
    );

    const latestBlockhash = await solanaConnection.getLatestBlockhash({
      commitment: commitment,
    });
    
    // Get optimal compute unit price
    const computeUnitPrice = await getOptimalComputeUnitPrice(solanaConnection);
    
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          tokenAccount.address,
          wallet.publicKey,
          accountData.baseMint,
        ),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);
    const rawTransaction = transaction.serialize();
    
    const signature = await retry(
      () =>
        solanaConnection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        }),
      { retryIntervalMs: 10, retries: 10 }, // Reduced retries for faster response
    );
    
    logger.info({ mint: accountData.baseMint, signature }, `Sent tx order`);
    
    // Increment daily trade count for risk management
    dailyTradeCount++;
    
    // Process confirmation in the background
    processBuyConfirmation(signature, latestBlockhash, accountData, tokenAccount)
      .catch(error => {
        logger.error({ mint: accountData.baseMint, error }, 'Error in buy confirmation processing');
        activeTransactions.delete(mintAddress);
      });
    
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData.baseMint }, `Failed to buy token`);
    activeTransactions.delete(mintAddress);
  }
}

async function processBuyConfirmation(
  signature: string,
  latestBlockhash: any,
  accountData: LiquidityStateV4,
  tokenAccount: MinimalTokenAccountData
): Promise<void> {
  const mintAddress = accountData.baseMint.toString();
  
  try {
    const confirmation = await solanaConnection.confirmTransaction(
      {
        signature,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        blockhash: latestBlockhash.blockhash,
      },
      commitment,
    );
    
    // Get token balances in parallel
    const [baseValue, quoteValue] = await Promise.all([
      solanaConnection.getTokenAccountBalance(accountData.baseVault, commitment),
      solanaConnection.getTokenAccountBalance(accountData.quoteVault, commitment)
    ]);

    if (baseValue?.value?.uiAmount && quoteValue?.value?.uiAmount)
      tokenAccount.buyValue = quoteValue?.value?.uiAmount / baseValue?.value?.uiAmount;
      
    if (!confirmation.value.err) {
      logger.info(
        {
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${network}`,
          dex: `https://dexscreener.com/solana/${accountData.baseMint}?maker=${wallet.publicKey}`,
        },
        `Confirmed buy tx... Bought at: ${tokenAccount.buyValue} SOL`,
      );
    } else {
      logger.debug(confirmation.value.err);
      logger.info({ mint: accountData.baseMint, signature }, `Error confirming buy tx`);
    }
  } catch (error) {
    logger.error({ mint: accountData.baseMint, error }, 'Error confirming buy transaction');
  } finally {
    activeTransactions.delete(mintAddress);
  }
}

// UPDATE PROFIT
interface ProfitData {
  totalProfit: number;
}

const updateProfit = (newProfit: number): void => {
  const filePath = path.join(__dirname, 'totalProfit.json');

  // Update daily profit/loss for risk management
  dailyProfitLoss += newProfit;

  // Read the current totalProfit from the file
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading the file:', err);
      return;
    }

    let profitData: ProfitData;

    try {
      // Parse the existing data
      profitData = JSON.parse(data);
    } catch (parseError) {
      console.error('Error parsing the JSON data:', parseError);
      return;
    }

    // Update the total profit by adding the new profit
    profitData.totalProfit += newProfit;

    // Write the updated profit data back to the JSON file
    fs.writeFile(filePath, JSON.stringify(profitData, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        console.error('Error writing to the file:', writeErr);
      } else {
        console.log('Profit updated successfully');
      }
    });
  });
};

async function sell(accountId: PublicKey, mint: PublicKey, amount: BigNumberish, value: number): Promise<boolean> {
  const mintAddress = mint.toString();
  
  // Check if trading is allowed based on trading hours
  if (!isTradingAllowed()) {
    logger.debug('Selling not allowed during current hours');
    return false;
  }
  
  // Prevent duplicate transactions for the same mint
  if (activeTransactions.has(mintAddress)) {
    return false;
  }
  
  activeTransactions.add(mintAddress);
  
  let retries = 0;

  do {
    try {
      const tokenAccount = existingTokenAccounts.get(mintAddress);
      if (!tokenAccount) {
        activeTransactions.delete(mintAddress);
        return true;
      }

      if (!tokenAccount.poolKeys) {
        logger.warn({ mint }, 'No pool keys found');
        continue;
      }

      if (amount === 0) {
        logger.info(
          {
            mint: tokenAccount.mint,
          },
          `Empty balance, can't sell`,
        );
        activeTransactions.delete(mintAddress);
        return true;
      }

      // Check stop loss/take profit
      if (tokenAccount.buyValue === undefined) {
        activeTransactions.delete(mintAddress);
        return true;
      }

      const netChange = (value - tokenAccount.buyValue) / tokenAccount.buyValue;
      if (netChange > STOP_LOSS && netChange < TAKE_PROFIT) {
        activeTransactions.delete(mintAddress);
        return false;
      }

      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: tokenAccount.poolKeys!,
          userKeys: {
            tokenAccountOut: quoteTokenAssociatedAddress,
            tokenAccountIn: tokenAccount.address,
            owner: wallet.publicKey,
          },
          amountIn: amount,
          minAmountOut: 0,
        },
        tokenAccount.poolKeys!.version,
      );

      const latestBlockhash = await solanaConnection.getLatestBlockhash({
        commitment: commitment,
      });
      
      // Get optimal compute unit price
      const computeUnitPrice = await getOptimalComputeUnitPrice(solanaConnection);
      
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPrice }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
          ...innerTransaction.instructions,
          createCloseAccountInstruction(tokenAccount.address, wallet.publicKey, wallet.publicKey),
        ],
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);
      const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: commitment,
      });
      logger.info({ mint, signature }, `Sent sell order tx`);
      
      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        commitment,
      );
      
      if (confirmation.value.err) {
        logger.debug(confirmation.value.err);
        logger.info({ mint, signature }, `Error confirming sell tx`);
        continue;
      }

      logger.info(
        {
          mint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${network}`,
          dex: `https://dexscreener.com/solana/${mint}?maker=${wallet.publicKey}`,
        },
        `Confirmed sell tx... Sold at: ${value}\tNet Profit: ${netChange * 100}%`,
      );
      
      updateProfit(netChange * 100);
      activeTransactions.delete(mintAddress);
      return true;
    } catch (e: any) {
      retries++;
      logger.debug(e);
      logger.error({ mint }, `Failed to sell token, retry: ${retries}/${MAX_SELL_RETRIES}`);
    }
  } while (retries < MAX_SELL_RETRIES);
  
  activeTransactions.delete(mintAddress);
  return true;
}

// Main execution
(async () => {
  try {
    await init();
    
    // Set up periodic snipe list refresh
    if (USE_SNIPE_LIST) {
      setInterval(async () => {
        await loadSnipeListAsync();
      }, SNIPE_LIST_REFRESH_INTERVAL);
    }
    
    // Subscribe to Raydium liquidity pools
    const raydiumPoolSubscriptionId = solanaConnection.onProgramAccountChange(
      RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
      async (updatedAccountInfo) => {
        try {
          if (existingLiquidityPools.has(updatedAccountInfo.accountId.toString())) {
            return;
          }
          existingLiquidityPools.add(updatedAccountInfo.accountId.toString());

          const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
          
          // Process pool in the background to avoid blocking
          processRaydiumPool(updatedAccountInfo.accountId, poolState)
            .catch(error => {
              logger.error({ error }, 'Error processing Raydium pool');
            });
        } catch (e) {
          logger.debug(e);
        }
      },
      commitment,
    );

    // Subscribe to OpenBook markets
    const openBookSubscriptionId = solanaConnection.onProgramAccountChange(
      OPENBOOK_PROGRAM_ID,
      async (updatedAccountInfo) => {
        try {
          if (existingOpenBookMarkets.has(updatedAccountInfo.accountId.toString())) {
            return;
          }
          existingOpenBookMarkets.add(updatedAccountInfo.accountId.toString());
          
          // Process market in the background to avoid blocking
          processOpenBookMarket(updatedAccountInfo)
            .catch(error => {
              logger.error({ error }, 'Error processing OpenBook market');
            });
        } catch (e) {
          logger.debug(e);
        }
      },
      commitment,
    );

    // Auto sell monitoring
    if (AUTO_SELL) {
      setInterval(async () => {
        try {
          const tokenAccounts = await getTokenAccounts(solanaConnection, wallet.publicKey, commitment);
          for (const tokenAccount of tokenAccounts) {
            const accountData = existingTokenAccounts.get(tokenAccount.accountInfo.mint.toString());
            if (!accountData || !accountData.buyValue) continue;

            const currValue = await retrieveTokenValueByAddress(tokenAccount.accountInfo.mint.toString());
            if (!currValue) continue;

            let completed = await sell(
              new PublicKey('11111111111111111111111111111111'), // Placeholder
              accountData.mint,
              tokenAccount.accountInfo.amount,
              currValue,
            );
          }
        } catch (e) {
          logger.debug(e);
        }
      }, Number(retrieveEnvVariable('AUTO_SELL_DELAY', logger)));
    }

    // Log trading status based on trading hours
    setInterval(() => {
      const tradingAllowed = isTradingAllowed();
      const tradingStatus = tradingAllowed ? 'enabled' : 'disabled';
      logger.debug(`Trading is currently ${tradingStatus} (Hour: ${new Date().getHours()}, Range: ${TRADING_START_HOUR}-${TRADING_END_HOUR})`);
      
      // Log risk management status
      logger.debug(`Risk management: ${dailyTradeCount}/${MAX_DAILY_TRADES} trades, P/L: ${dailyProfitLoss.toFixed(2)}%`);
    }, 300000); // Log every 5 minutes

    logger.info('Bot started successfully');
  } catch (error) {
    logger.error('Failed to initialize bot:', error);
    process.exit(1);
  }
})();
