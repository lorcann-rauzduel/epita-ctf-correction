/**
 * Deploy FairCasino to Sepolia and fund it with 0.2 ETH.
 *
 * Run: node scripts/deploy-casino.js
 *
 * After deployment, copy the printed CASINO_ADDRESS into .env.
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

// ─── Casino parameters ────────────────────────────────────────────────────────
// SECRET_TARGET and GAME_SALT are the on-chain game parameters baked into the
// constructor — they define the CTF challenge and are intentional constants here.
const SECRET_TARGET = BigInt("0x14ca66724587aafc3454b268c296bc483d17df");
const GAME_SALT     = 7192271n;
const HONEY_ETH     = "0.2"; // jackpot pool (2 × JACKPOT = 2 × 0.1 ETH)

async function main() {
    const privateKey = process.env.PRIVATE_KEY_1;
    const ORACLE     = process.env.ORACLE_ADDRESS;
    if (!privateKey) throw new Error("Missing PRIVATE_KEY_1 in .env");
    if (!ORACLE)     throw new Error("Missing ORACLE_ADDRESS in .env");

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const deployer = new ethers.Wallet(privateKey, provider);
    console.log("Deploying FairCasino from:", deployer.address);

    const artifactPath = path.join(
        __dirname, "../out/FairCasino.sol/FairCasino.json"
    );
    if (!fs.existsSync(artifactPath)) {
        throw new Error("Artifact not found — run: forge build");
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
    const casino  = await factory.deploy(SECRET_TARGET, ORACLE, GAME_SALT, {
        value: ethers.parseEther(HONEY_ETH),
    });
    await casino.waitForDeployment();
    const addr = await casino.getAddress();

    console.log("\n=== DEPLOYMENT SUMMARY ===");
    console.log("FairCasino:    ", addr);
    console.log("Oracle:        ", ORACLE);
    console.log("secretTarget:  ", SECRET_TARGET.toString(16));
    console.log("gameSalt:      ", GAME_SALT.toString());
    console.log("Funded:        ", HONEY_ETH, "ETH");
    console.log("=".repeat(26));
    console.log("\nAdd to .env:");
    console.log(`CASINO_ADDRESS=${addr}`);
    console.log(`SECRET_TARGET=${SECRET_TARGET.toString(16)}`);
    console.log(`GAME_SALT=${GAME_SALT}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
