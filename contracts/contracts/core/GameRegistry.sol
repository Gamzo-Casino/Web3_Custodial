// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../games/interfaces/IGame.sol";

/// @title GameRegistry — central registry of game modules
/// @notice Admin registers/enables/disables game contracts here
contract GameRegistry is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant OPERATOR_ROLE  = keccak256("OPERATOR_ROLE");
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE");

    struct GameInfo {
        address contractAddr;
        bool    enabled;
        string  name;
        uint256 registeredAt;
    }

    mapping(bytes32 => GameInfo) public games;
    bytes32[] public gameIds;

    event GameRegistered(bytes32 indexed gameId, address indexed contractAddr, string name);
    event GameEnabled(bytes32 indexed gameId);
    event GameDisabled(bytes32 indexed gameId);
    event GameUpgraded(bytes32 indexed gameId, address indexed newAddr);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) external initializer {
        __AccessControl_init();
        // UUPSUpgradeable in OZ v5 has no __init needed
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function registerGame(bytes32 gameId, address contractAddr) external onlyRole(OPERATOR_ROLE) {
        require(contractAddr != address(0), "zero address");
        string memory name = IGame(contractAddr).gameName();
        games[gameId] = GameInfo({
            contractAddr: contractAddr,
            enabled: true,
            name: name,
            registeredAt: block.timestamp
        });
        gameIds.push(gameId);
        emit GameRegistered(gameId, contractAddr, name);
    }

    function enableGame(bytes32 gameId)  external onlyRole(OPERATOR_ROLE) {
        require(games[gameId].contractAddr != address(0), "not registered");
        games[gameId].enabled = true;
        emit GameEnabled(gameId);
    }

    function disableGame(bytes32 gameId) external onlyRole(OPERATOR_ROLE) {
        require(games[gameId].contractAddr != address(0), "not registered");
        games[gameId].enabled = false;
        emit GameDisabled(gameId);
    }

    function upgradeGame(bytes32 gameId, address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(games[gameId].contractAddr != address(0), "not registered");
        require(newAddr != address(0), "zero address");
        games[gameId].contractAddr = newAddr;
        emit GameUpgraded(gameId, newAddr);
    }

    function getGame(bytes32 gameId) external view returns (GameInfo memory) {
        return games[gameId];
    }

    function isEnabled(bytes32 gameId) external view returns (bool) {
        return games[gameId].enabled && games[gameId].contractAddr != address(0);
    }

    function allGameIds() external view returns (bytes32[] memory) {
        return gameIds;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
