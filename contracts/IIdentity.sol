// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface IIdentity {
    function walletForPlatformUser(
        string memory platformId,
        string memory userId
    ) external view returns (address);
}
