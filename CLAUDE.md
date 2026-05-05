# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

CTF correction repository for EPITA participants demonstrating MEV frontrunning on Ethereum Sepolia. A MEV bot frontruns anyone who attacks `FairCasino` via the public mempool. Only Flashbots-protected transactions are undetectable by the bot.

---

## Commands

### Contracts (Foundry)

```bash
forge build                          # Compile → out/
forge build --force                  # Force recompile
```

Solidity version: `0.8.28` (set in `foundry.toml`). Artifacts land in `out/<Contract>.sol/<Contract>.json`.

### Scripts (Node.js / ethers v6)

```bash
# MEV bot (run first)
node scripts/mev/mev-bot.mjs

# Participant exploit scripts
node scripts/casino-exploit/off-chain-exploit.js
node scripts/casino-exploit/eoa-direct-exploit.js
node scripts/casino-exploit/flashbots-exploit.js
node scripts/casino-exploit/multi-exploit.js
node scripts/casino-exploit/on-chain-exploit.js

# Deploy a fresh casino
node scripts/deploy-casino.js
```

All scripts load `.env` via `dotenv`. Required vars: `PRIVATE_KEY_1`, `PRIVATE_KEY_2`, `RPC_URL`, `CASINO_ADDRESS`, `GAME_SALT`, `ORACLE_ADDRESS`, `FLASHBOTS_RPC`.

---

## Architecture

### FairCasino game loop

```
play(guess, round, nonce)  [0.01 ETH]
├─ PoW check: keccak256(msg.sender, nonce, guess, round) last 2 bytes == 0xbeef
├─ ticket split: 90% → jackpotReserve, 10% → profitPool
├─ winningNumber = keccak256(secretTarget ^ oraclePrice, gameSalt, currentRound)
└─ guess == winningNumber → pay min(jackpotReserve/2, 0.1 ETH), round++
```

- `secretTarget` is recoverable two ways: from the deployment tx constructor calldata, and via `eth_getStorageAt(casino, 5)`. The slot is 5 (not 0) because `contracts/Context.sol` is a fake lookalike of the OZ `Context` with 4 hidden state variables that shift the layout.
- `gameSalt` is `immutable` — not in storage, only in the deployment tx constructor calldata.
- `oraclePrice` = Chainlink BTC/USD `latestRoundData()[1]`
- `jackpotReserve` — player-only ETH pool (public getter); `profitPool` — house fees (public getter)
- `GamePlayed` event: `(address player, uint256 round, bool won, uint256 payout)`
- `withdrawProfits(amount)` — house-only, capped to `profitPool` balance

### IDrainer interface

All attack contracts implement:

```solidity
interface IDrainer {
    function attack(uint256 _guess, uint256 _round, uint256 _nonce) external payable;
    function distribute() external;
}
```

- **`Drainer.sol`** — off-chain exploit: receives pre-computed values, calls `casino.play()`, then distributes to LT1/LT2/LT3 (50/30/20%)
- **`DrainerOnChain.sol`** — ignores `_guess` and `_nonce`; computes both on-chain via assembly-optimised keccak256 loop. `secretTarget` and `gameSalt` passed in constructor.

### MEV bot (`scripts/mev/mev-bot.mjs`)

Hot-cache pattern: pre-computes `winningNumber` + `nonce` every 3s (re-mines only when `winningNumber` changes). On any pending `attack(uint256,uint256,uint256)` or `play(uint256,uint256,uint256)` detected via WebSocket mempool, fires a `casino.play()` with `maxPriorityFeePerGas + 3 gwei` and `maxFeePerGas + 5 gwei` above victim tx — response time 200–400ms.

**Bot is blind to Flashbots private transactions.**

### Exploit matrix

| Script | Method | vs Bot |
|--------|--------|--------|
| `off-chain-exploit.js` | Drainer via public mempool | Bot wins |
| `eoa-direct-exploit.js` | Direct `casino.play()` from EOA | Bot wins |
| `flashbots-exploit.js` | `casino.play()` via Flashbots RPC | Participant wins (solo) |
| `multi-exploit.js` | 3 participants: Drainer + EOA + Flashbots | Bot wins all 3† |
| `on-chain-exploit.js` | DrainerOnChain (nonce hidden) | Bot wins (computes independently) |

> † In `multi-exploit.js`, Participants 1+2 broadcast publicly — the bot wins the round outright, the Flashbots tx arrives stale (round mismatch).

### Assembly nonce mining (DrainerOnChain)

116-byte packed input `[addr(20) | nonce(32) | winningNumber(32) | round(32)]`. Static fields written once before the loop; only the 32-byte nonce slot is updated each iteration. Cost ~70 gas/iter vs ~500 gas with `abi.encodePacked`. Max 200k iterations → up to ~14M gas → `gasLimit: 15_000_000` required in `on-chain-exploit.js`.

---

## Deployed contracts (Sepolia)

| Contract | Address |
|----------|---------|
| FairCasino | `0xed5415679D46415f6f9a82677F8F4E9ed9D1302b` |
| Drainer | `0xcC86a55B47d5f6b0106dD15C8C1f5004b80608a7` |
| DrainerOnChain | `0xaa3D0f396D66dAc304e575e3FC5677bc1680dC74` |
| Oracle BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |

If `DRAINER_ADDRESS` or `DRAINER_ONCHAIN_ADDRESS` is absent from `.env`, the exploit scripts auto-deploy a new instance and print the address to add.

---

## Key invariants

- Nonce must be mined for the **actual `msg.sender`**: for EOA calls it's `wallet.address`; for Drainer calls it's `drainerAddress`. Mining with the wrong sender always fails the PoW check.
- `multi-exploit.js` must deploy the Drainer **before** mining the nonce (needs the contract address as sender).
- The bot uses `PRIVATE_KEY_2`; participant scripts use `PRIVATE_KEY_1`. Never mix them — the bot skips its own transactions by filtering `tx.from`.

## Test battery

Run `/test-battery` (project skill at `.claude/commands/test-battery.md`) to execute the full Phase 1 (solo) + Phase 2 (bot) test suite and generate a dated `TEST_REPORT_<date>.md`.
