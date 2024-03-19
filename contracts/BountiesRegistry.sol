// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IBountiesRegistry} from "./interfaces/IBountiesRegistry.sol";

contract BountiesRegistry is IBountiesRegistry, AccessControlDefaultAdminRules {
  mapping (address => bool) private bountiesContracts;

  bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
  bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

  event BountiesContractRegistered(address contractAddress);
  event BountiesContractUnregistered(address contractAddress);

  error BountiesContractAlreadyRegistered();
  error BountiesContractNotRegistered();

  constructor(address _custodian) AccessControlDefaultAdminRules(3 days, msg.sender) {
    _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
    _grantRole(CUSTODIAN_ROLE, _custodian);
    _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
  }

  function addBountiesContract(address _addr) public onlyRole(CUSTODIAN_ROLE) {
    if (bountiesContracts[_addr]) {
      revert BountiesContractAlreadyRegistered();
    }

    bountiesContracts[_addr] = true;
    emit BountiesContractRegistered(_addr);
  }

  function removeBountiesContract(address _addr) public onlyRole(CUSTODIAN_ROLE) {
    if (!bountiesContracts[_addr]) {
      revert BountiesContractNotRegistered();
    }

    delete bountiesContracts[_addr];
    emit BountiesContractUnregistered(_addr);
  }

  function isBountiesContract(address _addr) public view override(IBountiesRegistry) returns (bool) {
    return bountiesContracts[_addr];
  }
}
