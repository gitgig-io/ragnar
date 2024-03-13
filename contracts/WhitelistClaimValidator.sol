// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IClaimValidator} from "./interfaces/IClaimValidator.sol";

// this is only used for testing
contract WhitelistClaimValidator is IClaimValidator, AccessControlDefaultAdminRules {
  mapping(string => mapping(string => bool)) public whitelisted;

  bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
  bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

  constructor(address _custodian)
    AccessControlDefaultAdminRules(3 days, msg.sender)
  {
    _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
    _grantRole(CUSTODIAN_ROLE, _custodian);
    _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
  }

  function add(string calldata _platformId, string calldata _platformUserId) external onlyRole(CUSTODIAN_ROLE) {
    whitelisted[_platformId][_platformUserId] = true;
  }

  function remove(string calldata _platformId, string calldata _platformUserId) onlyRole(CUSTODIAN_ROLE) external {
    delete whitelisted[_platformId][_platformUserId];
  }

  function validate(address, string calldata _platformId, string calldata, string calldata, string calldata _platformUserId, address, uint256) override(IClaimValidator) external view returns (bool) {
    if (whitelisted[_platformId][_platformUserId]) {
      return true;
    }

    return false;
  }
}
