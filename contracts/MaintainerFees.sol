// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Notarizable} from "./Notarizable.sol";

contract MaintainerFees is
    EIP712,
    Pausable,
    AccessControlDefaultAdminRules,
    Notarizable
{
    // store owner level fees
    // platform -> owner -> fee
    mapping(string => mapping (string => uint8)) public ownerFee;
    mapping(string => mapping (string => bool)) public hasOwnerFee;

    // store repo level fees
    // platform -> owner -> repo -> fee
    mapping(string => mapping (string => mapping(string => uint8))) public repoFee;
    mapping(string => mapping (string => mapping(string => bool))) public hasRepoFee;

    // store issue level fees
    // platform -> owner -> repo -> issue -> fee
    mapping(string => mapping (string => mapping(string => mapping(string => uint8)))) public issueFee;
    mapping(string => mapping (string => mapping(string => mapping(string => bool)))) public hasIssueFee;

    bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant FINANCE_ADMIN_ROLE = keccak256("FINANCE_ADMIN_ROLE");
    bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");

    bytes32 private constant SET_OWNER_FEE_TYPE_HASH = keccak256("SetOwnerFee(string platform,string owner,uint8 fee,uint256 expires)");
    bytes32 private constant SET_REPO_FEE_TYPE_HASH = keccak256("SetRepoFee(string platform,string owner,string repo,uint8 fee,uint256 expires)");
    bytes32 private constant SET_ISSUE_FEE_TYPE_HASH = keccak256("SetIssueFee(string platform,string owner,string repo,string issue,uint8 fee,uint256 expires)");

    uint8 public constant UNSET_FEE = 255;

    error InvalidSignature();
    error InvalidFee(uint8);
    error TimeframeError();

    event ConfigChange(
        address notary,
        uint8 unsetFee
    );

    event UpdateOwnerFee(
      string platform,
      string owner,
      uint8 fee,
      address by
    );

    event UpdateRepoFee(
      string platform,
      string owner,
      string repo,
      uint8 fee,
      address by
    );

    event UpdateIssueFee(
      string platform,
      string owner,
      string repo,
      string issue,
      uint8 fee,
      address by
    );

    constructor(
        address _custodian,
        address _notary
    )
        Pausable()
        AccessControlDefaultAdminRules(3 days, msg.sender)
        EIP712("GitGigMaintainerFees", "1")
        Notarizable(_notary)
    {
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);

        _emitConfigChange();
    }

    function getCustomFee(
        string calldata _platform,
        string calldata _owner,
        string calldata _repo,
        string calldata _issue
    ) external view returns (bool, uint8) {
        // first check for an issue fee
        if (hasIssueFee[_platform][_owner][_repo][_issue]) {
            return (true, issueFee[_platform][_owner][_repo][_issue]);
        }

        if (hasRepoFee[_platform][_owner][_repo]) {
            return (true, repoFee[_platform][_owner][_repo]);
        }

        if (hasOwnerFee[_platform][_owner]) {
            return (true, ownerFee[_platform][_owner]);
        }

        return (false, UNSET_FEE);
    }

    function setOwnerFee(
        string calldata _platform,
        string calldata _owner,
        uint8 _fee,
        uint256 _expires,
        bytes calldata _signature
    ) external whenNotPaused {
        _validateFee(_fee);
        _validateExpires(_expires);
        _validateOwnerFeeSignature(_platform, _owner, _fee, _expires, _signature);

        (bool _isSet, uint8 _newFee) = _feeInputToIsSetAndFee(_fee);

        hasOwnerFee[_platform][_owner] = _isSet;
        ownerFee[_platform][_owner] = _newFee;

        emit UpdateOwnerFee(_platform, _owner, _newFee, msg.sender);
    }

    function setRepoFee(
        string calldata _platform,
        string calldata _owner,
        string calldata _repo,
        uint8 _fee,
        uint256 _expires,
        bytes calldata _signature
    ) external whenNotPaused {
        _validateFee(_fee);
        _validateExpires(_expires);
        _validateRepoFeeSignature(_platform, _owner, _repo, _fee, _expires, _signature);

        (bool _isSet, uint8 _newFee) = _feeInputToIsSetAndFee(_fee);

        hasRepoFee[_platform][_owner][_repo] = _isSet;
        repoFee[_platform][_owner][_repo] = _newFee;

        emit UpdateRepoFee(_platform, _owner, _repo, _newFee, msg.sender);
    }

    function setIssueFee(
        string calldata _platform,
        string calldata _owner,
        string calldata _repo,
        string calldata _issue,
        uint8 _fee,
        uint256 _expires,
        bytes calldata _signature
    ) external whenNotPaused {
        _validateFee(_fee);
        _validateExpires(_expires);
        _validateIssueFeeSignature(_platform, _owner, _repo, _issue, _fee, _expires, _signature);

        (bool _isSet, uint8 _newFee) = _feeInputToIsSetAndFee(_fee);

        hasIssueFee[_platform][_owner][_repo][_issue] = _isSet;
        issueFee[_platform][_owner][_repo][_issue] = _newFee;

        emit UpdateIssueFee(_platform, _owner, _repo, _issue, _newFee, msg.sender);
    }

    // --------------------
    // private functions
    // --------------------

    function _validateExpires(uint256 _expires) private view {
        if (_expires > (block.timestamp + 30 minutes) || _expires < block.timestamp) {
          // replay attack or too far in future so reject
          revert TimeframeError();
        }
    }

    function _validateFee(uint8 _fee) private pure {
        if (_fee > 100 && _fee != UNSET_FEE) {
            revert InvalidFee(_fee);
        }
    }

    function _feeInputToIsSetAndFee(uint8 _fee) private pure returns (bool, uint8) {
        if (_fee == UNSET_FEE) {
          // unsetting
          return (false, 0);
        } 

        // setting
        return (true, _fee);
    }

    function _validateOwnerFeeSignature(
        string calldata _platform,
        string calldata _owner,
        uint8 _fee,
        uint256 _expires,
        bytes calldata _signature
    ) private view {
        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SET_OWNER_FEE_TYPE_HASH,
                    keccak256(bytes(_platform)),
                    keccak256(bytes(_owner)),
                    _fee,
                    _expires
                )
            )
        );

        address _signer = ECDSA.recover(_digest, _signature);
        _validateSigner(_signer);
    }

    function _validateRepoFeeSignature(
        string calldata _platform,
        string calldata _owner,
        string calldata _repo,
        uint8 _fee,
        uint256 _expires,
        bytes calldata _signature
    ) private view {
        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SET_REPO_FEE_TYPE_HASH,
                    keccak256(bytes(_platform)),
                    keccak256(bytes(_owner)),
                    keccak256(bytes(_repo)),
                    _fee,
                    _expires
                )
            )
        );

        address _signer = ECDSA.recover(_digest, _signature);
        _validateSigner(_signer);
    }

    function _validateIssueFeeSignature(
        string calldata _platform,
        string calldata _owner,
        string calldata _repo,
        string calldata _issue,
        uint8 _fee,
        uint256 _expires,
        bytes calldata _signature
    ) private view {
        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SET_ISSUE_FEE_TYPE_HASH,
                    keccak256(bytes(_platform)),
                    keccak256(bytes(_owner)),
                    keccak256(bytes(_repo)),
                    keccak256(bytes(_issue)),
                    _fee,
                    _expires
                )
            )
        );

        address _signer = ECDSA.recover(_digest, _signature);
        _validateSigner(_signer);
    }

    function _validateSigner(address _signer) private view {
        if (_signer != notary) {
            revert InvalidSignature();
        }
    }

    function _emitConfigChange() private {
        emit ConfigChange(notary, UNSET_FEE);
    }

    // --------------------
    // custodian functions
    // --------------------

    function setNotary(address _notary) external onlyRole(CUSTODIAN_ROLE) {
        _setNotary(_notary);
        _emitConfigChange();
    }

    function pause() external onlyRole(CUSTODIAN_ROLE) {
      _pause();
    }

    function unpause() external onlyRole(CUSTODIAN_ROLE) {
      _unpause();
    }
}
