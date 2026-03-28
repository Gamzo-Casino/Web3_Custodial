// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../games/interfaces/IGame.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title RandomnessCoordinator — Chainlink VRF v2.5 abstraction
/// @notice Games call requestRandomness; VRF fulfills via fulfillRandomWords
contract RandomnessCoordinator is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant GAME_ROLE     = keccak256("GAME_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ── VRF config ─────────────────────────────────────────────────────────────
    address  public vrfCoordinator;
    bytes32  public keyHash;
    uint256  public subscriptionId;
    uint16   public constant MIN_CONFIRMATIONS = 3;
    uint32   public constant CALLBACK_GAS      = 500_000; // kept for storage-layout compat
    uint32   public constant NUM_WORDS         = 1;

    // ── Request tracking ───────────────────────────────────────────────────────
    struct Request {
        bytes32 gameId;
        address gameContract;
        bytes32 roundId;
        bool    fulfilled;
    }
    mapping(uint256 => Request) public requests; // vrfRequestId => Request

    // ── Storage extension (appended to avoid layout collision) ──────────────────
    uint32 public callbackGas; // configurable callback gas; 0 = use CALLBACK_GAS legacy

    event RandomnessRequested(uint256 indexed vrfRequestId, bytes32 indexed gameId, bytes32 indexed roundId);
    event RandomnessFulfilled(uint256 indexed vrfRequestId, bytes32 indexed gameId, bytes32 indexed roundId, uint256 randomWord);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address vrfCoordinator_,
        bytes32 keyHash_,
        uint256 subscriptionId_
    ) external initializer {
        __AccessControl_init();
        // UUPSUpgradeable in OZ v5 has no __init needed
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        vrfCoordinator = vrfCoordinator_;
        keyHash        = keyHash_;
        subscriptionId = subscriptionId_;
        // Fresh deploy only — on upgrade callbackGas stays 0 until setCallbackGas is called
    }

    /// @notice Called by game contracts to request randomness
    function requestRandomness(
        bytes32 gameId,
        bytes32 roundId,
        address gameContract
    ) external onlyRole(GAME_ROLE) returns (uint256 vrfRequestId) {
        vrfRequestId = IVRFCoordinatorV2Plus(vrfCoordinator).requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash:             keyHash,
                subId:               subscriptionId,
                requestConfirmations: MIN_CONFIRMATIONS,
                callbackGasLimit:    callbackGas == 0 ? 1_000_000 : callbackGas,
                numWords:            NUM_WORDS,
                extraArgs:           VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({ nativePayment: false })
                )
            })
        );
        requests[vrfRequestId] = Request({
            gameId: gameId,
            gameContract: gameContract,
            roundId: roundId,
            fulfilled: false
        });
        emit RandomnessRequested(vrfRequestId, gameId, roundId);
    }

    /// @notice Called by Chainlink VRF coordinator on fulfillment
    function rawFulfillRandomWords(uint256 vrfRequestId, uint256[] memory randomWords) external {
        require(msg.sender == vrfCoordinator, "only VRF coordinator");
        Request storage req = requests[vrfRequestId];
        require(req.gameContract != address(0), "unknown request");
        require(!req.fulfilled, "already fulfilled");
        req.fulfilled = true;

        emit RandomnessFulfilled(vrfRequestId, req.gameId, req.roundId, randomWords[0]);
        IGame(req.gameContract).fulfillRandomness(vrfRequestId, randomWords);
    }

    /// @notice Update VRF config (e.g., rotate subscription)
    function setVRFConfig(address coord, bytes32 kh, uint256 subId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vrfCoordinator = coord;
        keyHash = kh;
        subscriptionId = subId;
    }

    /// @notice Update the VRF callback gas limit (recommended: 1_000_000 for Keno)
    function setCallbackGas(uint32 gas_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(gas_ >= 100_000 && gas_ <= 2_500_000, "gas out of range");
        callbackGas = gas_;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
