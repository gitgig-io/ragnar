// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestUsdc is ERC20 {
    constructor(uint256 _initialSupply, address recipient)
        ERC20("TestUSDC", "USDC")
    {
        _mint(recipient, _initialSupply);
    }
}
