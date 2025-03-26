import { expect, jest, test, describe, beforeEach } from '@jest/globals';
import { PublicKey } from '@solana/web3.js';
import { 
  createPoolKeys,
  analyzeLiquidityPool,
  calculateOptimalSwapAmount
} from '../liquidity/liquidity.improved';

// Mock data
const mockPoolState = {
  baseReserve: { toNumber: () => 1000 },
  quoteReserve: { toNumber: () => 5000 },
  baseMint: new PublicKey('11111111111111111111111111111111'),
  quoteMint: new PublicKey('22222222222222222222222222222222'),
  lpMint: new PublicKey('33333333333333333333333333333333'),
  baseDecimal: { toNumber: () => 9 },
  quoteDecimal: { toNumber: () => 6 },
  openOrders: new PublicKey('44444444444444444444444444444444'),
  targetOrders: new PublicKey('55555555555555555555555555555555'),
  baseVault: new PublicKey('66666666666666666666666666666666'),
  quoteVault: new PublicKey('77777777777777777777777777777777'),
  marketProgramId: new PublicKey('88888888888888888888888888888888'),
  marketId: new PublicKey('99999999999999999999999999999999'),
  withdrawQueue: new PublicKey('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  lpVault: new PublicKey('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
};

const mockMinimalMarketLayoutV3 = {
  eventQueue: new PublicKey('cccccccccccccccccccccccccccccccc'),
  bids: new PublicKey('dddddddddddddddddddddddddddddddd'),
  asks: new PublicKey('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
};

describe('Liquidity Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createPoolKeys should create pool keys correctly', () => {
    const poolId = new PublicKey('ffffffffffffffffffffffffffffffff');
    
    const result = createPoolKeys(poolId, mockPoolState, mockMinimalMarketLayoutV3);
    
    expect(result).toBeDefined();
    expect(result.id).toBe(poolId);
    expect(result.baseMint).toBe(mockPoolState.baseMint);
    expect(result.quoteMint).toBe(mockPoolState.quoteMint);
    expect(result.baseDecimals).toBe(9);
    expect(result.quoteDecimals).toBe(6);
    expect(result.marketBids).toBe(mockMinimalMarketLayoutV3.bids);
    expect(result.marketAsks).toBe(mockMinimalMarketLayoutV3.asks);
    expect(result.marketEventQueue).toBe(mockMinimalMarketLayoutV3.eventQueue);
  });

  test('analyzeLiquidityPool should calculate trading score correctly', () => {
    const basePrice = 0.5; // 0.5 USD per token
    
    const result = analyzeLiquidityPool(mockPoolState, basePrice);
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('liquidity');
    expect(result).toHaveProperty('slippage');
    expect(result).toHaveProperty('tradingScore');
    expect(result).toHaveProperty('recommendation');
    
    // Verify liquidity calculation (baseReserve * basePrice + quoteReserve * 1)
    expect(result.liquidity).toBe(1000 * 0.5 + 5000);
  });

  test('calculateOptimalSwapAmount should respect max slippage', () => {
    const maxSlippagePercent = 1.0; // 1% max slippage
    
    const result = calculateOptimalSwapAmount(mockPoolState, maxSlippagePercent);
    
    expect(result).toBeGreaterThan(0);
    // The optimal amount should be less than the total quote reserve
    expect(result).toBeLessThan(mockPoolState.quoteReserve.toNumber());
  });
});
