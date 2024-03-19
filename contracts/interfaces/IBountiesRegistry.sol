// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IBountiesRegistry {
  function isBountiesContract(address _addr) external returns (bool);
}
