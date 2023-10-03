// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "./IIdentity.sol";

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
        uint256 amount
    );

    event IssueClosed(
        string platform,
        string repo,
        string issue,
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

    address public signer;

    // TODO: remove the oracle since it shouldn't be needed anymore
    // TODO: should probably have a setter to update this
    address public oracle;

    // TODO: make this changeable by the owner
    address public identityContract;

    // TODO: make this changeable by the owner
    uint256 public maintainerFee = 10;

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
        address _oracle,
        address _signer,
        address _identityContract,
        address[] memory _supportedTokens
    ) {
        signer = _signer;
        identityContract = _identityContract;
        oracle = _oracle;
        supportedTokens = _supportedTokens;
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            isSupportedToken[_supportedTokens[i]] = true;
        }
    }

    modifier oracleOnly() {
        require(
            msg.sender == oracle,
            "This function is restricted to the oracle"
        );
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

    // modifier resolverOnly(
    //     string memory _platform,
    //     string memory _repoId,
    //     string memory _issueId
    // ) {
    //     bool isResolver = false;
    //     for (
    //         uint256 i = 0;
    //         i < resolvers[_platform][_repoId][_issueId].length;
    //         i++
    //     ) {
    //         address addr = resolvers[_platform][_repoId][_issueId][i];
    //         if (msg.sender == addr) {
    //             isResolver = true;
    //             break;
    //         }
    //     }

    //     require(isResolver, "This function is restricted to resolvers");
    //     _;
    // }

    modifier notClaimed(
        string memory _platform,
        string memory _repoId,
        string memory _issueId,
        address[] memory _tokenContracts
    ) {
        for (uint256 i = 0; i < _tokenContracts.length; i++) {
            address _tokenContract = _tokenContracts[i];
            require(
                claimed[_platform][_repoId][_issueId][_tokenContract][
                    msg.sender
                ] == false,
                "You have already claimed bounty"
            );
        }
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
        // record the number of tokens in the contract allocated to this issue
        bounties[_platform][_repoId][_issueId][_tokenContract] += _amount;

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
            _amount
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
            bytes32 _ethMessageHash = ECDSA.toEthSignedMessageHash(
                _messageHash
            );

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

        emit IssueClosed(
            _platformId,
            _repoId,
            _issueId,
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

    // TODO: a percent of each bounty to the maintainer and include a fee for the _platform
    // function claimBounty(
    //     string memory _platform,
    //     string memory _repoId,
    //     string memory _issueId,
    //     address[] memory _tokenContracts
    // ) public resolverOnly(_platform, _repoId, _issueId) {
    //     for (uint256 i = 0; i < _tokenContracts.length; i++) {
    //         uint8 _claimsRemaining = 0;
    //         address _tokenContract = _tokenContracts[i];
    //         uint256 _amount = bounties[_platform][_repoId][_issueId][
    //             _tokenContract
    //         ];

    //         for (
    //             uint256 j = 0;
    //             j < resolvers[_platform][_repoId][_issueId].length;
    //             j++
    //         ) {
    //             address resolver = resolvers[_platform][_repoId][_issueId][j];
    //             if (
    //                 claimed[_platform][_repoId][_issueId][_tokenContract][
    //                     resolver
    //                 ] == false
    //             ) {
    //                 _claimsRemaining++;
    //             }
    //         }

    //         uint256 _resolverAmount = _amount / _claimsRemaining;

    //         if (_resolverAmount > 0) {
    //             // TODO: transfer tokens from this contract to the caller

    //             // mark the bounty as claimed for this resolver
    //             claimed[_platform][_repoId][_issueId][_tokenContract][
    //                 msg.sender
    //             ] = true;
    //         }
    //     }
    // }

    function isIssueClosed(
        string memory _platform,
        string memory _repoId,
        string memory _issueId
    ) public view returns (bool) {
        return resolvers[_platform][_repoId][_issueId].length > 0;
    }
}
