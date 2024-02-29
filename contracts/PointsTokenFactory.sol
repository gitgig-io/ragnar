// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {PointsToken} from "./PointsToken.sol";
import {ITokenSupportable} from "./ITokenSupportable.sol";
import {Notarizable} from "./Notarizable.sol";
import {IPointsTokenRegistry} from "./IPointsTokenRegistry.sol";

// TODO: make this pausable?
contract PointsTokenFactory is
    EIP712,
    AccessControlDefaultAdminRules,
    Notarizable
{
    uint256 public fee;
    uint8 public dec;
    uint256 public totalSupply;
    address[] public bountiesConfigContracts;
    address public registry;

    bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant FINANCE_ADMIN_ROLE = keccak256("FINANCE_ADMIN_ROLE");
    bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");

    bytes32 private constant TYPE_HASH =
        keccak256(
            "CreatePointsToken(string name,string symbol,string platform,string owner,address creator)"
        );

    error InvalidSignature();
    error InvalidSymbol(string symbol);
    error InvalidArgument();
    error WrongFeeAmount(uint256);

    event PointsTokenCreate(
        address pToken,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        address creator,
        string platform,
        string owner
    );

    event ConfigChange(
        uint256 fee,
        uint8 decimals,
        uint256 totalSupply,
        address[] bountiesConfigContracts,
        address registry,
        address notary
    );

    event FeeWithdraw(address recipient, uint256 amount);

    // TODO: add flag to limit transferability
    constructor(
        address _custodian,
        address _finance,
        address _notary,
        address _registry,
        uint8 _decimals,
        uint256 _totalSupply,
        uint256 _fee
    )
        AccessControlDefaultAdminRules(3 days, msg.sender)
        EIP712("GitGigPointsFactory", "1")
        Notarizable(_notary)
    {
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
        _grantRole(FINANCE_ADMIN_ROLE, _finance);
        _grantRole(FINANCE_ROLE, _finance);
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        _setRoleAdmin(FINANCE_ROLE, FINANCE_ADMIN_ROLE);
        registry = _registry;
        dec = _decimals;
        totalSupply = _totalSupply;
        fee = _fee;

        _emitConfigChange();
    }

    function createPointsToken(
        string calldata _name,
        string calldata _symbol,
        string calldata _platformId,
        string calldata _owner,
        bytes calldata _signature
    ) external payable {
        _validateFee(msg.value);
        _validateSymbol(_symbol);
        _validateSignature(_name, _symbol, _platformId, _owner, _signature);

        address _pToken = address(
            new PointsToken(
                _name,
                _symbol,
                _platformId,
                _owner,
                dec,
                totalSupply,
                msg.sender
            )
        );

        for (uint256 i = 0; i < bountiesConfigContracts.length; i++) {
            ITokenSupportable(bountiesConfigContracts[i]).addToken(_pToken);
        }

        // add symbol to registry
        // this will fail if the symbol already exists in the owner
        IPointsTokenRegistry(registry).add(_platformId, _owner, _symbol, _pToken);

        emit PointsTokenCreate(
            _pToken,
            _name,
            _symbol,
            dec,
            totalSupply,
            msg.sender,
            _platformId,
            _owner
        );
    }

    function _validateFee(uint256 _fee) private view {
        if (_fee != fee) {
            revert WrongFeeAmount(msg.value);
        }
    }

    function _validateSymbol(string calldata _symbol) private pure {
        if (!_eq(_substr(_symbol, 0, 1), "p")) {
            revert InvalidSymbol(_symbol);
        }
    }

    function _validateSignature(
        string calldata _name,
        string calldata _symbol,
        string calldata _platformId,
        string calldata _owner,
        bytes calldata _signature
    ) private view {
        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TYPE_HASH,
                    keccak256(bytes(_name)),
                    keccak256(bytes(_symbol)),
                    keccak256(bytes(_platformId)),
                    keccak256(bytes(_owner)),
                    msg.sender
                )
            )
        );

        address _signer = ECDSA.recover(_digest, _signature);

        if (_signer != notary) {
            revert InvalidSignature();
        }
    }

    function _substr(
        string calldata str,
        uint256 start,
        uint256 end
    ) private pure returns (string memory) {
        return str[start:end];
    }

    function _eq(string memory str1, string memory str2)
        private
        pure
        returns (bool)
    {
        return
            keccak256(abi.encodePacked(str1)) ==
            keccak256(abi.encodePacked(str2));
    }

    // --------------------
    // custodian functions
    // --------------------

    function setDecimals(uint8 _decimals) external onlyRole(CUSTODIAN_ROLE) {
        if (_decimals > 18) {
            revert InvalidArgument();
        }
        dec = _decimals;
        _emitConfigChange();
    }

    function setTotalSupply(uint256 _totalSupply) external onlyRole(CUSTODIAN_ROLE) {
        totalSupply = _totalSupply;
        _emitConfigChange();
    }

    function setFee(uint256 _fee) external onlyRole(CUSTODIAN_ROLE) {
        fee = _fee;
        _emitConfigChange();
    }

    function setRegistry(address _registry) external onlyRole(CUSTODIAN_ROLE) {
        registry = _registry;
        _emitConfigChange();
    }

    function setNotary(address _notary) external onlyRole(CUSTODIAN_ROLE) {
        _setNotary(_notary);
        _emitConfigChange();
    }

    function addBountiesConfigContract(address _bounties) external onlyRole(CUSTODIAN_ROLE) {
        for (uint256 i = 0; i < bountiesConfigContracts.length; i++) {
            if (bountiesConfigContracts[i] == _bounties) {
                revert InvalidArgument();
            }
        }

        bountiesConfigContracts.push(_bounties);
        _emitConfigChange();
    }

    function removeBountiesConfigContract(address _bounties) external onlyRole(CUSTODIAN_ROLE) {
        bool _found = false;
        // find _bounties in the bountiesConfigContracts list
        for (uint256 i = 0; i < bountiesConfigContracts.length; i++) {
            if (bountiesConfigContracts[i] == _bounties) {
                bountiesConfigContracts[i] = bountiesConfigContracts[
                    bountiesConfigContracts.length - 1
                ];
                bountiesConfigContracts.pop();
                _found = true;
            }
        }

        if (!_found) {
            revert InvalidArgument();
        }

        _emitConfigChange();
    }

    // ------------------
    // finance functions
    // ------------------

    function withdrawFees() external onlyRole(FINANCE_ROLE) {
        uint256 amount = address(this).balance;
        address payable receipient = payable(msg.sender);

        receipient.transfer(amount);

        emit FeeWithdraw(receipient, amount);
    }

    function _emitConfigChange() private {
        emit ConfigChange(
            fee,
            dec,
            totalSupply,
            bountiesConfigContracts,
            registry,
            notary
        );
    }
}
