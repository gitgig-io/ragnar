// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IIdentity, PlatformUser} from "./interfaces/IIdentity.sol";
import {ITokenSupportable} from "./interfaces/ITokenSupportable.sol";
import {IBountiesConfig} from "./interfaces/IBountiesConfig.sol";
import {IClaimValidator} from "./interfaces/IClaimValidator.sol";

contract Bounties is
  EIP712,
  Pausable,
  AccessControlDefaultAdminRules
{
  using ECDSA for bytes32;
  using MessageHashUtils for bytes32;

  event BountyCreate(
    string platform,
    string repo,
    string issue,
    address issuer,
    address token,
    string symbol,
    uint8 decimals,
    uint256 amount,
    uint256 fee,
    uint256 reclaimableAt
  );

  event IssueTransition(
    string platform,
    string repo,
    string issue,
    string status,
    string priorStatus,
    string maintainerUserId,
    address maintainerAddress,
    string[] resolvers
  );

  event BountyClaim(
    string platform,
    string repo,
    string issue,
    string platformUserId,
    address claimer,
    string role,
    address token,
    string symbol,
    uint8 decimals,
    uint256 amount
  );

  event Withdraw(
    address token,
    string symbol,
    uint8 decimals,
    address recipient,
    uint256 amount,
    string kind
  );

  event BountySweep(
    address wallet,
    string platform,
    string repo,
    string issue,
    address token,
    string symbol,
    uint8 decimals,
    uint256 amount
  );

  event BountyReclaim(
    string platform,
    string repo,
    string issue,
    address issuer,
    address token,
    string symbol,
    uint8 decimals,
    uint256 amount
  );

  event ConfigChange(address configContract);

  error ClaimValidationError(string platformId, string platformUserId, address token, uint256 amount);
  error AlreadyClaimed(string platformId, string repoId, string issueId, address claimer);
  error IdentityNotFound(string platformId, string platformUserId);
  error InvalidResolver(string platformId, string repoId, string issueId, address claimer);
  error InvalidSignature();
  error IssueClosed(string platformId, string repoId, string issueId);
  error NoAmount(address token);
  error NoBounty(string platformId, string repoId, string issueId, address[] tokens);
  error MaxTokensError();
  error TimeframeError(uint256 eligibleAt);
  error TokenSupportError(address token, bool supported);

  // roles
  bytes32 public constant CUSTODIAN_ADMIN_ROLE = keccak256("CUSTODIAN_ADMIN_ROLE");
  bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
  bytes32 public constant FINANCE_ADMIN_ROLE = keccak256("FINANCE_ADMIN_ROLE");
  bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");

  bytes32 private constant TYPE_HASH = keccak256(
    "MaintainerClaim(string maintainerUserId,string platformId,string repoId,string issueId,string[] resolverIds)"
  );

  // how long before bounties are reclaimable for an issue (from first bounty posted on the issue)
  uint64 public constant RECLAIM_START = 14 days;

  // number of days
  uint64 public constant RECLAIM_DAYS = 90 days;

  // store the service fees that have accumulated
  mapping(address => uint256) public fees;

  // store registered and closed issues. 0 resolvers means registered, 1+ resolvers means closed
  mapping(string => mapping(string => mapping(string => string[]))) public resolvers;

  // store bounties by platform, repo, issue and token
  mapping(
    string => mapping(string => mapping(string => mapping(address => uint256)))
  ) public bounties;

  // store a list of tokens for each bounty
  // platformId -> repoId -> issueId -> tokenAddresses[]
  mapping(string => mapping(string => mapping(string => address[]))) public bountyTokens;

  mapping(string platformId => mapping(string repoId => mapping(string issueId => mapping(address tokenContract => mapping(string platformUserId => bool))))) public claimed;

  // when the bounties on an issue are reclaimable
  // platformId -> repoId -> issueId -> reclaimableAt
  mapping(string => mapping(string => mapping(string => uint256))) public reclaimableAt;

  // the amount of contributions by individual issuers for reclaim purposes
  // platformId -> repoId -> issueId -> token -> issuer -> amount
  mapping(string => mapping(string => mapping(string => mapping(address => mapping(address => uint256))))) public bountyContributions;

  address public configContract;

  constructor(address _configContract, address _custodian, address _finance)
    Pausable()
    AccessControlDefaultAdminRules(3 days, msg.sender)
    EIP712("GitGigBounties", "1")
  {
    _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
    _grantRole(CUSTODIAN_ROLE, _custodian);
    _grantRole(FINANCE_ADMIN_ROLE, _finance);
    _grantRole(FINANCE_ROLE, _finance);
    _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
    _setRoleAdmin(FINANCE_ROLE, FINANCE_ADMIN_ROLE);
    configContract = _configContract;
    emit ConfigChange(configContract);
  }

  modifier supportedToken(address tokenContract) {
    if (!_getConfig().isSupportedToken(tokenContract)) {
      revert TokenSupportError(tokenContract, false);
    }

    _;
  }

  modifier issueNotClosed(
    string calldata _platform,
    string calldata _repoId,
    string calldata _issueId
  ) {
    if (resolvers[_platform][_repoId][_issueId].length > 0) {
      revert IssueClosed(_platform, _repoId, _issueId);
    }

    _;
  }

  modifier unclaimedResolverOnly(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId
  ) {
    address[] storage _bountyTokens =
      bountyTokens[_platformId][_repoId][_issueId];
    (bool _isResolver, bool _hasUnclaimed) = _isUnclaimedResolver(
      _bountyTokens,
      _platformId,
      claimed[_platformId][_repoId][_issueId],
      bounties[_platformId][_repoId][_issueId],
      resolvers[_platformId][_repoId][_issueId]
    );

    // ensure they are actually a resolver for this issue
    if (!_isResolver) {
      revert InvalidResolver(_platformId, _repoId, _issueId, msg.sender);
    }

    // ensure they have not claimed yet
    if (!_hasUnclaimed) {
      revert AlreadyClaimed(_platformId, _repoId, _issueId, msg.sender);
    }

    _;
  }

  function setConfigContract(address _configContract) external onlyRole(CUSTODIAN_ROLE) {
    configContract = _configContract;
    emit ConfigChange(configContract);
  }

  function postBounty(
    string calldata _platform,
    string calldata _repoId,
    string calldata _issueId,
    address _tokenContract,
    uint256 _amount
  )
    external
    whenNotPaused
    issueNotClosed(_platform, _repoId, _issueId)
    supportedToken(_tokenContract)
  {
    if (bountyTokens[_platform][_repoId][_issueId].length >= 25 && bounties[_platform][_repoId][_issueId][_tokenContract] == 0) {
      revert MaxTokensError();
    }

    uint256 _fee = (_amount * _getConfig().effectiveServiceFee(msg.sender)) / 100;
    uint256 _bountyAmount = _amount - _fee;

    // capture fee
    fees[_tokenContract] += _fee;

    // record the number of tokens in the contract allocated to this issue
    bounties[_platform][_repoId][_issueId][_tokenContract] += _bountyAmount;
    bountyContributions[_platform][_repoId][_issueId][_tokenContract][msg.sender] += _bountyAmount;
    _addTokenToBountyTokens(_platform, _repoId, _issueId, _tokenContract);

    uint256 _reclaimableAt = reclaimableAt[_platform][_repoId][_issueId];

    if (_reclaimableAt == 0) {
      // first bounty for this token on this issue so set the reclaimableAt
      _reclaimableAt = block.timestamp + RECLAIM_START;
      reclaimableAt[_platform][_repoId][_issueId] = _reclaimableAt;
    }

    // transfer tokens from the msg sender to this contract and record the bounty amount
    ERC20(_tokenContract).transferFrom(msg.sender, address(this), _amount);

    emit BountyCreate(
      _platform,
      _repoId,
      _issueId,
      msg.sender,
      _tokenContract,
      ERC20(_tokenContract).symbol(),
      ERC20(_tokenContract).decimals(),
      _bountyAmount,
      _fee,
      _reclaimableAt
    );
  }

  function _addTokenToBountyTokens(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    address _tokenContract
  ) private {
    address[] storage _bountyTokens =
      bountyTokens[_platformId][_repoId][_issueId];

    for (uint256 i = 0; i < _bountyTokens.length; i++) {
      if (_bountyTokens[i] == _tokenContract) {
        return;
      }
    }

    // not found, so add it
    bountyTokens[_platformId][_repoId][_issueId].push(_tokenContract);
  }

  function _maybeRemoveBountyToken(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    address _tokenContract
  ) private {
    if (bounties[_platformId][_repoId][_issueId][_tokenContract] == 0) {
      address[] storage _bountyTokens = bountyTokens[_platformId][_repoId][_issueId];

      for (uint256 i = 0; i < _bountyTokens.length; i++) {
        if (_bountyTokens[i] == _tokenContract) {
          _bountyTokens[i] = _bountyTokens[_bountyTokens.length - 1];
          _bountyTokens.pop();
          return;
        }
      }
    }
  }

  function _validateSignature(
    string calldata _maintainerUserId,
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    string[] calldata _resolverIds,
    bytes calldata _signature
  ) private view {
    bytes32[] memory _resolvers = new bytes32[](_resolverIds.length);

    // https://stackoverflow.com/a/70762545/63738
    for (uint256 i = 0; i < _resolverIds.length; i++) {
      _resolvers[i] = keccak256(bytes(_resolverIds[i]));
    }

    bytes32 _digest = _hashTypedDataV4(
      keccak256(
        abi.encode(
          TYPE_HASH,
          keccak256(bytes(_maintainerUserId)),
          keccak256(bytes(_platformId)),
          keccak256(bytes(_repoId)),
          keccak256(bytes(_issueId)),
          keccak256(abi.encodePacked(_resolvers))
        )
      )
    );

    address _signer = ECDSA.recover(_digest, _signature);

    if (_signer != _getConfig().notary()) {
      revert InvalidSignature();
    }
  }

  function reclaim(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    address _tokenContract
  ) external whenNotPaused issueNotClosed(_platformId, _repoId, _issueId) {
    uint256 _reclaimWindowStart = reclaimableAt[_platformId][_repoId][_issueId];

    if (block.timestamp <= _reclaimWindowStart) {
      revert TimeframeError(_reclaimWindowStart);
    }

    uint256 _amount = bountyContributions[_platformId][_repoId][_issueId][_tokenContract][msg.sender];

    if (_amount == 0) {
      address[] memory _tokens = new address[](1);
      _tokens[0] = _tokenContract;
      revert NoBounty(_platformId, _repoId, _issueId, _tokens);
    }

    ERC20 token = ERC20(_tokenContract);
    token.transfer(msg.sender, _amount);

    bountyContributions[_platformId][_repoId][_issueId][_tokenContract][msg.sender] = 0;
    bounties[_platformId][_repoId][_issueId][_tokenContract] -= _amount;
    _maybeRemoveBountyToken(_platformId, _repoId, _issueId, _tokenContract);

    emit BountyReclaim(
      _platformId,
      _repoId,
      _issueId,
      msg.sender,
      _tokenContract,
      token.symbol(),
      token.decimals(),
      _amount
    );
  }

  // The signature will ensure that this will always transfer tokens to the maintainer
  // regardless of who sends the transaction because the maintainerAddress is part of the
  // signature

  // no need for a nonce here because the maintainer can only claim once
  function maintainerClaim(
    string calldata _maintainerUserId,
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    string[] calldata _resolverIds,
    bytes calldata _signature
  ) external whenNotPaused issueNotClosed(_platformId, _repoId, _issueId) {
    // lookup maintainer wallet from _maintainerUserId
    address _identityContract = _getConfig().identityContract();
    address _maintainerAddress = IIdentity(_identityContract).ownerOf(_platformId, _maintainerUserId);

    // ensure the maintainer address is linked
    if (_maintainerAddress == address(0)) {
      revert IdentityNotFound(_platformId, _maintainerUserId);
    }

    _validateSignature(
      _maintainerUserId,
      _platformId,
      _repoId,
      _issueId,
      _resolverIds,
      _signature
    );

    // 2. mark the issue as closed
    resolvers[_platformId][_repoId][_issueId] = _resolverIds;

    emit IssueTransition(
      _platformId,
      _repoId,
      _issueId,
      "closed",
      "open",
      _maintainerUserId,
      _maintainerAddress,
      _resolverIds
    );

    // 3. For each token...
    address[] storage _bountyTokens = bountyTokens[_platformId][_repoId][_issueId];

    IClaimValidator _claimValidator = _getClaimValidator();

    for (uint256 index = 0; index < _bountyTokens.length; index++) {
      // 3a. compute the bounty claim amount for the maintainer
      uint256 _amount = maintainerClaimAmount(
        _platformId, _repoId, _issueId, _bountyTokens[index]
      );

      if (!_claimValidator.validate(_identityContract, _platformId, _repoId, _issueId, _maintainerUserId, _bountyTokens[index], _amount)) {
        revert ClaimValidationError(_platformId, _maintainerUserId, _bountyTokens[index], _amount);
      }

      if (_amount > 0) {
        // 3b. transfer tokens to the maintainer
        ERC20(_bountyTokens[index]).transfer(_maintainerAddress, _amount);

        // 3c. remove the amount from the bounty
        bounties[_platformId][_repoId][_issueId][_bountyTokens[index]] -= _amount;

        emit BountyClaim(
          _platformId,
          _repoId,
          _issueId,
          _maintainerUserId,
          _maintainerAddress,
          "maintainer",
          _bountyTokens[index],
          ERC20(_bountyTokens[index]).symbol(),
          ERC20(_bountyTokens[index]).decimals(),
          _amount
        );
      }
    }

    // 4. auto-claim for contributors
    for (uint256 i = 0; i < _resolverIds.length; i++) {
      _contributorClaim(_platformId, _repoId, _issueId, _resolverIds[i], false);
    }
  }

  // returns the total amount of tokens the maintainer will receive for this bounty
  function maintainerClaimAmount(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    address _token
  ) public view returns (uint256) {
    return
      (bounties[_platformId][_repoId][_issueId][_token] * _getConfig().maintainerFee()) / 100;
  }

  function contributorClaim(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId
  ) external whenNotPaused unclaimedResolverOnly(_platformId, _repoId, _issueId) {
    IIdentity _identity = _getIdentity();

    for (
      uint256 i = 0; i < _identity.balanceOf(msg.sender); i++
    ) {
      // lookup the platformUserId for the resolver
      uint256 _tokenId = _identity.tokenOfOwnerByIndex(msg.sender, i);
      PlatformUser memory _platformUser = _identity.platformUser(_tokenId);

      if (!_eq(_platformUser.platformId, _platformId)) {
        continue;
      }

      _contributorClaim(_platformId, _repoId, _issueId, _platformUser.userId, true);
    }
  }

  function _contributorClaim(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    string memory _resolverUserId,
    bool _revertOnNoClaim
  ) private {
    // lookup the wallet for the resolverId
    // if the user hasn't linked yet this will be the zero address which can never claim
    address _identityContract = _getConfig().identityContract();
    address _resolver = IIdentity(_identityContract).ownerOf(_platformId, _resolverUserId);

    if (_resolver == address(0)) {
      // cannot claim since the resolver has not minted yet
      return;
    }

    address[] storage _bountyTokens = bountyTokens[_platformId][_repoId][_issueId];

    IClaimValidator _claimValidator = _getClaimValidator();

    // track how many types of tokens were claimed by this contributor 
    uint16 _numClaimed = 0;

    for (uint256 i = 0; i < _bountyTokens.length; i++) {
      address _tokenContract = _bountyTokens[i];
      uint8 _remainingClaims = _claimsRemaining(
        bounties[_platformId][_repoId][_issueId],
        claimed[_platformId][_repoId][_issueId],
        resolvers[_platformId][_repoId][_issueId],
        _tokenContract
      );

      if (_remainingClaims == 0) {
        continue;
      }

      uint256 _amount = bounties[_platformId][_repoId][_issueId][_tokenContract];

      uint256 _resolverAmount = _amount / _remainingClaims;

      if (
        _claimValidator.validate(_identityContract, _platformId, _repoId, _issueId, _resolverUserId, _tokenContract, _resolverAmount) 
          && _resolverAmount > 0
      ) {
        // transfer tokens from this contract to the resolver
        ERC20(_tokenContract).transfer(_resolver, _resolverAmount);

        // mark the bounty as claimed for this resolver
        claimed[_platformId][_repoId][_issueId][_tokenContract][_resolverUserId] = true;

        // reduce the bounty by the amount claimed for this user
        bounties[_platformId][_repoId][_issueId][_tokenContract] -= _resolverAmount;

        emit BountyClaim(
          _platformId,
          _repoId,
          _issueId,
          _resolverUserId,
          _resolver,
          "contributor",
          _tokenContract,
          ERC20(_tokenContract).symbol(),
          ERC20(_tokenContract).decimals(),
          _resolverAmount
        );

        _numClaimed++;
      }

      if (i == _bountyTokens.length - 1 && _numClaimed == 0 && _revertOnNoClaim) {
        // this is the last iteration of the loop and no tokens were claimed so revert
        revert ClaimValidationError(_platformId, _resolverUserId, _tokenContract, _resolverAmount);
      }
    }
  }

  function withdrawFees(address _tokenContract) external onlyRole(FINANCE_ROLE) {
    ERC20 _token = ERC20(_tokenContract);
    uint256 _amount = fees[_tokenContract];
    fees[_tokenContract] -= _amount;
    _withdraw(_token, _amount, msg.sender, "fee");
  }

  function withdrawUnsupportedToken(address _tokenContract) external onlyRole(FINANCE_ROLE) {
    if (_getConfig().isSupportedToken(_tokenContract)) {
      revert TokenSupportError(_tokenContract, true);
    }

    ERC20 _token = ERC20(_tokenContract);
    uint256 _amount = _token.balanceOf(address(this));
    _withdraw(_token, _amount, msg.sender, "unsupported");
  }

  function _withdraw(ERC20 _token, uint256 _amount, address _recipient, string memory _kind) private {
    address _tokenContract = address(_token);

    if (_amount == 0) {
      revert NoAmount(_tokenContract);
    }

    _token.transfer(_recipient, _amount);

    emit Withdraw(
      _tokenContract,
      _token.symbol(),
      _token.decimals(),
      _recipient,
      _amount,
      _kind
    );
  }

  // this takes a list of tokens to sweep to allow for granular sweeps
  // as well as sweeping after a token is no longer supported
  function sweepBounty(
    string calldata _platformId,
    string calldata _repoId,
    string calldata _issueId,
    address[] calldata _tokens
  ) external onlyRole(FINANCE_ROLE) whenNotPaused {
    uint256 _reclaimWindowEnd =
      reclaimableAt[_platformId][_repoId][_issueId] + RECLAIM_DAYS;

    if (block.timestamp <= _reclaimWindowEnd) {
      revert TimeframeError(_reclaimWindowEnd);
    }

    bool swept = false;
    for (uint256 index = 0; index < _tokens.length; index++) {
      address _token = _tokens[index];
      // get the amount of supported tokens in this bounty
      uint256 amount = bounties[_platformId][_repoId][_issueId][_token];

      if (amount > 0) {
        // transfer tokens to the message sender (finance)
        ERC20(_token).transfer(msg.sender, amount);

        // remove the amount from the bounty
        bounties[_platformId][_repoId][_issueId][_token] -= amount;

        emit BountySweep(
          msg.sender,
          _platformId,
          _repoId,
          _issueId,
          _token,
          ERC20(_token).symbol(),
          ERC20(_token).decimals(),
          amount
        );

        swept = true;

        // remove from bountyTokens
        address[] storage _bountyTokens =
          bountyTokens[_platformId][_repoId][_issueId];

        for (uint256 i = 0; i < _bountyTokens.length; i++) {
          if (_bountyTokens[i] == _token) {
            _bountyTokens[i] = _bountyTokens[_bountyTokens.length - 1];
            _bountyTokens.pop();
          }
        }
      }
    }

    if (!swept) {
      revert NoBounty(_platformId, _repoId, _issueId, _tokens);
    }
  }

  function pause() external onlyRole(CUSTODIAN_ROLE) {
    _pause();
  }

  function unpause() external onlyRole(CUSTODIAN_ROLE) {
    _unpause();
  }

  // library functions

  function _eq(string memory a, string memory b) private pure returns (bool) {
    return keccak256(bytes(a)) == keccak256(bytes(b));
  }

  function _isUnclaimedResolver(
    address[] storage _supportedTokens,
    string memory _platformId,
    mapping(address => mapping(string => bool)) storage _claimed,
    mapping(address => uint256) storage _bounties,
    string[] storage _resolvers
  ) private view returns (bool, bool) {
    bool _hasUnclaimed = false;
    bool _isResolver = false;

    IIdentity _identity = _getIdentity();

    // need to check all of their identities
    for (
      uint256 i = 0; i < _identity.balanceOf(msg.sender); i++
    ) {
      // lookup the platformUserId for the resolver
      uint256 _tokenId = _identity.tokenOfOwnerByIndex(msg.sender, i);
      PlatformUser memory platformUser = _identity.platformUser(_tokenId);

      // skip this platformUser if it's not for this platform
      if (!_eq(platformUser.platformId, _platformId)) {
        continue;
      }

      // make sure they have an unclaimed bounty
      for (uint256 j = 0; j < _supportedTokens.length; j++) {
        if (
          !_claimed[_supportedTokens[j]][platformUser.userId]
            && _bounties[_supportedTokens[j]] > 0
        ) {
          _hasUnclaimed = true;
          break;
        }
      }

      // make sure they are a resolver
      for (uint256 k = 0; k < _resolvers.length; k++) {
        string memory _resolverUserId = _resolvers[k];

        if (_eq(_resolverUserId, platformUser.userId)) {
          _isResolver = true;
          break;
        }
      }

      if (_isResolver && _hasUnclaimed) {
        break;
      }
    }

    return (_isResolver, _hasUnclaimed);
  }

  function _claimsRemaining(
    mapping(address => uint256) storage _bounties,
    mapping(address => mapping(string => bool)) storage _claimed,
    string[] storage _resolvers,
    address _tokenContract
  ) private view returns (uint8) {
    uint256 _amount = _bounties[_tokenContract];

    if (_amount < 1) {
      return 0;
    }

    uint8 _remaining = 0;

    for (uint256 k = 0; k < _resolvers.length; k++) {
      string memory _resolverUserId = _resolvers[k];

      if (_claimed[_tokenContract][_resolverUserId] == false) {
        _remaining++;
      }
    }

    return _remaining;
  }

  function _getConfig() private view returns (IBountiesConfig) {
    return IBountiesConfig(configContract);
  }

  function _getIdentity() private view returns (IIdentity) { 
    return IIdentity(_getConfig().identityContract());
  }

  function _getClaimValidator() private view returns (IClaimValidator) {
    return IClaimValidator(_getConfig().claimValidatorContract());
  }
}
