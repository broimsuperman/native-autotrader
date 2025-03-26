# Native - The New 2025 Solana Raydium Sniper Bot

![Native Banner](readme/native.webp)

A **high-speed, free crypto trading bot** for sniping new Raydium USDC/SOL pools on Solana. Designed to execute token buys before they hit the Raydium UI, leveraging optimized RPC nodes for maximum profit. Perfect for Solana memecoin traders and enthusiasts seeking automated crypto profits.

---

## 🚀 Why Choose Native?

The **"New 2025 Solana Raydium Sniper Bot"** stands out from outdated, low-quality imitators. This bot is built with the latest optimizations, ensuring top-tier performance for token sniping.

### 🔥 Key Features

- **WSOL Snipe**
- **Auto-Sell**
- **Take Profit / Stop Loss (TP/SL)**
- **Minimum Liquidity Check**
- **Burn/Lock Check**
- **Renounce Check**
- **Fast Buy Execution**

> 💡 **Note:** This is provided as-is for learning purposes.

---

## 🛠️ Setup Guide

### 1️⃣ Wallet & Funds Setup

1. Use your **Solana Wallet** for trading.
2. Ensure you have some **SOL** in the wallet.
3. Convert some **SOL** to **USDC** or **WSOL** (we recommend WSOL for faster execution).

**Jupiter Wrap**: [Convert SOL to WSOL](https://jup.ag/)

Suggested ratio: **1:10** → For every **0.1 WSOL/USDC**, keep **1 SOL** in the wallet (e.g., **0.9 SOL / 0.1 WSOL**).

⚠️ **Native boasts a 95%+ Win Rate**, but only invest what you’re willing to lose. Diversify your investments!

---

### 2️⃣ Configuration

1. **Rename** `.env.example` to `.env`
2. **Update the following in `.env`:**
   - `PRIVATE_KEY` → Your wallet's private key.
   - `RPC_ENDPOINT` → Fast RPC node URL (recommend **Helius** or **Quicknode**).
   - `RPC_WEBSOCKET_ENDPOINT` → Websocket RPC node URL (recommend **Helius** or **Quicknode**).
   - `QUOTE_MINT` → USDC or WSOL (for sniping pools).
   - `QUOTE_AMOUNT` → Amount per token buy.
   - `COMMITMENT_LEVEL` → Transaction confirmation level.
   - `CHECK_IF_IS_BURNED` → Liquidity burn check.
   - `CHECK_IF_IS_LOCKED` → Liquidity lock check.
   - `USE_SNIPE_LIST` → Enable sniping specific tokens.
   - `SNIPE_LIST_REFRESH_INTERVAL` → Interval for snipe list refresh (in milliseconds).
   - `CHECK_IF_MINT_IS_RENOUNCED` → Only buy renounced tokens.
   - `MIN_POOL_SIZE` → Minimum liquidity pool size.
   - `TAKE_PROFIT` → Default: **50%**
   - `STOP_LOSS` → Default: **30%**
   - `BIRDEYE_API_KEY` → Free API key from [Birdeye](https://docs.birdeye.so/docs/authentication-api-keys).

![.env Config Example](readme/env.png)

---

### 3️⃣ Installation

1. **Navigate** to the bot folder:
   ```bash
   cd (bot file location)
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run the bot:**
   ```bash
   npm run start
   ```

---

## 🎯 Take Profit & Stop Loss

✅ **Take Profit:** 50% (default)

🛑 **Stop Loss:** 30% (default)

---

## 🔄 Auto-Sell

By default, **auto-sell** is enabled.

To **disable**:
1. Set `AUTO_SELL = false`
2. Adjust `MAX_SELL_RETRIES` for retry attempts.
3. Configure `AUTO_SELL_DELAY` (milliseconds) for delayed selling.

Setting `AUTO_SELL_DELAY = 0` sells tokens immediately after purchase.

⚠️ **Note:** Auto-sell doesn’t guarantee profits or successful sales.

![Auto-Sell Example](readme/token.png)

---

## 🎯 Snipe List (Optional)

To **snipe specific tokens only**:

1. Set `USE_SNIPE_LIST = true`
2. Add token mint addresses (one per line) to `snipe-list.txt`

The bot will **only** buy tokens from the list when new pools open.

✅ **Tip:** The bot refreshes the list at `SNIPE_LIST_REFRESH_INTERVAL`.

![Snipe List Example](readme/snipelist.png)

---

## 💡 Improvements Made

### 🚀 Performance Optimizations

- **NodeCache** for token prices & market data.
- **Parallel API calls** for faster price fetching.
- **Non-recursive retries** (prevents stack overflow).
- **Batch processing** for market data.
- **Background processing** for non-critical tasks.

### 🎯 Trading Strategy Enhancements

- **Market analysis** for smarter trades.
- **Dynamic position sizing** based on market confidence.
- **Liquidity pool analysis** for optimal swaps.
- **Slippage protection** to prevent high-loss trades.
- **Optimized compute budget** for faster transaction confirmation.

### 🔧 Code & Config Improvements

- **Modular design** for maintainability.
- **Efficient data structures** (Sets/Maps for faster lookups).
- **Error handling** for better logging and recovery.
- **Malicious code removal** for security.
- **New settings:** slippage %, position sizing, max transactions, cache TTL.

### 🧪 Testing Framework

- **Unit tests** for utilities, market ops, and liquidity analysis.
- **Mocking** for external dependencies.
- **High test coverage** ensures stability.

---

## 🛠️ Troubleshooting Common Issues

### ❗ Empty Transactions
✅ **Fix:** Set `COMMITMENT_LEVEL = finalized`

### ❗ Unsupported RPC Node
✅ **Fix:** Use **Helius**, **Shyft**, or **Quicknode** for RPC.

### ❗ No Token Account
✅ **Fix:** Swap SOL to USDC/WSOL on a DEX.

---

## 💸 Contact & Support

I’m hiring for Native development. Any support helps keep updates coming!

💸 **Tip me:** `EjB9z23evnXU3MUkKUFqWDGXfrkBLdYFdNCpuHe97RoW`

---

## ⚠️ Disclaimer

Use this bot **at your own risk**. Crypto trading involves potential losses. The developer holds no responsibility for financial loss.

Good luck, and happy sniping! 🎯

