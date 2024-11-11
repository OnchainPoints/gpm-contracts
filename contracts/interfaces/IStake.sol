// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStake {
    function earnedUserPoints(address _user) external view returns (uint256);
    function stakeOnBehalf(address _user) external payable;
}
