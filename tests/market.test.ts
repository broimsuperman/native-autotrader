import { expect, jest, test, describe, beforeEach } from '@jest/globals';
import { PublicKey } from '@solana/web3.js';
import { 
  getMinimalMarketV3,
  batchGetMinimalMarkets,
  getMarketStatistics
} from '../market/market.improved';

// Mock Connection
jest.mock('@solana/web3.js', () => {
  const original = jest.requireActual('@solana/web3.js');
  return {
    ...original,
    Connection: jest.fn().mockImplementation(() => ({
      getAccountInfo: jest.fn().mockResolvedValue({
        data: Buffer.from([
          // Mock data for MINIMAL_MARKET_STATE_LAYOUT_V3
          ...Array(32).fill(1), // eventQueue
          ...Array(32).fill(2), // bids
          ...Array(32).fill(3)  // asks
        ])
      }),
      getMultipleAccountsInfo: jest.fn().mockResolvedValue([
        {
          data: Buffer.from([
            ...Array(32).fill(1), // eventQueue
            ...Array(32).fill(2), // bids
            ...Array(32).fill(3)  // asks
          ])
        },
        {
          data: Buffer.from([
            ...Array(32).fill(4), // eventQueue
            ...Array(32).fill(5), // bids
            ...Array(32).fill(6)  // asks
          ])
        }
      ])
    }))
  };
});

describe('Market Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getMinimalMarketV3 should return market data', async () => {
    const connection = new (jest.requireMock('@solana/web3.js').Connection)();
    const marketId = new PublicKey('11111111111111111111111111111111');
    
    const result = await getMinimalMarketV3(connection, marketId);
    
    expect(result).toBeDefined();
    expect(connection.getAccountInfo).toHaveBeenCalledWith(
      marketId,
      expect.objectContaining({
        dataSlice: expect.anything()
      })
    );
  });

  test('batchGetMinimalMarkets should fetch multiple markets', async () => {
    const connection = new (jest.requireMock('@solana/web3.js').Connection)();
    const marketIds = [
      new PublicKey('11111111111111111111111111111111'),
      new PublicKey('22222222222222222222222222222222')
    ];
    
    const result = await batchGetMinimalMarkets(connection, marketIds);
    
    expect(result).toBeDefined();
    expect(result.size).toBe(2);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith(
      marketIds,
      undefined
    );
  });

  test('getMarketStatistics should return market stats', async () => {
    const connection = new (jest.requireMock('@solana/web3.js').Connection)();
    const marketId = new PublicKey('11111111111111111111111111111111');
    
    const result = await getMarketStatistics(connection, marketId);
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('spread');
    expect(result).toHaveProperty('depth');
  });
});
