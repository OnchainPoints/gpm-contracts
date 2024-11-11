// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IStake.sol";

/**
 * @title OnchainPoints
 * @dev A contract for managing on-chain points, activities, and rewards.
 * This contract allows users to claim rewards, spend tokens, and manage their balances.
 * It also includes features for staking, daily spending limits, and delegated spending.
 */
contract OnchainPoints is Initializable, OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;

    /**
     * @dev Struct to represent a spending request
     * @param deadline Timestamp after which the request is no longer valid
     * @param nonce Unique identifier to prevent replay attacks
     * @param amount The amount of tokens to spend
     */
    struct Request {
        uint256 deadline;
        string nonce;
        uint256 amount;
    }

    /**
     * @dev Struct to represent an activity
     * @param name Name of the activity
     * @param lockupEndTimestamp Timestamp when the lockup period ends
     * @param createdAt Timestamp when the activity was created
     */
    struct Activity {
        string name;
        uint256 lockupEndTimestamp;
        uint256 createdAt;
    }

    // Keccak256 hash of the EIP712 typed data for Request
    bytes32 private constant REQUEST_TYPEHASH = keccak256(
        "Request(uint256 deadline,string nonce,uint256 amount)"
    );

    // Maximum daily spending limit as a fraction (numerator/denominator)
    uint256[2] public maxDailySpendingNumDen;

    // Percentage of rewards to send immediately on claim
    uint256 public percentageToSendOnClaim;

    // Maximum cap for daily spending
    uint256 public maxDailySpendingCap;

    // Mapping of activity name to Activity struct
    mapping(string => Activity) public activities;

    // Array of all activity names
    string[] public allActivities;

    // Mapping to track if rewards for an activity have been claimed by a user
    mapping(string => mapping(address => bool)) public activityRewardsClaimed;

    // Mapping to store the amount claimed for each activity by a user
    mapping(string => mapping(address => uint256)) public activityClaimAmount;

    // Mapping to store the remaining amount for each activity by a user
    mapping(string => mapping(address => uint256)) public activityRemainingAmount;

    // Mapping to track if rewards for an activity have been withdrawn by a user
    mapping(string => mapping(address => bool)) public activityRewardsWithdrawn;

    // Mapping to store the list of activities for each user
    mapping(address => string[]) public userActivities;

    // Flag to pause/unpause the contract
    bool public isPaused;

    // Mapping to store user balances
    mapping(address => uint256) public userBalance;

    // Mapping to store deposited balances
    mapping(address => uint256) public depositedBalance;

    // Mapping to store reference user balances (used for daily spending limit calculations)
    mapping(address => uint256) public referenceUserBalance;

    // Mapping to store daily spendings for each user
    mapping(uint256 => mapping(address => uint256)) public dailySpendings;

    // Mapping to store authorized addresses
    mapping(address => bool) public authorizedAddresses;

    // Mapping to store admin addresses
    mapping(address => bool) public adminAddresses;

    // Mapping to track used nonces
    mapping(address => mapping(bytes32 => bool)) public nonces;

    // Events
    event ActivityCreated(string name);
    event ActivityClaimed(string name, address user, uint256 amount);
    event AuthorizedAddressUpdated(address authorizedAddress, bool allowed);
    event BalanceUpdated(address user, uint256 amount);
    event ReferenceBalanceUpdated(address user, uint256 amount);
    event MaxSpendingUpdated(uint256[2] maxSpendingNumDen);
    event TokenSpent(address user, uint256 amount, uint256 dayId);

    // Address of the staking contract
    address public stakingContractAddress;

    // Mapping to track spent staking points for each user
    mapping(address => uint256) public spentStakingPoints;

    // Total points issued
    uint256 public totalPointsIssued;

    // Remaining points available
    uint256 public remainingPoints;

    /**
     * @dev Struct to represent a delegated spending request
     * @param deadline Timestamp after which the request is no longer valid
     * @param nonce Unique identifier to prevent replay attacks
     * @param amount The amount of tokens to spend
     * @param owner The address of the token owner
     */
    struct DelegatedRequest {
        uint256 deadline;
        string nonce;
        uint256 amount;
        address owner;
    }

    // Keccak256 hash of the EIP712 typed data for DelegatedRequest
    bytes32 private constant DELEGATED_REQUEST_TYPEHASH = keccak256(
        "DelegatedRequest(uint256 deadline,string nonce,uint256 amount,address owner)"
    );

    // Mapping for allowances (owner => spender => amount)
    mapping(address => mapping(address => uint256)) public allowances;

    // Events
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposited(address user, uint256 amount);
    event Withdrawn(address user, uint256 amount);
    event DepositedTokensSpent(address user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
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
        __EIP712_init("OnchainPointsContract", "0.1");
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
    }

    /**
     * @dev Returns the total balance of a user, including staking points
     * @param user The address of the user
     * @return The total balance
     */
    function getTotalBalance(address user) public view returns(uint256) {
        return userBalance[user] + getRemainingPointsEarnedFromStaking(user);
    }

    /**
     * @dev Internal function to authorize an upgrade
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal onlyOwner override {}

    /**
     * @dev Allows a user to deposit Ether into their account
     */
    function deposit() public payable {
        depositedBalance[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @dev Allows a user to withdraw Ether from their account
     * @param amount The amount to withdraw
     */
    function withdraw(uint256 amount) public {
        require(amount > 0, "Amount must be greater than 0");
        require(depositedBalance[msg.sender] >= amount, "Insufficient balance");
        depositedBalance[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Sets the address of the staking contract
     * @param _stakingContractAddress The address of the staking contract
     */
    function setStakingContractAddress(address _stakingContractAddress) public onlyOwner {
        stakingContractAddress = _stakingContractAddress;
    }

    /**
     * @dev Updates the maximum daily spending cap
     * @param _maxDailySpendingCap The new maximum daily spending cap
     */
    function updateMaxDailySpendingCap(uint256 _maxDailySpendingCap) public onlyOwner {
        maxDailySpendingCap = _maxDailySpendingCap;
    }

    /**
     * @dev Creates a new activity
     * @param name The name of the activity
     * @param lockupDays The number of days for the lockup period
     */
    function createActivity(string memory name, uint256 lockupDays) public onlyOwner {
        require(activities[name].createdAt == 0, "Activity already exists");
        uint256 lockupEndTimestamp = block.timestamp + lockupDays * 86400;
        activities[name] = Activity(name, lockupEndTimestamp, block.timestamp);
        allActivities.push(name);
        emit ActivityCreated(name);
    }

    /**
     * @dev Sets the maximum daily spending limit
     * @param _maxDailySpendingNumDen An array containing the numerator and denominator for the spending limit fraction
     */
    function setMaxDailySpending(uint256[2] memory _maxDailySpendingNumDen) public onlyOwner {
        require(_maxDailySpendingNumDen[0] > 0, "Max daily spending must be greater than 0");
        require(_maxDailySpendingNumDen[1] > 0, "Max daily spending denominator must be greater than 0");
        maxDailySpendingNumDen = _maxDailySpendingNumDen;
        emit MaxSpendingUpdated(_maxDailySpendingNumDen);
    }

    /**
     * @dev Updates the percentage of rewards to send immediately on claim
     * @param _percentageToSendOnClaim The new percentage (0-100)
     */
    function updatePercentageToSendOnClaim(uint256 _percentageToSendOnClaim) public onlyOwner {
        require(_percentageToSendOnClaim >= 0 && _percentageToSendOnClaim <= 100, "Percentage must be between 1 and 100");
        percentageToSendOnClaim = _percentageToSendOnClaim;
    }

    /**
     * @dev Updates the admin status for multiple addresses
     * @param _adminAddresses Array of addresses to update
     * @param _allowed Array of boolean values indicating admin status
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
     * @dev Recovers the signer's address from a signed message
     * @param addr The address that was signed
     * @param amounts Array of amounts that were signed
     * @param names Array of activity names that were signed
     * @param v The recovery byte of the signature
     * @param r The R component of the signature
     * @param s The S component of the signature
     * @return The recovered signer's address
     */
    function getSigner(address addr, uint256[] memory amounts, string[] memory names, uint8 v, bytes32 r, bytes32 s) public pure returns(address) {
        return _ecrecover(keccak256(abi.encodePacked(
            addr,
            keccak256(abi.encode(amounts)),
            keccak256(abi.encode(names))
        )), v, r, s);
    }

    /**
     * @dev Internal function to withdraw rewards for a specific activity
     * @param name The name of the activity
     */
    function withdrawActivityRewards(string memory name) private {
        require(!isPaused, "Contract is paused");
        require(activities[name].createdAt > 0, "Activity not found");

        if (!activityRewardsClaimed[name][msg.sender] || activities[name].lockupEndTimestamp > block.timestamp || activityRewardsWithdrawn[name][msg.sender]) {
            // not reverting here because this function might be called in a loop
            return;
        }

        uint256 maxWithdrawAmount = activityRemainingAmount[name][msg.sender];
        referenceUserBalance[msg.sender] -= maxWithdrawAmount;

        if (userBalance[msg.sender] < maxWithdrawAmount) {
            maxWithdrawAmount = userBalance[msg.sender];
        }

        require(address(this).balance >= maxWithdrawAmount, "Contract doesn't have enough balance");

        activityRewardsWithdrawn[name][msg.sender] = true;

        userBalance[msg.sender] -= maxWithdrawAmount;
        activityRemainingAmount[name][msg.sender] = 0;

        payable(msg.sender).transfer(maxWithdrawAmount);

        emit BalanceUpdated(msg.sender, userBalance[msg.sender]);
    }

    /**
     * @dev Allows a user to withdraw rewards for multiple activities
     * @param names Array of activity names to withdraw rewards from
     */
    function withdrawRewards(string[] memory names) nonReentrant public {
        for (uint256 i = 0; i < names.length; i++) {
            withdrawActivityRewards(names[i]);
        }
    }

    /**
     * @dev Calculates the total withdrawable balance for a user across multiple activities
     * @param names Array of activity names
     * @param user The address of the user
     * @return The total withdrawable balance
     */
    function withdrawableBalance(string[] memory names, address user) public view returns(uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < names.length; i++) {
            total += withdrawableBalanceForActivity(names[i], user);
        }
        if (total > userBalance[user]) {
            total = userBalance[user];
        }
        return total;
    }

    /**
     * @dev Calculates the withdrawable balance for a user for a specific activity
     * @param name The name of the activity
     * @param user The address of the user
     * @return The withdrawable balance for the activity
     */
    function withdrawableBalanceForActivity(string memory name, address user) public view returns(uint256) {
        if (!activityRewardsClaimed[name][user]) {
            return 0;
        }
        if (activities[name].lockupEndTimestamp > block.timestamp) {
            return 0;
        }
        if (activityRewardsWithdrawn[name][user]) {
            return 0;
        }
        uint256 maxWithdrawAmount = activityRemainingAmount[name][user];

        if (userBalance[user] < maxWithdrawAmount) {
            maxWithdrawAmount = userBalance[user];
        }
        return maxWithdrawAmount;
    }

    /**
     * @dev Internal function to recover an address from a signed message
     * @param messageHash The hash of the message that was signed
     * @param v The recovery byte of the signature
     * @param r The R component of the signature
     * @param s The S component of the signature
     * @return The recovered address
     */
    function _ecrecover(bytes32 messageHash, uint8 v, bytes32 r, bytes32 s) internal pure returns(address) {
        // Compute the EIP-191 prefixed message
        bytes memory prefixedMessage = abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        );

        // Compute the message digest
        bytes32 digest = keccak256(prefixedMessage);

        // Use the native ecrecover provided by the EVM
        return ecrecover(digest, v, r, s);
    }

    /**
     * @dev Allows a user to claim rewards for multiple activities
     * @param user The address of the user claiming rewards
     * @param amounts Array of reward amounts for each activity
     * @param names Array of activity names
     * @param v The recovery byte of the signature
     * @param r The R component of the signature
     * @param s The S component of the signature
     */
    function claimActivityRewards(address user, uint256[] memory amounts, string[] memory names, uint8 v, bytes32 r, bytes32 s) nonReentrant public {
        require(!isPaused, "Contract is paused");
        require(amounts.length == names.length, "Array length mismatch");
        require(adminAddresses[getSigner(user, amounts, names, v, r, s)], "Signature is not valid");

        uint256 userBalanceBefore = userBalance[user];
        for (uint256 i = 0; i < names.length; i++) {
            _claimActivityRewards(user, amounts[i], names[i]);
        }

        require(userBalance[user] > userBalanceBefore, "Activity rewards already claimed");
        emit BalanceUpdated(user, userBalance[user]);
    }

    /**
     * @dev Internal function to claim rewards for a single activity
     * @param user The address of the user claiming rewards
     * @param amount The amount of rewards to claim
     * @param name The name of the activity
     */
    function _claimActivityRewards(address user, uint256 amount, string memory name) private {
        require(activities[name].createdAt > 0, "Activity not found");
        if (activityRewardsClaimed[name][user]) {
            return;
        }
        uint256 amountToSend = amount * percentageToSendOnClaim / 100;
        uint256 amountToKeep = amount - amountToSend;
        require(address(this).balance >= amountToSend, "Contract doesn't have enough balance");
        if (amountToSend > 0) {
            payable(user).transfer(amountToSend);
        }

        activityRewardsClaimed[name][user] = true;

        activityClaimAmount[name][user] = amount;
        activityRemainingAmount[name][user] = amountToKeep;
        userActivities[user].push(name);

        userBalance[user] += amountToKeep;
        referenceUserBalance[user] += amountToKeep;
        emit ActivityClaimed(name, user, amount);
    }

    /**
     * @dev Allows the owner to update a user's balance
     * @param user The address of the user
     * @param amount The new balance amount
     */
    function adminUpdateBalance(address user, uint256 amount) public onlyOwner {
        userBalance[user] = amount;
        emit BalanceUpdated(user, userBalance[user]);
    }

    /**
     * @dev Allows the owner to update a user's reference balance
     * @param user The address of the user
     * @param amount The new reference balance amount
     */
    function adminUpdateReferenceBalance(address user, uint256 amount) public onlyOwner {
        referenceUserBalance[user] = amount;
        emit ReferenceBalanceUpdated(user, referenceUserBalance[user]);
    }

    /**
     * @dev Allows the owner to update balances for multiple users
     * @param users Array of user addresses
     * @param amounts Array of balance amounts
     */
    function adminUpdateBalanceBatch(address[] memory users, uint256[] memory amounts) public onlyOwner {
        require(users.length == amounts.length, "Array length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            adminUpdateBalance(users[i], amounts[i]);
        }
    }

    /**
     * @dev Adds an authorized address
     * @param _authorizedAddress The address to authorize
     */
    function addAuthorizedAddress(address _authorizedAddress) public onlyOwner {
        authorizedAddresses[_authorizedAddress] = true;
        emit AuthorizedAddressUpdated(_authorizedAddress, true);
    }

    /**
     * @dev Removes an authorized address
     * @param _authorizedAddress The address to remove authorization from
     */
    function removeAuthorizedAddress(address _authorizedAddress) public onlyOwner {
        authorizedAddresses[_authorizedAddress] = false;
        emit AuthorizedAddressUpdated(_authorizedAddress, false);
    }

    /**
     * @dev Internal function to get a user's total balance
     * @param user The address of the user
     * @return The total balance including staking points and deposited balance
     */
    function _getUserTotalBalance(address user) private view returns(uint256) {
        return userBalance[user] + spendableStakingPoints(user) + depositedBalance[user];
    }

    /**
     * @dev Verifies a spending request
     * @param request The spending request to verify
     * @param signature The signature of the request
     * @return spender The address of the spender
     */
    function verify(
        Request calldata request,
        bytes calldata signature
    ) public view returns(address spender) {
        require(!isPaused, "Contract is paused");
        bytes32 requestHash = hashRequest(request);
        spender = recoverAddress(requestHash, signature);
        require(authorizedAddresses[msg.sender], "Unauthorized address");
        require(getAvailableSpending(spender) >= request.amount, "Daily spending limit exceeded");
        require(_getUserTotalBalance(spender) >= request.amount, "Insufficient balance");
        require(nonces[spender][_hashTypedDataV4(keccak256(bytes(request.nonce)))] == false, "Nonce already used");
        require(block.timestamp < request.deadline, "Signature Expired!");
        return spender;
    }

    /**
     * @dev Hashes a spending request
     * @param request The spending request to hash
     * @return The hash of the request
     */
    function hashRequest(Request calldata request) private view returns(bytes32) {
        bytes32 requestHash = _hashTypedDataV4(keccak256(
            abi.encode(
                REQUEST_TYPEHASH,
                request.deadline,
                keccak256(bytes(request.nonce)),
                request.amount
            )
        ));
        return requestHash;
    }

    /**
     * @dev Recovers the address from a signed message hash
     * @param messageHash The hash of the message that was signed
     * @param signature The signature
     * @return The recovered address
     */
    function recoverAddress(bytes32 messageHash, bytes calldata signature) public pure returns(address) {
        return messageHash.recover(signature);
    }

    /**
     * @dev Gets the points earned from staking for a user
     * @param user The address of the user
     * @return The amount of points earned from staking
     */
    function getPointsEarnedFromStaking(address user) public view returns(uint256) {
        if (stakingContractAddress == address(0)) {
            return 0;
        }
        return IStake(stakingContractAddress).earnedUserPoints(user);
    }

    /**
     * @dev Gets the remaining points earned from staking for a user
     * @param user The address of the user
     * @return The amount of remaining points earned from staking
     */
    function getRemainingPointsEarnedFromStaking(address user) public view returns(uint256) {
        if (spentStakingPoints[user] > getPointsEarnedFromStaking(user)) {
            return 0;
        }
        return getPointsEarnedFromStaking(user) - spentStakingPoints[user];
    }

    /**
     * @dev Calculates the spendable staking points for a user
     * @param user The address of the user
     * @return The amount of spendable staking points
     */
    function spendableStakingPoints(address user) public view returns(uint256) {
        if (remainingPoints > getRemainingPointsEarnedFromStaking(user)) {
            return getRemainingPointsEarnedFromStaking(user);
        } else {
            return remainingPoints;
        }
    }

    /**
     * @dev Adds staked points to the contract
     */
    function addStakedPoints() public payable {
        totalPointsIssued += msg.value;
        remainingPoints += msg.value;
    }

    /**
     * @dev Calculates the available spending for a user
     * @param spender The address of the spender
     * @return The amount available for spending
     */
    function getAvailableSpending(address spender) public view returns(uint256) {
        uint256 userBalanceAmount = _getUserTotalBalance(spender);
        // Check for potential overflow in multiplication and division
        if (maxDailySpendingNumDen[1] == 0) {
            return 0; // To avoid division by zero
        }

        uint256 maxDailySpending = getMaxDailySpending(spender);
        uint256 userSpendings = dailySpendings[block.timestamp / 86400][spender];

        // Safely calculate remaining daily limit
        uint256 dailyLimitRemaining = (maxDailySpending > userSpendings) ? maxDailySpending - userSpendings : 0;
        // Return the minimum of dailyLimitRemaining and userBalanceAmount
        return (dailyLimitRemaining < userBalanceAmount) ? dailyLimitRemaining : userBalanceAmount;
    }

    /**
     * @dev Calculates the maximum daily spending for a user
     * @param user The address of the user
     * @return The maximum daily spending amount
     */
    function getMaxDailySpending(address user) public view returns(uint256) {
        // NOTE: using referenceUserBalance instead of userBalance to calculate daily limit because userBalance is updated after the transaction
        uint256 dailySpending = (maxDailySpendingNumDen[0] * (referenceUserBalance[user] + getPointsEarnedFromStaking(user))) / maxDailySpendingNumDen[1];

        return (dailySpending < maxDailySpendingCap) ? dailySpending : maxDailySpendingCap;
    }

    /**
     * @dev Allows the owner to withdraw all balance in case of emergency
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
    }

    /**
     * @dev Spends tokens based on a signed request
     * @param request The spending request
     * @param signature The signature of the request
     * @return spender The address of the spender
     */
    function spendToken(
        Request calldata request,
        bytes calldata signature
    ) external nonReentrant returns(address spender) {
        spender = verify(request, signature);
        _spendTokens(spender, spender, request.amount);
        return spender;
    }

    /**
     * @dev Spends tokens without requiring a signature
     * @param amount The amount of tokens to spend
     */
    function spendTokenWithoutSignature(
        uint256 amount
    ) nonReentrant external {
        address spender = tx.origin;
        require(!isPaused, "Contract is paused");
        require(authorizedAddresses[msg.sender], "Unauthorized address");
        require(getAvailableSpending(spender) >= amount, "Daily spending limit exceeded");
        require(_getUserTotalBalance(spender) >= amount, "Insufficient balance");

        _spendTokens(spender, spender, amount);
    }

    /**
     * @dev Approves a spender to spend tokens on behalf of the owner
     * @param spender The address of the spender
     * @param amount The amount of tokens to approve
     */
    function approve(address spender, uint256 amount) external {
        allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
    }

    /**
     * @dev Returns the amount of tokens approved by the owner to be spent by the spender
     * @param owner The address of the token owner
     * @param spender The address of the spender
     * @return The amount of tokens approved
     */
    function allowance(address owner, address spender) public view returns(uint256) {
        return allowances[owner][spender];
    }

    /**
     * @dev Verifies a delegated spending request
     * @param request The delegated spending request
     * @param signature The signature of the request
     * @return spender The address of the spender
     */
    function verifyDelegated(
        DelegatedRequest calldata request,
        bytes calldata signature
    ) public view returns(address spender) {
        require(!isPaused, "Contract is paused");
        bytes32 requestHash = hashDelegatedRequest(request);
        spender = recoverAddress(requestHash, signature);
        require(authorizedAddresses[msg.sender], "Unauthorized address");
        require(getAvailableSpending(request.owner) >= request.amount, "Daily spending limit exceeded");
        require(_getUserTotalBalance(request.owner) >= request.amount, "Insufficient balance");
        require(nonces[spender][_hashTypedDataV4(keccak256(bytes(request.nonce)))] == false, "Nonce already used");
        require(block.timestamp < request.deadline, "Signature Expired!");
        return spender;
    }

    /**
     * @dev Hashes a delegated spending request
     * @param request The delegated spending request to hash
     * @return The hash of the request
     */
    function hashDelegatedRequest(DelegatedRequest calldata request) private view returns(bytes32) {
        return _hashTypedDataV4(keccak256(
            abi.encode(
                DELEGATED_REQUEST_TYPEHASH,
                request.deadline,
                keccak256(bytes(request.nonce)),
                request.amount,
                request.owner
            )
        ));
    }

    /**
     * @dev Spends tokens on behalf of another user
     * @param request The delegated spending request
     * @param signature The signature of the request
     */
    function spendTokensOnBehalf(
        DelegatedRequest calldata request,
        bytes calldata signature
    ) external nonReentrant {
        address spender = verifyDelegated(request, signature);
        require(allowances[request.owner][spender] >= request.amount, "Insufficient allowance");

        _spendTokens(request.owner, spender, request.amount);

        nonces[spender][_hashTypedDataV4(keccak256(bytes(request.nonce)))] = true;
    }

    /**
     * @dev Spends tokens on behalf of another user without requiring a signature
     * @param amount The amount of tokens to spend
     * @param owner The address of the token owner
     */
    function spendTokensOnBehalfWithoutSignature(
        uint256 amount,
        address owner
    ) nonReentrant external {
        address spender = tx.origin;
        require(!isPaused, "Contract is paused");
        require(getAvailableSpending(owner) >= amount, "Daily spending limit exceeded");
        require(_getUserTotalBalance(owner) >= amount, "Insufficient balance");
        require(allowances[owner][spender] >= amount, "Insufficient allowance");
        require(authorizedAddresses[msg.sender], "Unauthorized address");

        _spendTokens(owner, spender, amount);

    }

    /**
     * @dev Internal function to spend tokens on behalf of a user
     * @param owner The address of the token owner
     * @param spender The address of the spender
     * @param amount The amount of tokens to spend
     */
    function _spendTokens(address owner, address spender, uint256 amount) private {
        uint256 userPoints = spendableStakingPoints(owner);
        
        // Check if the amount to spend is greater than available staking points
        if (amount > userPoints) {
            // Use all available staking points
            spentStakingPoints[owner] += userPoints;
            remainingPoints -= userPoints;
            uint256 remainingAmount = amount - userPoints;

            // Check if user balance is sufficient for the remaining amount
            if (userBalance[owner] >= remainingAmount) {
                userBalance[owner] = userBalance[owner] - remainingAmount;
            } else {
                // Use deposited balance if user balance is insufficient
                uint256 depositedAmountToUse = remainingAmount - userBalance[owner];
                userBalance[owner] = 0;
                depositedBalance[owner] = depositedBalance[owner] - depositedAmountToUse;
                emit DepositedTokensSpent(owner, depositedAmountToUse);
            }
        } else {
            // If amount is less than or equal to available staking points, use only staking points
            spentStakingPoints[owner] += amount;
            remainingPoints -= amount;
        }

        // Update daily spending for the user
        dailySpendings[block.timestamp / 86400][owner] = dailySpendings[block.timestamp / 86400][owner] + amount;
        
        // Transfer the amount to the message sender
        payable(msg.sender).transfer(amount);

        // Update allowance if spender is not the owner
        if (spender != owner) {
            allowances[owner][spender] -= amount;
        }

        // Emit event for token spent
        emit TokenSpent(owner, amount, block.timestamp / 86400);
    }

}