// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IBountiesRegistry} from "./interfaces/IBountiesRegistry.sol";

contract PointsToken is ERC20 {
    uint8 private dec;

    string public platformId;

    string public org;

    address public owner;

    address public bountiesRegistry;

    constructor(
        address _bountiesRegistry,
        string memory _name,
        string memory _symbol,
        string memory _platformId,
        string memory _org,
        uint8 _decimals,
        uint256 _totalSupply,
        address _owner
    ) ERC20(_name, _symbol) {
        dec = _decimals;
        platformId = _platformId;
        org = _org;
        owner = _owner;
        bountiesRegistry = _bountiesRegistry;
        _mint(_owner, _totalSupply);
    }

    modifier allowedToTransfer(address _sender) {
      if (_sender != owner) {
        // not the owner/minter of the token

        IBountiesRegistry _registry = IBountiesRegistry(bountiesRegistry);
        if (!_registry.isBountiesContract(_sender)) {
          // not a bounties contract...
          revert ERC20InvalidSender(_sender);
        }
      }

      _;
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }

    function transfer(address _to, uint256 _value) public override(ERC20) allowedToTransfer(_msgSender()) returns (bool) {
      return super.transfer(_to, _value);
    }

    function transferFrom(address _from, address _to, uint256 _value) public override(ERC20) allowedToTransfer(_from) returns (bool) {
      return super.transferFrom(_from, _to, _value);
    }
}
