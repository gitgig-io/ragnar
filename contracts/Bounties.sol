// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IIdentity, PlatformUser} from "./IIdentity.sol";
import {LibBounties} from "./LibBounties.sol";

contract Bounties is EIP712, Pausable, AccessControlDefaultAdminRules {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct CustomFee {
      uint8 fee;
      bool enabled;
    }

    // TODO: which fields should be indexed?
    event BountyCreate(
        string platform,
        string repo,
        string issue,
        address issuer,
        address token,
        string symbol,
        uint8 decimals,
        uint256 amount,
        uint256 fee
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
        address claimer,
        string role,
        address token,
        string symbol,
        uint8 decimals,
        uint256 amount
    );

    event FeeWithdraw(
        address token,
        string symbol,
        uint8 decimals,
        address recipient,
        uint256 amount
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

    // TODO: include the wallet that changed?
    event TokenSupportChange(bool supported, address token, string symbol, uint8 decimals);

    // TODO: include the wallet that changed?
    event ConfigChange(
        address notary,
        address identityContract,
        uint8 serviceFee,
        uint8 maintainerFee
    );

    event CustomFeeChange(address wallet, string feeType, uint8 fee, bool enabled);

    error AlreadyClaimed(string platformId, string repoId, string issueId, address claimer);
    error IdentityNotFound(string platformId, string platformUserId);
    error InvalidResolver(string platformId, string repoId, string issueId, address claimer);
    error InvalidSignature();
    error IssueClosed(string platformId, string repoId, string issueId);
    error TokenSupportError(address token, bool supported);
    error NoBounty(string platformId, string repoId, string issueId, address[] tokens);

    // roles
    bytes32 public constant CUSTODIAN_ADMIN_ROLE =
        keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant FINANCE_ADMIN_ROLE =
        keccak256("FINANCE_ADMIN_ROLE");
    bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");
    // TODO: do we need an admin for this? should it be custodian?
    bytes32 public constant TRUSTED_CONTRACT_ADMIN_ROLE = keccak256("TRUSTED_CONTRACT_ADMIN_ROLE");
    bytes32 public constant TRUSTED_CONTRACT_ROLE = keccak256("TRUSTED_CONTRACT_ROLE");

    bytes32 private constant TYPE_HASH = keccak256("MaintainerClaim(string maintainerUserId,string platformId,string repoId,string issueId,string[] resolverIds)");

    // for verifying signatures
    address public notary;

    // the identity contract
    address public identityContract;

    // the percentage that the platform charges
    uint8 public serviceFee = 20;

    // the percentage that is the maintainer share of a bounty
    uint8 public maintainerFee = 10;

    // store the service fees that have accumulated
    mapping(address => uint256) public fees;

    address[] public supportedTokens;

    mapping(address => bool) public isSupportedToken;

    // store registered and closed issues. 0 resolvers means registered, 1+ resolvers means closed
    mapping(string => mapping(string => mapping(string => string[])))
        public resolvers;

    // store bounties by platform, repo, issue and token
    mapping(string => mapping(string => mapping(string => mapping(address => uint256))))
        public bounties;

    mapping(string platformId => mapping(string repoId => mapping(string issueId => mapping(address tokenContract => mapping(string platformUserId => bool)))))
        public claimed;

    mapping(address => CustomFee) public customServiceFees;

    constructor(
        address _custodian,
        address _finance,
        address _notary,
        address _identityContract,
        address[] memory _supportedTokens
    ) 
        Pausable() 
        AccessControlDefaultAdminRules(3 days, msg.sender) 
        EIP712("GitGigBounties", "1")
    {
        _grantRole(TRUSTED_CONTRACT_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
        _grantRole(FINANCE_ADMIN_ROLE, _finance);
        _grantRole(FINANCE_ROLE, _finance);
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        _setRoleAdmin(FINANCE_ROLE, FINANCE_ADMIN_ROLE);
        _setRoleAdmin(TRUSTED_CONTRACT_ROLE, TRUSTED_CONTRACT_ADMIN_ROLE);
        notary = _notary;
        identityContract = _identityContract;
        supportedTokens = _supportedTokens;
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

    modifier supportedToken(address tokenContract) {
        if (!isSupportedToken[tokenContract]) {
            revert TokenSupportError(tokenContract, false);
        }

        _;
    }

    modifier issueNotClosed(
        string memory _platform,
        string memory _repoId,
        string memory _issueId
    ) {
        if (resolvers[_platform][_repoId][_issueId].length > 0) {
          revert IssueClosed(_platform, _repoId, _issueId);
        }

        _;
    }

    modifier unclaimedResolverOnly(
        string memory _platformId,
        string memory _repoId,
        string memory _issueId
    ) {
        (bool _isResolver, bool _hasUnclaimed) = LibBounties.isUnclaimedResolver(
          identityContract,
          supportedTokens,
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

    function effectiveServiceFee(address _wallet) public view returns (uint8) {
      CustomFee memory _customFee = customServiceFees[_wallet]; 
      if (_customFee.enabled) {
        return _customFee.fee;
      }

      return serviceFee;
    }

    // TODO: store a list of supported token contracts for each bounty to ensure we
    // don't need to loop over all tokens for each bounty claim, only those tokens
    // actually on the bounty.

    // TODO: allow for withdrawing arbitrary tokens from the contract to deal with
    // airdropped tokens.
    function postBounty(
        string memory _platform,
        string memory _repoId,
        string memory _issueId,
        address _tokenContract,
        uint256 _amount
    )
        public
        whenNotPaused
        issueNotClosed(_platform, _repoId, _issueId)
        supportedToken(_tokenContract)
    {
        // capture fee
        uint256 _fee = (_amount * effectiveServiceFee(msg.sender)) / 100;
        fees[_tokenContract] += _fee;

        // record the number of tokens in the contract allocated to this issue
        uint256 _bountyAmount = _amount - _fee;
        bounties[_platform][_repoId][_issueId][_tokenContract] += _bountyAmount;

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
            _fee
        );
        // TOOD: what if the issue was already closed be we aren't tracking it??? FE could check...
    }

    function _validateSignature(
        string memory _maintainerUserId,
        string memory _platformId,
        string memory _repoId,
        string memory _issueId,
        string[] memory _resolverIds,
        bytes memory _signature
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

        if (_signer != notary) {
            revert InvalidSignature();
        }
    }

    // The signature will ensure that this will always transfer tokens to the maintainer
    // regardless of who sends the transaction because the maintainerAddress is part of the
    // signature

    // no need for a nonce here because the maintainer can only claim once
    function maintainerClaim(
        string memory _maintainerUserId,
        string memory _platformId,
        string memory _repoId,
        string memory _issueId,
        string[] memory _resolverIds,
        bytes memory _signature
    ) public whenNotPaused issueNotClosed(_platformId, _repoId, _issueId) {
        // lookup maintainer wallet from _maintainerUserId
        address _maintainerAddress = IIdentity(identityContract).ownerOf(
            _platformId,
            _maintainerUserId
        );

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
        for (uint256 index = 0; index < supportedTokens.length; index++) {
            // 3a. compute the bounty claim amount for the maintainer
            uint256 amount = maintainerClaimAmount(
                _platformId,
                _repoId,
                _issueId,
                supportedTokens[index]
            );

            if (amount > 0) {
                // 3b. transfer tokens to the maintainer
                ERC20(supportedTokens[index]).transfer(
                    _maintainerAddress,
                    amount
                );

                // 3c. remove the amount from the bounty
                bounties[_platformId][_repoId][_issueId][
                    supportedTokens[index]
                ] -= amount;

                emit BountyClaim(
                    _platformId,
                    _repoId,
                    _issueId,
                    _maintainerAddress,
                    "maintainer",
                    supportedTokens[index],
                    ERC20(supportedTokens[index]).symbol(),
                    ERC20(supportedTokens[index]).decimals(),
                    amount
                );
            }
        }

        // TODO: should this be configurable?
        // 4. auto-claim for contributors
        for (uint256 i = 0; i < _resolverIds.length; i++) {
            _contributorClaim(
                _platformId,
                _repoId,
                _issueId,
                _resolverIds[i]
            );
        }
    }

    // returns the total amount of tokens the maintainer will receive for this bounty
    function maintainerClaimAmount(
        string memory _platformId,
        string memory _repoId,
        string memory _issueId,
        address _token
    ) public view returns (uint256) {
        return
            (bounties[_platformId][_repoId][_issueId][_token] * maintainerFee) /
            100;
    }

    function contributorClaim(
        string memory _platformId,
        string memory _repoId,
        string memory _issueId
    )
        public
        whenNotPaused
        unclaimedResolverOnly(_platformId, _repoId, _issueId)
    {
        for (uint256 i = 0; i < IIdentity(identityContract).balanceOf(msg.sender); i++) {
            // lookup the platformUserId for the resolver
            PlatformUser memory platformUser;

            uint256 _tokenId = IIdentity(identityContract).tokenOfOwnerByIndex(msg.sender, i);
            platformUser = IIdentity(identityContract).platformUser(_tokenId);

            if (!LibBounties.eq(platformUser.platformId, _platformId)) {
                continue;
            }

            _contributorClaim(_platformId, _repoId, _issueId, platformUser.userId);
        }
    }

    function _contributorClaim(
        string memory _platformId,
        string memory _repoId,
        string memory _issueId,
        string memory _resolverUserId
    ) private {
        // lookup the wallet for the resolverId
        // if the user hasn't linked yet this will be the zero address which can never claim
        address _resolver = IIdentity(identityContract).ownerOf(
            _platformId,
            _resolverUserId
        );

        if (_resolver == address(0)) {
            // cannot claim since the resolver has not minted yet
            return;
        }

        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address _tokenContract = supportedTokens[i];
            uint8 _remainingClaims = LibBounties.claimsRemaining(
              bounties[_platformId][_repoId][_issueId],
              claimed[_platformId][_repoId][_issueId],
              resolvers[_platformId][_repoId][_issueId],
              _tokenContract
            );

            if (_remainingClaims == 0) {
                continue;
            }

            uint256 _amount = bounties[_platformId][_repoId][_issueId][
                _tokenContract
            ];

            uint256 _resolverAmount = _amount / _remainingClaims;

            if (_resolverAmount > 0) {
                // transfer tokens from this contract to the resolver
                ERC20(_tokenContract).transfer(_resolver, _resolverAmount);

                // mark the bounty as claimed for this resolver
                claimed[_platformId][_repoId][_issueId][_tokenContract][
                    _resolverUserId
                ] = true;

                // reduce the bounty by the amount claimed for this user
                bounties[_platformId][_repoId][_issueId][
                    _tokenContract
                ] -= _resolverAmount;

                emit BountyClaim(
                    _platformId,
                    _repoId,
                    _issueId,
                    _resolver,
                    "contributor",
                    _tokenContract,
                    ERC20(_tokenContract).symbol(),
                    ERC20(_tokenContract).decimals(),
                    _resolverAmount
                );
            }
        }
    }

    function withdrawFees() public onlyRole(FINANCE_ROLE) {
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address _recipient = msg.sender;
            uint256 _amount = fees[supportedTokens[i]];

            if (_amount > 0) {
                ERC20(supportedTokens[i]).transfer(_recipient, _amount);
                fees[supportedTokens[i]] -= _amount;

                emit FeeWithdraw(
                    supportedTokens[i],
                    ERC20(supportedTokens[i]).symbol(),
                    ERC20(supportedTokens[i]).decimals(),
                    _recipient,
                    _amount
                );
            }
        }
    }

    // this takes a list of tokens to sweep to allow for granular sweeps
    // as well as sweeping after a token is no longer supported
    function sweepBounty(
        string memory _platformId,
        string memory _repoId,
        string memory _issueId,
        address[] memory _tokens
    ) public onlyRole(FINANCE_ROLE) {
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
            }
        }

        if (!swept) {
            revert NoBounty(_platformId, _repoId, _issueId, _tokens);
        }
    }

    function isIssueClosed(
        string memory _platform,
        string memory _repoId,
        string memory _issueId
    ) public view returns (bool) {
        return resolvers[_platform][_repoId][_issueId].length > 0;
    }

    function emitConfigChange() internal {
        emit ConfigChange(notary, identityContract, serviceFee, maintainerFee);
    }

    function setNotary(address _newNotary) public onlyRole(CUSTODIAN_ROLE) {
        LibBounties.validateAddress(_newNotary);
        notary = _newNotary;
        emitConfigChange();
    }

    function setIdentity(address _newIdentity) public onlyRole(CUSTODIAN_ROLE) {
        LibBounties.validateAddress(_newIdentity);
        identityContract = _newIdentity;
        emitConfigChange();
    }

    function setServiceFee(uint8 _newServiceFee)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        LibBounties.validateFee(_newServiceFee);
        serviceFee = _newServiceFee;
        emitConfigChange();
    }

    function setCustomServiceFee(address _wallet, uint8 _newServiceFee)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        LibBounties.validateFee(_newServiceFee);
        if (_newServiceFee == serviceFee) {
          delete customServiceFees[_wallet];
          emit CustomFeeChange(_wallet, "service", _newServiceFee, false);
        } else {
          customServiceFees[_wallet] = CustomFee(_newServiceFee, true);
          emit CustomFeeChange(_wallet, "service", _newServiceFee, true);
        }
    }

    function setMaintainerFee(uint8 _newMaintainerFee)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        LibBounties.validateFee(_newMaintainerFee);
        maintainerFee = _newMaintainerFee;
        emitConfigChange();
    }

    function addToken(address _newToken) public onlyRole(CUSTODIAN_ROLE) {
      _doAddToken(_newToken);
    }

    function addTokenTC(address _newToken) public onlyRole(TRUSTED_CONTRACT_ROLE) {
      _doAddToken(_newToken);
    }

    function _doAddToken(address _newToken) private {
        if (isSupportedToken[_newToken]) {
            revert TokenSupportError(_newToken, true);
        }

        supportedTokens.push(_newToken);
        isSupportedToken[_newToken] = true;

        emit TokenSupportChange(
            true,
            _newToken,
            ERC20(_newToken).symbol(),
            ERC20(_newToken).decimals()
        );
    }

    function removeToken(address _removeToken) public onlyRole(CUSTODIAN_ROLE) {
      _doRemoveToken(_removeToken);
    }

    function removeTokenTC(address _removeToken) public onlyRole(TRUSTED_CONTRACT_ROLE) {
      _doRemoveToken(_removeToken);
    }

    function _doRemoveToken(address _removeToken) private {
        if (!isSupportedToken[_removeToken]) {
            revert TokenSupportError(_removeToken, false);
        }

        for (uint256 i = 0; i < supportedTokens.length; i++) {
            if (supportedTokens[i] == _removeToken) {
                delete supportedTokens[i];
            }
        }

        isSupportedToken[_removeToken] = false;

        emit TokenSupportChange(
            false,
            _removeToken,
            ERC20(_removeToken).symbol(),
            ERC20(_removeToken).decimals()
        );
    }

    function pause() public onlyRole(CUSTODIAN_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(CUSTODIAN_ROLE) {
        _unpause();
    }
}
