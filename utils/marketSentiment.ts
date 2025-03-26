/**
 * Market sentiment analysis feature
 * Analyzes on-chain data to determine market sentiment for more informed trading decisions
 */

import { PublicKey } from '@solana/web3.js';
import NodeCache from 'node-cache';

// Import from global scope
declare const logger: any;
declare const solanaConnection: any;

// Cache for sentiment data
const sentimentCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 minute cache

// Sentiment levels
export enum SentimentLevel {
  VERY_BEARISH = 'VERY_BEARISH',
  BEARISH = 'BEARISH',
  NEUTRAL = 'NEUTRAL',
  BULLISH = 'BULLISH',
  VERY_BULLISH = 'VERY_BULLISH'
}

// Market sentiment data
export interface MarketSentiment {
  level: SentimentLevel;
  score: number; // -100 to 100
  confidence: number; // 0 to 100
  factors: {
    priceAction: number; // -100 to 100
    volumeTrend: number; // -100 to 100
    buyVsSellPressure: number; // -100 to 100
    liquidityChange: number; // -100 to 100
    whaleActivity: number; // -100 to 100
  };
  timestamp: number;
}

/**
 * Analyze recent transactions to determine buy vs sell pressure
 * @param mint Token mint address
 * @param timeWindowSeconds Time window in seconds to analyze
 * @returns Ratio of buys to sells (-100 to 100, positive means more buys)
 */
async function analyzeBuySellPressure(mint: PublicKey, timeWindowSeconds: number = 3600): Promise<number> {
  try {
    // Get recent signatures for the token's mint
    const signatures = await solanaConnection.getSignaturesForAddress(
      mint,
      { limit: 100 }
    );
    
    if (!signatures || signatures.length === 0) {
      return 0; // Neutral if no transactions
    }
    
    // Filter to recent transactions within time window
    const currentTime = Date.now() / 1000;
    const recentSignatures = signatures.filter(sig => 
      sig.blockTime && (currentTime - sig.blockTime) < timeWindowSeconds
    );
    
    if (recentSignatures.length === 0) {
      return 0; // Neutral if no recent transactions
    }
    
    // Get transaction details
    let buyCount = 0;
    let sellCount = 0;
    
    // Analyze a sample of transactions (up to 20) to determine if they're buys or sells
    const sampleSize = Math.min(recentSignatures.length, 20);
    for (let i = 0; i < sampleSize; i++) {
      try {
        const tx = await solanaConnection.getTransaction(recentSignatures[i].signature);
        if (!tx || !tx.meta) continue;
        
        // Simplified heuristic: if token balance increases for a wallet, it's a buy
        // If it decreases, it's a sell
        const preTokenBalances = tx.meta.preTokenBalances || [];
        const postTokenBalances = tx.meta.postTokenBalances || [];
        
        // Find balances for this mint
        const preBalances = preTokenBalances.filter(b => b.mint === mint.toString());
        const postBalances = postTokenBalances.filter(b => b.mint === mint.toString());
        
        // Compare pre and post balances
        for (const postBalance of postBalances) {
          const preBalance = preBalances.find(b => b.owner === postBalance.owner);
          
          if (preBalance) {
            const preAmount = Number(preBalance.uiTokenAmount.amount);
            const postAmount = Number(postBalance.uiTokenAmount.amount);
            
            if (postAmount > preAmount) {
              buyCount++;
            } else if (postAmount < preAmount) {
              sellCount++;
            }
          } else if (Number(postBalance.uiTokenAmount.amount) > 0) {
            // New holder, consider it a buy
            buyCount++;
          }
        }
      } catch (e) {
        // Skip problematic transactions
        continue;
      }
    }
    
    // Calculate buy/sell ratio and normalize to -100 to 100 scale
    const totalTransactions = buyCount + sellCount;
    if (totalTransactions === 0) return 0;
    
    const buyRatio = buyCount / totalTransactions;
    // Convert 0-1 ratio to -100 to 100 scale (0.5 becomes 0, 1 becomes 100, 0 becomes -100)
    return Math.round((buyRatio - 0.5) * 200);
    
  } catch (e) {
    logger.error('Error analyzing buy/sell pressure:', e);
    return 0; // Neutral on error
  }
}

/**
 * Analyze price action trend
 * @param priceChanges Object containing price changes at different time intervals
 * @returns Price action score (-100 to 100)
 */
function analyzePriceAction(priceChanges: { 
  m5?: number, 
  h1?: number, 
  h6?: number, 
  h24?: number 
}): number {
  // Weight factors for different time periods
  const weights = {
    m5: 0.1,   // 5 minutes
    h1: 0.2,   // 1 hour
    h6: 0.3,   // 6 hours
    h24: 0.4   // 24 hours
  };
  
  let weightedSum = 0;
  let totalWeight = 0;
  
  // Calculate weighted average of price changes
  for (const [period, weight] of Object.entries(weights)) {
    if (priceChanges[period] !== undefined) {
      weightedSum += priceChanges[period] * weight;
      totalWeight += weight;
    }
  }
  
  // If no data available, return neutral
  if (totalWeight === 0) return 0;
  
  // Normalize to -100 to 100 scale
  const normalizedScore = weightedSum / totalWeight;
  return Math.max(-100, Math.min(100, normalizedScore));
}

