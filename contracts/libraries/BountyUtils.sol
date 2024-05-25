// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

import {IIdentity, PlatformUser} from "../interfaces/IIdentity.sol";
import {IMaintainerFees} from "../interfaces/IMaintainerFees.sol";
import {IBountiesConfig} from "../interfaces/IBountiesConfig.sol";
import {StringUtils} from "./StringUtils.sol";

library BountyUtils {
  using StringUtils for string;

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

  function isUnclaimedResolver(
    address[] storage _supportedTokens,
    string memory _platformId,
    mapping(address => mapping(string => bool)) storage _claimed,
    mapping(address => uint256) storage _bounties,
    string[] storage _resolvers,
    IIdentity _identity
  ) public view returns (bool, bool) {
    bool _hasUnclaimed = false;
    bool _isResolver = false;

    // need to check all of their identities
    for (
      uint256 i = 0; i < _identity.balanceOf(msg.sender); i++
    ) {
      // lookup the platformUserId for the resolver
      uint256 _tokenId = _identity.tokenOfOwnerByIndex(msg.sender, i);
      PlatformUser memory platformUser = _identity.platformUser(_tokenId);

      // skip this platformUser if it's not for this platform
      if (!platformUser.platformId.eq(_platformId)) {
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

        if (_resolverUserId.eq(platformUser.userId)) {
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


  // returns the total amount of tokens the maintainer will receive for this bounty
  function maintainerClaimAmount(
    string calldata _platformId,
    string calldata _ownerAndRepo,
    string calldata _issueId,
    address _token,
    address _maintainerFeesContract,
    address _bountyConfigContract,
    mapping(string => mapping(string => mapping(string => mapping(address => uint256)))) storage _bounties
  ) public view returns (uint256) {
    // check to see if there is a custom fee
    IMaintainerFees _maintainerFees = IMaintainerFees(_maintainerFeesContract);
    (string memory _owner, string memory _repo) = _ownerAndRepo.split("/");
    (bool _isSet, uint8 _customFee) = 
      _maintainerFees.getCustomFee(_platformId, _owner, _repo, _issueId);

    uint8 _useFee;

    if (_isSet) {
      // use custom fee
      _useFee = _customFee;
    } else {
      // use default fee
      _useFee = IBountiesConfig(_bountyConfigContract).maintainerFee();
    }

    return (_bounties[_platformId][_ownerAndRepo][_issueId][_token] * _useFee) / 100;
  }
}
