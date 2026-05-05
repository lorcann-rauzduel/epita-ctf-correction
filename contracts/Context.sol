// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

abstract contract Context {
    address private _trustedForwarder;
    uint256 private _relayId;
    bytes32 private _executionCluster;
    uint256 private _gasRelayContext;

    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextIdentifier() internal view virtual returns (bytes32) {
        return _executionCluster;
    }
}
