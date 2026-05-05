# FairCasino CTF — Test Report 2026-04-27

## Environment

| Parameter | Value |
|-----------|-------|
| Casino | `0xed5415679D46415f6f9a82677F8F4E9ed9D1302b` (new deployment — FairCasino v2) |
| Oracle BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |
| Drainer | `0xcC86a55B47d5f6b0106dD15C8C1f5004b80608a7` |
| DrainerOnChain | `0xaa3D0f396D66dAc304e575e3FC5677bc1680dC74` |
| Initial round | 0 |
| Initial jackpotReserve | 0.200 ETH |
| Initial profitPool | 0.000 ETH |

> **New in FairCasino v2:** Segregated accounting (`jackpotReserve` / `profitPool`).
> Ticket fee split: 90% → `jackpotReserve`, 10% → `profitPool`.
> Payout = `min(jackpotReserve / 2, 0.1 ETH)` — dynamic, not fixed.
> **Wrong guesses no longer revert** — tx succeeds (status 1) but round does not advance.
> Correct win indicator: `currentRound` advanced, not just `receipt.status === 1`.

---

## Phase 1 — Solo results (no MEV bot)

| Script | TX | Status | Round Δ | Notes |
|--------|----|--------|---------|-------|
| `eoa-direct-exploit.js` | [0x5f49de79](https://sepolia.etherscan.io/tx/0x5f49de79a20bccc63f019713ac6003bb4d6bc9ed9d0227b7c34a48bef4c80ab3) | ✅ WIN | 0 → 1 | jackpotReserve 0.200→0.109 ETH (payout 0.1 ETH) |
| `off-chain-exploit.js` | [0x35c72730](https://sepolia.etherscan.io/tx/0x35c727300ae9e9969d814794fe5e730bfc59cd17f77664454176c8bf8ea899f4) | ✅ WIN | 1 → 2 | New Drainer auto-deployed; payout 0.059 ETH |
| `on-chain-exploit.js` | [0x2686020b](https://sepolia.etherscan.io/tx/0x2686020bd89e6a89a140c68c4fef6e947e1c42f87d9ab8ca6580e7fd080a9d21) | ✅ WIN | 2 → 3 | New DrainerOnChain auto-deployed |
| `flashbots-exploit.js` (attempt 1) | [0x24f3b711](https://sepolia.etherscan.io/tx/0x24f3b711f78b409bffcf1fb86e7d8f332ab9ff74de17b6022877bc270a821345) | ⚠️ WRONG GUESS | 3 → 3 | tx status=1 but round unchanged — oracle BTC/USD price shifted during Flashbots inclusion window |
| `flashbots-exploit.js` (attempt 2) | [0x5f77d65d](https://sepolia.etherscan.io/tx/0x5f77d65df126a52b319e8b383090a6d91cc67dee5398a18ace0eca56bb967cfc) | ✅ WIN | 3 → 4 | Second try with fresh price read |

**Phase 1 verdict:** All 4 exploits work correctly without the bot. Flashbots needed one retry due to oracle price shift (expected — Flashbots has ~10–30s inclusion latency on Sepolia).

---

## Phase 2 — MEV bot results

Bot address: `0x334Bdaad35afD9133B2CE6F8259F3dBAc56D95e1` | Starting round: 4

### EOA Direct (`eoa-direct-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Detection→Frontrun |
|-----|-----------|--------|--------|-------------------|
| 1/3 | [0x7aa119](https://sepolia.etherscan.io/tx/0x7aa11969c383b35d23f201e89bbe00e9766149831bad45678d666cedca3de842) | [0xfab3e5](https://sepolia.etherscan.io/tx/0xfab3e59576164c35c85f94a65424f1dc04a4a2d3a90919555cd7e6f021cc230e) | ⚡ Participant (edge case¹) | 227ms |
| 2/3 | [0x246fbc](https://sepolia.etherscan.io/tx/0x246fbc03ee1057ac639431c81d873c9f86e6b7df19cd9caaeb6bafb62b9fe06f) | Bot wins (round 5→6) | 🤖 Bot | — |
| 3/3 | [0xdaeb90](https://sepolia.etherscan.io/tx/0xdaeb90ce1fe28c80b7060a6d8842b991cf1726e3fcc6bfffea651f0cc470252c) | [0xf964e5](https://sepolia.etherscan.io/tx/0xf964e51d3bf8062d0e275877700a89af01c9f153877a1a13cccc9c03cc6b92ca) | 🤖 Bot | 277ms |

> ¹ Run 1 edge case: nonce mining took ~3s, so participant tx was already in flight before bot could react. Nonce=154740 (large value → slow mine).

### Off-Chain Drainer (`off-chain-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Detection→Frontrun |
|-----|-----------|--------|--------|-------------------|
| 1/3 | [0xbaceef](https://sepolia.etherscan.io/tx/0xbaceef82486d6335806dfe2bcacc5aef84da1fd9a98c347f18eb6b5d1f840b58) | [0xafa834](https://sepolia.etherscan.io/tx/0xafa834bb5604ef7d8297744d6363517b7a8e0a08abfdee66bf379aa94db2c1ff) | 🤖 Bot | 198ms |
| 2/3 | [0x6521b0](https://sepolia.etherscan.io/tx/0x6521b0df7ae23b5f4c39ee0f14565484dc92366b0dfb0772d79b38fdc4b3fbb1) | [0x0dd30e](https://sepolia.etherscan.io/tx/0x0dd30e095ceb1a5f56a23e6ea2906e8fd25c4efa8ce8a8a6efa5261b322e2ce3) | 🤖 Bot | 256ms |
| 3/3 | [0x0b22b5](https://sepolia.etherscan.io/tx/0x0b22b570f385a4b971549be4afdea91bb0f25af176446fce861f5a32932bafe9) | [0x04cf34](https://sepolia.etherscan.io/tx/0x04cf343163cf6ce11a3389ecfdf1120675a43f2abe27e1a60f679f2853957c2c) | 🤖 Bot | 223ms |

### On-Chain DrainerOnChain (`on-chain-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Detection→Frontrun |
|-----|-----------|--------|--------|-------------------|
| 1/3 | [0x93e522](https://sepolia.etherscan.io/tx/0x93e5229b70272128e4e9ab9384a3216ead57090f3bc33175e4ef0267e4954ca7) | [0x0cc6e9](https://sepolia.etherscan.io/tx/0x0cc6e9c49e3e8db3aa76a688725ad4384e7da67c54303431ac286b7069d29cd6) | 🤖 Bot | 264ms |
| 2/3 | [0xb5690c](https://sepolia.etherscan.io/tx/0xb5690cf613c5e4c4abca1936f20cb97a844c88a535c8471f1707a27aa655edea) | [0xad990e](https://sepolia.etherscan.io/tx/0xad990eef154ca8faa689d8d4cefc1529ca69064034de64bf31ca230c98f6be26) | 🤖 Bot | 234ms |
| 3/3 | [0x0ae601](https://sepolia.etherscan.io/tx/0x0ae6014587c20ae28fb28f9eade65aff10a7c2dab715061e7b4e3cccf6ac8757) | [0x05ab88](https://sepolia.etherscan.io/tx/0x05ab88feee3344bb1b921f72b0fcbf096f69347572284b775ef7ea11a0a9168d) | 🤖 Bot | 266ms |

### Flashbots Protect (`flashbots-exploit.js`) × 3

| Run | Participant TX | Bot TX | Winner | Notes |
|-----|-----------|--------|--------|-------|
| 1/3 | [0x66dbe9](https://sepolia.etherscan.io/tx/0x66dbe9732924b22ecc9e732e70fe05f9fe18bcc72f526379b16f0bd414e1db3a) | — (bot blind) | ✅ Participant | Block 10744244; round 13→14 |
| 2/3 | [0xb8c2aa](https://sepolia.etherscan.io/tx/0xb8c2aa3d709ff828e03e0ea90d7dbd7ddc1dd49c7c406c3ad9716715088632b4) | — (bot blind) | ✅ Participant | Block 10744249; round 14→15 |
| 3/3 | [0x3637b7](https://sepolia.etherscan.io/tx/0x3637b77741fe157527e17ae6aeee7f64623d6a558b2f931a602f36b5a58845e0) | — (bot blind) | ✅ Participant | Block 10744334; round 15→16 |

### Multi-Participant (`multi-exploit.js`) × 1 — 3 participants simultaneous, round 16

| Participant | Method | TX | Winner | Notes |
|---------|--------|-----|--------|-------|
| Participant 1 | Drainer (public) | [0x96d098](https://sepolia.etherscan.io/tx/0x96d098ec74e99ffa2f61bdf5311e8f621bf241689a5e3197913dd7d11dc2a99a) | 🤖 Bot | Bot frontran with [0x6a8946](https://sepolia.etherscan.io/tx/0x6a89464d0156d76e143c46938c0928c43d37241200cbf9573b2a98dd0f28cbb2) |
| Participant 2 | EOA (public) | [0xd4583f](https://sepolia.etherscan.io/tx/0xd4583f6c83d7cb4323cae3547a2a677e122473e58be713acdd125eaca5dc28d1) | 🤖 Bot | Same bot frontrun caught both in same detection window |
| Participant 3 | Flashbots | [0xf50be3](https://sepolia.etherscan.io/tx/0xf50be3b27ca34e5ed34590500c7b6069caccf250ecd2518458aec200c42e00f2) | 🤖 Bot² | Bot won round 16 before Flashbots tx landed |

> ² Important nuance: Flashbots does NOT help when other visible txs (Participants 1+2) alert the bot to the round. The bot wins the round outright, and the Flashbots tx arrives stale.

---

## MEV Bot Performance

| Metric | Value |
|--------|-------|
| Detection → frontrun range | **198ms – 292ms** |
| Total attacks detected | 11 (attacks #1–#11) |
| Successful frontruns | 9/11 (run #1 was edge case, #2–#11 bot won) |
| Nonce mine time range | 25ms – 4305ms (re-mine only on winningNumber change) |
| Hot-cache response (no re-mine) | < 350ms |
| Bot blindness (Flashbots only rounds) | 3/3 rounds: bot had zero detections |

---

## Summary

| Exploit | Beats MEV bot? | Reason |
|---------|----------------|--------|
| `eoa-direct-exploit.js` | ❌ No (2/3 bot wins¹) | `play()` calldata visible in public mempool |
| `off-chain-exploit.js` | ❌ No (3/3 bot wins) | `attack()` calldata visible; bot derives same winningNumber |
| `on-chain-exploit.js` | ❌ No (3/3 bot wins) | Selector detected in mempool; bot computes winningNumber independently from storage |
| `flashbots-exploit.js` | ✅ Yes (3/3 participant wins) | Tx bypasses public mempool — bot is completely blind |
| `multi-exploit.js` (S1+S2) | ❌ No | Public mempool; bot responds 198–266ms |
| `multi-exploit.js` (S3 Flashbots) | ❌ No (in multi-context²) | Bot won the round before Flashbots tx confirmed |

> ¹ EOA run 1 was a statistical edge case — high nonce (154740) slowed mining enough that tx was already in a block before bot frontrun propagated.
> ² Flashbots alone wins; but in multi-participant context the bot is triggered by other visible txs and wins the round first.

## New Contract Behavior (FairCasino v2) — Key Differences vs v1

| Behavior | v1 | v2 |
|----------|----|----|
| Wrong guess | `revert()` | Silent success — emits `GamePlayed(won=false, payout=0)` |
| Payout on win | Fixed `0.1 ETH` | `min(jackpotReserve/2, 0.1 ETH)` — dynamic |
| Ticket fee destination | Directly to contract balance | 90% → `jackpotReserve`, 10% → `profitPool` |
| Win detection in scripts | `receipt.status === 1` | Must check `currentRound > roundBefore` |
| House withdrawal | Unrestricted (10% cap bug in intermediate version) | Capped to `profitPool` only — jackpotReserve untouchable |

## Conclusion

All exploit vectors behave as expected on the new FairCasino v2. The segregated accounting (`jackpotReserve` / `profitPool`) and dynamic payout did not affect the exploit logic. The MEV bot successfully frontruns all public-mempool transactions in 198–292ms. The only reliable bypass remains **Flashbots Protect** — but only when the participant is the *sole* participant for that round. When other participants expose the round via public mempool, the bot wins the round and Flashbots txs arrive stale.
