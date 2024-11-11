// const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
  time
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  expect
} = require("chai");

describe("Social Bets", function () {


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

    await predictionsOracle.updateContracts(
      conditionalToken.target, fpmmFactory.target, token.target, onchainPoints.target
    )

    await predictionsOracle.updateMaxBuyAmountPerQuestion(
      BigInt("10000000000000000000000")
    );
    await predictionsOracle.updateBuyWithUnlockedEnabled(true);


    const socialBetsContract = await hre.ethers.getContractFactory("SocialBets");
    const socialBets = await upgrades.deployProxy(socialBetsContract, [owner.address, ], {
      initializer: "initialize",
      kind: "uups"
    });

    await socialBets.addOracleContract(predictionsOracle.target);
    await socialBets.updateSocialSpenders([otherAccount.address], [true])
    await socialBets.setMaxDailySocialSpending(BigInt("1000000000000000000"));
    await socialBets.setMaxSpendingCapPerUser(BigInt("10000000000000000000"));
    await socialBets.updateMaxBuyAmount(BigInt("1000000000000000000"));
    await socialBets.updateInitialGasDrop("1000000000000000000");


    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);
    await onchainPoints.adminUpdateBalance(otherAccount.address, BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateBalance(randomAccount.address, BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateBalance(randomAccount2.address, BigInt("1000000000000000000"));
    await onchainPoints.setMaxDailySpending([1, 1]);

    // set oracle address on conditional token contract
    await conditionalToken.setOracleAddress(predictionsOracle.target);

    const addedFunds = BigInt("1000000000000000000000");
    const distributionHints = [1, 1];
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

    const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const endTime = blockTimestamp + 3600000;

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
      socialBets
    };
  }

  it("Should successfully buy and redeem a position in a market on behalf of user using Social Bets", async function () {

    const {
      token,
      randomAccount,
      predictionsOracle,
      conditionalToken,
      questionId,
      endTime,
      outcomeSlotCount,
      onchainPoints,
      socialBets
    } = await loadFixture(deploy);

    const [owner, otherAccount] = await ethers.getSigners();

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: socialBets.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`Social Bets Contract balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);


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

    const balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);

    // check getMaxDailySpending
    expect(await socialBets.getMaxDailySpending(randomAccount.address)).to.be.equal(BigInt("1000000000000000000"));
    expect(await socialBets.getAvailableSpending(randomAccount.address)).to.be.equal(BigInt("1000000000000000000"));
    // buyPosition(bytes32 questionId, uint256 outcomeIndex, uint256 minOutcomeTokensToBuy, uint256 amount, address to, PredictionsOracle _oracleContract) external payable{
    await expect(socialBets.connect(otherAccount).buyPosition(
      questionId,
      outcomeIndex,
      0,
      BigInt("1000000000000000000"),
      randomAccount.address,
      predictionsOracle.target, {
        value: BigInt("1000000000000000000")
      },
    )).to.emit(socialBets, "SocialTokenSpent");

    const balanceAfter = await hre.ethers.provider.getBalance(randomAccount.address);
    console.log("balanceBefore", balanceBefore);
    console.log("balanceAfter", balanceAfter);
    const userEndBalances = await conditionalToken.balanceOfBatch([randomAccount.address, randomAccount.address], [positionId1, positionId2]);

    console.log("userEndBalances", userEndBalances);
    expect(userEndBalances[outcomeIndex]).to.be.equal(expectedBuyAmount);

    await expect(socialBets.connect(otherAccount).buyPosition(
      questionId,
      outcomeIndex,
      0,
      BigInt("1000000000000000000"),
      randomAccount.address,
      predictionsOracle.target, {
        value: BigInt("1000000000000000000")
      },
    )).to.be.revertedWith("Daily social spending limit exceeded");
    
    // increase evm time by 1 day
    // getAvailableSpending should be 0
    expect(await socialBets.getAvailableSpending(randomAccount.address)).to.be.equal(0);
    await time.increase(time.duration.days(1));
    expect(await socialBets.getAvailableSpending(randomAccount.address)).to.be.equal(BigInt("1000000000000000000"));

    // buy position again
    await expect(socialBets.connect(otherAccount).buyPosition(
      questionId,
      outcomeIndex,
      0,
      BigInt("1000000000000000000"),
      randomAccount.address,
      predictionsOracle.target, {
        value: BigInt("1000000000000000000")
      },
    )).to.emit(socialBets, "SocialTokenSpent");

    const userEndBalances2 = await conditionalToken.balanceOfBatch([randomAccount.address, randomAccount.address], [positionId1, positionId2]);
    expect(userEndBalances2[outcomeIndex]).to.be.gt(expectedBuyAmount);



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

  });

  it("Should successfully handle the initial gas drop and send funds to user", async function () {

    const {
      randomAccount,
      randomAccount2,
      predictionsOracle,
      questionId,
      onchainPoints,
      socialBets
    } = await loadFixture(deploy);

    const [owner, otherAccount] = await ethers.getSigners();

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: socialBets.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`Social Bets Contract balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);

    const newGasDrop = BigInt("2000000000000000000");

    await expect(socialBets.connect(owner).updateInitialGasDrop(newGasDrop)).to.emit(socialBets, "InitialGasDropUpdated");

    let balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    console.log("balanceBefore", balanceBefore);
    expect(balanceBefore).to.be.equal(0);

    // buy a social position on behalf of user
    const outcomeIndex = 1;
    const buyAmount = BigInt("1000000000000000000");
    await socialBets.updateSocialSpenders([owner.address], [true]);

    await expect(socialBets.buyPosition(
      questionId,
      outcomeIndex,
      0,
      buyAmount,
      randomAccount.address,
      predictionsOracle.target, {
        value: buyAmount
      },
    )).to.emit(socialBets, "InitialGasDrop");

    let balanceAfter = await hre.ethers.provider.getBalance(randomAccount.address);
    console.log("balanceAfter", balanceAfter);
    expect(balanceAfter).to.be.equal(newGasDrop);

    // should only give a single gas drop
    balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    expect(balanceBefore).to.be.equal(newGasDrop);

    const dailyMax = await socialBets.maxDailySocialSpending();
    await socialBets.setMaxDailySocialSpending(dailyMax + buyAmount);

    await expect(socialBets.buyPosition(
      questionId,
      outcomeIndex,
      0,
      buyAmount,
      randomAccount.address,
      predictionsOracle.target, {
        value: buyAmount
      },
    )).to.emit(socialBets, "SocialTokenSpent");

    balanceAfter = await hre.ethers.provider.getBalance(randomAccount.address);
    expect(balanceAfter).to.be.equal(newGasDrop);

    // should check that the sent amount accounts for the gas drop
    const initialGasDrop = await socialBets.initialGasDrop();
    await socialBets.emergencyWithdraw();

    const contractBalance = await hre.ethers.provider.getBalance(socialBets.target);
    console.log("contractBalance", contractBalance);
    expect(contractBalance).to.be.equal(0);

    // should revert since value does not account for gas drop
    await expect(socialBets.buyPosition(
      questionId,
      outcomeIndex,
      0,
      buyAmount,
      randomAccount2.address,
      predictionsOracle.target, {
        value: buyAmount
      },
    )).to.be.revertedWith("Insufficient balance in contract to cover total amount");

    await expect(socialBets.buyPosition(
      questionId,
      outcomeIndex,
      0,
      buyAmount,
      randomAccount2.address,
      predictionsOracle.target, {
        value: buyAmount + initialGasDrop
      },
    )).to.emit(socialBets, "InitialGasDrop");

    const balanceAfter2 = await hre.ethers.provider.getBalance(randomAccount2.address);
    expect(balanceAfter2).to.be.equal(initialGasDrop);

    // should revert if sent value is greater than value + gas drop
    const randomAccount3 = ethers.Wallet.createRandom().connect(hre.ethers.provider);
    await expect(socialBets.buyPosition(
      questionId,
      outcomeIndex,
      0,
      buyAmount,
      randomAccount3.address,
      predictionsOracle.target, {
        value: buyAmount + initialGasDrop + 1n
      },
    )).to.be.revertedWith("Incorrect amount sent");


  });

  it("Should correctly update social spenders", async function () {

    const {
      randomAccount,
      predictionsOracle,
      questionId,
      onchainPoints,
      socialBets
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2] = await ethers.getSigners();

    await expect(socialBets.updateSocialSpenders(
      [otherAccount.address, otherAccount2.address],
      [true, true]
    )).to.emit(socialBets, "SocialSpendersUpdated");
    // buy a social position on behalf of user with new social spender
    const outcomeIndex = 1;
    const buyAmount = BigInt("1000000000000000000");

    const initialGasDrop = await socialBets.initialGasDrop();

    await owner.sendTransaction({
      to: socialBets.target,
      value: initialGasDrop,
    });

    await expect(socialBets.connect(otherAccount2).buyPosition(
      questionId,
      outcomeIndex,
      0,
      buyAmount,
      randomAccount.address,
      predictionsOracle.target, {
        value: buyAmount
      },
    )).to.emit(socialBets, "SocialTokenSpent");

  });

});