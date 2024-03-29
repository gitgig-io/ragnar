// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IPointsTokenRegistry} from "./interfaces/IPointsTokenRegistry.sol";

contract PointsTokenRegistry is IPointsTokenRegistry, AccessControlDefaultAdminRules {
    // platformId -> owner -> symbol -> address
    mapping(string => mapping(string => mapping(string => address)))
        private symbols;

    mapping(address => bool) public isPointsToken;

    error SymbolAlreadyExists(
        string platformId,
        string owner,
        string symbol,
        address existing
    );

    event SymbolRegistered(
        string platformId,
        string owner,
        string symbol,
        address token
    );

    bytes32 public constant TRUSTED_CONTRACT_ADMIN_ROLE = keccak256("TRUSTED_CONTRACT_ADMIN_ROLE");
    bytes32 public constant TRUSTED_CONTRACT_ROLE = keccak256("TRUSTED_CONTRACT_ROLE");

    constructor(address _tcAdmin) AccessControlDefaultAdminRules(3 days, msg.sender) {
        _setRoleAdmin(TRUSTED_CONTRACT_ROLE, TRUSTED_CONTRACT_ADMIN_ROLE);
        _grantRole(TRUSTED_CONTRACT_ADMIN_ROLE, _tcAdmin);
    }

    function add(
        string calldata _platformId,
        string calldata _owner,
        string calldata _symbol,
        address _token
    ) external onlyRole(TRUSTED_CONTRACT_ROLE) {
        address _existing = symbols[_platformId][_owner][_symbol];
        if (_existing != address(0)) {
            revert SymbolAlreadyExists(_platformId, _owner, _symbol, _existing);
        }

        isPointsToken[_token] = true;
        symbols[_platformId][_owner][_symbol] = _token;

        emit SymbolRegistered(_platformId, _owner, _symbol, _token);
    }

    function getContract(
        string calldata _platformId,
        string calldata _owner,
        string calldata _symbol
    ) external view returns (address) {
        return symbols[_platformId][_owner][_symbol];
    }
}
