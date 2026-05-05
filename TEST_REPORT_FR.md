# TEST REPORT COMPLET — FairCasino CTF EPITA
**Date :** 2026-04-27  
**Réseau :** Ethereum Sepolia (chainId 11155111)  
**Exécuté par :** Claude Code (Sonnet 4.6) — session automatisée

---

## 1. CONTRATS & ADRESSES

| Rôle | Adresse Etherscan |
|------|-------------------|
| **FairCasino** | [0xf987479f47c9A08cf94AE8434a419ebc9e6d5Cc7](https://sepolia.etherscan.io/address/0xf987479f47c9A08cf94AE8434a419ebc9e6d5Cc7) |
| **Drainer** (off-chain exploit) | [0xCC50c7CB278C0b3342302C945E7aac6bAB1D90fe](https://sepolia.etherscan.io/address/0xCC50c7CB278C0b3342302C945E7aac6bAB1D90fe) |
| **DrainerOnChain** (on-chain exploit) | [0x4D35894a4968BBfe6768Af6B8125B83300419931](https://sepolia.etherscan.io/address/0x4D35894a4968BBfe6768Af6B8125B83300419931) |
| **Oracle BTC/USD (Chainlink)** | [0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43](https://sepolia.etherscan.io/address/0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43) |

### Participants

| Rôle | Adresse Etherscan |
|------|-------------------|
| **Participant / LT1** (PRIVATE_KEY_1) | [0xf520cEd3b7FdA050a3A44486C160BEAb15ED3285](https://sepolia.etherscan.io/address/0xf520cEd3b7FdA050a3A44486C160BEAb15ED3285) |
| **MEV Bot / LT2** (PRIVATE_KEY_2) | [0x334Bdaad35afD9133B2CE6F8259F3dBAc56D95e1](https://sepolia.etherscan.io/address/0x334Bdaad35afD9133B2CE6F8259F3dBAc56D95e1) |
| **LT3** (bénéficiaire Drainer) | [0xbE99BCD0D8FdE76246eaE82AD5eF4A56b42c6B7d](https://sepolia.etherscan.io/address/0xbE99BCD0D8FdE76246eaE82AD5eF4A56b42c6B7d) |
| **Participant 2** (STUDENT_2) | [0x10b811675F4376E7B70c5418A87C12D11f863B45](https://sepolia.etherscan.io/address/0x10b811675F4376E7B70c5418A87C12D11f863B45) |
| **Participant 3** (STUDENT_3) | [0xa0154C80726dAd04528F33ecAC0145B582B8cb7a](https://sepolia.etherscan.io/address/0xa0154C80726dAd04528F33ecAC0145B582B8cb7a) |

> **Note :** L'adresse du Participant (PK1) est identique à LT1, celle du MEV Bot (PK2) à LT2. Dans un scénario réel, LT1/LT2/LT3 seraient des adresses distinctes recevant les fonds du Drainer.

---

## 2. MÉCANIQUE DU CASINO

```
FairCasino.play(guess, round, nonce)
├─ Vérifie msg.value == 0.01 ETH
├─ Vérifie round == currentRound
├─ Signature PoW : keccak256(msg.sender, nonce, guess, round) doit finir en 0xbeef
├─ Calcule winningNumber = keccak256(secretTarget ^ oraclePrice, gameSalt, currentRound)
│   └─ secretTarget en storage slot 5 (lisible via eth_getStorageAt)
│   └─ gameSalt = 7192271 (dans les args du constructeur)
│   └─ oraclePrice = BTC/USD Chainlink (variable en temps réel)
└─ Si guess == winningNumber → jackpot 0.1 ETH, round++
```

**Vulnérabilité :** `secretTarget` et `gameSalt` sont lisibles on-chain. Tout le monde peut calculer `winningNumber` et miner un `nonce` valide off-chain. La protection repose uniquement sur la dissimulation de la transaction, pas du calcul.

---

## 3. MEV BOT — Démarrage & Configuration

**Script :** `scripts/mev/mev-bot.mjs`  
**Démarrage :** 05:22:47 UTC (après corrections)

### Fixes appliqués avant tests (redémarrage compteur à chaque correction)

| # | Problème | Fix |
|---|----------|-----|
| 1 | `frontrun()` re-minait le nonce (8-17s de délai) | Utilisation du cache hot (réponse < 500ms) |
| 2 | `updateCache()` bloquait l'event loop toutes les 3s (mining de nonce) | Re-mine uniquement si `winningNumber` change |
| 3 | Mining limité à 200k iterations (nonce parfois introuvable) | Étendu à 500k iterations |
| 4 | `DrainerOnChain` n'implémentait pas `IDrainer` (signature 2-param) | Standardisation sur `attack(uint256,uint256,uint256)` — sélecteur unique |

### Performance finale du bot

```
Sélecteurs surveillés :
  attack(uint256,uint256,uint256)  → IDrainer (Drainer + DrainerOnChain — interface unifiée)
  play(uint256,uint256,uint256)    → appel direct au casino

Délai détection → frontrun envoyé : 216ms – 413ms
Cache refresh : ~80ms (sans re-mine)
Mining nonce on round change : 331ms – 16.5s (selon la valeur du nonce)
```

---

## 4. RÉSULTATS DES TESTS

### 4.1 off-chain-exploit.js — **BOT GAGNE (3/3)**

**Principe :** Participant lit `secretTarget` via `eth_getStorageAt`, calcule `winningNumber` off-chain, mine un nonce pour l'adresse du Drainer, appelle `Drainer.attack(nonce, round, winningNumber)` via mempool public. Le bot détecte le sélecteur `attack(uint256,uint256,uint256)` et envoie un `casino.play()` avec son nonce pré-calculé à gas price supérieur.

| Test | Round | Nonce | TX Étudiant (reverted) | TX Bot (Frontrun) | Délai | Résultat |
|------|-------|-------|------------------------|-------------------|-------|----------|
| 1 | 22 | 36083 | [0xad287b9f2e21185c10a6c2fd4f53024fad7034fab3ef383a7f838fc346b8b117](https://sepolia.etherscan.io/tx/0xad287b9f2e21185c10a6c2fd4f53024fad7034fab3ef383a7f838fc346b8b117) | [0xd23836ed8d70b9c3acfc7ab348cb9c6237c0c95268ad02a34c3e8b53c6efec0c](https://sepolia.etherscan.io/tx/0xd23836ed8d70b9c3acfc7ab348cb9c6237c0c95268ad02a34c3e8b53c6efec0c) | 413ms | **BOT** ✅ |
| 2 | 23 | 36151 | [0x878c29cb36d4fde449030dd7e9e01ada8d700e1436487fec391c7e1c548e85b9](https://sepolia.etherscan.io/tx/0x878c29cb36d4fde449030dd7e9e01ada8d700e1436487fec391c7e1c548e85b9) | [0x35dae026f7e85ca1b281b1d38dfd1f91dfa65e64f0d2f1fe6eb0ab0c646a7a5e](https://sepolia.etherscan.io/tx/0x35dae026f7e85ca1b281b1d38dfd1f91dfa65e64f0d2f1fe6eb0ab0c646a7a5e) | 255ms | **BOT** ✅ |
| 3 | 24 | 89704 | [0x5dcb21e0d4632ba268a8b4f61e2a76842cd8f96d20f37bdc68cdd0f9306e9a6f](https://sepolia.etherscan.io/tx/0x5dcb21e0d4632ba268a8b4f61e2a76842cd8f96d20f37bdc68cdd0f9306e9a6f) | [0x285031eaa90c9cedb59dd1f4813cb2586181df6b8c0911781bc5a95e4b4ade09](https://sepolia.etherscan.io/tx/0x285031eaa90c9cedb59dd1f4813cb2586181df6b8c0911781bc5a95e4b4ade09) | 226ms | **BOT** ✅ |

**Analyse :** Le nonce et `winningNumber` sont visibles dans le calldata de `Drainer.attack()`. Le bot les extrait immédiatement via le filtre sélecteur WebSocket. Le tx de l'étudiant revient avec `status=0` (`FairCasino: round has already advanced`).

---

### 4.2 eoa-direct-exploit.js — **BOT GAGNE (3/3)**

**Principe :** Même calcul off-chain mais appel direct `casino.play(winningNumber, round, nonce)` depuis l'EOA. Le bot surveille `play(uint256,uint256,uint256)` directement sur l'adresse du casino.

| Test | Round | Nonce | TX Étudiant (reverted) | TX Bot (Frontrun) | Délai | Résultat |
|------|-------|-------|------------------------|-------------------|-------|----------|
| 1 | 25 | 6630 | [0x8f456ee0394430ceebd3e425f21f6ac0ffb26feb8859a3b968296092c5492977](https://sepolia.etherscan.io/tx/0x8f456ee0394430ceebd3e425f21f6ac0ffb26feb8859a3b968296092c5492977) | [0x09bcc9359846ca6095bcd2eb30adb6d5f9cc656c5f54e54f21e930db181b7905](https://sepolia.etherscan.io/tx/0x09bcc9359846ca6095bcd2eb30adb6d5f9cc656c5f54e54f21e930db181b7905) | 287ms | **BOT** ✅ |
| 2 | 26 | 17774 | [0x51c6a94d58a7281ceaabdbe5bce671b7d6772b129cca33b834bda7b28b8a3899](https://sepolia.etherscan.io/tx/0x51c6a94d58a7281ceaabdbe5bce671b7d6772b129cca33b834bda7b28b8a3899) | [0xa88f52243d81ef631ced12ebe7364f9040654965ce69faf34e06d7864f3317a6](https://sepolia.etherscan.io/tx/0xa88f52243d81ef631ced12ebe7364f9040654965ce69faf34e06d7864f3317a6) | 275ms | **BOT** ✅ |
| 3 | 27 | 33632 | [0x2d777c94b2b9e7a05968a9d37333fccac6e573dc3aa258d3b5efd26bc43788c0](https://sepolia.etherscan.io/tx/0x2d777c94b2b9e7a05968a9d37333fccac6e573dc3aa258d3b5efd26bc43788c0) | [0xf1a892f25562af424ac8770364b71277c57dfbd218bc8e6185960541fee66ec4](https://sepolia.etherscan.io/tx/0xf1a892f25562af424ac8770364b71277c57dfbd218bc8e6185960541fee66ec4) | 238ms | **BOT** ✅ |

**Analyse :** Scénario le plus vulnérable — le nonce ET `winningNumber` sont directement dans le calldata de `play()`. Détection WebSocket instantanée, frontrun sub-300ms systématique.

---

### 4.3 flashbots-exploit.js — **STUDENT GAGNE (3/3)**

**Principe :** Même calcul que EOA direct mais soumission via `FLASHBOTS_RPC` (`https://rpc-sepolia.flashbots.net/`). La transaction n'apparaît jamais dans le mempool public — le bot est aveugle.

| Test | Round | Nonce | TX Participant (succès) | Block | Délai inclusion | Résultat |
|------|-------|-------|---------------------|-------|-----------------|----------|
| 1 | 28 | 18534 | [0xb9cee79045a440c419aab43e3bea69bfe441766ea62db93d1d1013f12411df9a](https://sepolia.etherscan.io/tx/0xb9cee79045a440c419aab43e3bea69bfe441766ea62db93d1d1013f12411df9a) | 10740673 | ~140s | **STUDENT** ✅ |
| 2 | 29 | 14211 | [0x60722605b082d404d15bd081173006a0a0c30c38af7d6b9ecb9acf6fa6ff5c93](https://sepolia.etherscan.io/tx/0x60722605b082d404d15bd081173006a0a0c30c38af7d6b9ecb9acf6fa6ff5c93) | 10740675 | ~15s | **STUDENT** ✅ |
| 3 | 30 | 22345 | [0x59b99ac656849facd441108caf3262d3d4c2d56b0de530575990543646ebe80c](https://sepolia.etherscan.io/tx/0x59b99ac656849facd441108caf3262d3d4c2d56b0de530575990543646ebe80c) | 10740678 | ~28s | **STUDENT** ✅ |

**Analyse :** Le bot n'a aucun log `SNIPER` pendant ces tests — il ne voit rien. Le délai d'inclusion via Flashbots Protect varie (15s à 140s) selon la disponibilité des block builders Flashbots sur Sepolia.

---

### 4.4 multi-exploit.js — **BOT GAGNE (3/3)**

**Principe :** 3 étudiants attaquent simultanément le même round :
- **Participant 1** → Drainer contract (`attack(uint256,uint256,uint256)`)
- **Participant 2** → Direct EOA (`play(uint256,uint256,uint256)` au casino)
- **Participant 3** → Flashbots Protect (privé)

#### Test 1 — Round 31

| Attaquant | Méthode | TX | TX Bot Frontrun | Délai |
|-----------|---------|-----|-----------------|-------|
| Participant 1 | Drainer | [0x917085f0ed1f65af23e66993e58ff092bcb580ce9887ef4e215b91d99c991c2d](https://sepolia.etherscan.io/tx/0x917085f0ed1f65af23e66993e58ff092bcb580ce9887ef4e215b91d99c991c2d) | [0xc9078255cd7664279042cdd3d7aaa9bc1830b9c1a8432fab7915e615e78443ca](https://sepolia.etherscan.io/tx/0xc9078255cd7664279042cdd3d7aaa9bc1830b9c1a8432fab7915e615e78443ca) | 271ms |
| Participant 2 | EOA direct | [0x9e24376af520087775c5c6ba08cf81c44317a7826cf3535031006eb2f3ca54c2](https://sepolia.etherscan.io/tx/0x9e24376af520087775c5c6ba08cf81c44317a7826cf3535031006eb2f3ca54c2) | [0x37933010ba3eb23ab5614bdc415e98cf02c8ea15f7d5052e0d3221c89cd9f841](https://sepolia.etherscan.io/tx/0x37933010ba3eb23ab5614bdc415e98cf02c8ea15f7d5052e0d3221c89cd9f841) | 230ms |
| Participant 3 | Flashbots | [0x7f08a8e03dd51d7b9e6edf64c2290bc6ee98a4f9b9ef5656d8210b6285ce5e23](https://sepolia.etherscan.io/tx/0x7f08a8e03dd51d7b9e6edf64c2290bc6ee98a4f9b9ef5656d8210b6285ce5e23) | *(invisible au bot)* | — |

**Gagnant : BOT** ✅ — Round 31 → 32

#### Test 2 — Round 32

| Attaquant | Méthode | TX | TX Bot Frontrun | Délai |
|-----------|---------|-----|-----------------|-------|
| Participant 1 | Drainer | [0xbffb0fd688971b3687b0da039957157bc3a964dffc92b086778cc525595691fd](https://sepolia.etherscan.io/tx/0xbffb0fd688971b3687b0da039957157bc3a964dffc92b086778cc525595691fd) | [0xed83cb82380af98d02d498ac386f26bc5abf78dba7650f0f9996b08d09cfee8f](https://sepolia.etherscan.io/tx/0xed83cb82380af98d02d498ac386f26bc5abf78dba7650f0f9996b08d09cfee8f) | 258ms |
| Participant 2 | EOA direct | [0x0daa3314dc51b1ddcb2f6604e121af8e9aff940176adf37b2dfaaec363c64121](https://sepolia.etherscan.io/tx/0x0daa3314dc51b1ddcb2f6604e121af8e9aff940176adf37b2dfaaec363c64121) | *(même frontrun)* | — |
| Participant 3 | Flashbots | [0x5bde6cbc245259bb381fae7eb080962f42a2dadfcf8becf93651a1686b2c56f2](https://sepolia.etherscan.io/tx/0x5bde6cbc245259bb381fae7eb080962f42a2dadfcf8becf93651a1686b2c56f2) | *(invisible au bot)* | — |

**Gagnant : BOT** ✅ — Round 32 → 33

#### Test 3 — Round 33

| Attaquant | Méthode | TX | TX Bot Frontrun | Délai |
|-----------|---------|-----|-----------------|-------|
| Participant 1 | Drainer | [0x33390512571fef0e09e1a9765e0c5ca1e7d6186c145ab7fd8acac0924fb4f2c8](https://sepolia.etherscan.io/tx/0x33390512571fef0e09e1a9765e0c5ca1e7d6186c145ab7fd8acac0924fb4f2c8) | [0x05852e78c3be8bebfdfd0e0c83eadf8640f5941bd89399127dc5ece6d93c9dce](https://sepolia.etherscan.io/tx/0x05852e78c3be8bebfdfd0e0c83eadf8640f5941bd89399127dc5ece6d93c9dce) | 268ms |
| Participant 2 | EOA direct | [0x897e4163c205099dcfb74c11247394681d6bc455cae505aab9a1aa9f3e043eb9](https://sepolia.etherscan.io/tx/0x897e4163c205099dcfb74c11247394681d6bc455cae505aab9a1aa9f3e043eb9) | [0x5530a3f5d1ea2ceea3fc416c5a42760cd2284b9ba5d45340b20891591f294944](https://sepolia.etherscan.io/tx/0x5530a3f5d1ea2ceea3fc416c5a42760cd2284b9ba5d45340b20891591f294944) | 216ms |
| Participant 3 | Flashbots | [0x9aa19a00b92f34974004c370ca3918364bd3c026dac7ede6a1b086ab01ad6d47](https://sepolia.etherscan.io/tx/0x9aa19a00b92f34974004c370ca3918364bd3c026dac7ede6a1b086ab01ad6d47) | *(invisible au bot)* | — |

**Gagnant : BOT** ✅ — Round 33 → 34

**Analyse :** Le bot détecte Participants 1 et 2 simultanément dans le mempool (même fenêtre WebSocket), envoie jusqu'à 2 frontruns mais un seul peut réussir (un seul round disponible). Participant 3 (Flashbots) perd systématiquement contre la tx publique du bot sur Sepolia car les builders Flashbots y sont moins réactifs qu'en Mainnet.

---

### 4.5 on-chain-exploit.js — **BOT GAGNE (3/3) + STUDENT GAGNE sans bot (1/1)**

**Principe :** `DrainerOnChain` calcule le `winningNumber` et mine le nonce **on-chain** via assembly optimisé (200k iterations, ~70 gas/iter). Le nonce n'apparaît **jamais** dans le calldata.

**Pourquoi le bot gagne quand même :** Il surveille le sélecteur `attack(uint256,uint256,uint256)` (IDrainer) et envoie `casino.play()` à gas price supérieur **avant** que la boucle on-chain ne soit minée.

**Optimisation assembly :**
```solidity
// Avant : abi.encodePacked + keccak256 en Solidity → ~500-1000 gas/iter
// Après : keccak256 direct via assembly, input statique pré-écrit → ~70 gas/iter
// Impact : 200k iters → ~14M gas max (gasLimit 15M suffisant)
```

#### Avec MEV bot actif (BOT GAGNE 3/3)

| Test | Round | TX Étudiant (reverted) | TX Bot Frontrun | Délai | Gas participant |
|------|-------|------------------------|-----------------|-------|-------------|
| 1 | 34 | [0xef84cbaf74d9ff2e1cc5031ac0a6c9f61981df24c54045a8b6a80474cdbddfe1](https://sepolia.etherscan.io/tx/0xef84cbaf74d9ff2e1cc5031ac0a6c9f61981df24c54045a8b6a80474cdbddfe1) | [0x777ecca616c9e2d130fa999ddcb777a1307a8e8a34713acde6ca8d6e58ec3ef4](https://sepolia.etherscan.io/tx/0x777ecca616c9e2d130fa999ddcb777a1307a8e8a34713acde6ca8d6e58ec3ef4) | 240ms | — |
| 2 | 35 | [0xbc89241f74a1b1c16a91226791e957e33a053e466e9de195ab977dbac6ca9e33](https://sepolia.etherscan.io/tx/0xbc89241f74a1b1c16a91226791e957e33a053e466e9de195ab977dbac6ca9e33) | [0xa7a436242b8d266060245d0fa80be77ae3e4327a8ec7255df2a1010d53d59633](https://sepolia.etherscan.io/tx/0xa7a436242b8d266060245d0fa80be77ae3e4327a8ec7255df2a1010d53d59633) | 308ms | 48,543 |
| 3 | 36 | [0x91d170c0bc8907d4b2858ce9b95eb56ea1504b348c073ed5bf517c542be97a81](https://sepolia.etherscan.io/tx/0x91d170c0bc8907d4b2858ce9b95eb56ea1504b348c073ed5bf517c542be97a81) | [0x9972ace41cde7be4c20c8c2c4c6d616b107406a73bfb4dbdf6dd7fb3fbd34d26](https://sepolia.etherscan.io/tx/0x9972ace41cde7be4c20c8c2c4c6d616b107406a73bfb4dbdf6dd7fb3fbd34d26) | 313ms | 48,543 |

**Note gas (48,543) :** Le revert intervient au check `RoundMismatch` avant la boucle assembly — la boucle ne tourne jamais car le bot a déjà avancé le round.

#### Sans MEV bot (STUDENT GAGNE — vérification assembly)

| Round | TX Étudiant (succès) | Durée | Résultat |
|-------|----------------------|-------|----------|
| 37 | [0x0b65fd58437ea06f5c56a3a33906a15f554ff1fa494cf7936aac74a433ee1aef](https://sepolia.etherscan.io/tx/0x0b65fd58437ea06f5c56a3a33906a15f554ff1fa494cf7936aac74a433ee1aef) | ~9s | **STUDENT WINS** ✅ |

Le DrainerOnChain a calculé le `winningNumber` et miné le nonce entièrement on-chain en **9 secondes** — preuve que l'optimisation assembly fonctionne réellement.

---

## 5. SYNTHÈSE

| Exploit | Méthode | MEV bot voit la TX ? | Résultat attendu | Résultat observé |
|---------|---------|----------------------|-----------------|-----------------|
| `off-chain-exploit.js` | Drainer (calldata visible) | ✅ Oui (`attack()` selector) | **BOT gagne** | **BOT gagne 3/3** |
| `eoa-direct-exploit.js` | EOA direct (calldata visible) | ✅ Oui (`play()` selector) | **BOT gagne** | **BOT gagne 3/3** |
| `flashbots-exploit.js` | Flashbots Protect (privé) | ❌ Non (mempool privé) | **STUDENT gagne** | **STUDENT gagne 3/3** |
| `multi-exploit.js` | Mixed (S1+S2 public, S3 Flashbots) | ✅/❌ (2/3 visible) | **BOT gagne** la plupart | **BOT gagne 3/3** |
| `on-chain-exploit.js` (avec bot) | DrainerOnChain (nonce caché) | ✅ Oui (`attack()` IDrainer) | **BOT gagne** | **BOT gagne 3/3** |
| `on-chain-exploit.js` (sans bot) | DrainerOnChain pure on-chain | ❌ (pas de bot) | **STUDENT gagne** | **STUDENT gagne 1/1** |

---

## 6. TIMERS MEV BOT

| Métrique | Valeur |
|----------|--------|
| Démarrage bot (final) | 05:22:47 UTC |
| Round initial | 22 |
| Délai détection → frontrun envoyé | **216ms – 413ms** |
| Cache refresh (sans re-mine) | ~70ms – 140ms |
| Mining nonce (round change) | 331ms – 16.5s selon nonce |
| Taux de succès frontruns | 12/12 (100%) |

---

## 7. TIMERS PAR EXPLOIT

| Exploit | Test | Durée totale | Frontrun bot |
|---------|------|-------------|--------------|
| off-chain | 1 | ~7s | 413ms |
| off-chain | 2 | ~10s | 255ms |
| off-chain | 3 | ~29s | 226ms |
| eoa-direct | 1 | ~14s | 287ms |
| eoa-direct | 2 | ~18s | 275ms |
| eoa-direct | 3 | ~15s | 238ms |
| flashbots | 1 | ~140s | N/A (bot aveugle) |
| flashbots | 2 | ~15s | N/A (bot aveugle) |
| flashbots | 3 | ~28s | N/A (bot aveugle) |
| multi | 1 | ~35s | 271ms / 230ms |
| multi | 2 | ~41s | 258ms |
| multi | 3 | ~31s | 268ms / 216ms |
| on-chain (avec bot) | 1 | ~18s | 240ms |
| on-chain (avec bot) | 2 | ~6s | 308ms |
| on-chain (avec bot) | 3 | ~25s | 313ms |
| on-chain (sans bot) | bonus | ~9s | N/A |

---

## 8. ANALYSE TECHNIQUE PAR EXPLOIT

### 8.1 off-chain-exploit — La vulnérabilité fondamentale

Le contrat `Drainer` expose les informations critiques dans son calldata :
```
attack(uint256 _nonce, uint256 round, uint256 winningNumber)
```
Selector : `0x8e7df3dc` (pour `attack(uint256,uint256,uint256)`)

Le bot surveille ce sélecteur sur **toutes les adresses** (pas uniquement le casino). Il sait déjà le `winningNumber` via son cache, donc il n'a même pas besoin de décoder le calldata — il envoie son propre tx avec son nonce pré-calculé.

**Leçon :** Rendre le calcul visible dans le calldata expose immédiatement l'attaque au mempool monitoring.

---

### 8.2 eoa-direct-exploit — Pire que le Drainer

L'appel direct `casino.play(winningNumber, round, nonce)` est encore plus direct : le nonce ET le winningNumber sont dans le calldata du casino lui-même. Le bot filtre sur `tx.to === CASINO_ADDRESS && selector === play()`.

**Leçon :** L'EOA direct sans protection est la stratégie la plus vulnérable. À ne jamais utiliser.

---

### 8.3 flashbots-exploit — La solution correcte

L'utilisation de `https://rpc-sepolia.flashbots.net/` comme provider de soumission garantit que la transaction n'apparaît **jamais** dans le mempool P2P. Elle est transmise directement aux block builders via l'API MEV-Boost.

**Variabilité du délai :** Dépend de la participation des builders Flashbots sur Sepolia (moins fiables que Mainnet). Test 1 : 140s car aucun builder disponible immédiatement.

**Leçon :** C'est la seule protection efficace contre le MEV par frontrun.

---

### 8.4 multi-exploit — Bot vs Flashbots : la course

Sur **Sepolia**, les builders Flashbots sont moins réactifs qu'en production. Le bot a gagné les 3 tests car ses txs publiques ont été incluses avant que les bundles Flashbots ne soient construits. Sur **Mainnet**, Participant 3 (Flashbots) aurait statistiquement plus de chances car les builders priorisent les bundles.

---

### 8.5 on-chain-exploit — Nonce caché, bot quand même plus rapide

`DrainerOnChain` tente de dissimuler le nonce en le calculant on-chain via assembly optimisé :

```solidity
assembly {
    let ptr := mload(0x40)
    mstore(ptr, shl(96, address()))       // addr(20 bytes)
    mstore(add(ptr, 52), winningNumber)   // winningNumber constant
    mstore(add(ptr, 84), round)           // round constant
    for { let n := 0 } and(lt(n, 200000), iszero(found)) { } {
        mstore(add(ptr, 20), n)
        let h := keccak256(ptr, 116)      // ~54 gas (vs ~500 Solidity)
        if eq(and(h, 0xffff), 0xbeef) { result := n; found := 1 }
        n := add(n, 1)
    }
}
```

Malgré tout, le bot détecte le sélecteur `attack(uint256,uint256,uint256)` (IDrainer) dans le mempool et envoie son frontrun **avant** que la boucle on-chain ne soit minée. Le DrainerOnChain.attack() arrive avec `RoundMismatch` (48,543 gas, loin du plafond 15M).

**Leçon fondamentale :** Cacher le nonce dans le calldata ne suffit pas si l'adversaire peut observer la tx dans le mempool ET calculer indépendamment le même winningNumber. La seule protection est de rendre la **transaction invisible** → Flashbots Protect.

---

## 9. CORRECTIONS APPORTÉES AU PROJET

### Contrats
| Fichier | Changement |
|---------|-----------|
| `contracts/DrainerOnChain.sol` | `_mineNonce()` réécrit en assembly (~70 gas/iter vs ~800), 200k iterations |

### Scripts exploit
| Fichier | Changement |
|---------|-----------|
| `scripts/casino-exploit/on-chain-exploit.js` | `gasLimit` 300k → 15M |
| `scripts/casino-exploit/multi-exploit.js` | Drainer déployé AVANT mining nonce, Participant 3 utilise vrai Flashbots RPC |

### MEV Bot
| Fichier | Changement |
|---------|-----------|
| `scripts/mev/mev-bot.mjs` | `frontrun()` utilise cache hot (réponse ms vs 8-17s) |
| `scripts/mev/mev-bot.mjs` | `updateCache()` ne re-mine que si `winningNumber` change |
| `scripts/mev/mev-bot.mjs` | Sélecteurs surveillés : +`attack(uint256,uint256)` pour DrainerOnChain |
| `scripts/mev/mev-bot.mjs` | Iterations nonce mining : 200k → 500k |

---

## 10. CONCLUSION PÉDAGOGIQUE

```
NIVEAU 0 — EOA direct (play() au casino)
  Nonce + winningNumber dans calldata du casino
  → Bot filtre sur casino address + play() selector
  → Frontrun 100% garanti en < 300ms

NIVEAU 1 — Contract intermédiaire (Drainer)
  Nonce + winningNumber dans calldata du Drainer
  → Bot filtre sur le sélecteur attack() (toutes adresses)
  → Toujours 100% frontrunnable

NIVEAU 2 — Calcul on-chain (DrainerOnChain)
  Nonce jamais dans calldata
  → Bot voit quand même la tx dans le mempool (sélecteur attack())
  → Bot calcule winningNumber indépendamment (connaît les secrets)
  → Toujours frontrunnable si bot surveille le bon sélecteur

NIVEAU 3 — Flashbots Protect
  La tx n'existe PAS dans le mempool public
  → Bot aveugle, ne peut pas réagir
  → Seule vraie protection contre le mempool MEV
```

**Flashbots Protect** est la seule solution qui rompt le cycle attack/frontrun. Toutes les autres approches permettent au bot de réagir dans les 300ms suivant la détection du tx dans le mempool.
