// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {PointsToken} from "./PointsToken.sol";
import {ITokenSupportable} from "./ITokenSupportable.sol";
import {Notarizable} from "./Notarizable.sol";

// TODO: add event to all admin functions
contract PointsTokenFactory is
    EIP712,
    AccessControlDefaultAdminRules,
    Notarizable
{
    // TODO: create a custodian setter for this
    uint256 public fee;
    uint8 public dec;
    uint256 public totalSupply;
    address[] public bountiesContracts;

    bytes32 public constant CUSTODIAN_ADMIN_ROLE =
        keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

    bytes32 private constant TYPE_HASH =
        keccak256(
            "CreatePointsToken(string name,string symbol,string platformId,string org,address creator)"
        );

    error InvalidSignature();
    error InvalidSymbol(string symbol);
    error InvalidArgument();
    error WrongFeeAmount(uint256);

    event PointsTokenCreated(
        address cpToken,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        address minter,
        string platformId,
        string org
    );

    // TODO: make symbols unique within an org. need a symbolregistry contract in order to do this
    //       so that we can deploy a new factory contract over time.
    // TODO: make a maintainer function to set the payable amount
    // TODO: add flag to limit transferability
    // TODO: bake the org name into the token contract
    constructor(
        address _custodian,
        address _notary,
        uint8 _decimals,
        uint256 _totalSupply,
        uint256 _fee
    )
        AccessControlDefaultAdminRules(3 days, msg.sender)
        EIP712("GitGigPointsFactory", "1")
        Notarizable(_notary)
    {
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        dec = _decimals;
        totalSupply = _totalSupply;
        fee = _fee;
    }

    function addBountiesContract(address _bounties)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        for (uint256 i = 0; i < bountiesContracts.length; i++) {
            if (bountiesContracts[i] == _bounties) {
                revert InvalidArgument();
            }
        }

        bountiesContracts.push(_bounties);
    }

    function removeBountiesContract(address _bounties)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        bool _found = false;
        // find _bounties in the bountiesContracts list
        for (uint256 i = 0; i < bountiesContracts.length; i++) {
            if (bountiesContracts[i] == _bounties) {
                bountiesContracts[i] = bountiesContracts[
                    bountiesContracts.length - 1
                ];
                bountiesContracts.pop();
                _found = true;
            }
        }

        if (!_found) {
            revert InvalidArgument();
        }
    }

    function createPointsToken(
        string calldata _name,
        string calldata _symbol,
        string calldata _platformId,
        string calldata _org,
        // TODO: how do we prevent a signature from being re-used by someone that left the org???
        // TODO: do we need this? no, as long as we include the msg.sender
        // in the signature
        // uint256 _orgNonce,
        bytes calldata _signature
    ) public payable {
        _validateFee(msg.value);
        _validateSymbol(_symbol);

        _validateSignature(_name, _symbol, _platformId, _org, _signature);

        address cpToken = address(
            new PointsToken(
                _name,
                _symbol,
                _platformId,
                _org,
                dec,
                totalSupply,
                msg.sender
            )
        );

        for (uint256 i = 0; i < bountiesContracts.length; i++) {
            ITokenSupportable(bountiesContracts[i]).addToken(cpToken);
        }

        emit PointsTokenCreated(
            cpToken,
            _name,
            _symbol,
            dec,
            totalSupply,
            msg.sender,
            _platformId,
            _org
        );
    }

    function _validateFee(uint256 _fee) private view {
        if (_fee != fee) {
            revert WrongFeeAmount(msg.value);
        }
    }

    function _validateSymbol(string calldata _symbol) private pure {
        if (!eq(substr(_symbol, 0, 2), "cp")) {
            revert InvalidSymbol(_symbol);
        }
    }

    function _validateSignature(
        string calldata _name,
        string calldata _symbol,
        string calldata _platformId,
        string calldata _org,
        bytes calldata _signature
    ) private view {
        bytes32 _digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TYPE_HASH,
                    keccak256(bytes(_name)),
                    keccak256(bytes(_symbol)),
                    keccak256(bytes(_platformId)),
                    keccak256(bytes(_org)),
                    msg.sender
                )
            )
        );

        address _signer = ECDSA.recover(_digest, _signature);

        if (_signer != notary) {
            revert InvalidSignature();
        }
    }

    function substr(
        string calldata str,
        uint256 start,
        uint256 end
    ) internal pure returns (string memory) {
        return str[start:end];
    }

    function eq(string memory str1, string memory str2)
        internal
        pure
        returns (bool)
    {
        return
            keccak256(abi.encodePacked(str1)) ==
            keccak256(abi.encodePacked(str2));
    }

    // custodian functions

    function setDecimals(uint8 _decimals) public onlyRole(CUSTODIAN_ROLE) {
        if (_decimals > 18) {
            revert InvalidArgument();
        }
        dec = _decimals;
    }

    function setTotalSupply(uint256 _totalSupply)
        public
        onlyRole(CUSTODIAN_ROLE)
    {
        totalSupply = _totalSupply;
    }
}
