// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC721, ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IIdentity} from "./IIdentity.sol";

// TODO: should this be a proxy??
contract Identity is
    IIdentity,
    ERC721Enumerable,
    AccessControlDefaultAdminRules,
    Pausable
{
    using Strings for uint256;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // TODO: should token id be a part of this?
    event IdentityUpdate(
        address wallet,
        string platform,
        string platformUserId,
        string platformUsername
    );

    bytes32 public constant CUSTODIAN_ADMIN_ROLE =
        keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

    uint256 private nextTokenId;

    // TODO: function to update signing public key
    address notary;

    // TODO: store github usernames or ids? thinking user ids...
    // platformId -> tokenId -> userId
    mapping(string => mapping(uint256 => string)) public platformUserIds;

    mapping(string => mapping(string => address)) public walletForPlatformUser;

    constructor(address _custodian, address _notary)
        ERC721("GitGigIdentity", "GGID")
        AccessControlDefaultAdminRules(3 days, msg.sender)
        Pausable()
    {
        notary = _notary;
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        pure
        override(ERC721Enumerable, AccessControlDefaultAdminRules)
        returns (bool)
    {
        return
            interfaceId == type(ERC721).interfaceId ||
            interfaceId == type(ERC721Enumerable).interfaceId ||
            interfaceId == type(AccessControlDefaultAdminRules).interfaceId;
    }

    function _validLinkSignature(
        address _userAddress,
        string memory _platformId,
        string memory _platformUserId,
        string memory _platformUsername,
        bytes memory _signature
    ) private view {
        bytes memory _data = abi.encode(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername
        );
        bytes32 _messageHash = keccak256(_data);
        bytes32 _ethMessageHash = _messageHash.toEthSignedMessageHash();

        require(
            SignatureChecker.isValidSignatureNow(
                notary,
                _ethMessageHash,
                _signature
            ),
            "Invalid signature"
        );
    }

    // TODO: switch this to EIP-712?? https://eips.ethereum.org/EIPS/eip-712#specification
    // TODO: do not allow a wallet to mint more than one NFT
    // TODO: disallow transfers

    function mint(
        address _userAddress,
        string memory _platformId,
        string memory _platformUserId,
        string memory _platformUsername,
        bytes memory _signature
    ) public whenNotPaused {
        _validLinkSignature(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername,
            _signature
        );
        require(balanceOf(_userAddress) < 1, "Already minted");

        // TODO: ensure the platformUserId does not already have an existing wallet

        // TODO: extract data and set appropriate nft attributes
        // TODO: should we allow off-chain metadata extensions via a uri?
        uint256 _tokenId = nextTokenId++;
        _safeMint(_userAddress, _tokenId);
        // _setTokenURI(newItemId, getTokenURI(_platformId, newItemId));

        walletForPlatformUser[_platformId][_platformUserId] = _userAddress;

        emit IdentityUpdate(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername
        );
    }

    function transfer(
        address _userAddress,
        string memory _platformId,
        string memory _platformUserId,
        string memory _platformUsername,
        bytes memory _signature
    ) public whenNotPaused {
        _validLinkSignature(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername,
            _signature
        );
        address priorAddress = walletForPlatformUser[_platformId][
            _platformUserId
        ];

        require(priorAddress != address(0), "No identity to update");

        // transfer the token to the new wallet
        uint256 _tokenId = tokenOfOwnerByIndex(priorAddress, 0);
        _update(_userAddress, _tokenId, address(0));

        // update the address of the platform user
        walletForPlatformUser[_platformId][_platformUserId] = _userAddress;

        emit IdentityUpdate(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername
        );
    }

    function getTokenURI(string memory platformId, uint256 tokenId)
        public
        view
        returns (string memory)
    {
        // TODO: support multiple platforms. should this be an array instead?
        // TODO: better key name??
        bytes memory dataURI = abi.encodePacked(
            "{",
            '"platform_',
            platformId,
            '_id": "',
            platformUserIds[platformId][tokenId],
            '"',
            "}"
        );

        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(dataURI)
                )
            );
    }

    function pause() public onlyRole(CUSTODIAN_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(CUSTODIAN_ROLE) {
        _unpause();
    }
}
