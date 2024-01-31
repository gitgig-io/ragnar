// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface ITokenSupportable {
    function addToken(address _newToken) external;

    function removeToken(address _removeToken) external;
}
