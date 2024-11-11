// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "./SafeMath.sol";
import { ConditionalTokens } from "./ConditionalTokens.sol";
import { CTHelpers } from "./CTHelpers.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IPredictionsOracle.sol";

/// @title CeilDiv Library
/// @notice Provides a function to calculate ceiling division
library CeilDiv {
    /// @notice Calculates ceil(x/y)
    /// @param x Numerator
    /// @param y Denominator
    /// @return Result of ceiling division
    function ceildiv(uint x, uint y) internal pure returns (uint) {
        if(x > 0) return ((x - 1) / y) + 1;
        return x / y;
    }
}

/// @title Fixed Product Market Maker
/// @notice Implements a market maker for prediction markets using the CPMM (Constant Product Market Maker)
/// @dev Inherits from ERC20 for liquidity tokens and ERC1155Holder for handling conditional tokens
contract FixedProductMarketMaker is ERC20, ERC1155Holder {
    // Events
    event FPMMFundingAdded(address indexed funder, uint[] amountsAdded, uint sharesMinted);
    event FPMMFundingRemoved(address indexed funder, uint[] amountsRemoved, uint collateralRemovedFromFeePool, uint sharesBurnt);
    event FPMMBuy(address indexed buyer, uint investmentAmount, uint feeAmount, uint indexed outcomeIndex, uint outcomeTokensBought);
    event FPMMSell(address indexed seller, uint returnAmount, uint feeAmount, uint indexed outcomeIndex, uint outcomeTokensSold);

    using SafeMath for uint;
    using CeilDiv for uint;

    uint constant ONE = 10**18;

    ConditionalTokens public conditionalTokens;
    IERC20 public collateralToken;
    bytes32[] public conditionIds;
    uint public fee;
    bool public isInitialized;
    uint public marketEndTime;
    uint public uniqueBuys;
    address public oracleAddress;

    uint[] outcomeSlotCounts;
    bytes32[][] collectionIds;
    uint[] positionIds;
    mapping (address => uint256) withdrawnFees;
    uint internal totalWithdrawnFees;
    uint internal feePoolWeight;

    uint public MUL_FACTOR = 1000000000;

    /// @notice Ensures the market is active
    modifier onlyActive() {
        if (oracleAddress != address(0x0)) {
            require(block.timestamp < marketEndTime - IPredictionsOracle(oracleAddress).stopTradingBeforeMarketEnd(), "market is not active");
        }
        else{
            require(block.timestamp < marketEndTime, "market is not active");
        }
        _;
    }

    /// @notice Constructor for the FPMM
    constructor() ERC20("FPMM", "FPMM") {}

    /// @notice Recursively records collection IDs for all conditions
    /// @param conditionsLeft Number of conditions left to process
    /// @param parentCollectionId Parent collection ID
    function _recordCollectionIDsForAllConditions(uint conditionsLeft, bytes32 parentCollectionId) private {
        if(conditionsLeft == 0) {
            positionIds.push(CTHelpers.getPositionId(collateralToken, parentCollectionId));
            return;
        }

        conditionsLeft--;

        uint outcomeSlotCount = outcomeSlotCounts[conditionsLeft];

        collectionIds[conditionsLeft].push(parentCollectionId);
        for(uint i = 0; i < outcomeSlotCount; i++) {
            _recordCollectionIDsForAllConditions(
                conditionsLeft,
                CTHelpers.getCollectionId(
                    parentCollectionId,
                    conditionIds[conditionsLeft],
                    1 << i
                )
            );
        }
    }

    /// @notice Initializes the FPMM with market parameters
    /// @param _conditionalTokens Address of the ConditionalTokens contract
    /// @param _collateralToken Address of the collateral token
    /// @param _conditionIds Array of condition IDs
    /// @param _fee Fee percentage for the market
    /// @param _marketEndTime Timestamp when the market ends
    /// @param _oracleAddress Address of the oracle
    function initialize(
        ConditionalTokens _conditionalTokens,
        IERC20 _collateralToken,
        bytes32[] calldata _conditionIds,
        uint _fee,
        uint _marketEndTime,
        address _oracleAddress
    )
        external
    {
        require(!isInitialized);
        conditionalTokens = _conditionalTokens;
        collateralToken = _collateralToken;
        conditionIds = _conditionIds;
        fee = _fee;
        marketEndTime = _marketEndTime;
        oracleAddress = _oracleAddress;

        uint atomicOutcomeSlotCount = 1;
        outcomeSlotCounts = new uint[](_conditionIds.length);
        for (uint i = 0; i < _conditionIds.length; i++) {
            uint outcomeSlotCount = conditionalTokens.getOutcomeSlotCount(_conditionIds[i]);
            atomicOutcomeSlotCount *= outcomeSlotCount;
            outcomeSlotCounts[i] = outcomeSlotCount;
        }
        require(atomicOutcomeSlotCount > 1, "conditions must be valid");

        collectionIds = new bytes32[][](_conditionIds.length);
        _recordCollectionIDsForAllConditions(conditionIds.length, bytes32(0));
        isInitialized = true;
    }

    /// @notice Gets the balances of outcome tokens in the pool
    /// @return Array of balances for each outcome token
    function getPoolBalances() private view returns (uint[] memory) {
        address[] memory thises = new address[](positionIds.length);
        for(uint i = 0; i < positionIds.length; i++) {
            thises[i] = address(this);
        }
        return conditionalTokens.balanceOfBatch(thises, positionIds);
    }

    /// @notice Gets the balances of outcome tokens for a specific address
    /// @param userAddress Address to check balances for
    /// @return Array of balances for each outcome token
    function getAddressBalances(address userAddress) public view returns (uint[] memory) {
        address[] memory thises = new address[](positionIds.length);
        for(uint i = 0; i < positionIds.length; i++) {
            thises[i] = userAddress;
        }
        return conditionalTokens.balanceOfBatch(thises, positionIds);
    }

    /// @notice Sums up the values in an array
    /// @param array Array of uint values
    /// @return Sum of all values in the array
    function sumArray(uint[] memory array) public pure returns (uint) {
        uint sum = 0;
        for (uint i = 0; i < array.length; i++) {
            sum += array[i];
        }
        return sum;
    }

    /// @notice Generates a basic partition for outcomes
    /// @param outcomeSlotCount Number of outcome slots
    /// @return partition Array representing the basic partition
    function generateBasicPartition(uint outcomeSlotCount)
        private
        pure
        returns (uint[] memory partition)
    {
        partition = new uint[](outcomeSlotCount);
        for(uint i = 0; i < outcomeSlotCount; i++) {
            partition[i] = 1 << i;
        }
    }

    /// @notice Splits a position through all conditions
    /// @param amount Amount of tokens to split
    function splitPositionThroughAllConditions(uint amount)
        private
    {
        for (uint i = conditionIds.length; i > 0; i--) {
            uint index = i - 1;
            uint[] memory partition = generateBasicPartition(outcomeSlotCounts[index]);
            for(uint j = 0; j < collectionIds[index].length; j++) {
                conditionalTokens.splitPosition(collateralToken, collectionIds[index][j], conditionIds[index], partition, amount);
            }
        }
    }

    /// @notice Merges positions through all conditions
    /// @param amount Amount of tokens to merge
    function mergePositionsThroughAllConditions(uint amount)
        private
    {
        for(uint i = 0; i < conditionIds.length; i++) {
            uint[] memory partition = generateBasicPartition(outcomeSlotCounts[i]);
            for(uint j = 0; j < collectionIds[i].length; j++) {
                conditionalTokens.mergePositions(collateralToken, collectionIds[i][j], conditionIds[i], partition, amount);
            }
        }
    }

    /// @notice Calculates the total collected fees
    /// @return Amount of collected fees
    function collectedFees() external view returns (uint) {
        return feePoolWeight.sub(totalWithdrawnFees);
    }

    /// @notice Calculates fees withdrawable by an account
    /// @param account Address of the account
    /// @return Amount of fees withdrawable
    function feesWithdrawableBy(address account) public view returns (uint) {
        uint rawAmount = feePoolWeight.mul(balanceOf(account)) / totalSupply();
        return rawAmount.sub(withdrawnFees[account]);
    }

    /// @notice Withdraws fees for an account
    /// @param account Address of the account to withdraw fees for
    function withdrawFees(address account) public {
        uint rawAmount = feePoolWeight.mul(balanceOf(account)) / totalSupply();
        uint withdrawableAmount = rawAmount.sub(withdrawnFees[account]);
        if(withdrawableAmount > 0){
            withdrawnFees[account] = rawAmount;
            totalWithdrawnFees = totalWithdrawnFees.add(withdrawableAmount);
            require(collateralToken.transfer(account, withdrawableAmount), "withdrawal transfer failed");
        }
    }

    /// @notice Handles fee calculations before token transfers
    /// @param from Address tokens are transferred from
    /// @param to Address tokens are transferred to
    /// @param amount Amount of tokens transferred
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal {
        if (from != address(0)) {
            withdrawFees(from);
        }

        uint totalSupply = totalSupply();
        uint withdrawnFeesTransfer = totalSupply == 0 ?
            amount :
            feePoolWeight.mul(amount) / totalSupply;

        if (from != address(0)) {
            withdrawnFees[from] = withdrawnFees[from].sub(withdrawnFeesTransfer);
            totalWithdrawnFees = totalWithdrawnFees.sub(withdrawnFeesTransfer);
        } else {
            feePoolWeight = feePoolWeight.add(withdrawnFeesTransfer);
        }
        if (to != address(0)) {
            withdrawnFees[to] = withdrawnFees[to].add(withdrawnFeesTransfer);
            totalWithdrawnFees = totalWithdrawnFees.add(withdrawnFeesTransfer);
        } else {
            feePoolWeight = feePoolWeight.sub(withdrawnFeesTransfer);
        }
    }

    /// @notice Adds funding to the market
    /// @param addedFunds Amount of funds to add
    /// @param distributionHint Hint for initial token distribution
    function addFunding(uint addedFunds, uint[] calldata distributionHint)
        external onlyActive
    {
        require(addedFunds > 0, "funding must be non-zero");

        uint[] memory sendBackAmounts = new uint[](positionIds.length);
        uint poolShareSupply = totalSupply();
        uint mintAmount;
        if(poolShareSupply > 0) {
            require(distributionHint.length == 0, "cannot use distribution hint after initial funding");
            uint[] memory poolBalances = getPoolBalances();
            uint poolWeight = 0;
            for(uint i = 0; i < poolBalances.length; i++) {
                uint balance = poolBalances[i];
                if(poolWeight < balance)
                    poolWeight = balance;
            }

            for(uint i = 0; i < poolBalances.length; i++) {
                uint remaining = addedFunds.mul(poolBalances[i]) / poolWeight;
                sendBackAmounts[i] = addedFunds.sub(remaining);
            }

            mintAmount = addedFunds.mul(poolShareSupply) / poolWeight;
        } else {
            if(distributionHint.length > 0) {
                require(distributionHint.length == positionIds.length, "hint length off");
                uint maxHint = 0;
                for(uint i = 0; i < distributionHint.length; i++) {
                    uint hint = distributionHint[i];
                    if(maxHint < hint)
                        maxHint = hint;
                }

                for(uint i = 0; i < distributionHint.length; i++) {
                    uint remaining = addedFunds.mul(distributionHint[i]) / maxHint;
                    require(remaining > 0, "must hint a valid distribution");
                    sendBackAmounts[i] = addedFunds.sub(remaining);
                }
            }

            mintAmount = addedFunds;
        }

        require(collateralToken.transferFrom(msg.sender, address(this), addedFunds), "funding transfer failed");
        require(collateralToken.approve(address(conditionalTokens), addedFunds), "approval for splits failed");
        splitPositionThroughAllConditions(addedFunds);

        _mint(msg.sender, mintAmount);

        conditionalTokens.safeBatchTransferFrom(address(this), msg.sender, positionIds, sendBackAmounts, "");

        // transform sendBackAmounts to array of amounts added
        for (uint i = 0; i < sendBackAmounts.length; i++) {
            sendBackAmounts[i] = addedFunds.sub(sendBackAmounts[i]);
        }

        emit FPMMFundingAdded(msg.sender, sendBackAmounts, mintAmount);
    }

    /// @notice Removes funding from the market
    /// @param sharesToBurn Amount of shares to burn
    function removeFunding(uint sharesToBurn)
        external
    {
        uint[] memory poolBalances = getPoolBalances();

        uint[] memory sendAmounts = new uint[](poolBalances.length);

        uint poolShareSupply = totalSupply();
        for(uint i = 0; i < poolBalances.length; i++) {
            sendAmounts[i] = poolBalances[i].mul(sharesToBurn) / poolShareSupply;
        }

        uint collateralRemovedFromFeePool = collateralToken.balanceOf(address(this));

        _burn(msg.sender, sharesToBurn);
        collateralRemovedFromFeePool = collateralRemovedFromFeePool.sub(
            collateralToken.balanceOf(address(this))
        );

        conditionalTokens.safeBatchTransferFrom(address(this), msg.sender, positionIds, sendAmounts, "");

        emit FPMMFundingRemoved(msg.sender, sendAmounts, collateralRemovedFromFeePool, sharesToBurn);
    }


    /// @notice Calculates the amount of outcome tokens to buy
    /// @param investmentAmount Amount of collateral to invest
    /// @param outcomeIndex Index of the outcome to buy
    /// @return Amount of outcome tokens that can be bought
    function calcBuyAmount(uint investmentAmount, uint outcomeIndex) public view returns (uint) {
        require(outcomeIndex < positionIds.length, "invalid outcome index");

        uint[] memory poolBalances = getPoolBalances();
        uint investmentAmountMinusFees = investmentAmount.sub(investmentAmount.mul(fee) / ONE);
        uint buyTokenPoolBalance = poolBalances[outcomeIndex];
        uint endingOutcomeBalance = buyTokenPoolBalance.mul(ONE);
        for(uint i = 0; i < poolBalances.length; i++) {
            if(i != outcomeIndex) {
                uint poolBalance = poolBalances[i];
                endingOutcomeBalance = endingOutcomeBalance.mul(poolBalance).ceildiv(
                    poolBalance.add(investmentAmountMinusFees)
                );
            }
        }
        require(endingOutcomeBalance > 0, "must have non-zero balances");

        return buyTokenPoolBalance.add(investmentAmountMinusFees).sub(endingOutcomeBalance.ceildiv(ONE));
    }

    /// @notice Calculates probabilities for each outcome
    /// @return Array of probabilities for each outcome
    function calculateProbabilities() public view returns (uint[] memory) {
        uint[] memory poolBalances = getPoolBalances();
        uint totalPoolBalance = 0;
        
        // Calculate the total pool balance
        for (uint i = 0; i < poolBalances.length; i++) {
            totalPoolBalance = totalPoolBalance.add(poolBalances[i]);
        }

        require(totalPoolBalance > 0, "Total pool balance must be greater than zero");

        // Create an array to store probabilities
        uint[] memory probabilities = new uint[](poolBalances.length);

        // Calculate the probability for each outcome
        for (uint i = 0; i < poolBalances.length; i++) {
            probabilities[i] = (MUL_FACTOR).sub(poolBalances[i].mul(MUL_FACTOR).div(totalPoolBalance));
        }

        return probabilities;
    }


    /// @notice Calculates the amount of outcome tokens to sell
    /// @param returnAmount Amount of collateral to receive
    /// @param outcomeIndex Index of the outcome to sell
    /// @return outcomeTokenSellAmount Amount of outcome tokens to sell
    function calcSellAmount(uint returnAmount, uint outcomeIndex) public view returns (uint outcomeTokenSellAmount) {
        require(outcomeIndex < positionIds.length, "invalid outcome index");

        uint[] memory poolBalances = getPoolBalances();
        uint returnAmountPlusFees = returnAmount.mul(ONE) / ONE.sub(fee);
        uint sellTokenPoolBalance = poolBalances[outcomeIndex];
        uint endingOutcomeBalance = sellTokenPoolBalance.mul(ONE);
        for(uint i = 0; i < poolBalances.length; i++) {
            if(i != outcomeIndex) {
                uint poolBalance = poolBalances[i];
                endingOutcomeBalance = endingOutcomeBalance.mul(poolBalance).ceildiv(
                    poolBalance.sub(returnAmountPlusFees)
                );
            }
        }
        require(endingOutcomeBalance > 0, "must have non-zero balances");

        return returnAmountPlusFees.add(endingOutcomeBalance.ceildiv(ONE)).sub(sellTokenPoolBalance);
    }

    /// @notice Allows a user to buy outcome tokens
    /// @param investmentAmount Amount of collateral to invest
    /// @param outcomeIndex Index of the outcome to buy
    /// @param minOutcomeTokensToBuy Minimum amount of outcome tokens to buy
    function buy(uint investmentAmount, uint outcomeIndex, uint minOutcomeTokensToBuy) external onlyActive {
        require(oracleAddress == address(0x0), "oracle address is configured, use buyOnBehalf");
        uint outcomeTokensToBuy = calcBuyAmount(investmentAmount, outcomeIndex);
        require(outcomeTokensToBuy >= minOutcomeTokensToBuy, "minimum buy amount not reached");

        if (sumArray(getAddressBalances(msg.sender)) == 0)
            uniqueBuys++;

        require(collateralToken.transferFrom(msg.sender, address(this), investmentAmount), "cost transfer failed");

        uint feeAmount = investmentAmount.mul(fee) / ONE;
        feePoolWeight = feePoolWeight.add(feeAmount);
        uint investmentAmountMinusFees = investmentAmount.sub(feeAmount);
        require(collateralToken.approve(address(conditionalTokens), investmentAmountMinusFees), "approval for splits failed");
        splitPositionThroughAllConditions(investmentAmountMinusFees);

        conditionalTokens.safeTransferFrom(address(this), msg.sender, positionIds[outcomeIndex], outcomeTokensToBuy, "");

        emit FPMMBuy(msg.sender, investmentAmount, feeAmount, outcomeIndex, outcomeTokensToBuy);
    }

    /// @notice Allows the oracle to buy outcome tokens on behalf of a user
    /// @param investmentAmount Amount of collateral to invest
    /// @param outcomeIndex Index of the outcome to buy
    /// @param minOutcomeTokensToBuy Minimum amount of outcome tokens to buy
    /// @param buyerAddress Address of the buyer
    /// @return Amount of outcome tokens bought
    function buyOnBehalf(uint investmentAmount, uint outcomeIndex, uint minOutcomeTokensToBuy, address buyerAddress) external onlyActive returns (uint) {
        if (oracleAddress != address(0x0)){
            require(msg.sender == oracleAddress, "only oracle can buy on behalf");
        }
        uint outcomeTokensToBuy = calcBuyAmount(investmentAmount, outcomeIndex);
        require(outcomeTokensToBuy >= minOutcomeTokensToBuy, "minimum buy amount not reached");

        if (sumArray(getAddressBalances(buyerAddress)) == 0)
            uniqueBuys++;

        require(collateralToken.transferFrom(msg.sender, address(this), investmentAmount), "cost transfer failed");

        uint feeAmount = investmentAmount.mul(fee) / ONE;
        feePoolWeight = feePoolWeight.add(feeAmount);
        uint investmentAmountMinusFees = investmentAmount.sub(feeAmount);
        require(collateralToken.approve(address(conditionalTokens), investmentAmountMinusFees), "approval for splits failed");
        splitPositionThroughAllConditions(investmentAmountMinusFees);

        conditionalTokens.safeTransferFrom(address(this), buyerAddress, positionIds[outcomeIndex], outcomeTokensToBuy, "");

        emit FPMMBuy(buyerAddress, investmentAmount, feeAmount, outcomeIndex, outcomeTokensToBuy);

        return outcomeTokensToBuy;
    }

    /// @notice Allows a user to sell outcome tokens
    /// @param returnAmount Amount of collateral to receive
    /// @param outcomeIndex Index of the outcome to sell
    /// @param maxOutcomeTokensToSell Maximum amount of outcome tokens to sell
    function sell(uint returnAmount, uint outcomeIndex, uint maxOutcomeTokensToSell) external onlyActive {
        require(oracleAddress != address(0x0) && IPredictionsOracle(oracleAddress).sellEnabled(), "selling is disabled");

        uint outcomeTokensToSell = calcSellAmount(returnAmount, outcomeIndex);
        require(outcomeTokensToSell <= maxOutcomeTokensToSell, "maximum sell amount exceeded");

        conditionalTokens.safeTransferFrom(msg.sender, address(this), positionIds[outcomeIndex], outcomeTokensToSell, "");

        uint feeAmount = returnAmount.mul(fee) / (ONE.sub(fee));
        feePoolWeight = feePoolWeight.add(feeAmount);
        uint returnAmountPlusFees = returnAmount.add(feeAmount);
        mergePositionsThroughAllConditions(returnAmountPlusFees);

        require(collateralToken.transfer(msg.sender, returnAmount), "return transfer failed");

        emit FPMMSell(msg.sender, returnAmount, feeAmount, outcomeIndex, outcomeTokensToSell);
    }


    /// @notice Allows the oracle to sell outcome tokens on behalf of a user
    /// @param returnAmount Amount of collateral to receive
    /// @param outcomeIndex Index of the outcome to sell
    /// @param outcomeTokensToSell Amount of outcome tokens to sell
    function sellOnBehalf(uint returnAmount, uint outcomeIndex, uint outcomeTokensToSell) external onlyActive {
        require(oracleAddress != address(0x0) && IPredictionsOracle(oracleAddress).sellEnabled(), "selling is disabled");

        conditionalTokens.safeTransferFrom(msg.sender, address(this), positionIds[outcomeIndex], outcomeTokensToSell, "");

        uint feeAmount = returnAmount.mul(fee) / (ONE.sub(fee));
        feePoolWeight = feePoolWeight.add(feeAmount);
        uint returnAmountPlusFees = returnAmount.add(feeAmount);
        mergePositionsThroughAllConditions(returnAmountPlusFees);

        require(collateralToken.transfer(msg.sender, returnAmount), "return transfer failed");

        emit FPMMSell(msg.sender, returnAmount, feeAmount, outcomeIndex, outcomeTokensToSell);

    }


    /// @notice Gets the position IDs for all outcomes
    /// @return Array of position IDs
    function getPositionIds() external view returns (uint[] memory) {
        return positionIds;
    }

}
