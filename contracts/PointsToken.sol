// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PointsToken is ERC20 {
    uint8 private dec;

    string public platformId;

    string public org;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _platformId,
        string memory _org,
        uint8 _decimals,
        uint256 _totalSupply,
        address _supplyRecipient
    ) ERC20(_name, _symbol) {
        dec = _decimals;
        platformId = _platformId;
        org = _org;
        _mint(_supplyRecipient, _totalSupply);
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }
}
