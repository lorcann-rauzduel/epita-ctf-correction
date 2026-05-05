# AGENTS.md — FairCasino CTF

## Architecture

- **FairCasino**: `contracts/FairCasino.sol` — Guessing game with PoW signature check on Sepolia
- **MEV Bot**: `scripts/mev/mev-bot.mjs` — Frontruns public mempool attacks by replaying winning parameters at higher gas
- **Exploit Scripts**: `scripts/casino-exploit/*.js` — Various attack vectors against the casino

## Key Files

| File | Purpose |
|------|---------|
| `contracts/FairCasino.sol` | Main game contract |
| `contracts/Context.sol` | Custom Context (not OZ) — introduces storage slot shift |
| `contracts/Drainer.sol` | Attack contract, called via off-chain exploit |
| `contracts/DrainerOnChain.sol` | Attack contract, computes nonce on-chain |
| `scripts/mev/mev-bot.mjs` | MEV bot — frontruns public mempool |
| `scripts/casino-exploit/off-chain-exploit.js` | Deploy Drainer, attack via contract |
| `scripts/casino-exploit/eoa-direct-exploit.js` | Direct EOA call to `play()` |
| `scripts/casino-exploit/flashbots-exploit.js` | Private tx via Flashbots (invisible to bot) |
| `scripts/casino-exploit/multi-exploit.js` | 3 participants, mixed methods |
| `scripts/casino-exploit/on-chain-exploit.js` | DrainerOnChain — nonce computed on-chain |
| `scripts/deploy-casino.js` | Deploy a fresh FairCasino instance |

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| FairCasino | `0xed5415679D46415f6f9a82677F8F4E9ed9D1302b` |
| Drainer | `0xcC86a55B47d5f6b0106dD15C8C1f5004b80608a7` |
| DrainerOnChain | `0xaa3D0f396D66dAc304e575e3FC5677bc1680dC74` |
| Oracle BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |

## Running

```bash
# Start MEV bot
node scripts/mev/mev-bot.mjs

# Run exploits (with bot running)
node scripts/casino-exploit/off-chain-exploit.js
node scripts/casino-exploit/eoa-direct-exploit.js
node scripts/casino-exploit/flashbots-exploit.js
node scripts/casino-exploit/multi-exploit.js
node scripts/casino-exploit/on-chain-exploit.js
```

## CTF Logic

- `secretTarget`: readable from storage slot 5 (shifted by the fake `Context.sol`) and from the deployment tx constructor calldata
- `gameSalt`: immutable — only in constructor calldata, not in storage
- `winningNumber`: `keccak256(secretTarget ^ oraclePrice, gameSalt, round)`
- PoW: mine nonce so `keccak256(sender, nonce, guess, round)` ends in `0xbeef`
- Nonce must be mined for the actual `msg.sender` — the Drainer address, not the EOA

## MEV Bot Behaviour

- Watches mempool for `play(uint256,uint256,uint256)` and `attack(uint256,uint256,uint256)`
- Pre-calculates `winningNumber` + nonce every 3s (hot cache)
- On detection: replays with `+3 gwei` priority fee and `+5 gwei` max fee above victim
- Response time: 200–400ms
- Blind to Flashbots private transactions
