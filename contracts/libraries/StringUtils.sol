// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.20;

library StringUtils {
  // Function to split a string by a delimiter and check for exactly two parts
  function split(string memory _base, string memory _value)
      public
      pure
      returns (string memory, string memory)
  {
    bytes memory _baseBytes = bytes(_base);
    bytes memory _valueBytes = bytes(_value);

    uint256 _i;
    uint256 _lastPos = 0;
    string[2] memory _parts;
    uint256 _numParts = 0;

    // Loop over the string to find the delimiter
    for (_i = 0; _i < _baseBytes.length; _i++) {
      if (_baseBytes[_i] == _valueBytes[0] && compareStringsByBytes(_value, _baseBytes, _i)) {
        _parts[_numParts] = substring(_baseBytes, _lastPos, _i);
        _numParts++;
        _lastPos = _i + _valueBytes.length;
        if (_numParts >= 2) {
          break;
        }
      }
    }

    // Add the last part
    if (_numParts < 2) {
      _parts[_numParts] = substring(_baseBytes, _lastPos, _baseBytes.length);
      _numParts++;
    }

    // Check if the number of parts is exactly 2
    require(_numParts == 2, "Input string does not contain exactly two parts");

    return (_parts[0], _parts[1]);
  }

  // Compare if two byte arrays are equal
  function compareStringsByBytes(string memory _s1, bytes memory _b2, uint256 _start)
      public
      pure
      returns (bool)
  {
    bytes memory _b1 = bytes(_s1);
    if (_b1.length + _start > _b2.length) {
      return false;
    }
    for (uint256 _i = 0; _i < _b1.length; _i++) {
      if (_b1[_i] != _b2[_i + _start]) {
        return false;
      }
    }
    return true;
  }

  // Create a substring from a byte array
  function substring(bytes memory _str, uint _startIndex, uint _endIndex)
      public
      pure
      returns (string memory)
  {
    bytes memory _result = new bytes(_endIndex - _startIndex);
    for (uint _i = _startIndex; _i < _endIndex; _i++) {
      _result[_i - _startIndex] = _str[_i];
    }
    return string(_result);
  }

  // Compare if two strings are equal by hash
  function eq(string memory a, string memory b) public pure returns (bool) {
    return keccak256(bytes(a)) == keccak256(bytes(b));
  }
}
