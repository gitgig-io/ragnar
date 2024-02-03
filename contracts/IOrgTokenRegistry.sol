// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

interface IOrgTokenRegistry {
    function add(
        string calldata _platformId,
        string calldata _org,
        string calldata _symbol,
        address _token
    ) external;

    function getContract(
        string calldata _platformId,
        string calldata _org,
        string calldata _symbol
    ) external view returns (address);
}