/**
 * Analyze volume trend
 * @param volumes Object containing trading volumes at different time intervals
 * @returns Volume trend score (-100 to 100)
 */
function analyzeVolumeTrend(volumes: {
  m5?: number,
  h1?: number,
  h6?: number,
  h24?: number
}): number {
  // Need at least two data points to determine a trend
  if (!volumes.h1 || !volumes.h24) return 0;
  
  // Calculate hourly average from 24h volume
  const hourlyAverage = volumes.h24 / 24;
  
  // Compare recent volume to average
  const volumeRatio = volumes.h1 / hourlyAverage;
  
  // Convert ratio to score:
  // 1.0 = neutral (0)
  // 2.0 = very bullish (100)
  // 0.5 = very bearish (-100)
  let score = 0;
  
  if (volumeRatio >= 1) {
    // Increasing volume (0 to 100)
    score = Math.min(100, (volumeRatio - 1) * 100);
  } else {
    // Decreasing volume (0 to -100)
    score = Math.max(-100, (volumeRatio - 1) * 200);
  }
  
  return score;
}

/**
 * Analyze liquidity changes
 * @param currentLiquidity Current liquidity in the pool
 * @param previousLiquidity Previous liquidity measurement
 * @returns Liquidity change score (-100 to 100)
 */
function analyzeLiquidityChange(currentLiquidity: number, previousLiquidity: number): number {
  if (!previousLiquidity || previousLiquidity === 0) return 0;
  
  // Calculate percentage change
  const percentChange = ((currentLiquidity - previousLiquidity) / previousLiquidity) * 100;
  
  // Cap at -100 to 100
  return Math.max(-100, Math.min(100, percentChange));
}

/**
 * Detect whale activity by analyzing large transactions
 * @param mint Token mint address
 * @param timeWindowSeconds Time window in seconds to analyze
 * @returns Whale activity score (-100 to 100, positive means buying, negative means selling)
 */
async function detectWhaleActivity(mint: PublicKey, timeWindowSeconds: number = 3600): Promise<number> {
  try {
    // Get recent signatures for the token's mint
    const signatures = await solanaConnection.getSignaturesForAddress(
      mint,
      { limit: 50 }
    );
    
    if (!signatures || signatures.length === 0) {
      return 0; // No whale activity
    }
    
    // Filter to recent transactions within time window
    const currentTime = Date.now() / 1000;
    const recentSignatures = signatures.filter(sig => 
      sig.blockTime && (currentTime - sig.blockTime) < timeWindowSeconds
    );
    
    if (recentSignatures.length === 0) {
      return 0; // No recent whale activity
    }
    
    // Analyze transactions to find large transfers
    let largeInflows = 0;
    let largeOutflows = 0;
    
    // Get transaction details for a sample
    const sampleSize = Math.min(recentSignatures.length, 10);
    for (let i = 0; i < sampleSize; i++) {
      try {
        const tx = await solanaConnection.getTransaction(recentSignatures[i].signature);
        if (!tx || !tx.meta) continue;
        
        const preTokenBalances = tx.meta.preTokenBalances || [];
        const postTokenBalances = tx.meta.postTokenBalances || [];
        
        // Find balances for this mint
        const preBalances = preTokenBalances.filter(b => b.mint === mint.toString());
        const postBalances = postTokenBalances.filter(b => b.mint === mint.toString());
        
        // Look for large changes in balances
        for (const postBalance of postBalances) {
          const preBalance = preBalances.find(b => b.owner === postBalance.owner);
          
          if (preBalance) {
            const preAmount = Number(preBalance.uiTokenAmount.amount);
            const postAmount = Number(postBalance.uiTokenAmount.amount);
            const change = postAmount - preAmount;
            
            // Define "large" as 5% or more of total supply (simplified heuristic)
            // In a real implementation, you would compare to total supply
            if (Math.abs(change) > 1000000) {
              if (change > 0) {
                largeInflows += change;
              } else {
                largeOutflows += Math.abs(change);
              }
            }
          }
        }
      } catch (e) {
        // Skip problematic transactions
        continue;
      }
    }
    
    // Calculate net flow
    const netFlow = largeInflows - largeOutflows;
    const totalFlow = largeInflows + largeOutflows;
    
    // If no large flows, return 0
    if (totalFlow === 0) return 0;
    
    // Normalize to -100 to 100 scale
    return Math.max(-100, Math.min(100, (netFlow / totalFlow) * 100));
    
  } catch (e) {
    logger.error('Error detecting whale activity:', e);
    return 0; // Neutral on error
  }
}

