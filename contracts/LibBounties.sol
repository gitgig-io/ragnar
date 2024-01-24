// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IIdentity, PlatformUser} from "./IIdentity.sol";

library LibBounties {
    error InvalidAddress(address addr);
    error InvalidFee(uint8 fee);

    function eq(string memory a, string memory b) public pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // TODO: maybe change param order?
    function isUnclaimedResolver(
        address _identityContract,
        address[] storage _supportedTokens,
        string memory _platformId,
        mapping(address => mapping(string => bool)) storage _claimed,
        mapping(address => uint256) storage _bounties,
        string[] storage _resolvers
    ) public view returns (bool, bool) {
        bool _hasUnclaimed = false;
        bool _isResolver = false;

        // need to check all of their identities
        for (
            uint256 i = 0;
            i < IIdentity(_identityContract).balanceOf(msg.sender);
            i++
        ) {
            // lookup the platformUserId for the resolver
            uint256 _tokenId = IIdentity(_identityContract).tokenOfOwnerByIndex(
                msg.sender,
                i
            );
            PlatformUser memory platformUser = IIdentity(_identityContract)
                .platformUser(_tokenId);

            // skip this platformUser if it's not for this platform
            if (!eq(platformUser.platformId, _platformId)) {
                continue;
            }

            // make sure they have an unclaimed bounty
            for (uint256 j = 0; j < _supportedTokens.length; j++) {
                if (
                    !_claimed[_supportedTokens[j]][platformUser.userId] &&
                    _bounties[_supportedTokens[j]] > 0
                ) {
                    _hasUnclaimed = true;
                    break;
                }
            }

            // make sure they are a resolver
            for (uint256 k = 0; k < _resolvers.length; k++) {
                string memory _resolverUserId = _resolvers[k];

                if (eq(_resolverUserId, platformUser.userId)) {
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

    function claimsRemaining(
        mapping(address => uint256) storage _bounties,
        mapping(address => mapping(string => bool)) storage _claimed,
        string[] storage _resolvers,
        address _tokenContract
    ) public view returns (uint8) {
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

    function validateAddress(address _address) public pure {
        if (_address == address(0)) {
            revert InvalidAddress(_address);
        }
    }

    function validateFee(uint8 _fee) public pure {
        if (_fee < 0 || _fee > 100) {
            revert InvalidFee(_fee);
        }
    }
}
