// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "./IIdentity.sol";
// TODO: remove
import "hardhat/console.sol";

// TODO: should this be a proxy??
contract Identity is IIdentity, ERC721URIStorage {
    using ECDSA for bytes32;
    using Strings for uint256;
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    // TODO: should token id be a part of this?
    event IdentityUpdate(
        address wallet,
        string platform,
        string platformUserId,
        string platformUsername
    );

    string constant MSGPREFIX = "\x19Ethereum Signed Message:\n";

    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    // TODO: function to update signing public key
    address signer;

    // TODO: store github usernames or ids? thinking user ids...
    // platformId -> tokenId -> userId
    mapping(string => mapping(uint256 => string)) public platformUserIds;

    mapping(string => mapping(string => address)) public walletForPlatformUser;

    constructor(address _signer) ERC721("GitGigIdentity", "GGID") {
        signer = _signer;
    }

    modifier validLinkSignature(
        address _userAddress,
        string memory _platformId,
        string memory _platformUserId,
        string memory _platformUsername,
        bytes memory _signature
    ) {
        bytes memory _data = abi.encode(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername
        );
        bytes32 _messageHash = keccak256(_data);
        bytes32 _ethMessageHash = ECDSA.toEthSignedMessageHash(_messageHash);

        require(
            SignatureChecker.isValidSignatureNow(
                signer,
                _ethMessageHash,
                _signature
            ),
            "Invalid signature"
        );

        _;
    }

    // TODO: probably need a function for users to drop their wallet association
    // if they lost the keys... or just a function to overwrite it.

    // TODO: switch this to EIP-712?? https://eips.ethereum.org/EIPS/eip-712#specification
    // TODO: do not allow a wallet to mint more than one NFT
    // TODO: disallow transfers

    function mint(
        address _userAddress,
        string memory _platformId,
        string memory _platformUserId,
        string memory _platformUsername,
        bytes memory _signature
    )
        public
        validLinkSignature(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername,
            _signature
        )
    {
        require(balanceOf(_userAddress) < 1, "Already minted");

        // TODO: ensure the platformUserId does not already have an existing wallet

        // TODO: extract data and set appropriate nft attributes
        // TODO: should we allow off-chain metadata extensions via a uri?
        _tokenIds.increment();
        uint256 tokenId = _tokenIds.current();
        _safeMint(_userAddress, tokenId);
        // _setTokenURI(newItemId, getTokenURI(_platformId, newItemId));

        walletForPlatformUser[_platformId][_platformUserId] = _userAddress;

        emit IdentityUpdate(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername
        );
    }

    function update(
        address _userAddress,
        string memory _platformId,
        string memory _platformUserId,
        string memory _platformUsername,
        bytes memory _signature
    )
        public
        validLinkSignature(
            _userAddress,
            _platformId,
            _platformUserId,
            _platformUsername,
            _signature
        )
    {
        require(balanceOf(_userAddress) > 0, "No identity to update");

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

    // TODO: remove these...
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
