// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IBountiesConfig {
  function effectiveServiceFee(address _wallet) external view returns (uint8);
  function identityContract() external view returns (address);
  function isSupportedToken(address token) external view returns (bool);
  function maintainerFee() external view returns (uint8);
  function notary() external view returns (address);
}
