import {
  Commitment, Connection, PublicKey
} from '@solana/web3.js';
import {
  Liquidity,
  LiquidityPoolKeys,
  Market,
  TokenAccount,
  SPL_ACCOUNT_LAYOUT,
  publicKey,
  struct,
  MAINNET_PROGRAM_ID,
  LiquidityStateV4,
} from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { MinimalMarketLayoutV3 } from '../market';
import NodeCache from 'node-cache';

// Initialize cache with 2 minute TTL for liquidity data
const liquidityCache = new NodeCache({ stdTTL: 120, checkperiod: 30 });

export const RAYDIUM_LIQUIDITY_PROGRAM_ID_V4 = MAINNET_PROGRAM_ID.AmmV4;
export const OPENBOOK_PROGRAM_ID = MAINNET_PROGRAM_ID.OPENBOOK_MARKET;

export const MINIMAL_MARKET_STATE_LAYOUT_V3 = struct([
  publicKey('eventQueue'),
  publicKey('bids'),
  publicKey('asks'),
]);

/**
 * Create pool keys with caching for improved performance
 */
export function createPoolKeys(
  id: PublicKey,
  accountData: LiquidityStateV4,
  minimalMarketLayoutV3: MinimalMarketLayoutV3,
): LiquidityPoolKeys {
  const cacheKey = `pool_${id.toString()}`;
  
  // Check cache first
  const cachedPool = liquidityCache.get<LiquidityPoolKeys>(cacheKey);
  if (cachedPool) {
    return cachedPool;
  }
  
  // Create pool keys if not in cache
  const poolKeys = {
    id,
    baseMint: accountData.baseMint,
    quoteMint: accountData.quoteMint,
    lpMint: accountData.lpMint,
    baseDecimals: accountData.baseDecimal.toNumber(),
    quoteDecimals: accountData.quoteDecimal.toNumber(),
    lpDecimals: 5,
    version: 4,
    programId: RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    authority: Liquidity.getAssociatedAuthority({
      programId: RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    }).publicKey,
    openOrders: accountData.openOrders,
    targetOrders: accountData.targetOrders,
    baseVault: accountData.baseVault,
    quoteVault: accountData.quoteVault,
    marketVersion: 3,
    marketProgramId: accountData.marketProgramId,
    marketId: accountData.marketId,
    marketAuthority: Market.getAssociatedAuthority({
      programId: accountData.marketProgramId,
      marketId: accountData.marketId,
    }).publicKey,
    marketBaseVault: accountData.baseVault,
    marketQuoteVault: accountData.quoteVault,
    marketBids: minimalMarketLayoutV3.bids,
    marketAsks: minimalMarketLayoutV3.asks,
    marketEventQueue: minimalMarketLayoutV3.eventQueue,
    withdrawQueue: accountData.withdrawQueue,
    lpVault: accountData.lpVault,
    lookupTableAccount: PublicKey.default,
  };
  
  // Cache the result
  liquidityCache.set(cacheKey, poolKeys);
  
  return poolKeys;
}

/**
 * Get token accounts with batching for improved performance
 */
export async function getTokenAccounts(
  connection: Connection,
  owner: PublicKey,
  commitment?: Commitment,
): Promise<TokenAccount[]> {
  const cacheKey = `token_accounts_${owner.toString()}`;
  
  // Check cache first
  const cachedAccounts = liquidityCache.get<TokenAccount[]>(cacheKey);
  if (cachedAccounts) {
    return cachedAccounts;
  }
  
  // Fetch from network if not in cache
  const tokenResp = await connection.getTokenAccountsByOwner(
    owner,
    {
      programId: TOKEN_PROGRAM_ID,
    },
    commitment,
  );

  const accounts: TokenAccount[] = [];
  for (const { pubkey, account } of tokenResp.value) {
    accounts.push({
      pubkey,
      programId: account.owner,
      accountInfo: SPL_ACCOUNT_LAYOUT.decode(account.data),
    });
  }
  
  // Cache the result with a shorter TTL (30 seconds) as token accounts change frequently
  liquidityCache.set(cacheKey, accounts, 30);
  
  return accounts;
}

/**
 * Analyze liquidity pool for trading opportunities
 */
export function analyzeLiquidityPool(
  poolData: LiquidityStateV4,
  basePrice: number,
  quotePrice: number = 1 // Default for USDC or SOL
): {
  liquidity: number;
  slippage: number;
  tradingScore: number;
  recommendation: 'buy' | 'sell' | 'hold';
} {
  // Calculate total liquidity in USD
  const baseLiquidity = poolData.baseReserve.toNumber() * basePrice;
  const quoteLiquidity = poolData.quoteReserve.toNumber() * quotePrice;
  const totalLiquidity = baseLiquidity + quoteLiquidity;
  
  // Calculate estimated slippage for a trade of 1% of the pool
  const tradeSize = totalLiquidity * 0.01;
  const k = poolData.baseReserve.toNumber() * poolData.quoteReserve.toNumber();
  const newQuoteReserve = poolData.quoteReserve.toNumber() + tradeSize;
  const newBaseReserve = k / newQuoteReserve;
  const baseReceived = poolData.baseReserve.toNumber() - newBaseReserve;
  const effectivePrice = tradeSize / baseReceived;
  const currentPrice = poolData.quoteReserve.toNumber() / poolData.baseReserve.toNumber();
  const slippage = (effectivePrice / currentPrice - 1) * 100;
  
  // Calculate trading score (0-100)
  // Higher liquidity and lower slippage = better score
  const liquidityScore = Math.min(totalLiquidity / 10000, 50); // Max 50 points for liquidity
  const slippageScore = Math.max(0, 50 - slippage * 10); // Max 50 points for low slippage
  const tradingScore = liquidityScore + slippageScore;
  
  // Determine recommendation
  let recommendation: 'buy' | 'sell' | 'hold' = 'hold';
  
  if (tradingScore > 70) {
    recommendation = 'buy';
  } else if (tradingScore < 30) {
    recommendation = 'sell';
  }
  
  return {
    liquidity: totalLiquidity,
    slippage,
    tradingScore,
    recommendation
  };
}

/**
 * Clear liquidity cache for specific pools or all pools
 */
export function clearLiquidityCache(poolIds?: PublicKey[]): void {
  if (!poolIds) {
    liquidityCache.flushAll();
    return;
  }
  
  for (const poolId of poolIds) {
    const cacheKey = `pool_${poolId.toString()}`;
    liquidityCache.del(cacheKey);
  }
}

/**
 * Calculate optimal swap amount based on pool data
 */
export function calculateOptimalSwapAmount(
  poolData: LiquidityStateV4,
  maxSlippagePercent: number = 1.0
): number {
  const baseReserve = poolData.baseReserve.toNumber();
  const quoteReserve = poolData.quoteReserve.toNumber();
  
  // Calculate constant product k
  const k = baseReserve * quoteReserve;
  
  // Calculate maximum input amount that would result in slippage <= maxSlippagePercent
  // Formula: maxInput = quoteReserve * (sqrt(1 + maxSlippage) - 1)
  const maxInput = quoteReserve * (Math.sqrt(1 + maxSlippagePercent / 100) - 1);
  
  return maxInput;
}
