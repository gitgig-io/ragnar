// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

contract Notarizable {
    address public notary;

    error InvalidAddress(address addr);

    constructor(address _notary) {
        notary = _notary;
    }

    function _setNotary(address _newNotary) internal {
        validateAddress(_newNotary);
        notary = _newNotary;
    }

    function validateAddress(address _address) private pure {
        if (_address == address(0)) {
            revert InvalidAddress(_address);
        }
    }
}
