// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IStake.sol";

/**
 * @title TestnetPoints
 * @dev This contract manages a testnet points system where users can claim rewards for various activities.
 * It includes features like initial gas drops, admin management, and integration with a staking contract.
 */
contract TestnetPoints is Initializable, OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct Activity {
        string name;
        uint256 createdAt;
    }

    uint256 public initialGasDrop; // Initial gas drop in wei
    bool public isPaused;
    string[] public allActivities;
    uint256 public percentageToSendOnClaim;

    mapping(string activityName => Activity activityData) public activities;
    mapping(string activityName => mapping(uint256 slotId => uint256 amount)) public activityClaimAmount;
    mapping(string activityName => mapping(uint256 slotId => uint256 amount)) public activityClaimAmountStoredInContract;
    mapping(string activityName => mapping(uint256 slotId => bool amount)) public activitySlotRewardsClaimed;
    mapping(address user => uint256 totalRewards) public totalUserRewards;
    mapping(address user => bool gasDropped) public gasDrops;
    
    mapping(address user => uint256 userBalance) public userBalance;
    
    mapping (address adminAddress => bool enabled) public adminAddresses;
    
    event ActivityCreated(string name);
    event ActivityRewardsClaimed(string name, address indexed user, uint256 indexed slotId, uint256 amount);
    event InitialGasDropUpdated(uint256 initialGasDrop);
    event InitialGasDrop(address indexed user, uint256 amount);

    event BalanceUpdated(address indexed user, uint256 amount);
    event RewardsWithdrawn(address indexed user, uint256 amount);

    address public stakingContractAddress;
    bool public autoStakeRewards;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(){
        _disableInitializers();
    }

    receive() payable external {}

    /**
     * @dev Initializes the contract setting the deployer as the initial owner.
     * @param initialOwner Address of the initial owner
     */
    function initialize(
        address initialOwner
    ) initializer public {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    /**
     * @dev Function that should revert when `msg.sender` is not authorized to upgrade the contract.
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}

    /**
     * @dev Updates the address of the staking contract
     * @param _stakingContractAddress New staking contract address
     */
    function updateStakingContractAddress(address _stakingContractAddress) external onlyOwner {
        stakingContractAddress = _stakingContractAddress;
    }

    /**
     * @dev Toggles automatic staking of rewards
     * @param _autoStakeRewards Whether to automatically stake rewards
     */
    function updateAutoStakeRewards(bool _autoStakeRewards) external onlyOwner {
        autoStakeRewards = _autoStakeRewards;
    }

    /**
     * @dev Updates the initial gas drop amount
     * @param _initialGasDrop New initial gas drop amount in wei
     */
    function updateInitialGasDrop(uint256 _initialGasDrop) external onlyOwner {
        initialGasDrop = _initialGasDrop;
        emit InitialGasDropUpdated(initialGasDrop);
    }

    /**
     * @dev Creates a new activity
     * @param name Name of the activity
     */
    function createActivity(string memory name) public onlyOwner {
        require(activities[name].createdAt == 0, "Activity already exists");
        activities[name] = Activity(name, block.timestamp);
        allActivities.push(name);
        emit ActivityCreated(name);
    }

    /**
     * @dev Updates the percentage of rewards to send immediately on claim
     * @param _percentageToSendOnClaim Percentage (0-100) of rewards to send immediately
     */
    function updatePercentageToSendOnClaim(uint256 _percentageToSendOnClaim) public onlyOwner {
        require(_percentageToSendOnClaim >= 0 && _percentageToSendOnClaim <= 100, "Percentage must be between 0 and 100");
        percentageToSendOnClaim = _percentageToSendOnClaim;
    }
    
    /**
     * @dev Updates admin addresses
     * @param _adminAddresses Array of admin addresses
     * @param _allowed Array of boolean values indicating if each address is allowed
     */
    function updateAdminAddresses(address[] memory _adminAddresses, bool[] memory _allowed) public onlyOwner {
        require(_adminAddresses.length == _allowed.length, "Array length mismatch");
        for (uint256 i = 0; i < _adminAddresses.length; i++) {
            adminAddresses[_adminAddresses[i]] = _allowed[i];
        }
    }

    /**
     * @dev Pauses the contract
     */
    function pause() public onlyOwner {
        isPaused = true;
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() public onlyOwner {
        isPaused = false;
    }

    /**
     * @dev Recovers the signer of a message
     * @param addr Address of the user
     * @param amounts Array of reward amounts
     * @param names Array of activity names
     * @param slotId Slot ID
     * @param v V component of the signature
     * @param r R component of the signature
     * @param s S component of the signature
     * @return Address of the signer
     */
    function getSigner(address addr, uint256[] memory amounts, string[] memory names, uint256 slotId, uint8 v, bytes32 r, bytes32 s) public pure returns (address){
            return _ecrecover(keccak256(abi.encodePacked(
            addr,
            slotId,
            keccak256(abi.encode(amounts)),
            keccak256(abi.encode(names))
        )), v, r, s);
    }

    /**
     * @dev Allows users to withdraw their rewards
     * @return Amount of rewards withdrawn
     */
    function withdrawRewards() public returns (uint256) {
        require(!isPaused, "Contract is paused");
        uint256 rewardsToWithdraw = userBalance[msg.sender];
        require(rewardsToWithdraw > 0, "No rewards to withdraw");
        require(address(this).balance >= rewardsToWithdraw, "Contract doesn't have enough balance");
        
        userBalance[msg.sender] = 0;
        payable(msg.sender).transfer(rewardsToWithdraw);
        emit RewardsWithdrawn(msg.sender, rewardsToWithdraw);
        emit BalanceUpdated(msg.sender, userBalance[msg.sender]);
        return rewardsToWithdraw;
    }

    /**
     * @dev Allows users to withdraw and stake their rewards
     */
    function withdrawAndStakeRewards() public {
        require (!isPaused, "Contract is paused");
        require(stakingContractAddress != address(0), "Staking contract address not set");
        uint256 rewardsToWithdraw = userBalance[msg.sender];
        require(rewardsToWithdraw > 0, "No rewards to withdraw");
        require(address(this).balance >= rewardsToWithdraw, "Contract doesn't have enough balance");

        userBalance[msg.sender] = 0;
        IStake(stakingContractAddress).stakeOnBehalf{value: rewardsToWithdraw}(msg.sender);
        emit RewardsWithdrawn(msg.sender, rewardsToWithdraw);
        emit BalanceUpdated(msg.sender, userBalance[msg.sender]);
    }

    /**
     * @dev Internal function to recover the signer of a message
     * @param messageHash Hash of the message
     * @param v V component of the signature
     * @param r R component of the signature
     * @param s S component of the signature
     * @return Address of the signer
     */
    function _ecrecover(bytes32 messageHash, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
        bytes memory prefixedMessage = abi.encodePacked(
        "\x19Ethereum Signed Message:\n32",
        messageHash
        );

        bytes32 digest = keccak256(prefixedMessage);

        return ecrecover(digest, v, r, s);
    }

    /**
     * @dev Allows users to claim rewards for multiple activities
     * @param user Address of the user claiming rewards
     * @param amounts Array of reward amounts
     * @param names Array of activity names
     * @param slotId Slot ID
     * @param v V component of the signature
     * @param r R component of the signature
     * @param s S component of the signature
     */
    function claimActivityRewards(address user, uint256[] memory amounts, string[] memory names, uint256 slotId, uint8 v, bytes32 r, bytes32 s) nonReentrant public {
        require(!isPaused, "Contract is paused");
        require(amounts.length == names.length, "Array length mismatch");
        require(adminAddresses[getSigner(user, amounts, names, slotId, v, r, s)], "Signature is not valid");

        uint256 userBalanceBefore = totalUserRewards[user];
        for (uint256 i = 0; i < names.length; i++) {
            _claimActivityRewards(user, amounts[i], names[i], slotId);
        }

        if (initialGasDrop != 0 && !gasDrops[user] && address(user).balance == 0) {
            payable(user).transfer(initialGasDrop);
            gasDrops[user] = true;
            emit InitialGasDrop(user, initialGasDrop);
        }

        require(totalUserRewards[user] > userBalanceBefore, "Activity rewards already claimed");
        emit BalanceUpdated(user, userBalance[user]);
    }

    /**
     * @dev Internal function to claim rewards for a single activity
     * @param user Address of the user claiming rewards
     * @param amount Amount of rewards
     * @param name Name of the activity
     * @param slotId Slot ID
     */
    function _claimActivityRewards(address user, uint256 amount, string memory name, uint256 slotId) private{
        require(activities[name].createdAt > 0, "Activity not found");
        if (activitySlotRewardsClaimed[name][slotId]){
            return;
        }
        uint256 amountToSend = amount * percentageToSendOnClaim / 100;
        uint256 amountToKeep = amount - amountToSend;
        require(address(this).balance >= amountToSend, "Contract doesn't have enough balance");
        if (amountToSend > 0){
            payable(user).transfer(amountToSend);
        }

        activitySlotRewardsClaimed[name][slotId] = true;

        activityClaimAmount[name][slotId] = amount;
        activityClaimAmountStoredInContract[name][slotId] = amountToKeep;
        
        if (autoStakeRewards && amountToKeep > 0){
            IStake(stakingContractAddress).stakeOnBehalf{value: amountToKeep}(user);
        }
        else{
            userBalance[user] += amountToKeep;
        }
        totalUserRewards[user] += amount;
        emit ActivityRewardsClaimed(name, user, slotId, amount);        
    }

    /**
     * @dev Allows the owner to withdraw all balance in case of emergency
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
    }
}