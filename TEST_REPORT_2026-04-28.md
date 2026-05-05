# FairCasino CTF — Test Report 2026-04-28

## Environment

- Casino: `0xed5415679D46415f6f9a82677F8F4E9ed9D1302b` (FairCasino v2, existing — no redeploy)
- Initial round: 17
- Initial jackpotReserve: 0.03603076171875 ETH
- Initial profitPool: 0.021 ETH
- MEV bot fix applied: `mev-bot.mjs` line 17 — Infura WSS URL now correctly uses `/ws/v3/` path (was `/v3/`, causing `Unexpected server response: 200`)

---

## Phase 1 — Solo results (no MEV bot)

> ⚠️ A residual MEV bot process (PID 64437) was running at session start — killed before on-chain exploit attempts. First two on-chain runs failed partially because of this leftover process.

| Script | TX | Status | Round Δ | Notes |
|--------|----|--------|---------|-------|
| `eoa-direct-exploit.js` | [0xe77558b2](https://sepolia.etherscan.io/tx/0xe77558b2a84c7eba39bd2d86573fa5ed9db9cac0730dedc2344711c4f182e2c1) | ✅ WIN | 17→18 | Clean win |
| `off-chain-exploit.js` | [0xa3e3df20](https://sepolia.etherscan.io/tx/0xa3e3df20af86ec1776276b9f7f221568d695ff6e241fba40f9ee8b9302e22db9) | ✅ WIN | 18→19 | Clean win |
| `on-chain-exploit.js` (attempt 1) | [0x0116509f](https://sepolia.etherscan.io/tx/0x0116509f820d1b69f0b9e9eeb81a3d6e8bfd7da389d6098a57d4c7cbbfd91fce) | ❌ OOG | 19→19 | Residual bot still running; also OOG (gasUsed=15,000,000) |
| `on-chain-exploit.js` (attempt 2) | [0x4a6c56d4](https://sepolia.etherscan.io/tx/0x4a6c56d4933a2edef6473c73deecd9899a7ae33ff9bc873ecd91f6315720457e) | ❌ OOG | 19→19 | Bot killed; still OOG — nonce mining exhausted full 15M gas budget |
| `on-chain-exploit.js` (attempt 3) | [0xf095481c](https://sepolia.etherscan.io/tx/0xf095481c626e465d0f1a32598b70e3f9f8697b8caf7c7b368dcb069b62a7acfb) | ❌ OOG | 19→19 | Still OOG — probabilistic failure (~5% per run); winning number for round 19 required >200k nonce iterations |
| `flashbots-exploit.js` | [0x9ab6f07a](https://sepolia.etherscan.io/tx/0x9ab6f07a06b20f6aa68f0a0c9d4412dad184b6c6a0c366a8554c9ba3084bc2de) | ✅ WIN | 19→20 | Block 10745742 |

**Phase 1 verdict:** 3/4 exploits succeeded solo. `on-chain-exploit.js` failed all 3 attempts with OOG — probabilistic failure where the winning number for round 19 required more than 200k keccak iterations (all 15M gas consumed). This is a known ~5% failure mode of `DrainerOnChain`.

---

## Phase 2 — MEV bot results

> Bot launched with fixed WSS URL (Infura `/ws/v3/` path). 9 frontrun events fired total (0 for multi-exploit — see notes).

### EOA Direct (`eoa-direct-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Bot frontrun (ms) | Notes |
|-----|-----------|--------|--------|-------------------|-------|
| 1/3 | [0x71719628](https://sepolia.etherscan.io/tx/0x7171962860b5785ae2a6e0668c5b078180195e751f1384c4a2601647b7d4190b) | [0x7c393a35](https://sepolia.etherscan.io/tx/0x7c393a355722f5ac9810d54c613a6466e4193b43fe95599bf23cc4c697fd53f3) | 🎓 Participant | 431ms | Bot frontrun REVERTED — participant tx included first |
| 2/3 | [0x6d718f52](https://sepolia.etherscan.io/tx/0x6d718f524c7691d2b9df15c748c96e76371a8c0b9c2bc8df19ffeb8271296b9b) | [0xa9320daa](https://sepolia.etherscan.io/tx/0xa9320daa0d7242c2bee9c4fd42df24a2626818a3e2b23bcf72a77c3be0a7fb0e) | 🤖 Bot | 430ms | Bot WIN; script falsely reports "SUCCESS" (v2 wrong-guess accepted, bot advanced round) |
| 3/3 | [0xa11b27c6](https://sepolia.etherscan.io/tx/0xa11b27c64bc961bc21341d0f2c69e4c21c66e93ed3084a72e1071fb283e67281) | [0xffec0c4f](https://sepolia.etherscan.io/tx/0xffec0c4fabd508e062f1150aa281707d1aeddd3aa96a101f4446f5a6327679b7) | 🤖 Bot | 445ms | Bot WIN; participant tx REVERTED (explicit round mismatch) |

**EOA result: Bot 2/3 — Participant 1/3 (statistical)**

### Off-Chain Drainer (`off-chain-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Bot frontrun (ms) | Notes |
|-----|-----------|--------|--------|-------------------|-------|
| 1/3 | [0xdaacbe01](https://sepolia.etherscan.io/tx/0xdaacbe01f668372c17bcf8f9b114cc98087ff49fa75ec6601b1b840ff4af0550) | [0xb2d840d0](https://sepolia.etherscan.io/tx/0xb2d840d05c7fb1dd0b25376fbd2f365fa84b598557fb3e07811b088128364181) | 🤖 Bot | 822ms | Participant REVERTED; bot WIN |
| 2/3 | [0x0c2d4125](https://sepolia.etherscan.io/tx/0x0c2d4125a6610bc755e077a19b02b55dbe81466e68448314970f94afee1c007b) | [0x9edd5cae](https://sepolia.etherscan.io/tx/0x9edd5cae462fb89b9fa19d6e7772b85a55acc85c6b9b02210dc9ef30d86920cd) | 🎓 Participant | 443ms | Bot REVERTED — participant included first |
| 3/3 | [0x2149f91b](https://sepolia.etherscan.io/tx/0x2149f91b2f4912ba94c0e4fbad3d18b0fc0f54943b728b9256041b833131d846) | [0x471b6546](https://sepolia.etherscan.io/tx/0x471b654687c8b289011813b772643c837f971db55396d2fee97ce49c89baaaf0) | 🤖 Bot | 433ms | Participant REVERTED; bot WIN |

**Off-chain result: Bot 2/3 — Participant 1/3 (statistical)**

### On-Chain DrainerOnChain (`on-chain-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Bot frontrun (ms) | Notes |
|-----|-----------|--------|--------|-------------------|-------|
| 1/3 | [0xe8f2b9f8](https://sepolia.etherscan.io/tx/0xe8f2b9f80342d6fd3eba879a434aa6d45480e8368e3693bdd6ff474f782faa1b) | [0x556e4e78](https://sepolia.etherscan.io/tx/0x556e4e785051ef077234547a34cbc8d338a5e0f9e0abccb1f40a5f5738af76c7) | 🎓 Participant | 423ms | Participant in block 10745767 idx 74; bot REVERTED in block 10745768 — one full block late |
| 2/3 | [0x2bc30ab4](https://sepolia.etherscan.io/tx/0x2bc30ab4f610fa040d39cdcbaf29d817ee9d790015506821eeb959d8ed70d324) | [0x3a368889](https://sepolia.etherscan.io/tx/0x3a368889dcdcd049bdd3358fddb5207c315836598983f579f30712c0c40eed73) | 🎓 Participant | 447ms | Participant in block 10745769; bot REVERTED in block 10745770 — one full block late |
| 3/3 | [0x24102fa6](https://sepolia.etherscan.io/tx/0x24102fa6decb41aa7ee0bac63f5c9e31c12cf26cbf0d08fe37a68e2a5a2bb0b0) | [0x8474b55e](https://sepolia.etherscan.io/tx/0x8474b55e7cd645afb4174290f620b10d12401c14030aeab8f808422b2ed36725) | 🎓 Participant | 453ms | Participant in block 10745771; bot REVERTED in block 10745772 — one full block late |

**On-chain result: Participant 3/3 — Bot 0/3 ← unexpected! See MEV Bot Performance notes.**

### Flashbots Protect (`flashbots-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Notes |
|-----|-----------|--------|--------|-------|
| 1/3 | [0x754cd5bd](https://sepolia.etherscan.io/tx/0x754cd5bde90f5282d847c906f03814281321bab7fe430d60930246f3826e35f4) | — | 🎓 Participant | Block 10745779; bot blind |
| 2/3 | [0x698291d9](https://sepolia.etherscan.io/tx/0x698291d990ee64fb1fb420d96b87e5d0f4d6d908375cacf945f61e10e5aa3819) | — | 🎓 Participant | Block 10745781; bot blind |
| 3/3 | [0xa510b63e](https://sepolia.etherscan.io/tx/0xa510b63eb50ba42b100c124a0944ea64bc397a1f1bbf8a1f3b94fa262ac28203) | — | ⚠️ Oracle shift | Tx REVERTED — oracle BTC/USD price shifted during Flashbots ~15s inclusion window; same issue as last report |

**Flashbots result: Participant 2/3 (3rd run: oracle price drift, not bot interference)**

### Multi-Participant (`multi-exploit.js`) × 1 — Round 33

| Participant | TX | Status | Winner | Notes |
|---------|-----|--------|--------|-------|
| S1 Drainer (public) | [0xf910886a](https://sepolia.etherscan.io/tx/0xf910886a76b8714814fc473fcd2a6ee648e440a06a5cabfbd80ba1540d936efa) | REVERTED | — | Confirmed block 10745817; stale round after S3 won |
| S2 EOA direct (public) | [0xaff5e6a8](https://sepolia.etherscan.io/tx/0xaff5e6a8834e75988c72776c9ccf8479130241de3785d7cfe6a0f2f59f23475a) | REVERTED | — | Confirmed block 10745817; stale round |
| S3 Flashbots | [0x464612e1](https://sepolia.etherscan.io/tx/0x464612e1570969a84673f13c39bcdd7cbf17c2aa6353318ac3b059659eb0ddd3) | ✅ WIN | 🎓 S3 | Block 10745814; bot blind; S3 won round 33→34 |

**Multi-exploit result:** Bot fired NO frontruns (0 SNIPER events) — likely a WS subscription gap during this window. S3 (Flashbots) won the round. S1+S2 confirmed stale in block 10745817 (reverted, round already 34).

---

## MEV Bot Performance

- Detection → frontrun range: **423ms – 822ms** (9 events)
- Cache re-mine: triggered on each round change (`[WIN# CHANGED]` log entries)
- Frontrun success rate: **4/9** bot TXs WIN (44%) — lower than expected
- Key discovery: bot frontrun **consistently arrives one full block late** for `DrainerOnChain` (15M gas tx). The large tx is included by validators faster than the bot's mempool notification latency allows it to respond within the same block.
- WSS connection bug fixed during this run: Infura endpoint required `/ws/v3/` not `/v3/` — caused `Unexpected server response: 200` crash on first start.
- Multi-exploit window: **0 frontruns fired** — WS subscription gap suspected.

---

## Summary

| Exploit | Phase 1 (solo) | Phase 2 (vs bot) | Beats MEV Bot? | Reason |
|---------|---------------|------------------|----------------|--------|
| `eoa-direct-exploit.js` | ✅ WIN | 1/3 participant wins | ❌ Mostly No | Calldata visible in mempool; bot wins 2/3. Participant win #1 was race |
| `off-chain-exploit.js` | ✅ WIN | 1/3 participant wins | ❌ Mostly No | Calldata visible in mempool; bot wins 2/3. Participant win #2 was race |
| `on-chain-exploit.js` | ❌ OOG (Phase 1) | **3/3 participant wins** | ✅ **Effectively Yes** | 15M gas tx confirmed before bot mempool notification arrives — bot always one block late on Sepolia |
| `flashbots-exploit.js` | ✅ WIN | 2/3 wins + oracle ⚠️ | ✅ Yes | Tx never enters public mempool; oracle drift risk on 3rd run |
| `multi-exploit.js` (S1+S2) | — | REVERTED (stale) | ❌ No | Public mempool; stale round after S3 won |
| `multi-exploit.js` (S3) | — | ✅ WIN | ✅ Yes | Flashbots; bot blind |

---

## Notable Findings vs Previous Report (2026-04-27)

1. **`on-chain-exploit.js` now beats the bot (3/3)**: Previously "Bot wins" per documentation. On Sepolia today, the 15M gas DrainerOnChain tx lands in a block before the bot's frontrun propagates. This appears to be a Sepolia validator behaviour change or mempool latency issue.

2. **`on-chain-exploit.js` OOG in Phase 1**: DrainerOnChain nonce mining probabilistically exhausts 15M gas (~5% chance per oracle tick). Consistent across 3 attempts with same round 19 winning number.

3. **`eoa-direct-exploit.js` / `off-chain-exploit.js` win 1/3 statistically**: Block race conditions mean ~1/3 of runs the participant gets included before the bot's gas-bumped tx. Not reliable as a strategy, but worth noting.

4. **MEV bot WSS bug fixed**: `scripts/mev/mev-bot.mjs` line 17 now applies `.replace(/\/v3\//, "/ws/v3/")` for Infura WSS URLs.

5. **`off-chain-exploit.js` v2 false-positive detection**: When bot wins but participant tx is accepted (wrong guess, status=1), the script incorrectly reports "✅ SUCCESS". Correct check must also verify participant is the one who advanced the round (e.g. parse `GamePlayed` event).

---

## Conclusion

Flashbots Protect remains the definitive bot bypass. Unexpectedly, `DrainerOnChain` (on-chain exploit) also beat the bot 3/3 today due to 15M gas transactions being included before the bot's mempool notification latency allows a same-block frontrun. Public mempool exploits (EOA, off-chain) remain vulnerable but have stochastic wins (~33%) from block race conditions. The MEV bot WSS connection bug (Infura `/ws/v3/` path) was found and fixed during this run.
