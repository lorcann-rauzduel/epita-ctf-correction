# EPITA CTF — Correction

Correction repository for [epita-ctf-student](https://github.com/lorcann-rauzduel/epita-ctf-student). The `FairCasino` contract is vulnerable and can be drained. Several exploit strategies are available (EOA direct, off-chain, on-chain, multi-participant). A MEV bot runs independently and frontruns anyone who attacks via the public mempool — stealing the winning parameters before the victim's transaction lands. Only Flashbots-protected transactions bypass the bot.

## Setup

**Requirements:** [Foundry](https://book.getfoundry.sh/getting-started/installation), Node.js 18+

```bash
forge build       # compile contracts → out/
npm install       # install script dependencies
```

Copy `.env` and fill in:

```env
PRIVATE_KEY_1=        # participant wallet
PRIVATE_KEY_2=        # MEV bot wallet
RPC_URL=              # Sepolia HTTP RPC
WS_RPC_URL=           # Sepolia WebSocket RPC (required by the bot)
CASINO_ADDRESS=0xed5415679D46415f6f9a82677F8F4E9ed9D1302b
GAME_SALT=            # from deploy tx calldata
FLASHBOTS_RPC=https://relay-sepolia.flashbots.net
```

## Testing

### 1. Start the MEV bot

```bash
node scripts/mev/mev-bot.mjs
```

The bot watches the mempool and frontruns any `play()` or `attack()` call within ~300ms. Keep it running for all tests below.

### 2. Run an exploit (separate terminal)

```bash
# These all lose against the bot (public mempool)
node scripts/casino-exploit/eoa-direct-exploit.js
node scripts/casino-exploit/off-chain-exploit.js
node scripts/casino-exploit/on-chain-exploit.js
node scripts/casino-exploit/multi-exploit.js

# This one wins — bot is blind to Flashbots private transactions
node scripts/casino-exploit/flashbots-exploit.js
```

**Expected results:**

| Script | Result vs bot |
|---|---|
| `eoa-direct-exploit.js` | Bot wins |
| `off-chain-exploit.js` | Bot wins |
| `on-chain-exploit.js` | Bot wins |
| `multi-exploit.js` | Bot wins all 3 |
| `flashbots-exploit.js` | **Participant wins** |

> `multi-exploit.js`: even the Flashbots leg loses — Participants 1+2 broadcast publicly, the bot wins the round before the private tx can land.

### 3. Without the bot

Stop the bot process and re-run any script — all exploits succeed.

---

## Contracts

| Contract | Role |
|---|---|
| `FairCasino.sol` | Guessing game — PoW check + jackpot |
| `Drainer.sol` | Off-chain exploit (pre-computed guess+nonce) |
| `DrainerOnChain.sol` | On-chain exploit (assembly keccak256 loop) |

**Deployed (Sepolia)**

| | Address |
|---|---|
| FairCasino v2 | `0xed5415679D46415f6f9a82677F8F4E9ed9D1302b` |
| Drainer | `0xcC86a55B47d5f6b0106dD15C8C1f5004b80608a7` |
| DrainerOnChain | `0xaa3D0f396D66dAc304e575e3FC5677bc1680dC74` |
| Oracle BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |

## How it works

```
play(guess, round, nonce)  [0.01 ETH]
├─ PoW: keccak256(sender, nonce, guess, round) last 2 bytes == 0xbeef
├─ winningNumber = keccak256(secretTarget ^ btcPrice, gameSalt, round)
└─ guess == winningNumber → pay min(jackpotReserve/2, 0.1 ETH)
```

`secretTarget` is not actually secret: it is recoverable from the deployment transaction's constructor calldata, and also via `eth_getStorageAt` at slot 5 (shifted by the fake `Context.sol`). `gameSalt` is `immutable` so only accessible via constructor calldata. The bot re-derives `winningNumber` every 3s and frontruns with `+3/+5 gwei` above victim gas fees.