/**
 * Get market sentiment for a token
 * @param mint Token mint address
 * @param priceChanges Recent price changes at different time intervals
 * @param volumes Trading volumes at different time intervals
 * @param currentLiquidity Current liquidity in the pool
 * @param previousLiquidity Previous liquidity measurement
 * @returns Market sentiment analysis
 */
export async function getMarketSentiment(
  mint: PublicKey,
  priceChanges: { m5?: number, h1?: number, h6?: number, h24?: number },
  volumes: { m5?: number, h1?: number, h6?: number, h24?: number },
  currentLiquidity: number,
  previousLiquidity: number
): Promise<MarketSentiment> {
  // Check cache first
  const cacheKey = `sentiment_${mint.toString()}`;
  const cachedSentiment = sentimentCache.get<MarketSentiment>(cacheKey);
  
  if (cachedSentiment) {
    return cachedSentiment;
  }
  
  // Analyze different factors
  const priceActionScore = analyzePriceAction(priceChanges);
  const volumeTrendScore = analyzeVolumeTrend(volumes);
  
  // These operations can be expensive, so we run them in parallel
  const [buyVsSellPressure, whaleActivity] = await Promise.all([
    analyzeBuySellPressure(mint),
    detectWhaleActivity(mint)
  ]);
  
  const liquidityChangeScore = analyzeLiquidityChange(currentLiquidity, previousLiquidity);
  
  // Calculate overall sentiment score (weighted average)
  const weights = {
    priceAction: 0.3,
    volumeTrend: 0.2,
    buyVsSellPressure: 0.2,
    liquidityChange: 0.15,
    whaleActivity: 0.15
  };
  
  const factors = {
    priceAction: priceActionScore,
    volumeTrend: volumeTrendScore,
    buyVsSellPressure: buyVsSellPressure,
    liquidityChange: liquidityChangeScore,
    whaleActivity: whaleActivity
  };
  
  let overallScore = 0;
  for (const [factor, weight] of Object.entries(weights)) {
    overallScore += factors[factor] * weight;
  }
  
  // Round to nearest integer
  overallScore = Math.round(overallScore);
  
  // Calculate confidence (higher when factors agree with each other)
  const factorValues = Object.values(factors);
  const factorVariance = factorValues.reduce((sum, value) => 
    sum + Math.pow(value - overallScore, 2), 0) / factorValues.length;
  
  // Convert variance to confidence (0-100)
  // Lower variance = higher confidence
  const confidence = Math.max(0, Math.min(100, 100 - Math.sqrt(factorVariance) / 2));
  
  // Determine sentiment level
  let level: SentimentLevel;
  if (overallScore >= 60) {
    level = SentimentLevel.VERY_BULLISH;
  } else if (overallScore >= 20) {
    level = SentimentLevel.BULLISH;
  } else if (overallScore > -20) {
    level = SentimentLevel.NEUTRAL;
  } else if (overallScore > -60) {
    level = SentimentLevel.BEARISH;
  } else {
    level = SentimentLevel.VERY_BEARISH;
  }
  
  // Create sentiment object
  const sentiment: MarketSentiment = {
    level,
    score: overallScore,
    confidence,
    factors,
    timestamp: Date.now()
  };
  
  // Cache the result
  sentimentCache.set(cacheKey, sentiment);
  
  return sentiment;
}

/**
 * Determine if a trade should proceed based on market sentiment
 * @param sentiment Market sentiment analysis
 * @param minConfidence Minimum confidence required (0-100)
 * @param requiredSentiment Minimum sentiment level required for buying
 * @returns Whether the trade should proceed
 */
export function shouldTradeBasedOnSentiment(
  sentiment: MarketSentiment,
  minConfidence: number = 60,
  requiredSentiment: SentimentLevel = SentimentLevel.NEUTRAL
): boolean {
  // Check confidence threshold
  if (sentiment.confidence < minConfidence) {
    logger.info(`Market sentiment confidence too low: ${sentiment.confidence}% < ${minConfidence}%`);
    return false;
  }
  
  // Convert sentiment levels to numeric values for comparison
  const sentimentValues = {
    [SentimentLevel.VERY_BEARISH]: 1,
    [SentimentLevel.BEARISH]: 2,
    [SentimentLevel.NEUTRAL]: 3,
    [SentimentLevel.BULLISH]: 4,
    [SentimentLevel.VERY_BULLISH]: 5
  };
  
  const currentValue = sentimentValues[sentiment.level];
  const requiredValue = sentimentValues[requiredSentiment];
  
  // Check if current sentiment meets or exceeds required level
  if (currentValue < requiredValue) {
    logger.info(`Market sentiment too low: ${sentiment.level} < ${requiredSentiment}`);
    return false;
  }
  
  return true;
}
