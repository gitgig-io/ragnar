// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./IIdentity.sol";

// TODO: remove these
// import "@openzeppelin/contracts/utils/Strings.sol";
// import "hardhat/console.sol";

contract Bounties is Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // TODO: which fields should be indexed?
    event BountyCreate(
        string platform,
        string repo,
        // TODO: should this be a string?
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

    event TokenSupportChange(
        bool supported,
        address token,
        string symbol,
        uint8 decimals
    );

    event ConfigChange(
        address owner,
        address notary,
        address finance,
        address identityContract,
        uint8 serviceFee,
        uint8 maintainerFee
    );

    // for updating the contract configuration
    address public owner;

    // for verifying signatures
    address public notary;

    // for withdrawing fees
    address public finance;

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

    mapping(string => mapping(string => mapping(string => mapping(address => mapping(address => bool)))))
        public claimed;

    constructor(
        address _finance,
        address _notary,
        address _identityContract,
        address[] memory _supportedTokens
    ) Pausable() {
        owner = msg.sender;
        notary = _notary;
        identityContract = _identityContract;
        finance = _finance;
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

        emit ConfigChange(
            owner,
            notary,
            finance,
            identityContract,
            serviceFee,
            maintainerFee
        );
    }

    modifier ownerOnly() {
        require(msg.sender == owner, "You are not the owner");
        _;
    }

    modifier financeOnly() {
        require(finance == msg.sender, "You are not the finance team");
        _;
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
        // first ensure they have not claimed yet
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            require(
                claimed[_platformId][_repoId][_issueId][supportedTokens[i]][
                    msg.sender
                ] == false,
                "You have already claimed bounty"
            );
        }

        // next ensure they are actually a resolver for this issue
        bool isResolver = false;

        for (
            uint256 i = 0;
            i < resolvers[_platformId][_repoId][_issueId].length;
            i++
        ) {
            string memory _resolverUserId = resolvers[_platformId][_repoId][
                _issueId
            ][i];

            address addr = IIdentity(identityContract).walletForPlatformUser(
                _platformId,
                _resolverUserId
            );

            if (msg.sender == addr) {
                isResolver = true;
                break;
            }
        }

        require(isResolver, "You are not a resolver");
        _;
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
        IERC20(_tokenContract).transferFrom(msg.sender, address(this), _amount);

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
        // TODO: where is this maintainer address coming from??
        // instead: pass in maintainer's github id, then lookup wallet from identity contract
        string memory _maintainerUserId,
        string memory _platformId,
        string memory _repoId,
        string memory _issueId,
        string[] memory _resolverIds,
        bytes memory _signature
    ) public whenNotPaused issueNotClosed(_platformId, _repoId, _issueId) {
        // lookup maintainer wallet from _maintainerUserId
        address _maintainerAddress = IIdentity(identityContract)
            .walletForPlatformUser(_platformId, _maintainerUserId);

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
                IERC20(supportedTokens[index]).transfer(
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
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            uint8 _claimsRemaining = 0;
            address _tokenContract = supportedTokens[i];
            uint256 _amount = bounties[_platformId][_repoId][_issueId][
                _tokenContract
            ];

            for (
                uint256 j = 0;
                j < resolvers[_platformId][_repoId][_issueId].length;
                j++
            ) {
                string memory _resolverUserId = resolvers[_platformId][_repoId][
                    _issueId
                ][j];
                // if the user hasn't linked yet this will be the zero address which can never claim
                address _resolver = IIdentity(identityContract)
                    .walletForPlatformUser(_platformId, _resolverUserId);
                if (
                    claimed[_platformId][_repoId][_issueId][_tokenContract][
                        _resolver
                    ] == false
                ) {
                    _claimsRemaining++;
                }
            }

            uint256 _resolverAmount = _amount / _claimsRemaining;

            if (_resolverAmount > 0) {
                // transfer tokens from this contract to the caller
                IERC20(_tokenContract).transfer(msg.sender, _resolverAmount);

                // mark the bounty as claimed for this resolver
                claimed[_platformId][_repoId][_issueId][_tokenContract][
                    msg.sender
                ] = true;

                // reduce the bounty by the amount claimed for this user
                bounties[_platformId][_repoId][_issueId][
                    _tokenContract
                ] -= _resolverAmount;

                emit BountyClaim(
                    _platformId,
                    _repoId,
                    _issueId,
                    msg.sender,
                    "contributor",
                    _tokenContract,
                    ERC20(_tokenContract).symbol(),
                    ERC20(_tokenContract).decimals(),
                    _resolverAmount
                );
            }
        }
    }

    function withdrawFees() public financeOnly {
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            address _recipient = msg.sender;
            uint256 _amount = fees[supportedTokens[i]];

            if (_amount > 0) {
                IERC20(supportedTokens[i]).transfer(_recipient, _amount);
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
    ) public financeOnly {
        bool swept = false;
        for (uint256 index = 0; index < _tokens.length; index++) {
            address _token = _tokens[index];
            // get the amount of supported tokens in this bounty
            uint256 amount = bounties[_platformId][_repoId][_issueId][_token];

            if (amount > 0) {
                // transfer tokens to the message sender (finance)
                IERC20(_token).transfer(msg.sender, amount);

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
        emit ConfigChange(
            owner,
            notary,
            finance,
            identityContract,
            serviceFee,
            maintainerFee
        );
    }

    function ownerTransferOwnership(address _newOwner) public ownerOnly {
        require(_newOwner != address(0), "Cannot transfer to zero address");
        owner = _newOwner;
        emitConfigChange();
    }

    function ownerUpdateNotary(address _newNotary) public ownerOnly {
        require(_newNotary != address(0), "Cannot update to zero address");
        notary = _newNotary;
        emitConfigChange();
    }

    function ownerUpdateFinance(address _newFinance) public ownerOnly {
        require(_newFinance != address(0), "Cannot update to zero address");
        finance = _newFinance;
        emitConfigChange();
    }

    function ownerUpdateIdentity(address _newIdentity) public ownerOnly {
        require(_newIdentity != address(0), "Cannot update to zero address");
        identityContract = _newIdentity;
        emitConfigChange();
    }

    function ownerUpdateServiceFee(uint8 _newServiceFee) public ownerOnly {
        require(_newServiceFee >= 0 && _newServiceFee <= 100, "Invalid fee");
        serviceFee = _newServiceFee;
        emitConfigChange();
    }

    function ownerUpdateMaintainerFee(uint8 _newMaintainerFee)
        public
        ownerOnly
    {
        require(
            _newMaintainerFee >= 0 && _newMaintainerFee <= 100,
            "Invalid fee"
        );
        maintainerFee = _newMaintainerFee;
        emitConfigChange();
    }

    function ownerAddSupportedToken(address _newToken) public ownerOnly {
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

    function ownerRemoveSupportedToken(address _removeToken) public ownerOnly {
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

    function pause() public ownerOnly {
        _pause();
    }

    function unpause() public ownerOnly {
        _unpause();
    }
}
