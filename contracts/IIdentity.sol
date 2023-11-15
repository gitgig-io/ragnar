// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

struct PlatformUser {
    string platformId;
    string userId;
    string username;
}

interface IIdentity {
    function mint(
        address userAddress,
        string memory platformId,
        string memory platformUserId,
        string memory platformUsername,
        uint16 nonce,
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

    function balanceOf(address addr) external view returns (uint256);

    function tokenOfOwnerByIndex(address addr, uint256 index)
        external
        view
        returns (uint256);

    function platformUser(uint256 tokenId)
        external
        view
        returns (PlatformUser memory);
}
