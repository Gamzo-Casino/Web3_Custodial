// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockVRFCoordinator — instant fulfillment for tests
contract MockVRFCoordinator {
    uint256 private _nextRequestId = 1;

    event RandomWordsRequested(uint256 indexed requestId);
    event RandomWordsFulfilled(uint256 indexed requestId, uint256[] words);

    struct Request {
        address requester;
        bool fulfilled;
    }
    mapping(uint256 => Request) public requests;

    function requestRandomWords(
        bytes32, uint256, uint16, uint32, uint32, bytes memory
    ) external returns (uint256 requestId) {
        requestId = _nextRequestId++;
        requests[requestId] = Request({ requester: msg.sender, fulfilled: false });
        emit RandomWordsRequested(requestId);
    }

    /// @notice Tests call this to simulate VRF fulfillment
    function fulfillRandomWords(uint256 requestId, address coordinator, uint256 randomWord) external {
        require(!requests[requestId].fulfilled, "already fulfilled");
        requests[requestId].fulfilled = true;

        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;

        (bool ok, bytes memory err) = coordinator.call(
            abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", requestId, words)
        );
        require(ok, string(err));
        emit RandomWordsFulfilled(requestId, words);
    }
}
