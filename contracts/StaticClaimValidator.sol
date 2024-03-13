// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {IClaimValidator} from "./interfaces/IClaimValidator.sol";

contract StaticClaimValidator is IClaimValidator {
  bool private result;

  constructor(bool _result) {
    result = _result;
  }

  function validate(address, string calldata, string calldata, string calldata, string calldata, address, uint256) override(IClaimValidator) external view returns (bool) {
    return result;
  }
}
