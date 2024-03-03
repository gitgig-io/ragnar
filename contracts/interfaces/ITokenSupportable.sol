// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface ITokenSupportable {
    function addToken(address _newToken) external;

    function removeToken(address _removeToken) external;
}
