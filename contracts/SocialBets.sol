// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./OracleContract.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SocialBets
 * @dev A contract for managing social bets with daily spending limits and gas drops for new users.
 * This contract is upgradeable and uses OpenZeppelin's upgradeable contracts.
 */
contract SocialBets is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Mappings
    mapping(address => bool) public oracleContracts;
    mapping(uint256 => mapping(address => uint256)) public dailySocialSpendings;
    mapping(address => bool) public gasDrops;
    mapping(address => uint256) public userTotalSpendings;

    // Set to store social spender addresses
    EnumerableSet.AddressSet private socialSpenderSet;

    // Configuration variables
    uint256 public maxBuyAmount;
    uint256 public maxDailySocialSpending;
    uint256 public initialGasDrop; // Initial gas drop in wei
    uint256 public maxSpendingCapPerUser;

    // Events
    event MaxSpendingCapPerUserUpdated(uint256 maxSpendingCap);
    event MaxSocialSpendingUpdated(uint256 maxSpending);
    event SocialTokenSpent(address user, uint256 amount, uint256 dayId);
    event InitialGasDropUpdated(uint256 initialGasDrop);
    event InitialGasDrop(address user, uint256 amount);
    event SocialSpendersUpdated(address[] spenders, bool[] status);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Modifier to restrict function access to social spenders only
     */
    modifier onlySocialSpender() {
        require(socialSpenderSet.contains(tx.origin) || socialSpenderSet.contains(msg.sender), "Only social spender can call this function");
        _;
    }

    /**
     * @dev Fallback function to receive Ether
     */
    receive() external payable {}

    /**
     * @dev Initializes the contract
     * @param initialOwner The address of the initial owner
     */
    function initialize(address initialOwner) initializer public {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    /**
     * @dev Function to authorize upgrades, can only be called by the owner
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}

    /**
     * @dev Sets the maximum spending cap per user
     * @param _newSpendingCap The new maximum spending cap
     */
    function setMaxSpendingCapPerUser(uint256 _newSpendingCap) public onlyOwner {
        maxSpendingCapPerUser = _newSpendingCap;
        emit MaxSpendingCapPerUserUpdated(_newSpendingCap);
    }

    /**
     * @dev Calculates the maximum daily spending for a user
     * @param user The address of the user
     * @return The maximum daily spending amount
     */
    function getMaxDailySpending(address user) public view returns (uint256) {
        uint256 totalSpendings = userTotalSpendings[user];
        
        if (totalSpendings > maxSpendingCapPerUser) {
            return 0;
        }
        
        uint256 remainingCap = maxSpendingCapPerUser - totalSpendings;
        
        return (remainingCap > maxDailySocialSpending) ? maxDailySocialSpending : remainingCap;
    }

    /**
     * @dev Calculates the available spending for a user
     * @param spender The address of the spender
     * @return The available spending amount
     */
    function getAvailableSpending(address spender) public view returns (uint256) {
        uint256 maxDailySpending = getMaxDailySpending(spender);
        uint256 userSpendings = dailySocialSpendings[block.timestamp / 86400][spender];

        return (maxDailySpending > userSpendings) ? maxDailySpending - userSpendings : 0;
    }

    /**
     * @dev Updates the initial gas drop amount
     * @param _initialGasDrop The new initial gas drop amount
     */
    function updateInitialGasDrop(uint256 _initialGasDrop) external onlyOwner {
        initialGasDrop = _initialGasDrop;
        emit InitialGasDropUpdated(initialGasDrop);
    }

    /**
     * @dev Sets the maximum daily social spending
     * @param _maxDailySocialSpending The new maximum daily social spending
     */
    function setMaxDailySocialSpending(uint256 _maxDailySocialSpending) public onlyOwner {
        maxDailySocialSpending = _maxDailySocialSpending;
        emit MaxSocialSpendingUpdated(_maxDailySocialSpending);
    }    

    /**
     * @dev Adds an oracle contract to the list of authorized oracles
     * @param _oracleContract The address of the oracle contract to add
     */
    function addOracleContract(address _oracleContract) public onlyOwner {
        oracleContracts[_oracleContract] = true;
    }

    /**
     * @dev Updates the maximum buy amount
     * @param _maxBuyAmount The new maximum buy amount
     */
    function updateMaxBuyAmount(uint256 _maxBuyAmount) public onlyOwner {
        maxBuyAmount = _maxBuyAmount;
    }

    /**
     * @dev Updates the list of social spenders
     * @param _spenders Array of spender addresses
     * @param _status Array of boolean statuses corresponding to spenders
     */
    function updateSocialSpenders(address[] calldata _spenders, bool[] calldata _status) external onlyOwner {
        require(_spenders.length == _status.length, "Array length mismatch");
        for (uint256 i = 0; i < _spenders.length; i++) {
            if (_status[i]) {
                socialSpenderSet.add(_spenders[i]);
            } else {
                socialSpenderSet.remove(_spenders[i]);
            }
        }
        emit SocialSpendersUpdated(_spenders, _status);
    }

    /**
     * @dev Retrieves the list of social spenders
     * @return An array of social spender addresses
     */
    function getSocialSpenders() public view returns (address[] memory) {
        address[] memory spenders = new address[](socialSpenderSet.length());
        for (uint256 i = 0; i < socialSpenderSet.length(); i++) {
            spenders[i] = socialSpenderSet.at(i);
        }
        return spenders;
    }

    /**
     * @dev Buys a position in a prediction market
     * @param questionId The ID of the question
     * @param outcomeIndex The index of the outcome to buy
     * @param minOutcomeTokensToBuy The minimum number of outcome tokens to buy
     * @param amount The amount to spend
     * @param to The address to receive the position
     * @param _oracleContract The address of the oracle contract
     */
    function buyPosition(
        bytes32 questionId, 
        uint256 outcomeIndex, 
        uint256 minOutcomeTokensToBuy, 
        uint256 amount, 
        address to, 
        PredictionsOracle _oracleContract
    ) external payable onlySocialSpender {
        require(dailySocialSpendings[block.timestamp/86400][to] + amount <= maxDailySocialSpending, "Daily social spending limit exceeded");
        require(amount <= maxBuyAmount, "Amount exceeds maximum buy amount");
        require(amount <= getAvailableSpending(to), "Amount exceeds available spending");
        require(oracleContracts[address(_oracleContract)], "Unauthorized oracle contract");

        uint256 totalAmount = amount;
        bool gasDrop = false;

        if (initialGasDrop != 0 && !gasDrops[to] && address(to).balance == 0) {
            totalAmount += initialGasDrop;
            gasDrop = true;
        }

        if (msg.value < totalAmount) {
            uint256 remainder = totalAmount - msg.value;
            require(address(this).balance >= remainder, "Insufficient balance in contract to cover total amount");
        } else {
            require(msg.value == totalAmount, "Incorrect amount sent");
        }
        
        PredictionsOracle oracle = PredictionsOracle(_oracleContract);

        dailySocialSpendings[block.timestamp/86400][to] = dailySocialSpendings[block.timestamp/86400][to] + amount;
        userTotalSpendings[to] = userTotalSpendings[to] + amount;
        
        oracle.buyPosition{value: amount}(questionId, outcomeIndex, minOutcomeTokensToBuy, to);

        // send gas drop if user has not received any gas drop and doesn't have any balance
        if (gasDrop) {
            payable(to).transfer(initialGasDrop);
            gasDrops[to] = true;
            emit InitialGasDrop(to, initialGasDrop);
        }

        emit SocialTokenSpent(to, amount, block.timestamp/86400);
    }

    /**
     * @dev Emergency function to withdraw all balance, can only be called by the owner
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
    }
}