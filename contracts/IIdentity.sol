// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface IIdentity {
    function mint(
        address userAddress,
        string memory platformId,
        string memory platformUserId,
        string memory platformUsername,
        bytes memory signature
    ) external;

    function tokenIdForPlatformUser(
        string memory platformId,
        string memory platformUserId
    ) external view returns (uint256);

    function ownerOf(string memory platformId, string memory platformUserId)
        external
        view
        returns (address);
}
