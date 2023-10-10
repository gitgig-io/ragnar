// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./IIdentity.sol";

// TODO: remove these
// import "@openzeppelin/contracts/utils/Strings.sol";
// import "hardhat/console.sol";

contract Bounties {
    // TODO: which fields should be indexed?
    event BountyCreated(
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
        address maintainerAddress
    );

    event BountyClaimed(
        string platform,
        string repo,
        string issue,
        address maintainer,
        address token,
        string symbol,
        uint8 decimals,
        uint256 amount
    );

    event FeesWithdrawn(
        address token,
        string symbol,
        uint8 decimals,
        address recipient,
        uint256 amount
    );

    // TODO: make this changeable by the owner
    // for verifying signatures
    address public signer;

    // TODO: make this changeable by the owner
    address public finance;

    // TODO: make this changeable by the owner
    address public identityContract;

    // TODO: make this changeable by the owner
    uint8 public serviceFee = 20;

    // TODO: make this changeable by the owner
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
        address _signer,
        address _identityContract,
        address[] memory _supportedTokens
    ) {
        signer = _signer;
        identityContract = _identityContract;
        finance = _finance;
        supportedTokens = _supportedTokens;
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            isSupportedToken[_supportedTokens[i]] = true;
        }
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

        emit BountyCreated(
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
    ) public issueNotClosed(_platformId, _repoId, _issueId) {
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
            bytes32 _ethMessageHash = ECDSA.toEthSignedMessageHash(
                _messageHash
            );
            // console.log("_ethMessageHash: ", toHex(_ethMessageHash));

            require(
                SignatureChecker.isValidSignatureNow(
                    signer,
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
            _maintainerAddress
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

                emit BountyClaimed(
                    _platformId,
                    _repoId,
                    _issueId,
                    _maintainerAddress,
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
    ) public unclaimedResolverOnly(_platformId, _repoId, _issueId) {
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

                emit BountyClaimed(
                    _platformId,
                    _repoId,
                    _issueId,
                    msg.sender,
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

                emit FeesWithdrawn(
                    supportedTokens[i],
                    ERC20(supportedTokens[i]).symbol(),
                    ERC20(supportedTokens[i]).decimals(),
                    _recipient,
                    _amount
                );
            }
        }
    }

    function isIssueClosed(
        string memory _platform,
        string memory _repoId,
        string memory _issueId
    ) public view returns (bool) {
        return resolvers[_platform][_repoId][_issueId].length > 0;
    }

    // TODO: remove these
    function toHex16(bytes16 data) internal pure returns (bytes32 result) {
        result =
            (bytes32(data) &
                0xFFFFFFFFFFFFFFFF000000000000000000000000000000000000000000000000) |
            ((bytes32(data) &
                0x0000000000000000FFFFFFFFFFFFFFFF00000000000000000000000000000000) >>
                64);
        result =
            (result &
                0xFFFFFFFF000000000000000000000000FFFFFFFF000000000000000000000000) |
            ((result &
                0x00000000FFFFFFFF000000000000000000000000FFFFFFFF0000000000000000) >>
                32);
        result =
            (result &
                0xFFFF000000000000FFFF000000000000FFFF000000000000FFFF000000000000) |
            ((result &
                0x0000FFFF000000000000FFFF000000000000FFFF000000000000FFFF00000000) >>
                16);
        result =
            (result &
                0xFF000000FF000000FF000000FF000000FF000000FF000000FF000000FF000000) |
            ((result &
                0x00FF000000FF000000FF000000FF000000FF000000FF000000FF000000FF0000) >>
                8);
        result =
            ((result &
                0xF000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000) >>
                4) |
            ((result &
                0x0F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F00) >>
                8);
        result = bytes32(
            0x3030303030303030303030303030303030303030303030303030303030303030 +
                uint256(result) +
                (((uint256(result) +
                    0x0606060606060606060606060606060606060606060606060606060606060606) >>
                    4) &
                    0x0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F) *
                7
        );
    }

    function toHex(bytes32 data) public pure returns (string memory) {
        return
            string(
                abi.encodePacked(
                    "0x",
                    toHex16(bytes16(data)),
                    toHex16(bytes16(data << 128))
                )
            );
    }
}
