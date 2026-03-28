// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGame — standard interface every Gamzo game module must implement
interface IGame {
    /// @notice Called by RandomnessCoordinator when VRF fulfills
    function fulfillRandomness(uint256 vrfRequestId, uint256[] memory randomWords) external;

    /// @notice Human-readable game name
    function gameName() external view returns (string memory);

    /// @notice Unique game id (e.g. keccak256("COINFLIP"))
    function gameId() external view returns (bytes32);
}
