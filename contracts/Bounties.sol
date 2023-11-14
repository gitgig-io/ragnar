// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IIdentity, PlatformUser} from "./IIdentity.sol";

contract Bounties is Pausable, AccessControlDefaultAdminRules {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

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
    event TokenSupportChange(
        bool supported,
        address token,
        string symbol,
        uint8 decimals
    );

    // TODO: include the wallet that changed?
    event ConfigChange(
        address notary,
        address identityContract,
        uint8 serviceFee,
        uint8 maintainerFee
    );

    // roles
    bytes32 public constant CUSTODIAN_ADMIN_ROLE =
        keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant FINANCE_ADMIN_ROLE =
        keccak256("FINANCE_ADMIN_ROLE");
    bytes32 public constant FINANCE_ROLE = keccak256("FINANCE_ROLE");

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

    constructor(
        address _custodian,
        address _finance,
        address _notary,
        address _identityContract,
        address[] memory _supportedTokens
    ) Pausable() AccessControlDefaultAdminRules(3 days, msg.sender) {
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
        _grantRole(FINANCE_ADMIN_ROLE, _finance);
        _grantRole(FINANCE_ROLE, _finance);
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        _setRoleAdmin(FINANCE_ROLE, FINANCE_ADMIN_ROLE);
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
        require(isSupportedToken[tokenContract], "Unsupported token");
        _;
    }

    modifier issueNotClosed(
        string memory _platform,
        string memory _repoId,
        string memory _issueId
    ) {
        require(
            resolvers[_platform][_repoId][_issueId].length < 1,
            "Issue is already closed"
        );
        _;
    }

    modifier unclaimedResolverOnly(
        string memory _platformId,
        string memory _repoId,
        string memory _issueId
    ) {
        uint256 _identitiesLength = IIdentity(identityContract).balanceOf(msg.sender);

        bool _hasUnclaimed = false;
        bool _isResolver = false;

        // need to check all of their identities
        for (uint256 i = 0; i < _identitiesLength; i++) {
            // lookup the platformUserId for the resolver
            uint256 _tokenId = IIdentity(identityContract).tokenOfOwnerByIndex(msg.sender, i);
            PlatformUser memory platformUser = IIdentity(identityContract).platformUser(_tokenId);

            // skip this platformUser if it's not for this platform
            if (!eq(platformUser.platformId, _platformId)) {
                continue;
            }

            // make sure they have an unclaimed bounty
            for (uint256 j = 0; j < supportedTokens.length; j++) {
                if (!claimed[_platformId][_repoId][_issueId][supportedTokens[j]][platformUser.userId] && 
                   bounties[_platformId][_repoId][_issueId][supportedTokens[j]] > 0) {
                    _hasUnclaimed = true;
                    break;
                }
            }

            // make sure they are a resolver
            for (
                uint256 k = 0;
                k < resolvers[_platformId][_repoId][_issueId].length;
                k++
            ) {
                string memory _resolverUserId = resolvers[_platformId][_repoId][
                    _issueId
                ][k];

                if (eq(_resolverUserId, platformUser.userId)) {
                    _isResolver = true;
                    break;
                }
            }

            if (_isResolver && _hasUnclaimed) {
                break;
            }
        }

        // ensure they are actually a resolver for this issue
        require(_isResolver, "You are not a resolver");

        // ensure they have not claimed yet
        require(_hasUnclaimed, "You have already claimed bounty");

        _;
    }

    function eq(string memory a, string memory b) private pure returns (bool) {
      return keccak256(bytes(a)) == keccak256(bytes(b));
    }

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
        uint256 _fee = (_amount * serviceFee) / 100;
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

    // The signature will ensure that this will always transfer tokens to the maintainer
    // regardless of who sends the transaction because the maintainerAddress is part of the
    // signature
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
        require(
            _maintainerAddress != address(0),
            "Maintainer identity not established"
        );

        // scope to reduce local variables
        {
            // TODO: add a modifier to ensure the given issue actually has a bounty??
            // 1. verify the signature
            bytes memory _data = abi.encode(
                _maintainerUserId,
                _platformId,
                _repoId,
                _issueId,
                _resolverIds
            );
            bytes32 _messageHash = keccak256(_data);
            // console.log("_messageHash: ", toHex(_messageHash));
            bytes32 _ethMessageHash = _messageHash.toEthSignedMessageHash();
            // console.log("_ethMessageHash: ", toHex(_ethMessageHash));

            require(
                SignatureChecker.isValidSignatureNow(
                    notary,
                    _ethMessageHash,
                    _signature
                ),
                "Invalid signature"
            );

            // 2. mark the issue as closed
            resolvers[_platformId][_repoId][_issueId] = _resolverIds;
        }

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

            if (!eq(platformUser.platformId, _platformId)) {
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
            uint8 _remainingClaims = _claimsRemaining(_platformId, _repoId, _issueId, _tokenContract);

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

    function _claimsRemaining(string memory _platformId, string memory _repoId, string memory _issueId, address _tokenContract) internal view returns (uint8) {
        uint256 _amount = bounties[_platformId][_repoId][_issueId][
            _tokenContract
        ];

        if (_amount < 1) {
          return 0;
        }

        uint8 _remaining = 0;

        for (
            uint256 k = 0;
            k < resolvers[_platformId][_repoId][_issueId].length;
            k++
        ) {
            string memory _resolverUserId = resolvers[_platformId][_repoId][
                _issueId
            ][k];

            if (
                claimed[_platformId][_repoId][_issueId][_tokenContract][
                    _resolverUserId
                ] == false
            ) {
                _remaining++;
            }
        }

        return _remaining;
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
        require(swept, "No bounty to sweep");
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
        require(_newNotary != address(0), "Cannot update to zero address");
        notary = _newNotary;
        emitConfigChange();
    }

    function setIdentity(address _newIdentity) public onlyRole(CUSTODIAN_ROLE) {
        require(_newIdentity != address(0), "Cannot update to zero address");
        identityContract = _newIdentity;
        emitConfigChange();
    }

    function setServiceFee(uint8 _newServiceFee)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        require(_newServiceFee >= 0 && _newServiceFee <= 100, "Invalid fee");
        serviceFee = _newServiceFee;
        emitConfigChange();
    }

    function setMaintainerFee(uint8 _newMaintainerFee)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        require(
            _newMaintainerFee >= 0 && _newMaintainerFee <= 100,
            "Invalid fee"
        );
        maintainerFee = _newMaintainerFee;
        emitConfigChange();
    }

    function addToken(address _newToken) public onlyRole(CUSTODIAN_ROLE) {
        require(!isSupportedToken[_newToken], "Token already supported");

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
        require(isSupportedToken[_removeToken], "Token not supported");

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
