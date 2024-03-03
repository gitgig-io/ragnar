// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface IPointsTokenRegistry {
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
