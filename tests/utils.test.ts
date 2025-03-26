import { expect, jest, test, describe, beforeEach } from '@jest/globals';
import { PublicKey } from '@solana/web3.js';
import { 
  retrieveTokenValueByAddress, 
  retrieveTokenValueByAddressDexScreener,
  retrieveTokenValueByAddressBirdeye,
  retry,
  analyzeMarketConditions,
  calculatePositionSize
} from '../utils/utils.improved';

// Mock axios
jest.mock('axios');
const axios = require('axios');

describe('Utils Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retrieveTokenValueByAddressDexScreener should return price when available', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        pairs: [
          {
            chainId: 'solana',
            priceNative: '0.5'
          }
        ]
      }
    });

    const result = await retrieveTokenValueByAddressDexScreener('testAddress');
    expect(result).toBe(0.5);
    expect(axios.get).toHaveBeenCalledWith('https://api.dexscreener.com/latest/dex/tokens/testAddress');
  });

  test('retry should retry the function on failure', async () => {
    const mockFn = jest.fn();
    mockFn.mockRejectedValueOnce(new Error('Test error'))
          .mockResolvedValueOnce('success');

    const result = await retry(mockFn, { retries: 3, retryIntervalMs: 10 });
    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  test('analyzeMarketConditions should detect bullish conditions', () => {
    const priceChange = { m5: 6, h1: 12, h6: 15, h24: 20 };
    const volume = { m5: 1000, h1: 5000, h6: 20000, h24: 50000 };
    const txns = { 
      m5: { buys: 15, sells: 5 },
      h1: { buys: 60, sells: 40 }
    };

    const result = analyzeMarketConditions(priceChange, volume, txns);
    expect(result.bullish).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  test('calculatePositionSize should scale position based on confidence', () => {
    const baseAmount = 1000;
    const marketAnalysis = { bullish: true, confidence: 0.8 };

    const result = calculatePositionSize(baseAmount, marketAnalysis);
    expect(result).toBe(800);
  });

  test('calculatePositionSize should return 0 for non-bullish markets', () => {
    const baseAmount = 1000;
    const marketAnalysis = { bullish: false, confidence: 0.8 };

    const result = calculatePositionSize(baseAmount, marketAnalysis);
    expect(result).toBe(0);
  });
});
