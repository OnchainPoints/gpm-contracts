// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title StakingContract
 * @dev This contract manages a staking system where users can stake ETH, earn rewards, and accumulate points.
 * It uses OpenZeppelin's upgradeable contracts for initialization, ownership, reentrancy protection, and upgradeability.
 */
contract StakingContract is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    uint256 private constant PRECISION = 1e18;

    /**
     * @dev Struct to store user-specific staking information
     */
    struct UserInfo {
        uint256 amount;         // Amount of ETH staked by the user
        uint256 rewardDebt;     // Reward debt used for accurate reward calculation
        uint256 pointsDebt;     // Points debt used for accurate points calculation
        uint256 earnedRewards;  // Accumulated rewards not yet claimed
        uint256 points;         // Accumulated points
        uint256 lastStaked;     // Timestamp of last stake
        uint256 lastClaimed;    // Timestamp of last reward claim
        uint256 totalRewards;   // Total rewards claimed over time
    }

    mapping(address => UserInfo) public userInfo;
    uint256 public totalStaked;
    uint256 public accRewardPerShare;
    uint256 public accPointsPerShare;
    uint256 public lastUpdateTime;
    uint256 public rewardPerSecond;
    uint256 public pointsPerSecond;

    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event PointsEarned(address indexed user, uint256 points);
    event RewardPerSecondChanged(uint256 newRewardPerSecond);
    event PointsPerSecondChanged(uint256 newPointsPerSecond);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    /**
     * @dev Initializes the contract setting the deployer as the initial owner.
     * @param _rewardPerSecond Initial rate of reward distribution per second
     * @param _pointsPerSecond Initial rate of points distribution per second
     * @param _initialOwner Address of the initial owner of the contract
     */
    function initialize(uint256 _rewardPerSecond, uint256 _pointsPerSecond, address _initialOwner) public initializer {
        __Ownable_init(_initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        rewardPerSecond = _rewardPerSecond;
        pointsPerSecond = _pointsPerSecond;
        lastUpdateTime = block.timestamp;
    }

    /**
     * @dev Allows the contract to receive ETH
     */
    receive() external payable {}

    /**
     * @dev Updates the pool's accumulated rewards and points
     */
    function updatePool() public {
        if (block.timestamp <= lastUpdateTime) {
            return;
        }
        if (totalStaked == 0) {
            lastUpdateTime = block.timestamp;
            return;
        }
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        uint256 reward = rewardPerSecond * timeElapsed;
        uint256 points = pointsPerSecond * timeElapsed;
        accRewardPerShare += (reward * PRECISION) / totalStaked;
        accPointsPerShare += (points * PRECISION) / totalStaked;
        lastUpdateTime = block.timestamp;
    }

    /**
     * @dev Updates the user's earned rewards and points
     */
    function updateUserEarnedStats() private {
        UserInfo storage user = userInfo[msg.sender];
        uint256 pendingReward = (user.amount * accRewardPerShare / PRECISION) - user.rewardDebt;
        uint256 earnedPoints = (user.amount * accPointsPerShare / PRECISION) - user.pointsDebt;
        user.earnedRewards += pendingReward;
        user.points += earnedPoints;
        emit PointsEarned(msg.sender, earnedPoints);
    }

    /**
     * @dev Recalculates the user's reward and points debt
     */
    function recalculateUserDebt() private {
        UserInfo storage user = userInfo[msg.sender];
        user.rewardDebt = user.amount * accRewardPerShare / PRECISION;
        user.pointsDebt = user.amount * accPointsPerShare / PRECISION;
    }

    /**
     * @dev Internal function to handle staking logic
     * @param _user Address of the user staking
     */
    function _stake(address _user) private {
        require(msg.value > 0, "Cannot stake 0");

        updatePool();
        UserInfo storage user = userInfo[_user];
        if (user.amount > 0) {
            updateUserEarnedStats();
        }
        user.amount += msg.value;
        recalculateUserDebt();
        user.lastStaked = block.timestamp;
        totalStaked += msg.value;
        emit Staked(_user, msg.value);
    }

    /**
     * @dev Allows a user to stake ETH
     */
    function stake() external payable nonReentrant {
        _stake(msg.sender);
    }

    /**
     * @dev Allows staking on behalf of another user
     * @param _user Address of the user to stake for
     */
    function stakeOnBehalf(address _user) external payable {
        _stake(_user);
    }

    /**
     * @dev Allows a user to unstake their ETH
     * @param _amount Amount of ETH to unstake
     */
    function unstake(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "Insufficient staked amount");
        updatePool();
        updateUserEarnedStats();
        user.amount -= _amount;
        recalculateUserDebt();
        totalStaked -= _amount;
        payable(msg.sender).transfer(_amount);
        emit Unstaked(msg.sender, _amount);
    }

    /**
     * @dev Allows a user to claim their earned rewards and points
     */
    function claimRewards() external nonReentrant {
        updatePool();
        UserInfo storage user = userInfo[msg.sender];
        uint256 pendingReward = (user.amount * accRewardPerShare / PRECISION) - user.rewardDebt;
        uint256 earnedPoints = (user.amount * accPointsPerShare / PRECISION) - user.pointsDebt;
        uint256 totalRewards = user.earnedRewards + pendingReward;
        if (totalRewards > 0) {
            user.earnedRewards = 0;
            user.rewardDebt = user.amount * accRewardPerShare / PRECISION;
            user.totalRewards += totalRewards;
            user.lastClaimed = block.timestamp;
            payable(msg.sender).transfer(totalRewards);
            emit RewardPaid(msg.sender, totalRewards);
        }
        if (earnedPoints > 0) {
            user.points += earnedPoints;
            user.pointsDebt = user.amount * accPointsPerShare / PRECISION;
            emit PointsEarned(msg.sender, earnedPoints);
        }
    }

    /**
     * @dev Calculates the earned rewards for a user
     * @param _user Address of the user
     * @return Amount of earned rewards
     */
    function earnedRewards(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        uint256 accRewardPerShareTemp = accRewardPerShare;
        if (block.timestamp > lastUpdateTime && totalStaked != 0) {
            uint256 timeElapsed = block.timestamp - lastUpdateTime;
            uint256 reward = rewardPerSecond * timeElapsed;
            accRewardPerShareTemp += (reward * PRECISION) / totalStaked;
        }
        return user.earnedRewards + (user.amount * accRewardPerShareTemp / PRECISION) - user.rewardDebt;
    }

    /**
     * @dev Calculates the earned points for a user
     * @param _user Address of the user
     * @return Amount of earned points
     */
    function earnedUserPoints(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        uint256 accPointsPerShareTemp = accPointsPerShare;
        if (block.timestamp > lastUpdateTime && totalStaked != 0) {
            uint256 timeElapsed = block.timestamp - lastUpdateTime;
            uint256 points = pointsPerSecond * timeElapsed;
            accPointsPerShareTemp += (points * PRECISION) / totalStaked;
        }
        return user.points + (user.amount * accPointsPerShareTemp / PRECISION) - user.pointsDebt;
    }

    /**
     * @dev Allows the owner to change the reward rate
     * @param _newRewardPerSecond New reward rate per second
     */
    function changeRewardPerSecond(uint256 _newRewardPerSecond) external onlyOwner {
        updatePool();
        rewardPerSecond = _newRewardPerSecond;
        emit RewardPerSecondChanged(_newRewardPerSecond);
    }

    /**
     * @dev Allows the owner to change the points rate
     * @param _newPointsPerSecond New points rate per second
     */
    function changePointsPerSecond(uint256 _newPointsPerSecond) external onlyOwner {
        updatePool();
        pointsPerSecond = _newPointsPerSecond;
        emit PointsPerSecondChanged(_newPointsPerSecond);
    }

    /**
     * @dev Returns the staked balance of a user
     * @param _user Address of the user
     * @return Staked balance
     */
    function getStakedBalance(address _user) external view returns (uint256) {
        return userInfo[_user].amount;
    }

    /**
     * @dev Returns the current reward rate per second
     * @return Current reward rate
     */
    function getCurrentRewardPerSecond() external view returns (uint256) {
        return rewardPerSecond;
    }

    /**
     * @dev Returns the current points rate per second
     * @return Current points rate
     */
    function getCurrentPointsPerSecond() external view returns (uint256) {
        return pointsPerSecond;
    }

    /**
     * @dev Returns the full UserInfo struct for a user
     * @param _user Address of the user
     * @return UserInfo struct
     */
    function getUserInfo(address _user) external view returns (UserInfo memory) {
        return userInfo[_user];
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract. Called by
     * {upgradeTo} and {upgradeToAndCall}.
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Allows the owner to withdraw all ETH from the contract in case of emergency
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
    }
}