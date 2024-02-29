// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Notarizable} from "./Notarizable.sol";
import {IBountiesConfig} from "./IBountiesConfig.sol";
import {ITokenSupportable} from "./ITokenSupportable.sol";

contract BountiesConfig is IBountiesConfig, AccessControlDefaultAdminRules, ITokenSupportable {
  struct CustomFee {
    uint8 fee;
    bool enabled;
  }

  event TokenSupportChange(
    bool supported, address token, string symbol, uint8 decimals
  );

  event ConfigChange(
    address notary,
    address identityContract,
    uint8 serviceFee,
    uint8 maintainerFee
  );

  event CustomFeeChange(
    address wallet, string feeType, uint8 fee, bool enabled
  );

  error InvalidAddress(address addr);
  error InvalidFee(uint8 fee);
  error TokenSupportError(address token, bool supported);

  bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
  bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
  bytes32 public constant TRUSTED_CONTRACT_ADMIN_ROLE = keccak256("TRUSTED_CONTRACT_ADMIN_ROLE");
  bytes32 public constant TRUSTED_CONTRACT_ROLE = keccak256("TRUSTED_CONTRACT_ROLE");

  // the notary address
  address public notary;

  // the identity contract
  address public identityContract;

  // the percentage that the platform charges
  uint8 public serviceFee = 20;

  // the percentage that is the maintainer share of a bounty
  uint8 public maintainerFee = 10;

  // tokens which support bounties
  mapping(address => bool) public isSupportedToken;

  // store custom service fees
  mapping(address => CustomFee) public customServiceFees;

  constructor(
    address _custodian,
    address _notary,
    address _identityContract,
    address[] memory _supportedTokens
  )
    AccessControlDefaultAdminRules(3 days, msg.sender)
  {
    _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
    _grantRole(CUSTODIAN_ROLE, _custodian);
    _grantRole(TRUSTED_CONTRACT_ADMIN_ROLE, _custodian);
    _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
    _setRoleAdmin(TRUSTED_CONTRACT_ROLE, TRUSTED_CONTRACT_ADMIN_ROLE);

    notary = _notary;
    identityContract = _identityContract;

    for (uint256 i = 0; i < _supportedTokens.length; i++) {
      isSupportedToken[_supportedTokens[i]] = true;

      emit TokenSupportChange(
        true,
        _supportedTokens[i],
        ERC20(_supportedTokens[i]).symbol(),
        ERC20(_supportedTokens[i]).decimals()
      );
    }

    emit ConfigChange(notary, identityContract, serviceFee, maintainerFee);
  }

  modifier onlyRoles(bytes32 role1, bytes32 role2) {
    if (!hasRole(role1, msg.sender) && !hasRole(role2, msg.sender)) {
      revert AccessControlUnauthorizedAccount(msg.sender, role1);
    }

    _;
  }

  function effectiveServiceFee(address _wallet) external view returns (uint8) {
    CustomFee storage _customFee = customServiceFees[_wallet];
    if (_customFee.enabled) {
      return _customFee.fee;
    }

    return serviceFee;
  }

  function emitConfigChange() private {
    emit ConfigChange(notary, identityContract, serviceFee, maintainerFee);
  }

  function setNotary(address _newNotary) external onlyRole(CUSTODIAN_ROLE) {
    _validateAddress(_newNotary);
    notary = _newNotary;
    emitConfigChange();
  }

  function setIdentity(address _newIdentity) external onlyRole(CUSTODIAN_ROLE) {
    _validateAddress(_newIdentity);
    identityContract = _newIdentity;
    emitConfigChange();
  }

  function setServiceFee(uint8 _newServiceFee) external onlyRole(CUSTODIAN_ROLE) {
    _validateFee(_newServiceFee);
    serviceFee = _newServiceFee;
    emitConfigChange();
  }

  function setCustomServiceFee(address _wallet, uint8 _newServiceFee) external onlyRole(CUSTODIAN_ROLE) {
    _validateFee(_newServiceFee);
    if (_newServiceFee == serviceFee) {
      delete customServiceFees[_wallet];
      emit CustomFeeChange(_wallet, "service", _newServiceFee, false);
    } else {
      customServiceFees[_wallet] = CustomFee(_newServiceFee, true);
      emit CustomFeeChange(_wallet, "service", _newServiceFee, true);
    }
  }

  function setMaintainerFee(uint8 _newMaintainerFee) external onlyRole(CUSTODIAN_ROLE) {
    _validateFee(_newMaintainerFee);
    maintainerFee = _newMaintainerFee;
    emitConfigChange();
  }

  function addToken(address _newToken) external onlyRoles(CUSTODIAN_ROLE, TRUSTED_CONTRACT_ROLE) {
    if (isSupportedToken[_newToken]) {
      revert TokenSupportError(_newToken, true);
    }

    isSupportedToken[_newToken] = true;

    emit TokenSupportChange(
      true, _newToken, ERC20(_newToken).symbol(), ERC20(_newToken).decimals()
    );
  }

  function removeToken(address _removeToken) external onlyRoles(CUSTODIAN_ROLE, TRUSTED_CONTRACT_ROLE) {
    if (!isSupportedToken[_removeToken]) {
      revert TokenSupportError(_removeToken, false);
    }

    isSupportedToken[_removeToken] = false;

    emit TokenSupportChange(
      false,
      _removeToken,
      ERC20(_removeToken).symbol(),
      ERC20(_removeToken).decimals()
    );
  }

  // private functions

  function _validateAddress(address _address) private pure {
    if (_address == address(0)) {
      revert InvalidAddress(_address);
    }
  }

  function _validateFee(uint8 _fee) private pure {
    if (_fee < 0 || _fee > 100) {
      revert InvalidFee(_fee);
    }
  }

}
