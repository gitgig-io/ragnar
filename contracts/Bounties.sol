// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Bounties {
    // TODO: should probably have a setter to update this
    address public oracle;

    mapping(address => bool) public supportedTokens;

    // store registered and closed issues. 0 means registered, 1 means closed
    mapping(string => mapping(string => mapping(uint256 => address[])))
        public resolvers;

    // store bounties by repo, issue and token
    mapping(string => mapping(string => mapping(uint256 => mapping(address => uint256))))
        public bounties;

    mapping(string => mapping(string => mapping(uint256 => mapping(address => mapping(address => bool)))))
        public claimed;

    constructor(address _oracle, address[] memory _supportedTokens) {
        oracle = _oracle;
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            supportedTokens[_supportedTokens[i]] = true;
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
        require(supportedTokens[tokenContract], "Unsupported token");
        _;
    }

    modifier issueNotClosed(
        string memory _repoRegistry,
        string memory _repoId,
        uint256 _issueId
    ) {
        require(
            resolvers[_repoRegistry][_repoId][_issueId].length < 1,
            "Issue is already closed"
        );
        _;
    }

    modifier resolverOnly(
        string memory _repoRegistryId,
        string memory _repoId,
        uint256 _issueId
    ) {
        bool isResolver = false;
        for (
            uint256 i = 0;
            i < resolvers[_repoRegistryId][_repoId][_issueId].length;
            i++
        ) {
            address addr = resolvers[_repoRegistryId][_repoId][_issueId][i];
            if (msg.sender == addr) {
                isResolver = true;
                break;
            }
        }

        require(isResolver, "This function is restricted to resolvers");
        _;
    }

    modifier notClaimed(
        string memory _repoRegistry,
        string memory _repoId,
        uint256 _issueId,
        address[] memory _tokenContracts
    ) {
        for (uint256 i = 0; i < _tokenContracts.length; i++) {
            address _tokenContract = _tokenContracts[i];
            require(
                claimed[_repoRegistry][_repoId][_issueId][_tokenContract][
                    msg.sender
                ] == false,
                "You have already claimed bounty"
            );
        }
        _;
    }

    function postBounty(
        string memory _repoRegistry,
        string memory _repoId,
        uint256 _issueId,
        address _tokenContract,
        uint256 _amount
    )
        public
        issueNotClosed(_repoRegistry, _repoId, _issueId)
        supportedToken(_tokenContract)
    {
        // record the number of tokens in the contract allocated to this issue
        bounties[_repoRegistry][_repoId][_issueId][_tokenContract] += _amount;

        // transfer tokens from the msg sender to this contract and record the bounty amount
        IERC20(_tokenContract).transferFrom(msg.sender, address(this), _amount);

        // TOOD: what if the issue was already closed be we aren't tracking it??? FE could check...
    }

    function closeIssue(
        string memory _repoRegistry,
        string memory _repoId,
        uint256 _issueId,
        address[] memory _resolvers
    ) public oracleOnly issueNotClosed(_repoRegistry, _repoId, _issueId) {
        require(_resolvers.length > 0, "No resolvers specified");
        resolvers[_repoRegistry][_repoId][_issueId] = _resolvers;
    }

    // TODO: a percent of each bounty to the maintainer and include a fee for the platform
    function claimBounty(
        string memory _repoRegistry,
        string memory _repoId,
        uint256 _issueId,
        address[] memory _tokenContracts
    ) public resolverOnly(_repoRegistry, _repoId, _issueId) {
        for (uint256 i = 0; i < _tokenContracts.length; i++) {
            uint8 _claimsRemaining = 0;
            address _tokenContract = _tokenContracts[i];
            uint256 _amount = bounties[_repoRegistry][_repoId][_issueId][
                _tokenContract
            ];

            for (
                uint256 j = 0;
                j < resolvers[_repoRegistry][_repoId][_issueId].length;
                j++
            ) {
                address resolver = resolvers[_repoRegistry][_repoId][_issueId][
                    j
                ];
                if (
                    claimed[_repoRegistry][_repoId][_issueId][_tokenContract][
                        resolver
                    ] == false
                ) {
                    _claimsRemaining++;
                }
            }

            uint256 _resolverAmount = _amount / _claimsRemaining;

            if (_resolverAmount > 0) {
                // TODO: transfer tokens from this contract to the caller

                // mark the bounty as claimed for this resolver
                claimed[_repoRegistry][_repoId][_issueId][_tokenContract][
                    msg.sender
                ] = true;
            }
        }
    }

    function isIssueClosed(
        string memory _repoRegistry,
        string memory _repoId,
        uint256 _issueId
    ) public view returns (bool) {
        return resolvers[_repoRegistry][_repoId][_issueId].length > 0;
    }
}
