// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./ConditionalTokens.sol";
import "./interfaces/IFactory.sol";
import "./FixedProductMarketMaker.sol";
import "./WPOP.sol";
import "./OnchainPoints.sol";

/**
 * @title PredictionsOracle
 * @dev A contract for managing prediction markets, including market creation, buying/selling positions, and resolving markets.
 * This contract is upgradeable and uses OpenZeppelin's upgradeable contracts.
 */
contract PredictionsOracle is Initializable, OwnableUpgradeable, ERC1155HolderUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // External contract interfaces
    ConditionalTokens public conditionalTokens;
    IFactory public FPMMFactory;
    WPOP public collateralToken;

    address payable onchainPointsAddress;

    // Structs to store market data
    struct QuestionData {
        uint256 beginTimestamp;
        uint256 endTimestamp;
        uint256 outcomeSlots;
        address fpmm;
        bytes32 conditionId;
    }

    struct AnswerData {
        uint256[] payouts;
        uint256 answerTimestamp;
        string answerCid;
    }

    struct MarketData {
        QuestionData questionData;
        AnswerData answerData;
        uint256 uniqueBuys;
        uint256[] probabilities;
        uint256[] buyAmounts;
    }

    // Events
    event InitializerUpdated(address initializerAddress, bool allowed);
    event ProposerUpdated(address proposerAddress, bool allowed);
    event AnswerProposed(bytes32 questionId, uint256[] payouts, address proposer, string answerCid);
    event MarketResolved(bytes32 questionId, uint256[] payouts, address resolver, string answerCid);
    event FundingRecovered(bytes32 questionId, uint256 amountRecovered, address recipient);
    event BuyPosition(
        address indexed wallet,
        address indexed fpmmAddress,
        bytes32 indexed questionId,
        uint256 investmentAmount,
        uint256 feeAmount,
        uint256 outcomeIndex,
        uint256 outcomeTokensBought
    );
    event RedeemPosition(
        address indexed wallet,
        address indexed fpmmAddress,
        bytes32 indexed questionId,
        uint256[] indexSets,
        uint256 totalPayout
    );
    event SellPosition(
        address indexed wallet,
        address indexed fpmmAddress,
        bytes32 indexed questionId,
        uint256 returnAmount,
        uint256 outcomeIndex,
        uint256 outcomeTokensSold
    );

    // Constants and configuration variables
    uint constant ONE = 10**18;
    uint256 public stopTradingBeforeMarketEnd;
    uint256 public minBuyAmount;
    uint256 public maxBuyAmountPerQuestion;
    bytes32 parentCollectionId;
    bool public sellEnabled;
    bool public buyWithUnlockedEnabled;

    // Sets to store initializers and proposers
    EnumerableSet.AddressSet private initializerSet;
    EnumerableSet.AddressSet private proposerSet;

    // Mappings to store market and user data
    mapping(bytes32 => QuestionData) public questions;
    mapping(address => uint256) public userSpendings;
    mapping(address => uint256) public userRedeemed;
    mapping(address => EnumerableSet.Bytes32Set) private userOpenPositions;
    mapping(bytes32 => AnswerData) public answers;
    mapping(bytes32 => mapping(address => uint256)) public userBuyAmounts;
    
    // Modifiers
    modifier onlyProposer {
      require(proposerSet.contains(msg.sender), "Only proposer can call this function.");
      _;
    }

    modifier onlyInitializer {
      require(initializerSet.contains(msg.sender), "Only initializer can call this function.");
      _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() payable external {}

    /**
     * @dev Initializes the contract
     * @param initialOwner The address of the initial owner
     */
    function initialize(address initialOwner) initializer public {
        __Ownable_init(initialOwner);
        __ERC1155Holder_init();
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
     * @dev Updates the addresses of external contracts
     * @param conditionalTokensAddress Address of the ConditionalTokens contract
     * @param FPMMFactoryAddress Address of the FixedProductMarketMaker factory
     * @param collateralTokenAddress Address of the collateral token (WPOP)
     * @param _onchainPointsAddress Address of the OnchainPoints contract
     */
    function updateContracts(
        address conditionalTokensAddress,
        address FPMMFactoryAddress,
        address collateralTokenAddress,
        address _onchainPointsAddress
    ) external onlyOwner {
        conditionalTokens = ConditionalTokens(conditionalTokensAddress);
        FPMMFactory = IFactory(FPMMFactoryAddress);
        collateralToken = WPOP(collateralTokenAddress);
        onchainPointsAddress = payable(_onchainPointsAddress);
        parentCollectionId = bytes32(0);
    }

    /**
     * @dev Updates the minimum buy amount
     * @param _minBuyAmount The new minimum buy amount
     */
    function updateMinBuyAmount(uint256 _minBuyAmount) external onlyOwner {
        minBuyAmount = _minBuyAmount;
    }

    /**
     * @dev Enables or disables buying with unlocked tokens
     * @param _buyWithUnlockedEnabled Whether buying with unlocked tokens is enabled
     */
    function updateBuyWithUnlockedEnabled(bool _buyWithUnlockedEnabled) external onlyOwner {
        buyWithUnlockedEnabled = _buyWithUnlockedEnabled;
    }

    /**
     * @dev Updates the time before market end when trading should stop
     * @param _stopTradingBeforeMarketEnd The new stop trading time
     */
    function updateStopTradingBeforeMarketEnd(uint256 _stopTradingBeforeMarketEnd) external onlyOwner {
        stopTradingBeforeMarketEnd = _stopTradingBeforeMarketEnd;
    }

    /**
     * @dev Gets the remaining buy amount for a user on a specific question
     * @param questionId The ID of the question
     * @param spender The address of the spender
     * @return The remaining buy amount
     */
    function getRemainingBuyAmount(bytes32 questionId, address spender) external view returns (uint256) {
        return maxBuyAmountPerQuestion - userBuyAmounts[questionId][spender];
    }

    /**
     * @dev Updates the maximum buy amount per question
     * @param _maxBuyAmountPerQuestion The new maximum buy amount per question
     */
    function updateMaxBuyAmountPerQuestion(uint256 _maxBuyAmountPerQuestion) external onlyOwner {
        maxBuyAmountPerQuestion = _maxBuyAmountPerQuestion;
    }

    /**
     * @dev Enables or disables selling positions
     * @param _sellEnabled Whether selling is enabled
     */
    function updateSellEnabled(bool _sellEnabled) external onlyOwner {
        sellEnabled = _sellEnabled;
    }

    /**
     * @dev Gets the open positions for a user
     * @param user The address of the user
     * @return An array of question IDs representing open positions
     */
    function getUserOpenPositions(address user) public view returns (bytes32[] memory) {
        bytes32[] memory openPositions = new bytes32[](userOpenPositions[user].length());
        for (uint256 i = 0; i < userOpenPositions[user].length(); i++) {
            openPositions[i] = userOpenPositions[user].at(i);
        }
        return openPositions;
    }

    /**
     * @dev Creates a new prediction market
     * @param endTimestamp The end timestamp of the market
     * @param questionId The ID of the question
     * @param outcomeSlots The number of outcome slots
     * @param fee The fee for the market
     * @param distributionHints Hints for initial token distribution
     * @param initialFunding The initial funding amount
     * @return The address of the created FixedProductMarketMaker
     */
    function createMarket(
        uint256 endTimestamp, 
        bytes32 questionId, 
        uint256 outcomeSlots,
        uint256 fee,
        uint256[] calldata distributionHints,
        uint256 initialFunding
    ) external onlyInitializer payable returns (address) {
        require(block.timestamp < endTimestamp-stopTradingBeforeMarketEnd, "Market End timestamp is too close to current time");
        
        require(address(this).balance >= initialFunding, "Insufficient funds");
        
        conditionalTokens.prepareCondition(address(this), questionId, outcomeSlots);
        bytes32 conditionId = conditionalTokens.getConditionId(address(this), questionId, outcomeSlots);

        bytes32[] memory conditionIds = new bytes32[](1);

        conditionIds[0] = conditionId;

        // required to avoid stack too deep error
        uint256 marketEndTime = endTimestamp;

        FixedProductMarketMaker fpmm = FPMMFactory.createFixedProductMarketMaker(
            conditionalTokens, 
            collateralToken, 
            conditionIds, 
            fee,
            marketEndTime,
            address(this)
        );

        address fpmmAddress = address(fpmm);

        collateralToken.deposit{value: initialFunding}();
        collateralToken.approve(address(fpmm), initialFunding);

        fpmm.addFunding(initialFunding, distributionHints);

        // set approval for spending conditional tokens to allow selling
        conditionalTokens.setApprovalForAll(fpmmAddress, true);

        questions[questionId] = QuestionData(
            block.timestamp,
            endTimestamp,
            outcomeSlots,
            fpmmAddress,
            conditionId
        );

        return fpmmAddress;    

    }

    /**
     * @dev Gets the market data for a specific question
     * @param questionId The ID of the question
     * @return A MarketData struct containing market information
     */
    function getMarketData(bytes32 questionId) external view returns (MarketData memory) {
        FixedProductMarketMaker fpmm = FixedProductMarketMaker(questions[questionId].fpmm);
        uint256 uniqueBuys = fpmm.uniqueBuys();
        uint256[] memory probabilities = fpmm.calculateProbabilities();
        uint256[] memory buyAmounts = new uint256[](questions[questionId].outcomeSlots);
        
        for (uint256 i = 0; i < questions[questionId].outcomeSlots; i++) {
            buyAmounts[i] = fpmm.calcBuyAmount(ONE, i);
        }

        return MarketData(questions[questionId], answers[questionId], uniqueBuys, probabilities, buyAmounts);

    }

    /**
     * @dev Buys a position using a signature for spending tokens
     * @param questionId The ID of the question
     * @param outcomeIndex The index of the outcome to buy
     * @param minOutcomeTokensToBuy The minimum number of outcome tokens to buy
     * @param request The spending request
     * @param signature The signature for the spending request
     */
    function buyPositionWithSignature(bytes32 questionId, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy, OnchainPoints.Request calldata request, bytes calldata signature) nonReentrant external {

        require(request.amount >= minBuyAmount, "Amount sent is less than minimum buy amount");

        address spender = OnchainPoints(onchainPointsAddress).spendToken(request, signature);

        uint256 userBuyAmount = userBuyAmounts[questionId][spender];
        require(userBuyAmount + request.amount <= maxBuyAmountPerQuestion, "Amount exceeds maximum buy amount per question");

        userBuyAmounts[questionId][spender] = userBuyAmount + request.amount;
        collateralToken.deposit{value: request.amount}();

        address fpmmAddress = questions[questionId].fpmm;

        collateralToken.approve(fpmmAddress, request.amount);

        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);
        uint256 outcomeTokensBought = fpmm.buyOnBehalf(request.amount, outcomeIndex, minOutcomeTokensToBuy, spender);

        userSpendings[spender] += request.amount;
        userOpenPositions[spender].add(questionId);

        emit BuyPosition(
            spender,
            fpmmAddress,
            questionId,
            request.amount,
            fpmm.fee(),
            outcomeIndex,
            outcomeTokensBought
        );
    }

    /**
     * @dev Buys a position on behalf of another user using a signature
     * @param questionId The ID of the question
     * @param outcomeIndex The index of the outcome to buy
     * @param minOutcomeTokensToBuy The minimum number of outcome tokens to buy
     * @param request The delegated spending request
     * @param signature The signature for the delegated spending request
     */
    function buyPositionWithSignatureOnBehalf(bytes32 questionId, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy, OnchainPoints.DelegatedRequest calldata request, bytes calldata signature) nonReentrant external {

        require(request.amount >= minBuyAmount, "Amount sent is less than minimum buy amount");

        OnchainPoints(onchainPointsAddress).spendTokensOnBehalf(request, signature);

        address spender = request.owner;

        uint256 userBuyAmount = userBuyAmounts[questionId][spender];
        require(userBuyAmount + request.amount <= maxBuyAmountPerQuestion, "Amount exceeds maximum buy amount per question");

        userBuyAmounts[questionId][spender] = userBuyAmount + request.amount;
        collateralToken.deposit{value: request.amount}();

        address fpmmAddress = questions[questionId].fpmm;

        collateralToken.approve(fpmmAddress, request.amount);

        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);
        uint256 outcomeTokensBought = fpmm.buyOnBehalf(request.amount, outcomeIndex, minOutcomeTokensToBuy, spender);

        userSpendings[spender] += request.amount;
        userOpenPositions[spender].add(questionId);

        emit BuyPosition(
            spender,
            fpmmAddress,
            questionId,
            request.amount,
            fpmm.fee(),
            outcomeIndex,
            outcomeTokensBought
        );
    }

    /**
     * @dev Buys a position using locked tokens and optionally unlocked tokens (ETH)
     * @param questionId The ID of the question
     * @param outcomeIndex The index of the outcome to buy
     * @param minOutcomeTokensToBuy The minimum number of outcome tokens to buy
     * @param amount The total amount to spend (locked + unlocked tokens)
     * @notice This function allows users to buy a position using their locked tokens and, if enabled, additional unlocked tokens (ETH)
     * @notice If buyWithUnlockedEnabled is false, the function will not accept any ETH (msg.value must be 0)
     */
    function buyPositionWithLocked(bytes32 questionId, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy, uint256 amount) external nonReentrant payable {
        require(amount >= minBuyAmount, "Amount sent is less than minimum buy amount");

        if (!buyWithUnlockedEnabled){
            require(msg.value == 0, "Buy with unlocked tokens is disabled");
        }
        
        address spender = msg.sender;

        uint256 userBuyAmount = userBuyAmounts[questionId][spender];
        require(userBuyAmount + amount <= maxBuyAmountPerQuestion, "Amount exceeds maximum buy amount per question");

        uint256 userAvailableSpending = OnchainPoints(onchainPointsAddress).getAvailableSpending(spender);

        require(userAvailableSpending + msg.value >= amount, "Insufficient funds");

        uint256 unlockedTokensToSpend = 0;
        if (userAvailableSpending >= amount){
            OnchainPoints(onchainPointsAddress).spendTokenWithoutSignature(amount);
        } else {
            OnchainPoints(onchainPointsAddress).spendTokenWithoutSignature(userAvailableSpending);
            unlockedTokensToSpend = amount - userAvailableSpending;
        }

        address fpmmAddress = questions[questionId].fpmm;

        collateralToken.deposit{value: amount}();
        collateralToken.approve(fpmmAddress, amount);

        userBuyAmounts[questionId][spender] = userBuyAmount + amount;

        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);
        uint256 outcomeTokensBought = fpmm.buyOnBehalf(amount, outcomeIndex, minOutcomeTokensToBuy, spender);
        
        userSpendings[spender] += amount;
        userOpenPositions[spender].add(questionId);

        emit BuyPosition(
            spender,
            fpmmAddress,
            questionId,
            amount,
            fpmm.fee(),
            outcomeIndex,
            outcomeTokensBought
        );

        // Return any excess ETH sent
        if (msg.value > unlockedTokensToSpend) {
            payable(spender).transfer(msg.value - unlockedTokensToSpend);
        }
    }

    /**
     * @dev Buys a position on behalf of another user using locked tokens
     * @param owner The address of the position owner
     * @param questionId The ID of the question
     * @param outcomeIndex The index of the outcome to buy
     * @param minOutcomeTokensToBuy The minimum number of outcome tokens to buy
     * @param amount The amount to spend
     */
    function buyPositionWithLockedOnBehalf(address owner, bytes32 questionId, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy, uint256 amount) external nonReentrant{
        require(amount >= minBuyAmount, "Amount sent is less than minimum buy amount");
        
        address spender = owner;

        uint256 userBuyAmount = userBuyAmounts[questionId][spender];
        require(userBuyAmount + amount <= maxBuyAmountPerQuestion, "Amount exceeds maximum buy amount per question");

        uint256 userAvailableSpending = OnchainPoints(onchainPointsAddress).getAvailableSpending(spender);

        require(userAvailableSpending >= amount, "Insufficient funds");

        OnchainPoints(onchainPointsAddress).spendTokensOnBehalfWithoutSignature(amount, owner);

        address fpmmAddress = questions[questionId].fpmm;

        collateralToken.deposit{value: amount}();
        collateralToken.approve(fpmmAddress, amount);

        userBuyAmounts[questionId][spender] = userBuyAmount + amount;

        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);
        uint256 outcomeTokensBought = fpmm.buyOnBehalf(amount, outcomeIndex, minOutcomeTokensToBuy, spender);
        
        userSpendings[spender] += amount;
        userOpenPositions[spender].add(questionId);

        emit BuyPosition(
            spender,
            fpmmAddress,
            questionId,
            amount,
            fpmm.fee(),
            outcomeIndex,
            outcomeTokensBought
        );
    }

    /**
     * @dev Buys a position using unlocked tokens
     * @param questionId The ID of the question
     * @param outcomeIndex The index of the outcome to buy
     * @param minOutcomeTokensToBuy The minimum number of outcome tokens to buy
     * @param conditionTokensReceiver The address to receive the condition tokens
     */
    function buyPosition(bytes32 questionId, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy, address conditionTokensReceiver) external nonReentrant payable {
        require(msg.value >= minBuyAmount, "Amount sent is less than minimum buy amount");
        if (!proposerSet.contains(msg.sender)){
            require(buyWithUnlockedEnabled, "Buy with unlocked tokens is disabled");
        }
        uint256 userBuyAmount = userBuyAmounts[questionId][conditionTokensReceiver];
        require(userBuyAmount + msg.value <= maxBuyAmountPerQuestion, "Amount exceeds maximum buy amount per question");

        userBuyAmounts[questionId][conditionTokensReceiver] = userBuyAmount + msg.value;
        collateralToken.deposit{value: msg.value}();

        address fpmmAddress = questions[questionId].fpmm;

        collateralToken.approve(fpmmAddress, msg.value);

        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);
        uint256 outcomeTokensBought = fpmm.buyOnBehalf(msg.value, outcomeIndex, minOutcomeTokensToBuy, conditionTokensReceiver);

        userSpendings[conditionTokensReceiver] += msg.value;
        userOpenPositions[conditionTokensReceiver].add(questionId);

        emit BuyPosition(
            conditionTokensReceiver,
            fpmmAddress,
            questionId,
            msg.value,
            fpmm.fee(),
            outcomeIndex,
            outcomeTokensBought
        );
    }

    /**
     * @dev Sells a position
     * @param questionId The ID of the question
     * @param returnAmount The amount to return
     * @param outcomeIndex The index of the outcome to sell
     * @param maxOutcomeTokensToSell The maximum number of outcome tokens to sell
     */
    function sellPosition(bytes32 questionId, uint256 returnAmount, uint256 outcomeIndex, uint256 maxOutcomeTokensToSell) external {
        require(conditionalTokens.isApprovedForAll(msg.sender, address(this)), "oracle is not approved to transfer tokens");

        address fpmmAddress = questions[questionId].fpmm;
        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);

        uint outcomeTokensToSell = fpmm.calcSellAmount(returnAmount, outcomeIndex);
        require(outcomeTokensToSell <= maxOutcomeTokensToSell, "maximum sell amount exceeded");

        uint256[] memory positionIds = fpmm.getPositionIds();

        conditionalTokens.safeTransferFrom(msg.sender, address(this), positionIds[outcomeIndex], outcomeTokensToSell, "");

        fpmm.sellOnBehalf(returnAmount, outcomeIndex, outcomeTokensToSell);

        collateralToken.withdraw(returnAmount);
        payable(msg.sender).transfer(returnAmount);

        emit SellPosition(
            msg.sender,
            fpmmAddress,
            questionId,
            returnAmount,
            outcomeIndex,
            outcomeTokensToSell
        );
    }


    /**
     * @dev Gets the position balances for a holder
     * @param questionId The ID of the question
     * @param indexSets The index sets to check
     * @param holder The address of the holder
     */
    function getPositionBalances(bytes32 questionId, uint256[] memory indexSets, address holder) public view returns (uint256[] memory balances) {
        uint256 outcomeSlots = questions[questionId].outcomeSlots;
        require(outcomeSlots > 0, "Market has not been initialized");

        bytes32 conditionId = questions[questionId].conditionId;
        uint256 fullIndexSet = (1 << outcomeSlots) - 1;

        balances = new uint256[](indexSets.length);
        for (uint256 i = 0; i < indexSets.length; i++) {
            uint256 indexSet = indexSets[i];
            require(indexSet > 0 && indexSet < fullIndexSet, "Got invalid index set");
            uint256 positionId = conditionalTokens.getPositionId(collateralToken,
                conditionalTokens.getCollectionId(parentCollectionId, conditionId, indexSet));
                balances[i] = conditionalTokens.balanceOf(holder, positionId);
        }
    }

    /**
     * @dev Redeems a position
     * @param questionId The ID of the question
     * @param indexSets The index sets to redeem
     */
    function redeemPosition(bytes32 questionId, uint256[] memory indexSets) public {
        QuestionData memory questionData = questions[questionId];

        uint256[] memory requiredIndexSets = new uint256[](questionData.outcomeSlots);
        for (uint256 j = 0; j < questionData.outcomeSlots; j++) {
            requiredIndexSets[j] = j+1;
        }

        require(indexSets.length == questionData.outcomeSlots, "Invalid index sets");
        require(keccak256(abi.encodePacked(indexSets)) == keccak256(abi.encodePacked(requiredIndexSets)), "Invalid index sets");

        uint256[] memory positionBalances = getPositionBalances(questionId, indexSets, msg.sender);

        uint256 positionTotal = 0;
        for (uint256 i = 0; i < positionBalances.length; i++) {
            positionTotal += positionBalances[i];
        }

        require(positionTotal > 0, "No positions to redeem");

        uint256 totalPayout = conditionalTokens.redeemPositionsOnBehalf(
            collateralToken, 
            parentCollectionId, 
            questions[questionId].conditionId, 
            indexSets, 
            msg.sender
        );

        // unwrap collateral tokens
        collateralToken.withdraw(totalPayout);

        // transfer POP to user
        payable(msg.sender).transfer(totalPayout);

        userRedeemed[msg.sender] += totalPayout;
        userOpenPositions[msg.sender].remove(questionId);

        address fpmmAddress = questions[questionId].fpmm;

        emit RedeemPosition(msg.sender, fpmmAddress, questionId, indexSets, totalPayout);
    }

    /**
     * @dev Redeems multiple positions
     * @param num The number of positions to redeem
     */
    function redeemPositions(uint256 num) nonReentrant external {
        uint256 nUserPositions = userOpenPositions[msg.sender].length();
        require(nUserPositions > 0, "No open positions to redeem");

        if (num > nUserPositions) {
            num = nUserPositions;
        }

        bytes32[] memory openPositions = getUserOpenPositions(msg.sender);

        bytes32[] memory openPositionsResolved = new bytes32[](num);
        uint256 numPositionsToRedeem = 0;
        for (uint256 i = 0; i < num; i++) {
            if(answers[openPositions[i]].answerTimestamp > 0){
                openPositionsResolved[numPositionsToRedeem] = openPositions[i];
                numPositionsToRedeem++;
            }
        }
        require(numPositionsToRedeem > 0, "Unable to redeem positions, resolution pending. Please try again later.");

        for (uint256 i = 0; i < numPositionsToRedeem; i++) {
            bytes32 questionId = openPositionsResolved[i];
            QuestionData memory questionData = questions[questionId];

            uint256[] memory indexSets = new uint256[](questionData.outcomeSlots);
            for (uint256 j = 0; j < questionData.outcomeSlots; j++) {
                indexSets[j] = j+1;
            }

            redeemPosition(questionId, indexSets);
        }
    }

    /**
     * @dev Resolves a market
     * @param questionId The ID of the question
     */
    function resolveMarket(bytes32 questionId) public {
        require(questions[questionId].beginTimestamp > 0, "Market has not been initialized");
        require(answers[questionId].answerTimestamp > 0, "Answer has not been proposed");
        require(block.timestamp >= questions[questionId].endTimestamp, "Market still has time left");

        conditionalTokens.reportPayouts(questionId, answers[questionId].payouts);

        emit MarketResolved(questionId, answers[questionId].payouts, msg.sender, answers[questionId].answerCid);
    }

    /**
     * @dev Proposes an answer for a question
     * @param questionId The ID of the question
     * @param payouts The payouts for each outcome
     * @param answerCid The CID of the answer
     */
    function proposeAnswer(bytes32 questionId, uint256[] calldata payouts, string calldata answerCid) public onlyProposer {
       require(questions[questionId].beginTimestamp > 0, "Market has not been initialized");
       answers[questionId] = AnswerData(payouts, block.timestamp, answerCid);

       emit AnswerProposed(questionId, payouts, msg.sender, answerCid);
    }

    /**
     * @dev Proposes an answer and resolves the market in one transaction
     * @param questionId The ID of the question
     * @param payouts The payouts for each outcome
     * @param answerCid The CID of the answer
     */
    function proposeAndResolve(bytes32 questionId, uint256[] calldata payouts, string calldata answerCid) public onlyProposer {
        proposeAnswer(questionId, payouts, answerCid);
        resolveMarket(questionId);
    }

    /**
     * @dev Gets the number of unique buys for a question
     * @param questionId The ID of the question
     * @return The number of unique buys
     */
    function getUniqueBuys(bytes32 questionId) external view returns (uint256) {
        address fpmmAddress = questions[questionId].fpmm;
        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);
        return fpmm.uniqueBuys();
    }

    /**
     * @dev Updates the list of proposers
     * @param _proposers Array of proposer addresses
     * @param _status Array of boolean statuses corresponding to proposers
     */
    function updateProposers(address[] calldata _proposers, bool[] calldata _status) external onlyOwner {
       require(_proposers.length == _status.length, "Input lengths do not match");
       for (uint256 i = 0; i < _proposers.length; i++) {
           if (_status[i]) {
               proposerSet.add(_proposers[i]);
           } else {
              proposerSet.remove(_proposers[i]);
           }
           emit ProposerUpdated(_proposers[i], _status[i]);
      }
    }

    /**
     * @dev Updates the list of initializers
     * @param _initializers Array of initializer addresses
     * @param _status Array of boolean statuses corresponding to initializers
     */
    function updateInitializers(address[] calldata _initializers, bool[] calldata _status) external onlyOwner {
       require(_initializers.length == _status.length, "Input lengths do not match");
       for (uint256 i = 0; i < _initializers.length; i++) {
           if (_status[i]) {
               initializerSet.add(_initializers[i]);
           } else {
              initializerSet.remove(_initializers[i]);
           }
           emit InitializerUpdated(_initializers[i], _status[i]);
      }
    }

    /**
     * @dev Recovers funding tokens from a market
     * @param questionId The ID of the question
     * @param indexSets The index sets to recover
     */
    function recoverFundingToken(bytes32 questionId, uint256[] calldata indexSets) external payable onlyInitializer {
        address fpmmAddress = questions[questionId].fpmm;
        FixedProductMarketMaker fpmm = FixedProductMarketMaker(fpmmAddress);

        uint256 fundingTokenBalance = fpmm.balanceOf(address(this));
        require(fundingTokenBalance > 0, "No funding token to recover.");
        
        fpmm.removeFunding(fundingTokenBalance);

        uint256 balanceBefore = collateralToken.balanceOf(address(this));

        conditionalTokens.redeemPositions(
            collateralToken, 
            parentCollectionId, 
            questions[questionId].conditionId, 
            indexSets
        );

        uint256 balanceAfter = collateralToken.balanceOf(address(this));

        uint256 tokensRedeemed = balanceAfter - balanceBefore;
        
        collateralToken.withdraw(tokensRedeemed);

        emit FundingRecovered(questionId, tokensRedeemed, msg.sender);
    }

    /**
     * @dev Gets the list of proposers
     * @return An array of proposer addresses
     */
    function getProposers() external view returns (address[] memory) {
        address[] memory proposers = new address[](proposerSet.length());
        for (uint256 i = 0; i < proposerSet.length(); i++) {
            proposers[i] = proposerSet.at(i);
        }
        return proposers;
    }

    /**
     * @dev Gets the list of initializers
     * @return An array of initializer addresses
     */
    function getInitializers() external view returns (address[] memory) {
        address[] memory initializers = new address[](initializerSet.length());
        for (uint256 i = 0; i < initializerSet.length(); i++) {
            initializers[i] = initializerSet.at(i);
        }
        return initializers;
    }

    // emergency withdraw all balance
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        payable(msg.sender).transfer(balance);
    }
}