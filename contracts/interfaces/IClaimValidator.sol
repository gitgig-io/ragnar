// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IClaimValidator {
  function validate(address identityContract, string calldata platformId, string calldata platformUserId, address tokenContract, uint256 amount) external returns (bool);
}
