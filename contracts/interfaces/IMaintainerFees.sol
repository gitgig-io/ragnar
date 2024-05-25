// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IMaintainerFees {
  function getCustomFee(
    string calldata platform, 
    string calldata owner, 
    string calldata repo, 
    string calldata issue
  ) external view returns (bool, uint8);
}
