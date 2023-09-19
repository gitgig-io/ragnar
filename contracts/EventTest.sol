// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

contract EventTest {
    event TestEvent(string message);

    constructor() {
        emit TestEvent("hello");
    }

    function test() public {
        emit TestEvent("hello");
    }
}
