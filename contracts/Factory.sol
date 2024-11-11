// SPDX-License-Identifier: MIT

// © 2024 https://onchainpoints.xyz All Rights Reserved.

pragma solidity ^0.8.24;

import { FixedProductMarketMaker } from "./FixedProductMarketMaker.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ConditionalTokens } from "./ConditionalTokens.sol";

/// @title Factory Contract for Fixed Product Market Makers
/// @notice This contract creates new instances of FixedProductMarketMaker
/// @dev Uses CREATE2 for deterministic address generation
contract Factory {

    /// @notice Emitted when a new FixedProductMarketMaker is created
    /// @param creator Address of the creator
    /// @param fixedProductMarketMaker Address of the newly created FPMM
    /// @param conditionalTokens Address of the ConditionalTokens contract
    /// @param collateralToken Address of the collateral token
    /// @param conditionIds Array of condition IDs
    /// @param fee Fee percentage for the market
    event FixedProductMarketMakerCreation(
        address indexed creator,
        FixedProductMarketMaker fixedProductMarketMaker,
        ConditionalTokens indexed conditionalTokens,
        IERC20 indexed collateralToken,
        bytes32[] conditionIds,
        uint fee
    );

    /// @dev Empty constructor
    constructor() {}

    /// @notice Creates a new FixedProductMarketMaker instance
    /// @param conditionalTokens Address of the ConditionalTokens contract
    /// @param collateralToken Address of the collateral token
    /// @param conditionIds Array of condition IDs
    /// @param fee Fee percentage for the market
    /// @param marketEndTime Timestamp when the market ends
    /// @param oracleAddress Address of the oracle
    /// @return fpmm Address of the newly created FixedProductMarketMaker
    function createFixedProductMarketMaker(
        ConditionalTokens conditionalTokens,
        IERC20 collateralToken,
        bytes32[] calldata conditionIds,
        uint fee,
        uint marketEndTime,
        address oracleAddress
    )
        external
        returns (FixedProductMarketMaker fpmm)
    {   
        // Get the bytecode of the FixedProductMarketMaker contract
        bytes memory bytecode = type(FixedProductMarketMaker).creationCode;
        
        // Generate a unique salt for CREATE2
        bytes32 salt = keccak256(abi.encodePacked(conditionalTokens, collateralToken, conditionIds, fee));
        
        // Use CREATE2 to deploy the new FixedProductMarketMaker with a deterministic address
        assembly {
            fpmm := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }

        // Initialize the newly created FixedProductMarketMaker
        fpmm.initialize(conditionalTokens, collateralToken, conditionIds, fee, marketEndTime, oracleAddress);
        
        // Emit an event to log the creation of the new FixedProductMarketMaker
        emit FixedProductMarketMakerCreation(
            msg.sender,
            fpmm,
            conditionalTokens,
            collateralToken,
            conditionIds,
            fee
        );
        
        return fpmm;
    }
}
