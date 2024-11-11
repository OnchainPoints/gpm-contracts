// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FixedProductMarketMaker } from "contracts/FixedProductMarketMaker.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ConditionalTokens } from "contracts/ConditionalTokens.sol";

interface IFactory {

    function createFixedProductMarketMaker(
        ConditionalTokens conditionalTokens,
        IERC20 collateralToken,
        bytes32[] calldata conditionIds,
        uint fee,
        uint marketEndTime,
        address oracleAddress
    )
        external
        returns (FixedProductMarketMaker fpmm);

}
