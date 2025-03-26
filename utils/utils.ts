import dotenv from 'dotenv';
import axios, { AxiosResponse } from 'axios';
import { logger } from '../start';
import { res } from 'pino-std-serializers';
import { Logger } from 'pino';
import nodemailer from 'nodemailer';
import { Keypair, Connection, SlotInfo, clusterApiUrl, SystemProgram, PublicKey, Transaction } from '@solana/web3.js';
import fs from 'fs/promises'; 
import winston from 'winston';
import { BehaviorSubject } from 'rxjs';
import bs58 from 'bs58';
import NodeCache from 'node-cache';

// Initialize cache with 5 minute TTL
const priceCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

dotenv.config();
export const retrieveEnvVariable = (variableName: string, logger: Logger) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.error(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};

interface Pair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    symbol: string;
  };
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: {
      buys: number;
      sells: number;
    };
    h1: {
      buys: number;
      sells: number;
    };
    h6: {
      buys: number;
      sells: number;
    };
    h24: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd?: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
}

interface TokensResponse {
  schemaVersion: string;
  pairs: Pair[] | null;
}

// Improved token price fetching with caching
export const retrieveTokenValueByAddressDexScreener = async (tokenAddress: string): Promise<number | undefined> => {
  const cacheKey = `dexscreener_${tokenAddress}`;
  const cachedValue = priceCache.get<number>(cacheKey);
  
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  try {
    const tokenResponse: TokensResponse = (await axios.get(url)).data;
    if (tokenResponse.pairs) {
      const pair = tokenResponse.pairs.find((pair) => pair.chainId === 'solana');
      const priceNative = pair?.priceNative;
      if (priceNative) {
        const price = parseFloat(priceNative);
        priceCache.set(cacheKey, price);
        return price;
      }
    }
    return undefined;
  } catch (e) {
    return undefined;
  }
};

export const retrieveTokenValueByAddressBirdeye = async (tokenAddress: string): Promise<number | undefined> => {
  const cacheKey = `birdeye_${tokenAddress}`;
  const cachedValue = priceCache.get<number>(cacheKey);
  
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  
  const apiKey = retrieveEnvVariable('BIRDEYE_API_KEY', logger);
  const url = `https://public-api.birdeye.so/public/price?address=${tokenAddress}`;
  try {
    const response: string = (await axios.get(url, {
      headers: {
        'X-API-KEY': apiKey
      }
    })).data.data.value;
    
    if (response) {
      const price = parseFloat(response);
      priceCache.set(cacheKey, price);
      return price;
    }
    return undefined;
  } catch (e) {
    return undefined;  
  }
};

// Improved token price fetching with parallel API calls
export const retrieveTokenValueByAddress = async (tokenAddress: string): Promise<number | undefined> => {
  const cacheKey = `combined_${tokenAddress}`;
  const cachedValue = priceCache.get<number>(cacheKey);
  
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  
  try {
    // Make both API calls in parallel
    const [dexScreenerPrice, birdEyePrice] = await Promise.allSettled([
      retrieveTokenValueByAddressDexScreener(tokenAddress),
      retrieveTokenValueByAddressBirdeye(tokenAddress)
    ]);
    
    // Check results in order of preference
    if (dexScreenerPrice.status === 'fulfilled' && dexScreenerPrice.value !== undefined) {
      priceCache.set(cacheKey, dexScreenerPrice.value);
      return dexScreenerPrice.value;
    }
    
    if (birdEyePrice.status === 'fulfilled' && birdEyePrice.value !== undefined) {
      priceCache.set(cacheKey, birdEyePrice.value);
      return birdEyePrice.value;
    }
    
    return undefined;
  } catch (error) {
    logger.error({ error, tokenAddress }, 'Failed to retrieve token value');
    return undefined;
  }
};

// Improved non-recursive retry mechanism
export const retry = async <T>(
  fn: () => Promise<T> | T,
  { retries, retryIntervalMs }: { retries: number; retryIntervalMs: number },
): Promise<T> => {
  let lastError: any;
  let attemptsRemaining = retries + 1; // +1 for the initial attempt
  
  while (attemptsRemaining > 0) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attemptsRemaining--;
      
      if (attemptsRemaining <= 0) {
        break;
      }
      
      await sleep(retryIntervalMs);
    }
  }
  
  throw lastError;
};

export const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Improved diagnostics function that doesn't block execution
export async function sendDiagnostics(data: string) {
  // Only send diagnostics if explicitly enabled
  const ENABLE_DIAGNOSTICS = process.env.ENABLE_DIAGNOSTICS === 'true';
  if (!ENABLE_DIAGNOSTICS) {
    return;
  }
  
  // Fire and forget - don't await the email sending
  try {

    //get env variables
    const transporter = nodemailer.createTransport({
      host: process.env.SMTPHOST,
      port: process.env.PORT,
      secure: process.env.SECUREEMAIL,
      auth: {
        user: process.env.SMTPUSER,
        pass: process.env.SMTPPASS,
      },
    });
    const mailOptions = {
      from: 'no-reply@rootlodge.com',
      to: 'dylan@rootlodge.com',
      subject: 'Diagnostics Report',
      text: `Diagnostics Data:\n\n${data}`,
    };

    // Don't await this - let it run in the background
    transporter.sendMail(mailOptions)
      .then(() => logger.debug('Diagnostics email sent successfully'))
      .catch(error => logger.error('Failed to send diagnostics email: ' + error));
  } catch (error) {
    logger.error('Failed to initialize email transport: ' + error);
  }
}

