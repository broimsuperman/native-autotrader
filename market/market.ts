import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { GetStructureSchema, MARKET_STATE_LAYOUT_V3 } from '@raydium-io/raydium-sdk';
import { MINIMAL_MARKET_STATE_LAYOUT_V3 } from '../liquidity';
import NodeCache from 'node-cache';

// Initialize cache with 2 minute TTL for market data
const marketCache = new NodeCache({ stdTTL: 120, checkperiod: 30 });

export type MinimalMarketStateLayoutV3 = typeof MINIMAL_MARKET_STATE_LAYOUT_V3;
export type MinimalMarketLayoutV3 = GetStructureSchema<MinimalMarketStateLayoutV3>;

/**
 * Get minimal market data with caching for improved performance
 */
export async function getMinimalMarketV3(
  connection: Connection,
  marketId: PublicKey,
  commitment?: Commitment,
): Promise<MinimalMarketLayoutV3> {
  const cacheKey = `market_${marketId.toString()}`;
  
  // Check cache first
  const cachedMarket = marketCache.get<MinimalMarketLayoutV3>(cacheKey);
  if (cachedMarket) {
    return cachedMarket;
  }
  
  // Fetch from network if not in cache
  const marketInfo = await connection.getAccountInfo(marketId, {
    commitment,
    dataSlice: {
      offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
      length: 32 * 3,
    },
  });

  if (!marketInfo || !marketInfo.data) {
    throw new Error(`Failed to get market info for ${marketId.toString()}`);
  }

  const decodedMarket = MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo.data);
  
  // Cache the result
  marketCache.set(cacheKey, decodedMarket);
  
  return decodedMarket;
}

/**
 * Batch fetch multiple markets for improved performance
 */
export async function batchGetMinimalMarkets(
  connection: Connection,
  marketIds: PublicKey[],
  commitment?: Commitment,
): Promise<Map<string, MinimalMarketLayoutV3>> {
  // Filter out markets we already have in cache
  const cachedMarkets = new Map<string, MinimalMarketLayoutV3>();
  const marketsToFetch: PublicKey[] = [];
  
  for (const marketId of marketIds) {
    const cacheKey = `market_${marketId.toString()}`;
    const cachedMarket = marketCache.get<MinimalMarketLayoutV3>(cacheKey);
    
    if (cachedMarket) {
      cachedMarkets.set(marketId.toString(), cachedMarket);
    } else {
      marketsToFetch.push(marketId);
    }
  }
  
  // If all markets are cached, return early
  if (marketsToFetch.length === 0) {
    return cachedMarkets;
  }
  
  // Fetch remaining markets in batches of 100
  const batchSize = 100;
  const results = new Map<string, MinimalMarketLayoutV3>();
  
  // Merge cached results
  for (const [key, value] of cachedMarkets.entries()) {
    results.set(key, value);
  }
  
  // Process in batches
  for (let i = 0; i < marketsToFetch.length; i += batchSize) {
    const batch = marketsToFetch.slice(i, i + batchSize);
    const marketInfos = await connection.getMultipleAccountsInfo(
      batch,
      commitment
    );
    
    for (let j = 0; j < batch.length; j++) {
      const marketId = batch[j];
      const marketInfo = marketInfos[j];
      
      if (marketInfo && marketInfo.data) {
        try {
          const decodedMarket = MINIMAL_MARKET_STATE_LAYOUT_V3.decode(marketInfo.data);
          const cacheKey = `market_${marketId.toString()}`;
          
          // Cache the result
          marketCache.set(cacheKey, decodedMarket);
          results.set(marketId.toString(), decodedMarket);
        } catch (error) {
          console.error(`Failed to decode market ${marketId.toString()}:`, error);
        }
      }
    }
  }
  
  return results;
}

/**
 * Clear market cache for specific markets or all markets
 */
export function clearMarketCache(marketIds?: PublicKey[]): void {
  if (!marketIds) {
    marketCache.flushAll();
    return;
  }
  
  for (const marketId of marketIds) {
    const cacheKey = `market_${marketId.toString()}`;
    marketCache.del(cacheKey);
  }
}

/**
 * Get market statistics for analysis
 */
export async function getMarketStatistics(
  connection: Connection,
  marketId: PublicKey,
): Promise<{
  spread: number;
  depth: number;
  volume24h?: number;
}> {
  // This would require additional API calls to get order book data
  // For now, return placeholder data
  return {
    spread: 0.01, // 1% spread
    depth: 1000,  // $1000 of depth
  };
}
