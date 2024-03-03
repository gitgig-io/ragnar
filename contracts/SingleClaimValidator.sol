// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {IClaimValidator} from "./interfaces/IClaimValidator.sol";

// this is only used for testing
contract SingleClaimValidator is IClaimValidator {
  mapping(string => mapping(string => bool)) public claimed;

  constructor() {
  }

  function validate(address, string calldata _platformId, string calldata _platformUserId, address, uint256) override(IClaimValidator) external returns (bool) {
    if (claimed[_platformId][_platformUserId]) {
      return false;
    }

    claimed[_platformId][_platformUserId] = true;

    return true;
  }
}
