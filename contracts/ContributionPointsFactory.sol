// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.20;

import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ContributionPointsERC20} from "./ContributionPointsERC20.sol";
// TODO: import the interface
import {Bounties} from "./Bounties.sol";

// TODO: add event to all admin interfaces
contract ContributionPointsFactory is AccessControlDefaultAdminRules {
    uint8 public dec;
    uint256 public totalSupply;
    address[] public bountiesContracts;

    bytes32 public constant CUSTODIAN_ADMIN_ROLE =
        keccak256("CUSTODIAN_ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

    error InvalidSymbol(string symbol);
    error InvalidArgument();

    event PointsTokenCreated(
        address cpToken,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        address minter
    );

    // TODO: make this a payable function (0.2 ETH)
    // TODO: make a maintainer function to set the payable amount
    // TODO: add flag to limit transferability
    // TODO: bake the org name into the token contract
    constructor(
        address _custodian,
        uint8 _decimals,
        uint256 _totalSupply
    ) AccessControlDefaultAdminRules(3 days, msg.sender) {
        _grantRole(CUSTODIAN_ADMIN_ROLE, _custodian);
        _grantRole(CUSTODIAN_ROLE, _custodian);
        _setRoleAdmin(CUSTODIAN_ROLE, CUSTODIAN_ADMIN_ROLE);
        dec = _decimals;
        totalSupply = _totalSupply;
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

    // TODO: take an org name and signature (to validate the org name)
    function createContributionPointsToken(
        string calldata _name,
        string calldata _symbol
    ) public {
        validateSymbol(_symbol);

        address cpToken = address(
            new ContributionPointsERC20(
                _name,
                _symbol,
                dec,
                totalSupply,
                msg.sender
            )
        );

        for (uint256 i = 0; i < bountiesContracts.length; i++) {
            // TODO: make this an interface
            Bounties(bountiesContracts[i]).addToken(cpToken);
        }

        emit PointsTokenCreated(
            cpToken,
            _name,
            _symbol,
            dec,
            totalSupply,
            msg.sender
        );
    }

    function validateSymbol(string calldata _symbol) internal pure {
        if (!eq(substr(_symbol, 0, 2), "cp")) {
            revert InvalidSymbol(_symbol);
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
