// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ConditionalTokens } from "contracts/ConditionalTokens.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


interface IFixedProductMarketMaker {
    event FPMMFundingAdded(
        address indexed funder,
        uint[] amountsAdded,
        uint sharesMinted
    );
    event FPMMFundingRemoved(
        address indexed funder,
        uint[] amountsRemoved,
        uint collateralRemovedFromFeePool,
        uint sharesBurnt
    );
    event FPMMBuy(
        address indexed buyer,
        uint investmentAmount,
        uint feeAmount,
        uint indexed outcomeIndex,
        uint outcomeTokensBought
    );
    event FPMMSell(
        address indexed seller,
        uint returnAmount,
        uint feeAmount,
        uint indexed outcomeIndex,
        uint outcomeTokensSold
    );

    function initialize(
        ConditionalTokens _conditionalTokens,
        IERC20 _collateralToken,
        bytes32[] calldata _conditionIds,
        uint _fee,
        uint _marketEndTime,
        address _oracleAddress

    )
        external;

    function collectedFees() external view returns (uint);

    function feesWithdrawableBy(address account) external view returns (uint);

    function withdrawFees(address account) external;

    function addFunding(uint addedFunds, uint[] calldata distributionHint) external;

    function removeFunding(uint sharesToBurn) external;

    function calcBuyAmount(uint investmentAmount, uint outcomeIndex) external view returns (uint);

    function buy(uint investmentAmount, uint outcomeIndex, uint minOutcomeTokensToBuy) external;

}
