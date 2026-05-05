# Test Battery — FairCasino CTF

Run a full exploit test battery: first without the MEV bot to validate each exploit works in isolation, then with the bot running to demonstrate frontrunning. Generate a dated markdown report at the end.

---

## Phase 0 — Prerequisites

1. Run `forge build` and confirm it exits with code 0. If it fails, stop and report the error.
2. Verify `.env` contains: `PRIVATE_KEY_1`, `PRIVATE_KEY_2`, `RPC_URL`, `CASINO_ADDRESS`, `GAME_SALT`, `FLASHBOTS_RPC`. If any are missing, stop and list what's absent.
3. Read initial casino state via a short inline Node script:
   ```bash
   node -e "
   import('ethers').then(async ({ethers}) => {
     const p = new ethers.JsonRpcProvider(process.env.RPC_URL);
     const c = new ethers.Contract(process.env.CASINO_ADDRESS, [
       'function currentRound() view returns (uint256)',
       'function jackpotReserve() view returns (uint256)',
       'function profitPool() view returns (uint256)',
     ], p);
     const [r,j,pp] = await Promise.all([c.currentRound(),c.jackpotReserve(),c.profitPool()]);
     console.log('Round:', r.toString());
     console.log('jackpotReserve:', ethers.formatEther(j), 'ETH');
     console.log('profitPool:', ethers.formatEther(pp), 'ETH');
   })
   "
   ```
   Record the values in the report.

---

## Phase 1 — Solo tests (no MEV bot)

> Goal: confirm each exploit's **own logic** is correct before introducing bot interference.
> Run each script **once**. If it fails for a non-bot reason (wrong nonce, revert, missing artifact), run it a **second time** after diagnosing. Stop if it fails twice — do not mask errors.

Scripts to test (in order):

1. `node scripts/casino-exploit/eoa-direct-exploit.js`
2. `node scripts/casino-exploit/off-chain-exploit.js`
3. `node scripts/casino-exploit/on-chain-exploit.js`
4. `node scripts/casino-exploit/flashbots-exploit.js`

For each run:
- Capture the TX hash printed to stdout.
- After the script exits, check `currentRound` changed (win) or stayed the same (lose/revert).
- Record: Script | TX hash | Status (✅ WIN / ❌ REVERT) | Round before → after | Notes

> Expected without bot: all 4 exploits WIN (participant reaches the casino first).

---

## Phase 2 — MEV bot tests (bot running)

> Goal: show the bot frontruns all public-mempool exploits; Flashbots remains immune.

1. Start the bot in the background:
   ```bash
   node scripts/mev/mev-bot.mjs > /tmp/mev-bot.log 2>&1 &
   BOT_PID=$!
   echo "Bot PID: $BOT_PID"
   sleep 5   # let it initialise cache
   ```

2. Run each exploit **3 times** (with ~15s between runs to let the round settle):
   - `node scripts/casino-exploit/eoa-direct-exploit.js`          × 3
   - `node scripts/casino-exploit/off-chain-exploit.js`           × 3
   - `node scripts/casino-exploit/on-chain-exploit.js`            × 3
   - `node scripts/casino-exploit/flashbots-exploit.js`           × 3
   - `node scripts/casino-exploit/multi-exploit.js`               × 1 (covers 3 participants at once)

3. After all runs, stop the bot:
   ```bash
   kill $BOT_PID
   ```

4. For each run, record: Script | Run # | Participant TX hash | Bot TX hash (if found in /tmp/mev-bot.log) | Winner | Frontrun time (ms, from bot log)

> Expected: EOA, off-chain, on-chain → **bot wins 3/3**. Flashbots → **participant wins 3/3**.

---

## Phase 3 — Report

Write the report to `TEST_REPORT_<YYYY-MM-DD>.md` in the project root.

### Report structure

```markdown
# FairCasino CTF — Test Report <date>

## Environment
- Casino: <address>
- Initial round: <N>
- Initial jackpotReserve: <X> ETH
- Initial profitPool: <Y> ETH

## Phase 1 — Solo results (no MEV bot)

| Script | TX | Status | Round Δ | Notes |
|--------|----|--------|---------|-------|
...

## Phase 2 — MEV bot results

| Script | Run | Participant TX | Bot TX | Winner | Frontrun (ms) |
|--------|-----|------------|--------|--------|---------------|
...

## MEV Bot Performance
- Detection → frontrun range: Xms – Yms
- Cache miss / re-mine: noted when [WIN# CHANGED] appears in log
- Success rate: N/M frontruns

## Summary

| Exploit | Beats MEV bot? | Reason |
|---------|---------------|--------|
| eoa-direct-exploit.js    | ❌ No  | Calldata visible in mempool |
| off-chain-exploit.js     | ❌ No  | Calldata visible in mempool |
| on-chain-exploit.js      | ❌ No  | Selector visible; bot derives winning# independently |
| flashbots-exploit.js     | ✅ Yes | Tx never enters public mempool |
| multi-exploit.js (S1+S2) | ❌ No  | Public mempool |
| multi-exploit.js (S3)    | ✅ Yes | Flashbots |

## Conclusion
<1–2 sentences>
```

All TX hashes must be linked: `https://sepolia.etherscan.io/tx/<hash>`
