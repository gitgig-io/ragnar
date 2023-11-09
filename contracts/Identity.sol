// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC721, ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC721, IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IIdentity, PlatformUser} from "./IIdentity.sol";

contract Identity is
    IIdentity,
    IERC721Metadata,
    ERC721Enumerable,
    AccessControlDefaultAdminRules,
    Pausable
{
    using Strings for uint256;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    event IdentityUpdate(
        uint256 tokenId,
        address wallet,
        string platform,
        string platformUserId,
        string platformUsername
    );

    event ConfigChange(address notary, string baseUri);

    error AlreadyMinted();
    error InvalidAccount();
    error InvalidSignature();
    error NotSupported();

    bytes32 public constant CUSTODIAN_ADMIN_ROLE =
        keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

    // start at 1 so we can tell the difference between a minted and non-minted
    // token for a user in the tokenIdForPlatformUser mapping
    uint256 private nextTokenId = 1;

    address public notary;

    string public baseUri;

    mapping(string platformId => mapping(string platformUserId => uint256 tokenId)) public tokenIdForPlatformUser;

    // TODO: do we need this?
    mapping(uint256 tokenId => PlatformUser platformUser) private platformUserForTokenId;

    constructor(
        address _custodian,
        address _notary,
        string memory _baseUri
    )
        ERC721("GitGigIdentity", "GGID")
        ERC721Enumerable()
        AccessControlDefaultAdminRules(3 days, msg.sender)
        Pausable()
    {
        notary = _notary;
        baseUri = _baseUri;
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        pure
        override(AccessControlDefaultAdminRules, ERC721Enumerable, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC165).interfaceId ||
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

        bool _validSig = SignatureChecker.isValidSignatureNow(
                notary,
                _ethMessageHash,
                _signature
            );

        if (!_validSig) {
            revert InvalidSignature();
        }
    }

    // TODO: switch this to EIP-712 https://eips.ethereum.org/EIPS/eip-712#specification

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
        // ensure token has not already been minted for this platform user
        if (tokenIdForPlatformUser[_platformId][_platformUserId] != 0) {
          revert AlreadyMinted();
        }

        uint256 _tokenId = nextTokenId++;

        // update the internal state before calling safeMint to avoid inconsistent state
        tokenIdForPlatformUser[_platformId][_platformUserId] = _tokenId;
        platformUserForTokenId[_tokenId] = PlatformUser(
            _platformId,
            _platformUserId,
            _platformUsername
        );

        _safeMint(_userAddress, _tokenId);

        emit IdentityUpdate(
            _tokenId,
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

        uint256 _tokenId = tokenIdForPlatformUser[_platformId][_platformUserId];

        // make sure the identity token has been minted for the given platform user
        if (_tokenId == 0) {
            revert ERC721NonexistentToken(_tokenId);
        }

        // update the username as this could change off-chain
        platformUserForTokenId[_tokenId].username = _platformUsername;

        // transfer the token to the new wallet
        _update(_userAddress, _tokenId, address(0));

        emit IdentityUpdate(
            _tokenId,
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername
        );
    }

    function ownerOf(string memory _platformId, string memory _platformUserId) override public view returns (address) {
      uint256 _tokenId = tokenIdForPlatformUser[_platformId][_platformUserId];
      return _ownerOf(_tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, IERC721Metadata)
        returns (string memory)
    {
        return
            string.concat(
                baseUri,
                "/api/chains/",
                Strings.toString(block.chainid),
                "/contracts/",
                Strings.toHexString(address(this)),
                "/tokens/",
                Strings.toString(tokenId)
            );
    }

    function pause() public onlyRole(CUSTODIAN_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(CUSTODIAN_ROLE) {
        _unpause();
    }

    function setNotary(address _newNotary) public onlyRole(CUSTODIAN_ROLE) {
        if (_newNotary == address(0)) {
          revert InvalidAccount();
        }

        notary = _newNotary;
        emit ConfigChange(notary, baseUri);
    }

    function setBaseUri(string memory _newBaseUri)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        baseUri = _newBaseUri;
        emit ConfigChange(notary, baseUri);
    }

    /** BEGIN NFT transfer overrides **/

    function approve(address, uint256) override(ERC721,IERC721) public pure {
      revert NotSupported();
    }

    function setApprovalForAll(address, bool) override(ERC721,IERC721) public pure {
      revert NotSupported();
    }

    function transferFrom(address, address, uint256) override(ERC721,IERC721) public pure {
      revert NotSupported();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) override(ERC721,IERC721) public pure {
      revert NotSupported();
    }

    /** END NFT transfer overrides **/

    function tokenOfOwnerByIndex(address addr, uint256 index) override(ERC721Enumerable,IIdentity) public view returns (uint256) {
      return super.tokenOfOwnerByIndex(addr, index);
    }

    function balanceOf(address addr) override(ERC721,IERC721, IIdentity) public view returns (uint256) {
      return super.balanceOf(addr);
    }

    function platformUser(uint256 tokenId) override(IIdentity) public view returns (PlatformUser memory) {
      return platformUserForTokenId[tokenId];
    }
}
