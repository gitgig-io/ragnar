// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestUsdc is ERC20 {
    constructor(uint256 _initialSupply, address recipient)
        ERC20("TestUSDC", "USDC")
    {
        _mint(recipient, _initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
