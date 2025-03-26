/**
 * Price impact protection feature
 * Calculates and limits price impact of trades to protect from excessive slippage
 */

import { PublicKey } from '@solana/web3.js';
import { LiquidityStateV4 } from '@raydium-io/raydium-sdk';

// Import from global scope
declare const logger: any;
declare const tokenAccountCache: any;

/**
 * Calculate the estimated price impact of a swap
 * @param poolState The liquidity pool state
 * @param inputAmount The amount being swapped in
 * @param isBaseToQuote Direction of swap (true if swapping base token for quote token)
 * @returns Estimated price impact as a percentage
 */
export function calculatePriceImpact(
  poolState: LiquidityStateV4,
  inputAmount: bigint,
  isBaseToQuote: boolean
): number {
  try {
    // Get pool reserves
    const baseReserve = poolState.baseReserve.toNumber();
    const quoteReserve = poolState.quoteReserve.toNumber();
    
    if (baseReserve <= 0 || quoteReserve <= 0) {
      return 100; // Maximum price impact if reserves are invalid
    }
    
    // Calculate current price
    const currentPrice = quoteReserve / baseReserve;
    
    // Calculate new reserves after swap
    let newBaseReserve, newQuoteReserve;
    const inputAmountNumber = Number(inputAmount);
    
    if (isBaseToQuote) {
      // Swapping base token for quote token
      newBaseReserve = baseReserve + inputAmountNumber;
      // Calculate output amount using constant product formula: k = x * y
      const k = baseReserve * quoteReserve;
      newQuoteReserve = k / newBaseReserve;
    } else {
      // Swapping quote token for base token
      newQuoteReserve = quoteReserve + inputAmountNumber;
      // Calculate output amount using constant product formula: k = x * y
      const k = baseReserve * quoteReserve;
      newBaseReserve = k / newQuoteReserve;
    }
    
    // Calculate new price
    const newPrice = newQuoteReserve / newBaseReserve;
    
    // Calculate price impact
    let priceImpact: number;
    if (isBaseToQuote) {
      priceImpact = ((currentPrice - newPrice) / currentPrice) * 100;
    } else {
      priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;
    }
    
    return Math.abs(priceImpact);
  } catch (e) {
    logger.error('Error calculating price impact:', e);
    return 100; // Return maximum price impact on error
  }
}

/**
 * Check if a trade should proceed based on price impact
 * @param poolState The liquidity pool state
 * @param inputAmount The amount being swapped in
 * @param isBaseToQuote Direction of swap
 * @param maxPriceImpactPercent Maximum allowed price impact percentage
 * @returns Object indicating if trade should proceed and the calculated price impact
 */
export function checkPriceImpact(
  poolState: LiquidityStateV4,
  inputAmount: bigint,
  isBaseToQuote: boolean,
  maxPriceImpactPercent: number
): { shouldProceed: boolean; priceImpact: number } {
  // Calculate price impact
  const priceImpact = calculatePriceImpact(poolState, inputAmount, isBaseToQuote);
  
  // Check if price impact exceeds maximum allowed
  const shouldProceed = priceImpact <= maxPriceImpactPercent;
  
  if (!shouldProceed) {
    logger.warn(
      `High price impact detected: ${priceImpact.toFixed(2)}% exceeds maximum ${maxPriceImpactPercent}%`
    );
  }
  
  return { shouldProceed, priceImpact };
}