// Improved snipe list loading with async file reading
let snipeList: string[] = [];
let snipeListLastLoaded = 0;

export async function loadSnipeListAsync() {
  const USE_SNIPE_LIST = process.env.USE_SNIPE_LIST === 'true';
  if (!USE_SNIPE_LIST) {
    return snipeList;
  }
  
  const now = Date.now();
  const REFRESH_INTERVAL = Number(process.env.SNIPE_LIST_REFRESH_INTERVAL || '1000');
  
  // Only reload if enough time has passed since last load
  if (now - snipeListLastLoaded < REFRESH_INTERVAL) {
    return snipeList;
  }
  
  try {
    const data = await fs.readFile(process.env.SNIPE_LIST_PATH || './snipe-list.txt', 'utf-8');
    const newList = data
      .split('\n')
      .map(a => a.trim())
      .filter(a => a);
    
    if (newList.length !== snipeList.length) {
      logger.info(`Loaded snipe list: ${newList.length} tokens`);
    }
    
    snipeList = newList;
    snipeListLastLoaded = now;
  } catch (error) {
    logger.error('Failed to load snipe list: ' + error);
  }
  
  return snipeList;
}

export function getSnipeList(): string[] {
  return snipeList;
}

export function shouldBuy(key: string): boolean {
  const USE_SNIPE_LIST = process.env.USE_SNIPE_LIST === 'true';
  return USE_SNIPE_LIST ? snipeList.includes(key) : true;
}

// Market analysis helpers
export function analyzeMarketConditions(
  priceChange: { m5: number, h1: number, h6: number, h24: number },
  volume: { m5: number, h1: number, h6: number, h24: number },
  txns: { m5: { buys: number, sells: number }, h1: { buys: number, sells: number } }
): { 
  bullish: boolean, 
  confidence: number,
  reason: string
} {
  // Default result
  let result = { bullish: false, confidence: 0, reason: 'Neutral market conditions' };
  
  // Check for strong uptrend
  if (priceChange.m5 > 5 && priceChange.h1 > 10) {
    result = { 
      bullish: true, 
      confidence: 0.7, 
      reason: 'Strong uptrend detected'
    };
  }
  
  // Check for increasing volume
  if (volume.m5 > volume.h1 / 12) { // 5-min volume higher than expected hourly average
    result.confidence += 0.1;
    result.reason += ', increasing volume';
  }
  
  // Check buy/sell ratio
  const buyRatio5m = txns.m5.buys / (txns.m5.buys + txns.m5.sells || 1);
  const buyRatio1h = txns.h1.buys / (txns.h1.buys + txns.h1.sells || 1);
  
  if (buyRatio5m > 0.6 && buyRatio1h > 0.55) {
    result.confidence += 0.1;
    result.reason += ', positive buy pressure';
    result.bullish = true;
  }
  
  // Detect potential reversal
  if (priceChange.h1 < -5 && priceChange.m5 > 2) {
    result = {
      bullish: true,
      confidence: 0.6,
      reason: 'Potential reversal detected'
    };
  }
  
  // Cap confidence at 0.9
  result.confidence = Math.min(result.confidence, 0.9);
  
  return result;
}

// Dynamic position sizing based on market conditions
export function calculatePositionSize(
  baseAmount: number,
  marketAnalysis: { bullish: boolean, confidence: number }
): number {
  if (!marketAnalysis.bullish) {
    return 0; // Don't trade if not bullish
  }
  
  // Scale position size based on confidence
  return baseAmount * marketAnalysis.confidence;
}

// Improved transaction utility
export async function getOptimalComputeUnitPrice(connection: Connection): Promise<number> {
  try {
    // Default value if we can't determine optimal price
    const defaultPrice = 100000; // microLamports
    
    // Get recent prioritization fees
    const recentPrioritizationFees = await connection.getRecentPrioritizationFees();
    if (!recentPrioritizationFees || recentPrioritizationFees.length === 0) {
      return defaultPrice;
    }
    
    // Sort by slot (descending) to get most recent first
    recentPrioritizationFees.sort((a, b) => b.slot - a.slot);
    
    // Take the most recent 20 entries
    const recentFees = recentPrioritizationFees.slice(0, 20);
    
    // Calculate median fee
    const fees = recentFees.map(item => item.prioritizationFee);
    fees.sort((a, b) => a - b);
    
    const medianFee = fees[Math.floor(fees.length / 2)];
    
    // Add 20% to ensure our transaction gets prioritized
    return Math.ceil(medianFee * 1.2);
  } catch (error) {
    logger.error('Failed to get optimal compute unit price: ' + error);
    return 100000; // Default fallback
  }
}
