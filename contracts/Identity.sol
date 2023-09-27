// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

// TODO: should this be a proxy??
contract Identity is ERC721URIStorage {
    using ECDSA for bytes32;
    using Strings for uint256;
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    string constant MSGPREFIX = "\x19Ethereum Signed Message:\n";

    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    // TODO: function to update signing public key
    address signer;

    // TODO: store github usernames or ids? thinking user ids...
    // platformId -> tokenId -> userId
    mapping(string => mapping(uint256 => string)) public platformUserIds;

    constructor(address _signer) ERC721("GitGigIdentity", "GGID") {
        signer = _signer;
    }

    // TODO: do not allow a wallet to mint more than one NFT

    function mint(
        string memory _platformId,
        string memory _data,
        bytes memory _signature
    ) public {
        bytes32 _messageHash = keccak256(abi.encodePacked(_data));
        bytes32 _ethMessageHash = ECDSA.toEthSignedMessageHash(_messageHash);

        require(
            SignatureChecker.isValidSignatureNow(
                signer,
                _ethMessageHash,
                _signature
            ),
            "Invalid signature"
        );

        // TODO: decode data structure
        // TODO: verify structure and required arguments

        // TODO: extract data from data and set appropriate nft attributes
        // TODO: should we allow off-chain metadata extensions via a uri?
        _tokenIds.increment();
        uint256 newItemId = _tokenIds.current();
        _safeMint(msg.sender, newItemId);
        _setTokenURI(newItemId, getTokenURI(_platformId, newItemId));
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
}
