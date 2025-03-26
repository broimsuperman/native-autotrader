# Environment Settings Documentation

This file provides detailed documentation for all environment variables used in the Solana Automatic Trader. Use this as a reference when configuring your `.env` file.

## Network Configuration

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `RPC_ENDPOINT` | Solana RPC endpoint URL for API calls | `https://mainnet.helius-rpc.com/?api-key=your-api-key` | Required |
| `RPC_WEBSOCKET_ENDPOINT` | WebSocket endpoint for real-time updates | `wss://mainnet.helius-rpc.com/?api-key=your-api-key` | Required |
| `COMMITMENT_LEVEL` | Transaction commitment level | `confirmed`, `finalized` | `confirmed` |

## Wallet Settings

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `PRIVATE_KEY` | Your wallet's private key in base58 format | `4xkA4Uv1...` | Required |
| `QUOTE_MINT` | Token to use for buying | `WSOL`, `USDC` | Required |
| `QUOTE_AMOUNT` | Amount to use per trade | `0.004` | Required |
| `WRAP_SOL_AUTOMATICALLY` | Whether to automatically wrap SOL | `true`, `false` | `false` |
| `WRAP_SOL_AMOUNT` | Amount of SOL to wrap | `0.1`, `half` | `half` |

## Trading Parameters

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `TAKE_PROFIT` | Percentage increase to trigger take profit | `25` (for 25%) | `25` |
| `STOP_LOSS` | Percentage decrease to trigger stop loss | `10` (for 10%) | `10` |
| `MIN_POOL_SIZE` | Minimum pool size to consider for trading | `85` | `0` |
| `AUTO_SELL` | Enable automatic selling based on take profit/stop loss | `true`, `false` | `false` |
| `AUTO_SELL_DELAY` | Delay between auto-sell checks (milliseconds) | `5000` | `5000` |
| `MAX_SELL_RETRIES` | Maximum number of retries for sell transactions | `5` | `3` |
| `MAX_CONCURRENT_TRANSACTIONS` | Maximum number of concurrent transactions | `3` | `3` |
| `MAX_SLIPPAGE_PERCENT` | Maximum allowed slippage percentage | `1.0` | `1.0` |

## Token Security Settings

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `CHECK_IF_MINT_IS_RENOUNCED` | Skip tokens where mint authority is not renounced | `true`, `false` | `false` |
| `CHECK_IF_MINT_IS_FREEZABLE` | Skip tokens with freeze authority | `true`, `false` | `false` |
| `CHECK_IF_MINT_IS_MINTABLE` | Skip tokens with mint authority | `true`, `false` | `false` |
| `RUGCHECK` | Enable additional rug pull checks | `true`, `false` | `false` |

## Snipe List Configuration

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `USE_SNIPE_LIST` | Enable snipe list functionality | `true`, `false` | `false` |
| `SNIPE_LIST_PATH` | Path to your snipe list file | `./snipe-list.txt` | `./snipe-list.txt` |
| `SNIPE_LIST_REFRESH_INTERVAL` | Interval to refresh snipe list (milliseconds) | `1000` | `1000` |

## Risk Management Settings

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `RISK_LEVEL` | Trading risk level | `low`, `medium`, `high` | `medium` |
| `MAX_DAILY_TRADES` | Maximum number of trades per day | `20` | `20` |
| `MAX_DAILY_LOSS_PERCENT` | Maximum daily loss percentage | `5` | `5` |

## Trading Hours Settings

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `TRADING_HOURS_ENABLED` | Enable time-based trading restrictions | `true`, `false` | `false` |
| `TRADING_START_HOUR` | Hour to start trading (0-23) | `9` | `0` |
| `TRADING_END_HOUR` | Hour to end trading (0-23) | `17` | `24` |

## Performance Optimization

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `DYNAMIC_POSITION_SIZING` | Enable dynamic position sizing | `true`, `false` | `true` |
| `CACHE_TTL_SECONDS` | Cache time-to-live in seconds | `120` | `120` |

## Diagnostics and Logging

| Variable | Description | Example | Default |
|----------|-------------|---------|---------|
| `ENABLE_DIAGNOSTICS` | Enable email diagnostics | `true`, `false` | `false` |
| `LOG_LEVEL` | Logging level | `debug`, `info`, `warn`, `error` | `info` |
| `BIRDEYE_API_KEY` | API key for Birdeye price data | `a068f09449464c1ab869a0d5008e030c` | Optional |

## Example Configuration

```
# Network Configuration
RPC_ENDPOINT=https://mainnet.helius-rpc.com/?api-key=your-api-key
RPC_WEBSOCKET_ENDPOINT=wss://mainnet.helius-rpc.com/?api-key=your-api-key
COMMITMENT_LEVEL=confirmed

# Wallet Settings
PRIVATE_KEY=your-private-key-in-base58
QUOTE_MINT=WSOL
WRAP_SOL_AUTOMATICALLY=true
WRAP_SOL_AMOUNT=half
QUOTE_AMOUNT=0.004

# Trading Parameters
TAKE_PROFIT=25
STOP_LOSS=10
MIN_POOL_SIZE=85
AUTO_SELL=true
MAX_SELL_RETRIES=5
AUTO_SELL_DELAY=5000
MAX_CONCURRENT_TRANSACTIONS=3
MAX_SLIPPAGE_PERCENT=1.0

# Token Security Settings
CHECK_IF_MINT_IS_RENOUNCED=false
CHECK_IF_MINT_IS_FREEZABLE=true
CHECK_IF_MINT_IS_MINTABLE=true
RUGCHECK=true

# Snipe List Configuration
USE_SNIPE_LIST=false
SNIPE_LIST_REFRESH_INTERVAL=1000
SNIPE_LIST_PATH=./snipe-list.txt

# Risk Management Settings
RISK_LEVEL=medium
MAX_DAILY_TRADES=20
MAX_DAILY_LOSS_PERCENT=5

# Trading Hours Settings
TRADING_HOURS_ENABLED=false
TRADING_START_HOUR=0
TRADING_END_HOUR=24

# Performance Optimization
DYNAMIC_POSITION_SIZING=true
CACHE_TTL_SECONDS=120

# Diagnostics and Logging
ENABLE_DIAGNOSTICS=false
LOG_LEVEL=info
BIRDEYE_API_KEY=your-birdeye-api-key
```

## Notes

- Keep your `PRIVATE_KEY` secure and never share it
- For optimal performance, use a reliable RPC provider
- Start with conservative settings and adjust based on performance
- Enable security checks to protect against scam tokens
- Set `TRADING_HOURS_ENABLED=false` for 24/7 trading
- Adjust `RISK_LEVEL` based on your risk tolerance
