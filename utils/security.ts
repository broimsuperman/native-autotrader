import { PublicKey } from '@solana/web3.js';
import { MintLayout } from '../types';
import NodeCache from 'node-cache';

// Import from global scope
declare const solanaConnection: any;
declare const logger: any;
declare const tokenAccountCache: NodeCache;
declare const CHECK_IF_MINT_IS_RENOUNCED: boolean;
declare const CHECK_IF_MINT_IS_FREEZABLE: boolean;
declare const CHECK_IF_MINT_IS_MINTABLE: boolean;

/**
 * Enhanced token security checks to prevent buying tokens that are mintable or freezable
 */
export async function checkTokenSecurity(mint: PublicKey): Promise<{ isSafe: boolean, reason?: string }> {
  try {
    // Check if we should skip security checks entirely
    if (!CHECK_IF_MINT_IS_RENOUNCED && !CHECK_IF_MINT_IS_FREEZABLE && !CHECK_IF_MINT_IS_MINTABLE) {
      return { isSafe: true };
    }
    
    const cacheKey = `security_${mint.toString()}`;
    const cachedResult = tokenAccountCache.get<{ isSafe: boolean, reason?: string }>(cacheKey);
    
    if (cachedResult !== undefined) {
      return cachedResult;
    }
    
    // Get mint account data
    let { data } = (await solanaConnection.getAccountInfo(mint)) || {};
    if (!data) {
      const result = { isSafe: false, reason: "Could not retrieve mint data" };
      tokenAccountCache.set(cacheKey, result, 300);
      return result;
    }
    
    const mintData = MintLayout.decode(data);
    logger.debug(`Mint data for ${mint.toString()}: ${JSON.stringify(mintData)}`);
    
    // Check if mint is renounced (no mint authority)
    if (CHECK_IF_MINT_IS_RENOUNCED && mintData.mintAuthorityOption === 1) {
      const result = { isSafe: false, reason: "Token is mintable (has mint authority)" };
      tokenAccountCache.set(cacheKey, result, 300);
      return result;
    }
    
    // Check if mint is freezable
    if (CHECK_IF_MINT_IS_FREEZABLE && mintData.freezeAuthorityOption === 1) {
      const result = { isSafe: false, reason: "Token is freezable (has freeze authority)" };
      tokenAccountCache.set(cacheKey, result, 300);
      return result;
    }
    
    // Check if mint is mintable
    if (CHECK_IF_MINT_IS_MINTABLE && mintData.mintAuthorityOption === 1) {
      const result = { isSafe: false, reason: "Token is mintable (has mint authority)" };
      tokenAccountCache.set(cacheKey, result, 300);
      return result;
    }
    
    // All checks passed
    const result = { isSafe: true };
    tokenAccountCache.set(cacheKey, result, 300);
    return result;
    
  } catch (e) {
    logger.debug(e);
    logger.error({ mint }, `Failed to check token security`);
    return { isSafe: false, reason: "Error checking token security" };
  }
}
