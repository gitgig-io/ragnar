// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GeneratedERC20 is ERC20 {
    uint8 private dec;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _totalSupply,
        address _supplyRecipient,
        uint8 _feePercent,
        address _feeRecipient
    ) ERC20(_name, _symbol) {
        dec = _decimals;

        uint256 _fee = (_feePercent * _totalSupply) / 100;

        _mint(_supplyRecipient, _totalSupply - _fee);
        _mint(_feeRecipient, _fee);
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }
}
