// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IClaimValidator} from "../interfaces/IClaimValidator.sol";
import {IBountiesRegistry} from "../interfaces/IBountiesRegistry.sol";
import {IPointsTokenRegistry} from "../interfaces/IPointsTokenRegistry.sol";

contract OrgKycClaimValidator is IClaimValidator, EIP712, AccessControlDefaultAdminRules {  // platformId -> orgName -> platformUserId (user being kyc'd) -> true/false
  // platformId -> org -> platformUserId -> bool
  mapping(string => mapping(string => mapping(string => bool))) public isKnownToOrg;

  // stables claimed: platformId -> org -> platformUserId -> amountClaimed
  mapping(string => mapping(string => mapping(string => uint256))) public orgUserStableAmountClaimed;

  // symbol -> bool
  mapping(address => bool) public isStablecoin;

  // $500 in 18 decimal places
  uint256 public kycThresholdAmount = 500 * 10 ** 18;

  address public bountiesRegistry;

  address public tokenRegistry;

  address public notary;

  bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
  bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

  bytes32 private constant TYPE_HASH = keccak256(
    "SetKnownStatus(string platformId,string orgName,string platformUserId,bool isKnown,uint256 expires)"
  );

  event ConfigChange(address bountiesRegistry, address pointsTokenRegistry, address notary, uint256 kycThresholdAmount);
  event StablecoinRegistration(address token, bool isRegistered);
  event KnownUserStatusUpdate(string platformId, string orgName, string platformUserId, bool isKnown);

  error AlreadySet();
  error InvalidSignature();
  error OrgExtractionError(string repo);
  error TimeframeError();

  constructor (address _custodian, address _bountiesRegistry, address _tokenRegistry, address _notary)
    AccessControlDefaultAdminRules(3 days, msg.sender)
    EIP712("GitGigOrgKycClaimValidator", "1")
  {
    _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
    _grantRole(CUSTODIAN_ROLE, _custodian);
    _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
    bountiesRegistry = _bountiesRegistry;
    tokenRegistry = _tokenRegistry;
    notary = _notary;
    _emitConfigChange();
  }

  modifier onlyBountyContract {
    address _sender = msg.sender;
    IBountiesRegistry _registry = IBountiesRegistry(bountiesRegistry);
    if (!_registry.isBountiesContract(_sender)) {
      // not a bounties contract...
      revert AccessControlUnauthorizedAccount(_sender, "RegisteredBountiesContract");
    }

    _;
  }

  function validate(
    address, // _identityContract
    string calldata _platformId, 
    string calldata _repoId, 
    string calldata, // _issueId
    string calldata _platformUserId, 
    address _tokenContract, 
    uint256 _amount
  ) external onlyBountyContract returns (bool) {
    string memory _org = _extractOrgFromRepo(_repoId);
    ERC20 _token = ERC20(_tokenContract);
    
    bool _userKnown = isKnownToOrg[_platformId][_org][_platformUserId];

    if (isStablecoin[_tokenContract]) {
      // normalize the dollar amount to consistent decimal places
      uint256 _normalizedAmount = _normalizeAmount(_token, _amount);
      uint256 _totalClaimedForUser = _normalizedAmount + orgUserStableAmountClaimed[_platformId][_org][_platformUserId];

      if (_totalClaimedForUser >= kycThresholdAmount && !_userKnown) {
        // user would be over limit of stablecoins for this org and they are not known
        return false;
      }

      orgUserStableAmountClaimed[_platformId][_org][_platformUserId] = _totalClaimedForUser;
      return true;
    } 

    // not a stablecoin
    IPointsTokenRegistry _ptRegistry = IPointsTokenRegistry(tokenRegistry);

    if (_ptRegistry.isPointsToken(_tokenContract)) {
      // it's a points token, so anyone can claim
      return true;
    }

    // not a stablecoin or points token so it depends on if the user is known
    return _userKnown;
  }

  // sig check ensures can only be called by org admin/owner
  function setKnownStatus(
    string calldata _platformId, 
    string calldata _orgName, 
    string calldata _platformUserId, 
    bool _isKnown, 
    uint256 _expires,
    bytes calldata _signature
  ) public {
    if (_expires > (block.timestamp + 30 minutes) || _expires < block.timestamp) {
      // replay attack so reject
      revert TimeframeError();
    }

    _validateSignature(_platformId, _orgName, _platformUserId, _isKnown, _expires, _signature);

    if (isKnownToOrg[_platformId][_orgName][_platformUserId] == _isKnown) {
      revert AlreadySet();
    }

    isKnownToOrg[_platformId][_orgName][_platformUserId] = _isKnown;

    emit KnownUserStatusUpdate(_platformId, _orgName, _platformUserId, _isKnown);
  }

  /* custodian function */

  function setStablecoin(address _token, bool _isStable) public onlyRole(CUSTODIAN_ROLE) {
    if (isStablecoin[_token] == _isStable) {
      revert AlreadySet();
    }

    isStablecoin[_token] = _isStable;
    emit StablecoinRegistration(_token, _isStable);
  }

  function setBountiesRegistry(address _bountiesRegistry) external onlyRole(CUSTODIAN_ROLE) {
    bountiesRegistry = _bountiesRegistry;
    _emitConfigChange();
  }

  function setTokenRegistry(address _tokenRegistry) external onlyRole(CUSTODIAN_ROLE) {
    tokenRegistry = _tokenRegistry;
    _emitConfigChange();
  }

  function setNotary(address _notary) external onlyRole(CUSTODIAN_ROLE) {
    notary = _notary;
    _emitConfigChange();
  }

  /* end custodian function */

  /* private function */

  function _extractOrgFromRepo(string calldata _repoId) private pure returns (string memory) {
    bytes calldata _b = bytes(_repoId);

    for (uint8 i; i < _b.length; i++) {
      if (_b[i] == "/") {
        // found "/" character, so return everything up to it
        return string(_b[:i]);
      }
    }

    revert OrgExtractionError(_repoId);
  }

  // normalize to 18 decimals
  function _normalizeAmount(ERC20 _token, uint256 _amount) private view returns (uint256) {
    uint8 _shift = 18 - _token.decimals();
    return _amount * 10 ** _shift;
  }

  function _emitConfigChange() private {
    emit ConfigChange(
      bountiesRegistry,
      tokenRegistry,
      notary,
      kycThresholdAmount
    );
  }

  function _validateSignature(
    string calldata _platformId,
    string calldata _orgName,
    string calldata _platformUserId,
    bool _isKnown,
    uint256 _expires,
    bytes calldata _signature
  ) private view {
    bytes32 _digest = _hashTypedDataV4(
      keccak256(
        abi.encode(
          TYPE_HASH,
          keccak256(bytes(_platformId)),
          keccak256(bytes(_orgName)),
          keccak256(bytes(_platformUserId)),
          _isKnown,
          _expires
        )
      )
    );

    address _signer = ECDSA.recover(_digest, _signature);

    if (_signer != notary) {
      revert InvalidSignature();
    }
  }
}
