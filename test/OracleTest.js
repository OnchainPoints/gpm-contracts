// const { ethers, upgrades } = require("hardhat");
const {
    loadFixture,
    time
} = require("@nomicfoundation/hardhat-network-helpers");
const {
    expect
} = require("chai");
const { ethers } = require("hardhat");


// Commented out as OnchainPoints contract has been removed
/*
async function generateSignature(account, onchainPointsContract, nonceValue, amount) {
    const domain = {
      name: 'OnchainPointsContract',
      version: '0.1',
      chainId: 31337,
      verifyingContract: onchainPointsContract
    };


    const types = {
      Request: [{
          name: 'deadline',
          type: 'uint256'
        },
        {
          name: 'nonce',
          type: 'string'
        },
        {
          name: 'amount',
          type: 'uint256'
        },
      ]
    };
    const data = {
      deadline: new Date().getTime() + 1000,
      nonce: nonceValue,
      amount: BigInt(amount),
    }

    const signature = await account.signTypedData(domain, types, data);
    // const signature = await account._signTypedData(domain, types, data);

    return {
      data,
      signature
    };
}
*/


describe("Prediction Oracle", function () {

    // We define a fixture to reuse the same setup in every test.
    // We use loadFixture to run this setup once, snapshot that state,
    // and reset Hardhat Network to that snapshot in every test.
    async function deploy() {
        // Contracts are deployed using the first signer/account by default
        const [owner] = await ethers.getSigners();
        console.log(upgrades);
        const tokenContract = await hre.ethers.getContractFactory("POP");
        const token = await tokenContract.deploy("Prediction Oracle Points", "POP");

        const conditionalTokenContract = await hre.ethers.getContractFactory("ConditionalTokens");
        const conditionalToken = await conditionalTokenContract.deploy("TEST URI");

        const fpmmFactoryContract = await hre.ethers.getContractFactory("Factory");
        const fpmmFactory = await fpmmFactoryContract.deploy();

        // OnchainPoints contract removed from the new contract structure

        const predictionOracleContract = await hre.ethers.getContractFactory("PredictionsOracle");
        const predictionsOracle = await upgrades.deployProxy(predictionOracleContract, [owner.address, ], {
            initializer: "initialize",
            kind: "uups"
        });

        await predictionsOracle.updateContracts(
            conditionalToken.target, fpmmFactory.target, token.target
        )


        // set oracle address on conditional token contract
        await conditionalToken.setOracleAddress(predictionsOracle.target);

        const addedFunds = BigInt("10000000000000000000");
        const distributionHints = [1, 1];
        const outcomeSlotCount = 2;
        const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684333";
        const questionId2 = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684334";
        const fee = 0;

        // random account
        const randomAccount = ethers.Wallet.createRandom().connect(hre.ethers.provider);
        const randomAccount2 = ethers.Wallet.createRandom().connect(hre.ethers.provider);
        const fundAmount = ethers.parseUnits("1", 18);

        await owner.sendTransaction({
            to: randomAccount.address,
            value: fundAmount
          });
        await owner.sendTransaction({
        to: randomAccount2.address,
        value: fundAmount
        });
      

        // update oracle initializers
        const initializers = [owner.address];
        const initializersStatus = [1];
        await expect(predictionsOracle.updateInitializers(
            initializers,
            initializersStatus
        )).to.emit(predictionsOracle, "InitializerUpdated");

        // POP tokens are already minted to owner in constructor
        console.log('POP balance', await token.balanceOf(owner.address));

        const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
        const endTime = blockTimestamp + 3600;
        await predictionsOracle.updateMaxBuyAmountPerQuestion(
            BigInt("10000000000000000000000")
        );
        // transfer POP tokens to the oracle contract for funding
        await token.transfer(predictionsOracle.target, addedFunds);

        // create new market 1
        await predictionsOracle.createMarket(
            endTime,
            questionId,
            outcomeSlotCount,
            fee,
            distributionHints,
            addedFunds
        );

        // transfer more POP tokens for the second market
        await token.transfer(predictionsOracle.target, addedFunds);

        await predictionsOracle.createMarket(
            endTime,
            questionId2,
            outcomeSlotCount,
            fee,
            distributionHints,
            addedFunds
        );


        return {
            token,
            conditionalToken,
            fpmmFactory,
            predictionsOracle,
            questionId,
            questionId2,
            endTime,
            outcomeSlotCount,
            addedFunds
        };
    }

    it("Should deploy the oracle contract, initialize a market, and fail to buy directly", async function () {

        const {
            token,
            conditionalToken,
            predictionsOracle,
            questionId,
            endTime,
            outcomeSlotCount,
            addedFunds
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        // check that market was initialized properly
        const questionData = await predictionsOracle.questions(questionId);
        expect(questionData[1]).to.be.equal(endTime);
        expect(questionData[2]).to.be.equal(outcomeSlotCount);

        fpmmAddress = questionData[3];
        expect(fpmmAddress).to.be.a.properAddress;

        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(fpmmAddress);
        const funds = await fpmm.balanceOf(predictionsOracle.target);

        console.log("added funds", funds);
        expect(funds).to.be.equal(addedFunds);

        const conditionId = await conditionalToken.getConditionId(predictionsOracle.target, questionId, outcomeSlotCount);
        console.log("conditionId", conditionId);

        expect(questionData[4]).to.be.equal(conditionId);

        // send collateral token to other account
        const buyAmount = BigInt("1000000000000000000");
        await token.transfer(otherAccount.address, buyAmount);

        // approve fpmm contract to spend pop tokens from other account and buy position
        await token.connect(otherAccount).approve(fpmm.target, buyAmount);
        expect(fpmm.connect(otherAccount).buy(buyAmount, 1, 0)).to.be.revertedWith("oracle address is configured, use buyOnBehalf");
    });

    it("Should successfully buy and redeem a position in a market on behalf of a user", async function () {

        const {
            token,
            predictionsOracle,
            conditionalToken,
            questionId,
            endTime,
            outcomeSlotCount
        } = await loadFixture(deploy);


        const [owner, otherAccount] = await ethers.getSigners();
        const questionData = await predictionsOracle.questions(questionId);

        // get initial user positional token balances
        const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const conditionId = await conditionalToken.getConditionId(predictionsOracle.target, questionId, outcomeSlotCount);
        const collectionId1 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 1);
        const collectionId2 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 2);
        const positionId1 = await conditionalToken.getPositionId(token.target, collectionId1);
        const positionId2 = await conditionalToken.getPositionId(token.target, collectionId2);

        const userInitialBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1, positionId2]);

        console.log("userInitialBalances", userInitialBalances);

        expect(userInitialBalances[0]).to.be.equal(0);
        expect(userInitialBalances[1]).to.be.equal(0);

        const buyAmount = BigInt("1000000000000000000");

        // calc expected buy amount
        const fpmmAddress = questionData[3]
        const outcomeIndex = 1;
        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(fpmmAddress);
        const expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);

        console.log("expectedBuyAmount", expectedBuyAmount);

        // approve predictionsOracle to spend owner's tokens
        await token.approve(predictionsOracle.target, buyAmount);

        // buy position on behalf of user (owner provides tokens, buying for otherAccount)
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        const userEndBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1, positionId2]);

        console.log("userEndBalances", userEndBalances);

        expect(userEndBalances[outcomeIndex]).to.be.equal(expectedBuyAmount);

        // pass time to resolve market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // resolve market
        const payouts = [0, 1];
        const cid = "abcdefghijklmopqrstuvwxyz";

        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.proposeAnswer(questionId, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId)).to.emit(predictionsOracle, "MarketResolved");

        // redeem position on behalf of user
        const indexSets = [1, 2];
        const startBalance = await token.balanceOf(otherAccount.address);

        await expect(predictionsOracle.connect(otherAccount).redeemPosition(
            questionId,
            indexSets)).to.emit(predictionsOracle, "RedeemPosition");

        const endBalance = await token.balanceOf(otherAccount.address);

        console.log("startWPOPBalance", startBalance);
        console.log("endWPOPBalance", endBalance);

        expect(endBalance).to.be.gt(startBalance);

    });


    it("Should successfully buy and redeem multiple positions at once on behalf of a user", async function () {

        const {
            token,
            predictionsOracle,
            conditionalToken,
            questionId,
            questionId2,
            endTime,
            outcomeSlotCount
        } = await loadFixture(deploy);


        const [owner, otherAccount] = await ethers.getSigners();
        const questionData = await predictionsOracle.questions(questionId);
        const questionDataQ2 = await predictionsOracle.questions(questionId2);


        // get initial user positional token balances
        const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const conditionId = await conditionalToken.getConditionId(predictionsOracle.target, questionId, outcomeSlotCount);
        const conditionIdQ2 = await conditionalToken.getConditionId(predictionsOracle.target, questionId2, outcomeSlotCount);

        const collectionId1 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 1);
        const collectionId2 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 2);
        const collectionId1Q2 = await conditionalToken.getCollectionId(parentCollectionId, conditionIdQ2, 1);
        const collectionId2Q2 = await conditionalToken.getCollectionId(parentCollectionId, conditionIdQ2, 2);

        const positionId1 = await conditionalToken.getPositionId(token.target, collectionId1);
        const positionId2 = await conditionalToken.getPositionId(token.target, collectionId2);
        const positionId1Q2 = await conditionalToken.getPositionId(token.target, collectionId1Q2);
        const positionId2Q2 = await conditionalToken.getPositionId(token.target, collectionId2Q2);

        const userInitialBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1, positionId2]);
        const userInitialBalancesQ2 = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1Q2, positionId2Q2]);

        console.log("userInitialBalances", userInitialBalances);
        console.log("userInitialBalances Q2", userInitialBalancesQ2);

        expect(userInitialBalances[0]).to.be.equal(0);
        expect(userInitialBalances[1]).to.be.equal(0);

        expect(userInitialBalancesQ2[0]).to.be.equal(0);
        expect(userInitialBalancesQ2[1]).to.be.equal(0);

        const buyAmount = BigInt("1000000000000000000");

        // calc expected buy amount
        const fpmmAddress = questionData[3]
        const fpmmAddressQ2 = questionDataQ2[3]

        const outcomeIndex = 1;
        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(fpmmAddress);
        const fpmmQ2 = await fpmmContract.attach(fpmmAddressQ2);
        const expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);
        const expectedBuyAmountQ2 = await fpmmQ2.calcBuyAmount(buyAmount, outcomeIndex);

        console.log("expectedBuyAmount", expectedBuyAmount);
        console.log("expectedBuyAmountQ2", expectedBuyAmountQ2);

        // approve predictionsOracle to spend owner's tokens
        await token.approve(predictionsOracle.target, buyAmount * BigInt(2));

        // buy position on behalf of user
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        // buy for second question
        await expect(predictionsOracle.buyPosition(
            questionId2,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        const userEndBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1, positionId2]);
        const userEndBalancesQ2 = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1Q2, positionId2Q2]);

        console.log("userEndBalances", userEndBalances);
        console.log("userEndBalances Q2", userEndBalancesQ2);

        expect(userEndBalances[outcomeIndex]).to.be.equal(expectedBuyAmount);
        expect(userEndBalancesQ2[outcomeIndex]).to.be.equal(expectedBuyAmountQ2);

        // pass time to resolve market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // resolve market
        const payouts = [0, 1];
        const cid = "abcdefghijklmopqrstuvwxyz";

        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.proposeAnswer(questionId, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId)).to.emit(predictionsOracle, "MarketResolved");

        await expect(predictionsOracle.proposeAnswer(questionId2, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId2)).to.emit(predictionsOracle, "MarketResolved");

        // redeem position on behalf of user
        const indexSets = [1, 2];
        const startBalance = await token.balanceOf(otherAccount.address);

        await expect(predictionsOracle.connect(otherAccount).redeemPositions(10)).to.emit(predictionsOracle, "RedeemPosition");

        const endBalance = await token.balanceOf(otherAccount.address);

        // open positions should be empty
        const openPositions = await predictionsOracle.getUserOpenPositions(otherAccount.address);
        console.log("openPositions", openPositions);
        expect(openPositions.length).to.be.equal(0);

        console.log("startWPOPBalance", startBalance);
        console.log("endWPOPBalance after multiple Redeems", endBalance);

        expect(endBalance).to.be.gt(startBalance);

        // should only allow redemptions if there are open positions
        await expect(predictionsOracle.connect(otherAccount).redeemPositions(10)).to.be.revertedWith("No open positions to redeem");

    });

    it("Should correctly handle market answer proposal and resolutions", async function () {

        const {
            predictionsOracle,
            questionId,
            questionId2,
            endTime,
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();
        const payouts = [0, 1];
        const cid = "abcdefghijklmopqrstuvwxyz";

        // should fail if market is not found
        await expect(
            predictionsOracle.resolveMarket("0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999")
        ).to.be.revertedWith("Market has not been initialized");

        // should fail if answer is not proposed
        await expect(
            predictionsOracle.resolveMarket(questionId)
        ).to.be.revertedWith("Answer has not been proposed");

        // should fail if market is still active
        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.proposeAnswer(questionId, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(
            predictionsOracle.resolveMarket(questionId)
        ).to.be.revertedWith("Market still has time left");

        // should fail to propose if market not found
        await expect(
            predictionsOracle.proposeAnswer("0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999", payouts, cid)
        ).to.be.revertedWith("Market has not been initialized");

        // pass time to resolve market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // resolve market
        await expect(predictionsOracle.proposeAndResolve(
            questionId,
            payouts,
            cid
        )
        ).to.emit(predictionsOracle, "MarketResolved")
        .to.emit(predictionsOracle, "AnswerProposed");

        // resolve second market with individual functions
        await expect(predictionsOracle.proposeAnswer(questionId2, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId2)).to.emit(predictionsOracle, "MarketResolved");

    });

    it("Should successfully buy and redeem multiple positions but ignore unresolved positions", async function () {

        const {
            token,
            predictionsOracle,
            conditionalToken,
            questionId,
            questionId2,
            endTime,
            outcomeSlotCount
        } = await loadFixture(deploy);


        const [owner, otherAccount] = await ethers.getSigners();
        const questionData = await predictionsOracle.questions(questionId);
        const questionDataQ2 = await predictionsOracle.questions(questionId2);


        // get initial user positional token balances
        const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const conditionId = await conditionalToken.getConditionId(predictionsOracle.target, questionId, outcomeSlotCount);
        const conditionIdQ2 = await conditionalToken.getConditionId(predictionsOracle.target, questionId2, outcomeSlotCount);

        const collectionId1 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 1);
        const collectionId2 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 2);
        const collectionId1Q2 = await conditionalToken.getCollectionId(parentCollectionId, conditionIdQ2, 1);
        const collectionId2Q2 = await conditionalToken.getCollectionId(parentCollectionId, conditionIdQ2, 2);

        const positionId1 = await conditionalToken.getPositionId(token.target, collectionId1);
        const positionId2 = await conditionalToken.getPositionId(token.target, collectionId2);
        const positionId1Q2 = await conditionalToken.getPositionId(token.target, collectionId1Q2);
        const positionId2Q2 = await conditionalToken.getPositionId(token.target, collectionId2Q2);

        const userInitialBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1, positionId2]);
        const userInitialBalancesQ2 = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1Q2, positionId2Q2]);

        console.log("userInitialBalances", userInitialBalances);
        console.log("userInitialBalances Q2", userInitialBalancesQ2);

        expect(userInitialBalances[0]).to.be.equal(0);
        expect(userInitialBalances[1]).to.be.equal(0);

        expect(userInitialBalancesQ2[0]).to.be.equal(0);
        expect(userInitialBalancesQ2[1]).to.be.equal(0);

        const buyAmount = BigInt("1000000000000000000");

        // calc expected buy amount
        const fpmmAddress = questionData[3]
        const fpmmAddressQ2 = questionDataQ2[3]

        const outcomeIndex = 1;
        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(fpmmAddress);
        const fpmmQ2 = await fpmmContract.attach(fpmmAddressQ2);
        const expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);
        const expectedBuyAmountQ2 = await fpmmQ2.calcBuyAmount(buyAmount, outcomeIndex);

        console.log("expectedBuyAmount", expectedBuyAmount);
        console.log("expectedBuyAmountQ2", expectedBuyAmountQ2);

        // approve predictionsOracle to spend owner's tokens
        await token.approve(predictionsOracle.target, buyAmount * BigInt(2));

        // buy position on behalf of user
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        // buy for second question
        await expect(predictionsOracle.buyPosition(
            questionId2,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        const userEndBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1, positionId2]);
        const userEndBalancesQ2 = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], [positionId1Q2, positionId2Q2]);

        console.log("userEndBalances", userEndBalances);
        console.log("userEndBalances Q2", userEndBalancesQ2);

        expect(userEndBalances[outcomeIndex]).to.be.equal(expectedBuyAmount);
        expect(userEndBalancesQ2[outcomeIndex]).to.be.equal(expectedBuyAmountQ2);

        // pass time to resolve market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // resolve market
        const payouts = [0, 1];
        const cid = "abcdefghijklmopqrstuvwxyz";

        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.proposeAnswer(questionId, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId)).to.emit(predictionsOracle, "MarketResolved");

        // await expect(predictionsOracle.proposeAnswer(questionId2, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        // await expect(predictionsOracle.resolveMarket(questionId2)).to.emit(predictionsOracle, "MarketResolved");

        // redeem position on behalf of user
        const indexSets = [1, 2];
        const startBalance = await token.balanceOf(otherAccount.address);

        await expect(predictionsOracle.connect(otherAccount).redeemPositions(10)).to.emit(predictionsOracle, "RedeemPosition");

        const endBalance = await token.balanceOf(otherAccount.address);

        // open positions should be empty
        const openPositions = await predictionsOracle.getUserOpenPositions(otherAccount.address);
        console.log("openPositions", openPositions);
        expect(openPositions.length).to.be.equal(1);

        console.log("startWPOPBalance", startBalance);
        console.log("endWPOPBalance after multiple Redeems", endBalance);

        expect(endBalance).to.be.gt(startBalance);

        // should only allow redemptions if there are open positions
        await expect(predictionsOracle.connect(otherAccount).redeemPositions(10)).to.be.revertedWith("Unable to redeem positions, resolution pending. Please try again later.");

    });

    it("Should successfully restrict buying for an inactive market", async function () {

        const {
            token,
            predictionsOracle,
            questionId,
            endTime,
        } = await loadFixture(deploy);


        const [owner, otherAccount] = await ethers.getSigners();

        // send collateral token to other account
        const buyAmount = BigInt("1000000000000000000");

        // pass time to inactive market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // attempt to buy position in inactive market
        const outcomeIndex = 1;

        // approve predictionsOracle to spend owner's tokens
        await token.approve(predictionsOracle.target, buyAmount);

        // buy position on behalf of user
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.be.revertedWith("market is not active");

    });

    it("Should prevent buying with incorrect amounts", async function () {

        const {
            token,
            predictionsOracle,
            questionId
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        const minBuyAmount = BigInt("1000000000000000");

        // test with insufficient allowance
        await expect(predictionsOracle.buyPosition(
            questionId,
            1,
            minBuyAmount,
            0,
            owner.address
        )).to.be.revertedWith("Insufficient allowance");

        // approve predictionsOracle to spend owner's tokens
        await token.approve(predictionsOracle.target, minBuyAmount);

        // proposers can buy positions
        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.buyPosition(
            questionId,
            1,
            minBuyAmount,
            0,
            owner.address
        )).to.emit(predictionsOracle, "BuyPosition");

        // buy should fail if amount is greater than max buy amount
        const newMaxBuyAmount = BigInt("1000000000000000000");
        await predictionsOracle.updateMaxBuyAmountPerQuestion(newMaxBuyAmount);
        const maxBuyAmount = await predictionsOracle.maxBuyAmountPerQuestion();
        const invalidMaxBuyAmount = maxBuyAmount + BigInt(1);

        await token.approve(predictionsOracle.target, invalidMaxBuyAmount);

        await expect(predictionsOracle.buyPosition(
            questionId,
            1,
            invalidMaxBuyAmount,
            0,
            owner.address
        )).to.be.revertedWith('Amount exceeds maximum buy amount per question');   

    });

    it("Should return the correct remaining buy amount for a user", async function () {

        const {
            token,
            predictionsOracle,
            questionId,
            endTime,
            outcomeSlotCount,
            addedFunds
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        // set max buy amount
        const maxBuyAmount = addedFunds;
        await predictionsOracle.updateMaxBuyAmountPerQuestion(maxBuyAmount);

        const initialRemainingBuyAmount = await predictionsOracle.getRemainingBuyAmount(
            questionId,
            otherAccount.address
        );
        expect(initialRemainingBuyAmount).to.be.equal(addedFunds);

        // buy position on behalf of user
        const buyAmount = addedFunds / BigInt(2);
        const outcomeIndex = 1;

        await token.approve(predictionsOracle.target, buyAmount);

        await predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        );

        const remainingBuyAmount = await predictionsOracle.getRemainingBuyAmount(
            questionId,
            otherAccount.address
        );
        expect(remainingBuyAmount).to.be.equal(addedFunds - buyAmount);


    });

    it('Should successfully increment unique buys in the fpmm contract', async function () {

        const {
            token,
            predictionsOracle,
            questionId,
        } = await loadFixture(deploy);

        const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();

        const accounts = [otherAccount, otherAccount2, otherAccount3]

        // send collateral token to other accounts
        const buyAmount = BigInt("1000000000000000000");

        // approve predictionsOracle for all buys
        await token.approve(predictionsOracle.target, buyAmount * BigInt(accounts.length + 1));

        // buy position on multiple accounts
        const outcomeIndex = 1;

        for (const account of accounts) {
            await predictionsOracle.buyPosition(
                questionId,
                outcomeIndex,
                buyAmount,
                0,
                account.address
            );
        }

        // check unique buys
        expect(await predictionsOracle.getUniqueBuys(
            questionId
        )).to.be.equal(accounts.length);

        // buy again with another account, shouldn't increment unique buys
        await predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount3.address
        );

        // check unique buys
        expect(await predictionsOracle.getUniqueBuys(
            questionId
        )).to.be.equal(accounts.length);

    });

    it('Should successfully return market data from oracle contract', async function () {

        const {
            token,
            predictionsOracle,
            questionId,
            endTime,
            outcomeSlotCount
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        // buy position to increment unique buys
        const buyAmount = BigInt("1000000000000000000");
        const outcomeIndex = 1;

        // send collateral token to other account
        await token.transfer(otherAccount.address, buyAmount);
        // approve oracle to spend pop tokens
        await token.connect(otherAccount).approve(predictionsOracle.target, buyAmount);

        await predictionsOracle.connect(otherAccount).buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        );

        // get market data
        const marketData = await predictionsOracle.getMarketData(questionId);
        console.log("marketData", marketData);

        // get buy price for 1 token for each outcome
        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(marketData[0][3]);
        let buyPrice0 = await fpmm.calcBuyAmount(BigInt("1000000000000000000"), 0);
        let buyPrice1 = await fpmm.calcBuyAmount(BigInt("1000000000000000000"), 1);
        buyPrice0 = buyPrice0.toString();
        buyPrice1 = buyPrice1.toString();

        console.log("buyPrice0", buyPrice0);
        console.log("buyPrice1", buyPrice1);

        // check market data
        expect(marketData[0][1]).to.be.equal(endTime);
        expect(marketData[0][2]).to.be.equal(outcomeSlotCount);
        expect(marketData[2]).to.be.equal(1);

        let marketDataPrice0 = marketData[4][0].toString();
        let marketDataPrice1 = marketData[4][1].toString();

        expect(marketDataPrice0).to.be.equal(buyPrice0);
        expect(marketDataPrice1).to.be.equal(buyPrice1);

    });

    it("Should only allow redemption if sender has a position", async function () {

        const {
            token,
            predictionsOracle,
            questionId,
            endTime,
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        const buyAmount = BigInt("1000000000000000000");
        const outcomeIndex = 1;

        // approve predictionsOracle to spend owner's tokens
        await token.approve(predictionsOracle.target, buyAmount);

        // buy position on behalf of user
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        // pass time to resolve market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // resolve market
        const payouts = [0, 1];
        const cid = "abcdefghijklmopqrstuvwxyz";

        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.proposeAnswer(questionId, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId)).to.emit(predictionsOracle, "MarketResolved");

        // redeem position on behalf of user
        const indexSets = [1, 2];
        const startBalance = await token.balanceOf(otherAccount.address);

        // getPositionBalances should return at least one non-zero balance
        const startPositionBalances = await predictionsOracle.getPositionBalances(questionId, indexSets, otherAccount.address);
        console.log("startPositionBalances", startPositionBalances);
        expect(startPositionBalances.reduce((sum, x) => BigInt(sum) + BigInt(x), 0)).to.be.gt(0);
        const openPositions = await predictionsOracle.getUserOpenPositions(otherAccount.address);
        expect(openPositions.length).to.be.equal(1);
        expect(openPositions[0]).to.be.equal(questionId);
        await expect(predictionsOracle.connect(otherAccount).redeemPosition(
            questionId,
            indexSets)).to.emit(predictionsOracle, "RedeemPosition");

        const endBalance = await token.balanceOf(otherAccount.address);

        console.log("startWPOPBalance", startBalance);
        console.log("endWPOPBalance", endBalance);

        // first redemption should succeed
        expect(endBalance).to.be.gt(startBalance);

        // getPositionBalances should return zero balances
        const endPositionBalances = await predictionsOracle.getPositionBalances(questionId, indexSets, otherAccount.address);
        expect(endPositionBalances.reduce((sum, x) => BigInt(sum) + BigInt(x), 0)).to.be.equal(0);
        console.log("endPositionBalances", endPositionBalances);

        // second redemption should fail because sender has no positions
        await expect(predictionsOracle.connect(otherAccount).redeemPosition(
            questionId,
            indexSets)).to.be.revertedWith("No positions to redeem");

    });

    it("Should successfully sell a position in a market", async function () {

        const {
            token,
            predictionsOracle,
            questionId,
            conditionalToken,
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        const questionData = await predictionsOracle.questions(questionId);
        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(questionData[3]);
        const positionIds = await fpmm.getPositionIds();

        const accounts = [];
        for (let i = 0; i < positionIds.length; i++) {
            accounts.push(fpmm.target);
        }

        const idArray = Array.from(positionIds);

        let fpmmBalances = await conditionalToken.balanceOfBatch(accounts, idArray);
        console.log("initial fpmmBalances", fpmmBalances);

        // buy position on behalf of user
        const buyAmount = BigInt("1000000000000000000");
        const outcomeIndex = 1;

        await token.approve(predictionsOracle.target, buyAmount);

        await predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        );

        fpmmBalances = await conditionalToken.balanceOfBatch(accounts, idArray);
        console.log("fpmmBalances after buy", fpmmBalances);

        // const otherAccountBalances = await predictionsOracle.getPositionBalances(questionId, [1,2], otherAccount.address);
        const otherAccountBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], idArray);

        console.log("otherAccountBalances", otherAccountBalances);
        console.log("input", otherAccountBalances[outcomeIndex]);

        // const returnAmount = await fpmm.calcReturnAmount(otherAccountBalances[outcomeIndex], outcomeIndex);
        // console.log("returnAmount", returnAmount);

        // manually setting expected return amount until calc method is finalized
        const returnAmount = BigInt("999999999999999999");

        const calcSell = await fpmm.calcSellAmount(returnAmount, outcomeIndex);
        console.log("calcSell", calcSell);
        
        const indexSets = [1, 2];
        const startPLTBalance = await token.balanceOf(otherAccount.address);
        const startPositionBalances = await predictionsOracle.getPositionBalances(questionId, indexSets, otherAccount.address);

        // allow selling of positions in oracle contract
        await predictionsOracle.updateSellEnabled(true);

        // approve oracle contract to spend plt tokens from otheraccount and sell position
        await conditionalToken.connect(otherAccount).setApprovalForAll(predictionsOracle.target, true);

        await expect(predictionsOracle.connect(otherAccount).sellPosition(
            questionId, 
            returnAmount,
            outcomeIndex,
            startPositionBalances[outcomeIndex]
        )).to.emit(predictionsOracle, "SellPosition");

        const endPLTBalance = await token.balanceOf(otherAccount.address);
        const endPositionBalances = await predictionsOracle.getPositionBalances(questionId, indexSets, otherAccount.address);

        console.log("startPLTBalance", startPLTBalance);
        console.log("endPLTBalance", endPLTBalance);

        console.log("startPositionBalances", startPositionBalances);
        console.log("endPositionBalances", endPositionBalances);

        expect(endPLTBalance).to.be.gt(startPLTBalance);

        // balance remaining after selling all tokens should be near 0 due to fpmm's calcSellAmount rounding
        expect(endPositionBalances[outcomeIndex]).to.be.closeTo(0, 1);

    });

    it("Should create a market without sending funds if the contract is funded", async function () {

        const {
            token,
            predictionsOracle,
            addedFunds
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        const contractFunds = ethers.parseUnits("100", 18)
        await token.transfer(predictionsOracle.target, contractFunds);

        const contractBalance = await token.balanceOf(predictionsOracle.target);
        expect(contractBalance).to.be.gt(0);

        const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
        const endTime = blockTimestamp + 3600;
        const outcomeSlotCount = 2;
        const fee = 0;
        const distributionHints = [1, 1];
        const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999";
        
        // create market without sending value
        await predictionsOracle.createMarket(
            endTime,
            questionId,
            outcomeSlotCount,
            fee,
            distributionHints,
            addedFunds
        );

        const questionData = await predictionsOracle.questions(questionId);
        const fpmmAddress = questionData[3];
        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(fpmmAddress);
        const funds = await fpmm.balanceOf(predictionsOracle.target);
        expect(funds).to.be.equal(addedFunds);

    });

    it("Should fail to create a market with improper funding", async function () {

        const {
            token,
            predictionsOracle,
            addedFunds
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
        const endTime = blockTimestamp + 3600;
        const outcomeSlotCount = 2;
        const fee = 0;
        const distributionHints = [1, 1];
        const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999";

        const contractBalance = await token.balanceOf(predictionsOracle.target);
        const fundingAmount = contractBalance + BigInt(1);

        // create market with insufficient funds
        await expect(predictionsOracle.createMarket(
            endTime,
            questionId,
            outcomeSlotCount,
            fee,
            distributionHints,
            fundingAmount
        )).to.be.revertedWith("Insufficient funds");
    
    });

    it("Should fail to create a market with invalid end time", async function () {

        const {
            token,
            predictionsOracle,
            addedFunds
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
        const minEndTime = await predictionsOracle.stopTradingBeforeMarketEnd();
        const invalidEndTime = BigInt(blockTimestamp) + minEndTime - BigInt(1);

        const outcomeSlotCount = 2;
        const fee = 0;
        const distributionHints = [1, 1];
        const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999";

        await token.transfer(predictionsOracle.target, addedFunds);

        // create market with invalid end time
        await expect(predictionsOracle.createMarket(
            invalidEndTime,
            questionId,
            outcomeSlotCount,
            fee,
            distributionHints,
            addedFunds
        )).to.be.revertedWith("Market End timestamp is too close to current time");

    });


    it("Should successfully update the state variables", async function () {

        const {
            predictionsOracle,
            questionId,
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        // min buy amount
        const newMinBuyAmount = BigInt("1000000000000000000");

        await predictionsOracle.updateMinBuyAmount(newMinBuyAmount);
        expect(await predictionsOracle.minBuyAmount()).to.be.equal(newMinBuyAmount);

        // stop trading time
        const newStopTradingTime = 3600;

        await predictionsOracle.updateStopTradingBeforeMarketEnd(newStopTradingTime);
        expect(await predictionsOracle.stopTradingBeforeMarketEnd()).to.be.equal(newStopTradingTime);

    });

    it("Should successfully emergency withdraw funds from the oracle contract", async function () {

        const {
            token,
            predictionsOracle,
            addedFunds
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        // Transfer some funds to the oracle contract to test emergency withdraw
        const amountToWithdraw = ethers.parseUnits("100", 18);
        await token.transfer(predictionsOracle.target, amountToWithdraw);

        const contractPopBalance = await token.balanceOf(predictionsOracle.target);
        expect(contractPopBalance).to.be.equal(amountToWithdraw);

        const ownerStartBalance = await token.balanceOf(owner.address);
        await predictionsOracle.emergencyWithdraw();
        const ownerEndBalance = await token.balanceOf(owner.address);

        expect(ownerEndBalance).to.be.gt(ownerStartBalance);
        expect(ownerEndBalance).to.be.equal(ownerStartBalance + amountToWithdraw);

        const finalContractPopBalance = await token.balanceOf(predictionsOracle.target);
        expect(finalContractPopBalance).to.be.equal(0);

    });

    it("Should succesfully recover the funding token", async function () {

        const {
            token,
            predictionsOracle,
            questionId,
            endTime,
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        // pass time to resolve market
        const blockNumber = await hre.ethers.provider.getBlockNumber();
        const block = await hre.ethers.provider.getBlock(blockNumber);
        const timestamp = block.timestamp;

        await hre.ethers.provider.send('evm_increaseTime', [endTime - timestamp]);

        // resolve market
        const payouts = [0, 1];
        const cid = "abcdefghijklmopqrstuvwxyz";

        await predictionsOracle.updateProposers([owner.address], [1]);
        await expect(predictionsOracle.proposeAnswer(questionId, payouts, cid)).to.emit(predictionsOracle, "AnswerProposed");
        await expect(predictionsOracle.resolveMarket(questionId)).to.emit(predictionsOracle, "MarketResolved");

        const questionData = await predictionsOracle.questions(questionId);
        const fpmmAddress = questionData[3];

        const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
        const fpmm = await fpmmContract.attach(fpmmAddress);
        const funds = await fpmm.balanceOf(predictionsOracle.target);
        console.log("funds to redeem", funds);
        const indexSets = [1, 2];

        await expect(
            predictionsOracle.recoverFundingToken(questionId, indexSets)
        ).to.emit(predictionsOracle, "FundingRecovered").withArgs(questionId, funds, owner.address);

        // should fail to recover funds if none are present
        await expect(
            predictionsOracle.recoverFundingToken(questionId, indexSets)
        ).to.be.revertedWith("No funding token to recover.");

    });

    it("Should handle the getting and setting of initializers/proposers", async function () {

        const {
            predictionsOracle,
        } = await loadFixture(deploy);

        const [owner, otherAccount, otherAccount2] = await ethers.getSigners();

        let initializers = await predictionsOracle.getInitializers();
        expect(initializers.length).to.be.equal(1);
        expect(initializers[0]).to.be.equal(owner.address);

        let proposers = await predictionsOracle.getProposers();
        expect(proposers.length).to.be.equal(0);

        // update initializers
        const newInitializers = [otherAccount.address, otherAccount2.address];
        const newInitializersStatus = [1, 1];
        await predictionsOracle.updateInitializers(
            newInitializers,
            newInitializersStatus
        );
        initializers = await predictionsOracle.getInitializers();
        expect(initializers.length).to.be.equal(3);
        expect(initializers[1]).to.be.equal(otherAccount.address);

        // update proposers
        const newProposers = [otherAccount.address, otherAccount2.address];
        const newProposersStatus = [1, 1];
        await predictionsOracle.updateProposers(
            newProposers,
            newProposersStatus
        );
        proposers = await predictionsOracle.getProposers();
        expect(proposers.length).to.be.equal(2);
        expect(proposers[0]).to.be.equal(otherAccount.address);

        // remove initializer privileges
        const newInitializersStatus2 = [0, 0];
        await predictionsOracle.updateInitializers(
            newInitializers,
            newInitializersStatus2
        );
        initializers = await predictionsOracle.getInitializers();
        expect(initializers.length).to.be.equal(1);
        expect(initializers[0]).to.be.equal(owner.address);

        // remove proposer privileges
        const newProposersStatus2 = [0, 0];
        await predictionsOracle.updateProposers(
            newProposers,
            newProposersStatus2
        );
        proposers = await predictionsOracle.getProposers();
        expect(proposers.length).to.be.equal(0);

        // should fail to update initializers with invalid array lengths
        await expect(
            predictionsOracle.updateInitializers(
                [otherAccount.address],
                [1, 1]
            )
        ).to.be.revertedWith("Input lengths do not match");

        // should fail to update proposers with invalid array lengths
        await expect(
            predictionsOracle.updateProposers(
                [otherAccount.address],
                [1, 1]
            )
        ).to.be.revertedWith("Input lengths do not match");

    });

    it("Should restrict onlyOwner functions to the owner", async function () {

        const {
            predictionsOracle,
            conditionalToken,
            fpmmFactory,
            token
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        await expect(
            predictionsOracle.connect(otherAccount).updateContracts(
                conditionalToken.target,
                fpmmFactory.target,
                token.target
            )
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).updateMinBuyAmount(1)
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).updateMaxBuyAmountPerQuestion(1)
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).updateStopTradingBeforeMarketEnd(1)
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).updateSellEnabled(false)
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).updateProposers(
                [otherAccount.address],
                [1]
            )
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).updateInitializers(
                [otherAccount.address],
                [1]
            )
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

        await expect(
            predictionsOracle.connect(otherAccount).emergencyWithdraw()
        ).to.be.revertedWithCustomError(predictionsOracle, "OwnableUnauthorizedAccount");

    });

    it("Should restrict onlyInitializer functions to the initializers", async function () {

        const {
            predictionsOracle,
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        await expect(
            predictionsOracle.connect(otherAccount).createMarket(
                1,
                "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999",
                2,
                0,
                [1, 1],
                1
            )
        ).to.be.revertedWith('Only initializer can call this function.');

        await expect(
            predictionsOracle.connect(otherAccount).recoverFundingToken(
                "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999",
                [1, 2]
            )
        ).to.be.revertedWith('Only initializer can call this function.');

    });

    it("Should restrict onlyProposer functions to the proposers", async function () {

        const {
            predictionsOracle,
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        await expect(
            predictionsOracle.connect(otherAccount).proposeAnswer(
                "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999",
                [0, 1],
                "abcdefghijklmopqrstuvwxyz"
            )
        ).to.be.revertedWith('Only proposer can call this function.');

        await expect(
            predictionsOracle.connect(otherAccount).proposeAndResolve(
                "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999",
                [0, 1],
                "abcdefghijklmopqrstuvwxyz"
            )
        ).to.be.revertedWith('Only proposer can call this function.');

    });

    it("Should correctly return the position balances for a user", async function () {
            
            const {
                token,
                predictionsOracle,
                questionId,
                addedFunds
            } = await loadFixture(deploy);
    
            const [owner, otherAccount] = await ethers.getSigners();
            const questionData = await predictionsOracle.questions(questionId);
            
            const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
            const fpmm = await fpmmContract.attach(questionData[3]);

            // buy position on behalf of user
            const buyAmount = BigInt("1000000000000000000");
            const outcomeIndex = 1;
            const expectedReturn = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);
    
            await token.approve(predictionsOracle.target, buyAmount);

            await predictionsOracle.buyPosition(
                questionId,
                outcomeIndex,
                buyAmount,
                0,
                otherAccount.address
            );
    
            const indexSets = [1, 2];
            const positionBalances = await predictionsOracle.getPositionBalances(questionId, indexSets, otherAccount.address);
            console.log("positionBalances", positionBalances);
    
            expect(positionBalances.length).to.be.equal(2);
            expect(positionBalances[0]).to.be.equal(0);
            expect(positionBalances[1]).to.be.equal(expectedReturn);

            // should return 0 balances for a user with no positions
            const positionBalances2 = await predictionsOracle.getPositionBalances(questionId, indexSets, owner.address);
            console.log("positionBalances2", positionBalances2);
            expect(positionBalances2.length).to.be.equal(2);
            expect(positionBalances2[0]).to.be.equal(0);
            expect(positionBalances2[1]).to.be.equal(0);

            // should fail to get balances for invalid market
            await expect(predictionsOracle.getPositionBalances(
                "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684999", 
                indexSets, 
                owner.address
            )).to.be.revertedWith("Market has not been initialized");

            // should fail to get balances for invalid index set
            await expect(predictionsOracle.getPositionBalances(
                questionId, 
                [1, 3], 
                owner.address
            )).to.be.revertedWith("Got invalid index set");
    
        });

    it("Should successfully emergency withdraw ETH from the oracle contract", async function () {

        const {
            predictionsOracle,
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        const amountToSend = ethers.parseEther("1.0");
        await owner.sendTransaction({
            to: predictionsOracle.target,
            value: amountToSend,
        });

        const contractEthBalance = await hre.ethers.provider.getBalance(predictionsOracle.target);
        expect(contractEthBalance).to.be.equal(amountToSend);

        const ownerStartBalance = await hre.ethers.provider.getBalance(owner.address);

        const tx = await predictionsOracle.emergencyWithdrawETH();
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;

        const ownerEndBalance = await hre.ethers.provider.getBalance(owner.address);

        expect(ownerEndBalance).to.be.equal(ownerStartBalance + amountToSend - gasUsed);

        const finalContractEthBalance = await hre.ethers.provider.getBalance(predictionsOracle.target);
        expect(finalContractEthBalance).to.be.equal(0);

    });

    it("Should successfully buy a position for another user with buyPosition", async function () {
        const { token, conditionalToken, predictionsOracle, questionId } = await loadFixture(deploy);
        const [owner, otherAccount] = await ethers.getSigners();

        const buyAmount = ethers.parseEther("1");
        const outcomeIndex = 1;

        // owner buys for otherAccount
        await token.approve(predictionsOracle.target, buyAmount);
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            0,
            otherAccount.address
        )).to.emit(predictionsOracle, "BuyPosition");

        // Check that otherAccount received the conditional tokens
        const questionData = await predictionsOracle.questions(questionId);
        const fpmm = await hre.ethers.getContractAt("FixedProductMarketMaker", questionData.fpmm);
        const positionIds = await fpmm.getPositionIds();
        const balance = await conditionalToken.balanceOf(otherAccount.address, positionIds[outcomeIndex]);
        expect(balance).to.be.gt(0);
    });

    it("Should fail to buy if slippage protection is triggered", async function () {
        const { token, predictionsOracle, questionId } = await loadFixture(deploy);
        const [owner, otherAccount] = await ethers.getSigners();

        const buyAmount = ethers.parseEther("2");
        const outcomeIndex = 1;

        const questionData = await predictionsOracle.questions(questionId);
        const fpmm = await hre.ethers.getContractAt("FixedProductMarketMaker", questionData.fpmm);
        const expectedTokens = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);

        const minTokensTooHigh = expectedTokens + BigInt(1);

        await token.approve(predictionsOracle.target, buyAmount * BigInt(2));

        // Test with buyPosition
        await expect(predictionsOracle.buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            minTokensTooHigh,
            otherAccount.address
        )).to.be.revertedWith("minimum buy amount not reached");

        // Test with buyPosition
        await token.transfer(otherAccount.address, buyAmount);
        await token.connect(otherAccount).approve(predictionsOracle.target, buyAmount);
        await expect(predictionsOracle.connect(otherAccount).buyPosition(
            questionId,
            outcomeIndex,
            buyAmount,
            minTokensTooHigh,
            otherAccount.address
        )).to.be.revertedWith("minimum buy amount not reached");
    });

    it("Should fail to redeem position with wrong number of index sets", async function () {
        const { token, predictionsOracle, questionId, endTime } = await loadFixture(deploy);
        const [owner, otherAccount] = await ethers.getSigners();

        // Setup: buy a position so there is something to redeem
        const buyAmount = ethers.parseEther("1");
        const outcomeIndex = 1;
        await token.approve(predictionsOracle.target, buyAmount);
        await predictionsOracle.buyPosition(questionId, outcomeIndex, buyAmount, 0, otherAccount.address);

        // Fast forward time
        await time.increaseTo(endTime + 1);

        // Resolve market
        await predictionsOracle.updateProposers([owner.address], [1]);
        await predictionsOracle.proposeAndResolve(questionId, [0, 1], "test-cid");

        const invalidIndexSets = [1]; // Not all sets provided

        await expect(
            predictionsOracle.connect(otherAccount).redeemPosition(questionId, invalidIndexSets)
        ).to.be.revertedWith("Invalid index sets");
    });

    it("Should fail to get position balances with invalid index set", async function () {
        const { predictionsOracle, questionId } = await loadFixture(deploy);
        const [owner] = await ethers.getSigners();
        const invalidIndexSets = [1, 3]; // For 2 outcomes, 3 is invalid.
        await expect(
            predictionsOracle.getPositionBalances(questionId, invalidIndexSets, owner.address)
        ).to.be.revertedWith("Got invalid index set");
    });

  });
