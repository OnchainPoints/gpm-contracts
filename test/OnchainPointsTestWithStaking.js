// const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
  time
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  expect
} = require("chai");

describe("Onchain Points with Staking", function () {


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
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deploy() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    // random account
    const randomAccount = ethers.Wallet.createRandom().connect(hre.ethers.provider);
    const randomAccount2 = ethers.Wallet.createRandom().connect(hre.ethers.provider);
    const tokenContract = await hre.ethers.getContractFactory("WPOP");
    const token = await tokenContract.deploy();

    const conditionalTokenContract = await hre.ethers.getContractFactory("ConditionalTokens");
    const conditionalToken = await conditionalTokenContract.deploy("TEST URI");

    const fpmmFactoryContract = await hre.ethers.getContractFactory("Factory");
    const fpmmFactory = await fpmmFactoryContract.deploy();

    const onchainPointsContract = await hre.ethers.getContractFactory("OnchainPoints");
    const onchainPoints = await upgrades.deployProxy(onchainPointsContract, [owner.address], {
      initializer: "initialize",
      kind: "uups"
    });


    const predictionOracleContract = await hre.ethers.getContractFactory("PredictionsOracle");
    const predictionsOracle = await upgrades.deployProxy(predictionOracleContract, [owner.address, ], {
      initializer: "initialize",
      kind: "uups"
    });

    const StakingContract = await hre.ethers.getContractFactory("StakingContract");
    const stakingContract = await upgrades.deployProxy(StakingContract, [30000000000000, 3000000000000, owner.address], {
        initializer: "initialize",
        kind: "uups"
    });

    const sendEthTx = await owner.sendTransaction({
      to: stakingContract.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`Staking Contract balance: ${await ethers.provider.getBalance(stakingContract.target)} POP`);


    // send eth to onchain points contract
    const sendEthTx1 = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx1.wait();
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);

    const sendEthTx2 = await owner.sendTransaction({
      to: randomAccount.address,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx2.wait();

    await onchainPoints.addStakedPoints({value: BigInt("10000000000000000000")});



    await stakingContract.stake({value: BigInt(10000)});
    await stakingContract.connect(otherAccount).stake({value: BigInt(10000)});
    await stakingContract.connect(randomAccount).stake({value: BigInt(10000)});
    await time.increase(10000);

    await predictionsOracle.updateContracts(
      conditionalToken.target, fpmmFactory.target, token.target, onchainPoints.target
    )

    await predictionsOracle.updateMaxBuyAmountPerQuestion(
      BigInt("10000000000000000000000")
    );

    await predictionsOracle.updateBuyWithUnlockedEnabled(true);

    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);
    await onchainPoints.setMaxDailySpending([1, 1]);
    await onchainPoints.setStakingContractAddress(stakingContract.target);
    await onchainPoints.updateMaxDailySpendingCap(BigInt("1000000000000000000000000"));

    // set oracle address on conditional token contract
    await conditionalToken.setOracleAddress(predictionsOracle.target);

    const addedFunds = BigInt("1000000000000000000000");
    const distributionHints = [1, 1];
    const endTime = Math.floor(Date.now() / 1000) + 86400*20;
    const outcomeSlotCount = 2;
    const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684333";
    const fee = 0;

    // update oracle initializers
    const initializers = [owner.address];
    const initializersStatus = [1];
    await expect(predictionsOracle.updateInitializers(
      initializers,
      initializersStatus
    )).to.emit(predictionsOracle, "InitializerUpdated");

    // mint WPOP tokens for owner address
    console.log('balance', await hre.ethers.provider.getBalance(owner.address));
    await token.deposit({
      value: BigInt("10000000000000000000")
    });

    

    // create new market
    await predictionsOracle.createMarket(
      endTime,
      questionId,
      outcomeSlotCount,
      fee,
      distributionHints, 
      addedFunds,
      {
        value: addedFunds
      }
    );

    return {
      token,
      randomAccount,
      randomAccount2,
      conditionalToken,
      fpmmFactory,
      predictionsOracle,
      questionId,
      endTime,
      outcomeSlotCount,
      addedFunds,
      onchainPoints,
      stakingContract
    };
  }

  it("Should successfully buy and redeem a position in a market on behalf of a user using signatures", async function () {

    const {
      token,
      randomAccount,
      predictionsOracle,
      conditionalToken,
      questionId,
      endTime,
      outcomeSlotCount,
      onchainPoints,
      stakingContract
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

    let randomAccountAvailableSpending = await onchainPoints.getAvailableSpending(randomAccount.address);
    console.log("randomAccountAvailableSpending", randomAccountAvailableSpending);

    const buyAmount = BigInt(randomAccountAvailableSpending);

    // calc expected buy amount
    const fpmmAddress = questionData[3]
    const outcomeIndex = 1;
    const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
    const fpmm = await fpmmContract.attach(fpmmAddress);
    const expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);

    console.log("expectedBuyAmount", expectedBuyAmount);

    // buy position on behalf of user
    const sig_data = await generateSignature(randomAccount, onchainPoints.target, "testNonce1", buyAmount)

    console.log("sig_data", sig_data);
    await onchainPoints.addAuthorizedAddress(otherAccount.address);

    const balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    console.log(await onchainPoints.connect(otherAccount).verify(sig_data.data, sig_data.signature), randomAccount.address);
    await expect(predictionsOracle.buyPositionWithSignature(
      questionId,
      outcomeIndex,
      0,
      sig_data.data,
      sig_data.signature)).to.emit(predictionsOracle, "BuyPosition");

    const balanceAfter = await hre.ethers.provider.getBalance(randomAccount.address);
    console.log("balanceBefore", balanceBefore);
    console.log("balanceAfter", balanceAfter);
    const userEndBalances = await conditionalToken.balanceOfBatch([randomAccount.address, randomAccount.address], [positionId1, positionId2]);

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

    // // redeem position on behalf of user
    const indexSets = [1, 2];
    const startBalance = await hre.ethers.provider.getBalance(randomAccount.address);
    console.log("market resolved")
    await expect(predictionsOracle.connect(randomAccount).redeemPosition(
      questionId,
      indexSets)).to.emit(predictionsOracle, "RedeemPosition");

    const endBalance = await hre.ethers.provider.getBalance(randomAccount.address);

    console.log("startWPOPBalance", startBalance);
    console.log("endWPOPBalance", endBalance);

    expect(endBalance).to.be.gt(startBalance);

    // spentStakingPoints
    let spentStakingPoints = await onchainPoints.spentStakingPoints(randomAccount.address);
    console.log("spentStakingPoints", spentStakingPoints);

  })
  it("Should fail if user tries to spend more than his balance", async function () {

    const {
      token,
      randomAccount,
      predictionsOracle,
      conditionalToken,
      questionId,
      endTime,
      outcomeSlotCount,
      onchainPoints,
      stakingContract
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

    let randomAccountAvailableSpending = await onchainPoints.getAvailableSpending(randomAccount.address);
    console.log("randomAccountAvailableSpending", randomAccountAvailableSpending);

    const buyAmount = BigInt(randomAccountAvailableSpending*2n);

    // calc expected buy amount
    const fpmmAddress = questionData[3]
    const outcomeIndex = 1;
    const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
    const fpmm = await fpmmContract.attach(fpmmAddress);
    const expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);

    console.log("expectedBuyAmount", expectedBuyAmount);

    // buy position on behalf of user
    const sig_data = await generateSignature(randomAccount, onchainPoints.target, "testNonce1", buyAmount)

    console.log("sig_data", sig_data);
    await onchainPoints.addAuthorizedAddress(otherAccount.address);

    const balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    await expect(predictionsOracle.buyPositionWithSignature(
      questionId,
      outcomeIndex,
      0,
      sig_data.data,
      sig_data.signature)).to.be.revertedWith("Daily spending limit exceeded");

  })

});