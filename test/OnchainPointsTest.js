// const { ethers, upgrades } = require("hardhat");
const {
  loadFixture,
  time
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  expect
} = require("chai");
const { ethers } = require("hardhat");

describe("Onchain Points", function () {


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

  async function generateDelegatedSignature(account, onchainPointsContract, nonceValue, amount, owner) {
    const domain = {
      name: 'OnchainPointsContract',
      version: '0.1',
      chainId: 31337,
      verifyingContract: onchainPointsContract
    };

    const types = {
      DelegatedRequest: [{
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
        {
          name: 'owner',
          type: 'address'
        },
      ]
    };
    const data = {
      deadline: new Date().getTime() + 1000,
      nonce: nonceValue,
      amount: BigInt(amount),
      owner: owner
    }

    const signature = await account.signTypedData(domain, types, data);

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

    await predictionsOracle.updateContracts(
      conditionalToken.target, fpmmFactory.target, token.target, onchainPoints.target
    )

    await predictionsOracle.updateMaxBuyAmountPerQuestion(
      BigInt("10000000000000000000000")
    );

    await predictionsOracle.updateBuyWithUnlockedEnabled(true);

    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);
    await onchainPoints.adminUpdateBalance(otherAccount.address, BigInt("1000000000000000000"));
    await onchainPoints.updateMaxDailySpendingCap(BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateReferenceBalance(otherAccount.address, BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateBalance(randomAccount.address, BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateReferenceBalance(randomAccount.address, BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateBalance(randomAccount2.address, BigInt("1000000000000000000"));
    await onchainPoints.adminUpdateReferenceBalance(randomAccount2.address, BigInt("1000000000000000000"));
    await onchainPoints.setMaxDailySpending([1, 1]);

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
      onchainPoints
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
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount] = await ethers.getSigners();

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);

    const sendEthTx1 = await owner.sendTransaction({
      to: randomAccount.address,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx1.wait();



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

  });

  it("Should support buying positions with a mix of locked and native tokens", async function () {

    const {
      predictionsOracle,
      conditionalToken,
      questionId,
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2] = await ethers.getSigners();
    
    let otherAccount2Balance = await hre.ethers.provider.getBalance(otherAccount2.address);
    console.log("otherAccount2Balance", otherAccount2Balance);

    const fpmmAddress = (await predictionsOracle.questions(questionId))[3];
    const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
    const fpmm = await fpmmContract.attach(fpmmAddress);

    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);

    // update balance for spender
    const buyAmount = BigInt("1000000000000000000");
    await onchainPoints.setMaxDailySpending([1, 1]);

    await owner.sendTransaction({
      to: onchainPoints.target,
      value: buyAmount
    });

    onchainPointsBalance = await hre.ethers.provider.getBalance(onchainPoints.target);
    console.log("onchainPointsBalance", onchainPointsBalance);

    const ocpBalanceBefore = await onchainPoints.userBalance(otherAccount.address);
    console.log("ocpBalanceBefore", ocpBalanceBefore);

    expect(ocpBalanceBefore).to.be.equal(buyAmount);

    let userMaxDailySpending = await onchainPoints.getMaxDailySpending(otherAccount.address);
    console.log("userMaxDailySpending", userMaxDailySpending);
    let rewardAmount = userMaxDailySpending / BigInt("10");
    console.log("rewardAmount", rewardAmount);

    await owner.sendTransaction({
      to: onchainPoints.target,
      value: rewardAmount
    });

    // buy position without sending value to force use of locked tokens
    const outcomeIndex = 1;

    let expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);
    console.log("expectedBuyAmount", expectedBuyAmount);

    await expect(predictionsOracle.connect(otherAccount).buyPositionWithLocked(
      questionId,
      outcomeIndex,
      0,
      buyAmount
    )).to.emit(predictionsOracle, "BuyPosition");

    const positionIds = await fpmm.getPositionIds();
    const idArray = [positionIds[0], positionIds[1]];
    const positionBalances = await conditionalToken.balanceOfBatch([otherAccount.address, otherAccount.address], idArray);
    console.log("positionBalances", positionBalances);
    expect(positionBalances[outcomeIndex]).to.be.equal(expectedBuyAmount);

    const ocpBalanceAfter = await onchainPoints.userBalance(otherAccount.address);
    console.log("ocpBalanceAfter", ocpBalanceAfter);

    expect(ocpBalanceAfter).to.be.equal(0);

    // buy position partially with locked tokens
    const buyAmountLocked = buyAmount / BigInt("2");

    await owner.sendTransaction({
      to: onchainPoints.target,
      value: buyAmountLocked
    });

    await onchainPoints.adminUpdateBalance(otherAccount2.address, buyAmountLocked);
    await onchainPoints.adminUpdateReferenceBalance(otherAccount2.address, buyAmountLocked);

    const ocpBalanceBefore2 = await onchainPoints.userBalance(otherAccount2.address);
    console.log("ocpBalanceBefore2", ocpBalanceBefore2);

    expect(ocpBalanceBefore2).to.be.equal(buyAmountLocked);

    expectedBuyAmount = await fpmm.calcBuyAmount(buyAmount, outcomeIndex);
    console.log("expectedBuyAmount2", expectedBuyAmount);

    userMaxDailySpending = await onchainPoints.getMaxDailySpending(otherAccount.address);
    console.log("userMaxDailySpending", userMaxDailySpending);
    rewardAmount = userMaxDailySpending / BigInt("10");
    console.log("rewardAmount", rewardAmount);

    await owner.sendTransaction({
      to: onchainPoints.target,
      value: rewardAmount
    });

    const userBalanceBefore2 = await hre.ethers.provider.getBalance(otherAccount2.address);
    await expect(predictionsOracle.connect(otherAccount2).buyPositionWithLocked(
      questionId,
      outcomeIndex,
      0,
      buyAmount, {
        value: userBalanceBefore2-ethers.parseUnits("1", 18)
      }
    )).to.emit(predictionsOracle, "BuyPosition");

    const userBalanceAfter2 = await hre.ethers.provider.getBalance(otherAccount2.address);
    console.log("balance difference", userBalanceBefore2 - userBalanceAfter2);
    expect(userBalanceAfter2).to.be.gt(ethers.parseUnits("1", 18));
    // balance difference should be close to buyAmountLocked
    expect(userBalanceBefore2 - userBalanceAfter2).to.be.closeTo(buyAmountLocked, ethers.parseUnits("1", 16));

    const positionBalances2 = await conditionalToken.balanceOfBatch([otherAccount2.address, otherAccount2.address], idArray);
    console.log("positionBalances2", positionBalances2);

    expect(positionBalances2[outcomeIndex]).to.be.equal(expectedBuyAmount);

    const ocpBalanceAfter2 = await onchainPoints.userBalance(otherAccount2.address);
    console.log("ocpBalanceAfter2", ocpBalanceAfter2);

    expect(ocpBalanceAfter2).to.be.equal(0);

  });

  it("Should return the correct available spending for a user", async function () {

    const {
      predictionsOracle,
      conditionalToken,
      questionId,
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2] = await ethers.getSigners();

    const otherOCPBalance = await onchainPoints.userBalance(otherAccount.address);

    console.log("otherOCPBalance", otherOCPBalance);

    await owner.sendTransaction({
      to: onchainPoints.target,
      value: otherOCPBalance
    });

    let otherAvailableSpending = await onchainPoints.getAvailableSpending(otherAccount.address);
    console.log("otherAvailableSpending", otherAvailableSpending);
    expect(otherAvailableSpending).to.be.equal(otherOCPBalance);

    const maxDailyNum = await onchainPoints.maxDailySpendingNumDen(0);
    const maxDailyDen = await onchainPoints.maxDailySpendingNumDen(1);
    const otherAccountReferenceBalance = await onchainPoints.referenceUserBalance(otherAccount.address);

    let ocpMaxDailySpending = await onchainPoints.getMaxDailySpending(otherAccount.address);
    console.log("ocpMaxDailySpending", ocpMaxDailySpending);
    expect(ocpMaxDailySpending).to.be.equal(maxDailyNum * otherAccountReferenceBalance / maxDailyDen);

    let rewardAmount = ocpMaxDailySpending / BigInt("10");
    console.log("rewardAmount", rewardAmount);
    
    await owner.sendTransaction({
      to: onchainPoints.target, 
      value: rewardAmount,
    });

    // spend all otherAccount available OCP
    const outcomeIndex = 1;
    const sig_data = await generateSignature(otherAccount, onchainPoints.target, "testNonce1", otherAvailableSpending)

    await expect(predictionsOracle.buyPositionWithSignature(
      questionId,
      outcomeIndex,
      0,
      sig_data.data,
      sig_data.signature)).to.emit(predictionsOracle, "BuyPosition");

    otherAvailableSpending = await onchainPoints.getAvailableSpending(otherAccount.address);
    console.log("otherAvailableSpending after buy", otherAvailableSpending);
    expect(otherAvailableSpending).to.be.equal(0);

    // update balance for otherAccount and check available spending
    const newBalance = BigInt("1000000000000000000");
    await onchainPoints.adminUpdateBalance(otherAccount.address, newBalance);
    await onchainPoints.adminUpdateReferenceBalance(otherAccount.address, newBalance);
    otherAvailableSpending = await onchainPoints.getAvailableSpending(otherAccount.address);
    console.log("otherAvailableSpending after update", otherAvailableSpending);
    expect(otherAvailableSpending).to.be.equal(BigInt("0"));

    // check available spending with a balance less than maxDailySpending
    const initialBalance = await onchainPoints.userBalance(otherAccount2.address);
    console.log("initialBalance", initialBalance);

    const partialMaxSpend = ocpMaxDailySpending / BigInt("2");
    console.log("partialMaxSpend", partialMaxSpend);
    await onchainPoints.adminUpdateBalance(otherAccount2.address, partialMaxSpend);

    const balanceAfter = await onchainPoints.userBalance(otherAccount2.address);
    console.log("balance after update", balanceAfter);

    // update the reference balance to be greater than the balance simulating previous spending activity
    await onchainPoints.adminUpdateReferenceBalance(otherAccount2.address, ocpMaxDailySpending);
    const otherAccount2ReferenceBalance = await onchainPoints.referenceUserBalance(otherAccount2.address);
    console.log("otherAccount2ReferenceBalance", otherAccount2ReferenceBalance);

    await owner.sendTransaction({
      to: onchainPoints.target,
      value: partialMaxSpend
    });

    const otherAccount2MaxDaily = await onchainPoints.getMaxDailySpending(otherAccount2.address);
    console.log("otherAccount2MaxDaily", otherAccount2MaxDaily);
    expect(otherAccount2MaxDaily).to.be.equal(maxDailyNum * otherAccount2ReferenceBalance / maxDailyDen);

    const rewardAmount2 = otherAccount2MaxDaily / BigInt("10");
    console.log("rewardAmount", rewardAmount2);
    
    await owner.sendTransaction({
      to: onchainPoints.target, 
      value: rewardAmount2,
    });

    let otherAvailableSpending2 = await onchainPoints.getAvailableSpending(otherAccount2.address);
    console.log("otherAvailableSpending2", otherAvailableSpending2);

    // available spending should be equal to the balance
    expect(otherAvailableSpending2).to.be.equal(partialMaxSpend);

    // spend a portion of the dailyMaxSpend
    await onchainPoints.addAuthorizedAddress(otherAccount2.address);
    const sig_data2 = await generateSignature(otherAccount2, onchainPoints.target, "testNonce2", partialMaxSpend)

    await expect(predictionsOracle.buyPositionWithSignature(
      questionId,
      outcomeIndex,
      0,
      sig_data2.data,
      sig_data2.signature)).to.emit(predictionsOracle, "BuyPosition");

    // confirm daily spending
    const blockTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const dayId = Math.floor(blockTimestamp / 86400);
    const otherAccount2DailySpending = await onchainPoints.dailySpendings(dayId, otherAccount2.address);
    console.log("otherAccount2DailySpending", otherAccount2DailySpending);
    expect(otherAccount2DailySpending).to.be.equal(partialMaxSpend);

    // should be 0 after spending entire balance even if it is less than maxDailySpend
    otherAvailableSpending2 = await onchainPoints.getAvailableSpending(otherAccount2.address);
    console.log("otherAvailableSpending2 after buy", otherAvailableSpending2);
    expect(otherAvailableSpending2).to.be.equal(0);

  });

  it("Should update user balance with signature for an activity", async function () {

    const {
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
    await onchainPoints.updateAdminAddresses([otherAccount.address], [true]);

    const names = ["activity1"];
    await expect(onchainPoints.createActivity(names[0], 30)).to.emit(onchainPoints, "ActivityCreated");

    const amounts = [BigInt("100")]; // Example amount
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    // Compute the message hash
    const amountHash = ethers.keccak256(abiCoder.encode(["uint256[]"], [amounts]));
    const namesHash = ethers.keccak256(abiCoder.encode(["string[]"], [names]));
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "bytes32"],
      [otherAccount2.address, amountHash, namesHash]
    );

    // Sign the message hash
    const messageHashBytes = ethers.getBytes(messageHash);
    const signature = await otherAccount.signMessage(messageHashBytes);

    // Extract v, r, s from the signature
    const {
      v,
      r,
      s
    } = ethers.Signature.from(signature);

    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      amounts,
      names,
      v,
      r,
      s
    )).to.emit(onchainPoints, "BalanceUpdated");

    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      amounts,
      names,
      v,
      r,
      s
    )).to.be.revertedWith("Activity rewards already claimed");

    // userBalance
    const userBalance = await onchainPoints.userBalance(otherAccount2.address);
    console.log("userBalance", userBalance);
    expect(userBalance).to.be.equal(amounts[0]);

    // tx should revert if activity name is different than signature
    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      amounts,
      ["activity12"],
      v,
      r,
      s
    )).to.be.revertedWith("Signature is not valid");

    // tx should revert if amount to claim is different than signature
    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      [200],
      names,
      v,
      r,
      s
    )).to.be.revertedWith("Signature is not valid");

    // tx should revert if address is different than signature
    await expect(onchainPoints.claimActivityRewards(
      otherAccount3.address,
      amounts,
      names,
      v,
      r,
      s
    )).to.be.revertedWith("Signature is not valid");

  });

  it("Should check maxDailySpending and related things", async function () {

    const {
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
    await onchainPoints.updateAdminAddresses([otherAccount.address], [true]);

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);
    
    const names = ["activity1"];
    await expect(onchainPoints.createActivity(names[0], 30)).to.emit(onchainPoints, "ActivityCreated");
    const percentageToSend = 10;
    await onchainPoints.updatePercentageToSendOnClaim(percentageToSend);
    const amounts = [100]; // Example amount

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    const amountHash = ethers.keccak256(abiCoder.encode(["uint256[]"], [amounts]));
    const namesHash = ethers.keccak256(abiCoder.encode(["string[]"], [names]));
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "bytes32"],
      [otherAccount2.address, amountHash, namesHash]
    );


    // Sign the message hash
    const messageHashBytes = ethers.getBytes(messageHash);
    const signature = await otherAccount.signMessage(messageHashBytes);

    // Extract v, r, s from the signature
    const {
      v,
      r,
      s
    } = ethers.Signature.from(signature);

    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      amounts,
      names,
      v,
      r,
      s
    )).to.emit(onchainPoints, "BalanceUpdated");
    const amount = amounts[0];
    // userBalance
    const userBalance = await onchainPoints.userBalance(otherAccount2.address);
    console.log("userBalance", userBalance);
    expect(userBalance).to.be.equal(amounts[0]-(amount/percentageToSend));

    const availableSpendingInitially = await onchainPoints.getAvailableSpending(otherAccount2.address);
    expect(availableSpendingInitially).to.be.equal(amount-(amount/percentageToSend));
    const maxSpendingNumDen = [1,2]
    await onchainPoints.setMaxDailySpending(maxSpendingNumDen);
    const availableSpendingAfter = await onchainPoints.getAvailableSpending(otherAccount2.address);
    expect(availableSpendingAfter).to.be.equal((amount-(amount/percentageToSend))/maxSpendingNumDen[1]);

    const newMaxSpendingNumDen = [2,3]
    await onchainPoints.setMaxDailySpending(newMaxSpendingNumDen);
    const availableSpendingAfter2 = await onchainPoints.getAvailableSpending(otherAccount2.address);
    expect(availableSpendingAfter2).to.be.equal((amount-(amount/percentageToSend))*newMaxSpendingNumDen[0]/newMaxSpendingNumDen[1]);
  });


  it("Should check claiming related things", async function () {

    const {
      onchainPoints,
      predictionsOracle,
      questionId
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
    await onchainPoints.updateAdminAddresses([otherAccount.address], [true]);
    await onchainPoints.setMaxDailySpending([1, 1]);

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);
    
    const names = ["activity1", "activity2"];
    await expect(onchainPoints.createActivity(names[0], 30)).to.emit(onchainPoints, "ActivityCreated");

    await expect(onchainPoints.createActivity(names[1], 15)).to.emit(onchainPoints, "ActivityCreated");

    const percentageToSend = BigInt("10");
    await onchainPoints.updatePercentageToSendOnClaim(percentageToSend);
    const amounts = [BigInt("100000000000000000"), BigInt("100000000000000000")]; // Example amount

    // Compute the message hash
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    const amountHash = ethers.keccak256(abiCoder.encode(["uint256[]"], [amounts]));
    const namesHash = ethers.keccak256(abiCoder.encode(["string[]"], [names]));
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "bytes32"],
      [otherAccount2.address, amountHash, namesHash]
    );

    // Sign the message hash
    const messageHashBytes = ethers.getBytes(messageHash);
    const signature = await otherAccount.signMessage(messageHashBytes);

    // Extract v, r, s from the signature
    const {
      v,
      r,
      s
    } = ethers.Signature.from(signature);

    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      amounts,
      names,
      v,
      r,
      s
    )).to.emit(onchainPoints, "BalanceUpdated");
    const amount = amounts[0];
    // userBalance
    const userBalance = await onchainPoints.userBalance(otherAccount2.address);
    console.log("userBalance", userBalance);
    expect(userBalance).to.be.equal(BigInt("2")*(amount-(amount/percentageToSend)));

    const availableSpendingInitially = await onchainPoints.getAvailableSpending(otherAccount2.address);
    expect(availableSpendingInitially).to.be.equal(BigInt("2")*(amount-(amount/percentageToSend)));
    
    const userActivities0 = await onchainPoints.userActivities(otherAccount2.address, 0);
    expect(userActivities0).to.be.equal(names[0]);

    const userActivities1 = await onchainPoints.userActivities(otherAccount2.address, 1);
    expect(userActivities1).to.be.equal(names[1]);

    // withdrawableBalance
    const withdrawableBalance = await onchainPoints.connect(otherAccount2).withdrawableBalance(names, otherAccount2.address);
    expect (withdrawableBalance).to.be.equal(0);

    // move evm time ahead by 15 days
    await time.increase(15*24*60*60);

    // withdrawableBalance
    const withdrawableBalance1 = await onchainPoints.connect(otherAccount2).withdrawableBalance(names, otherAccount2.address);
    expect (withdrawableBalance1).to.be.equal((amount-(amount/percentageToSend)));

    balanceBefore = await hre.ethers.provider.getBalance(otherAccount2.address);
    await onchainPoints.connect(otherAccount2).withdrawRewards([names[1]]);

    balanceAfter = await hre.ethers.provider.getBalance(otherAccount2.address);

    expect(balanceAfter).to.be.gt(balanceBefore);

    // withdrawableBalance
    const withdrawableBalance2 = await onchainPoints.connect(otherAccount2).withdrawableBalance(names, otherAccount2.address);
    expect (withdrawableBalance2).to.be.equal(0);

    // userBalance
    const userBalanceAfterWithdraw = await onchainPoints.userBalance(otherAccount2.address);
    console.log("userBalanceAfterWithdraw", userBalanceAfterWithdraw);

    expect(userBalanceAfterWithdraw).to.be.equal(amount-(amount/percentageToSend));

    // maxDailySpending
    const maxDailySpending = await onchainPoints.getMaxDailySpending(otherAccount2.address);
    console.log("maxDailySpending", maxDailySpending);
    expect(maxDailySpending).to.be.equal((amount-(amount/percentageToSend)));

    // spend some money
    const outcomeIndex = 1;
    const sig_data = await generateSignature(otherAccount2, onchainPoints.target, "testNonce1", (amount-(amount/percentageToSend))/BigInt("2"))

    await expect(predictionsOracle.buyPositionWithSignature(
      questionId,
      outcomeIndex,
      0,
      sig_data.data,
      sig_data.signature)).to.emit(predictionsOracle, "BuyPosition");

      // user balance
      const userBalanceAfterSpend = await onchainPoints.userBalance(otherAccount2.address);
      console.log("userBalanceAfterSpend", userBalanceAfterSpend);
      expect(userBalanceAfterSpend).to.be.equal((amount-(amount/percentageToSend))/BigInt("2"));

      // available spending
      const availableSpendingAfterSpend = await onchainPoints.getAvailableSpending(otherAccount2.address);
      console.log("availableSpendingAfterSpend", availableSpendingAfterSpend);
      expect(availableSpendingAfterSpend).to.be.equal((amount-(amount/percentageToSend))/BigInt("2"));

      // increase time by 15 days
      await time.increase(15*24*60*60);

      // withdrawableBalance
      const withdrawableBalance3 = await onchainPoints.connect(otherAccount2).withdrawableBalance(names, otherAccount2.address);
      expect (withdrawableBalance3).to.be.equal((amount-(amount/percentageToSend))/BigInt("2"));

      // withdraw rewards
      balanceBefore = await hre.ethers.provider.getBalance(otherAccount2.address);
      await onchainPoints.connect(otherAccount2).withdrawRewards(names);

      balanceAfter = await hre.ethers.provider.getBalance(otherAccount2.address);
      
      expect(balanceAfter).to.be.gt(balanceBefore);

      // userBalance
      const userBalanceAfterWithdraw1 = await onchainPoints.userBalance(otherAccount2.address);
      console.log("userBalanceAfterWithdraw1", userBalanceAfterWithdraw1);
      expect(userBalanceAfterWithdraw1).to.be.equal(0);

      // maxDailySpending
      const maxDailySpendingAfterWithdraw = await onchainPoints.getMaxDailySpending(otherAccount2.address);
      console.log("maxDailySpendingAfterWithdraw", maxDailySpendingAfterWithdraw);
      // should be zero due to having withdrawn all activity balances
      expect(maxDailySpendingAfterWithdraw).to.be.equal(0);

      // available spending
      const availableSpendingAfterWithdraw = await onchainPoints.getAvailableSpending(otherAccount2.address);
      console.log("availableSpendingAfterWithdraw", availableSpendingAfterWithdraw);
      expect(availableSpendingAfterWithdraw).to.be.equal(0);

      // withdrawableBalance
      const withdrawableBalance4 = await onchainPoints.connect(otherAccount2).withdrawableBalance(names, otherAccount2.address);
      expect (withdrawableBalance4).to.be.equal(0);

  });


  it("Should correctly update a user's reference balance", async function () {

    const {
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2] = await ethers.getSigners();

    const referenceBalance1 = await onchainPoints.referenceUserBalance(otherAccount2.address);
    console.log("userReferenceBalance", referenceBalance1);
    expect(referenceBalance1).to.be.equal(0);

    // update reference balance
    const referenceBalance2 = 100;
    await expect(onchainPoints.adminUpdateReferenceBalance(
      otherAccount2.address, 
      referenceBalance2
    )).to.emit(onchainPoints, "ReferenceBalanceUpdated");

    const userReferenceBalance2 = await onchainPoints.referenceUserBalance(otherAccount2.address);
    console.log("userReferenceBalance2", userReferenceBalance2);
    expect(userReferenceBalance2).to.be.equal(referenceBalance2);

  });

  it("Should update user balance with signature for multiple activities", async function () {

    const {
      onchainPoints
    } = await loadFixture(deploy);

    const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
    await onchainPoints.updateAdminAddresses([otherAccount.address], [true]);

    const names = ["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
    for (let i = 0; i < names.length; i++) {
      await expect(onchainPoints.createActivity(names[i], 30)).to.emit(onchainPoints, "ActivityCreated");
    }

    const amounts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600]; // Example amount
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    // Compute the message hash
    const amountHash = ethers.keccak256(abiCoder.encode(["uint256[]"], [amounts]));
    const namesHash = ethers.keccak256(abiCoder.encode(["string[]"], [names]));
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "bytes32"],
      [otherAccount2.address, amountHash, namesHash]
    );

    // Sign the message hash
    const messageHashBytes = ethers.getBytes(messageHash);
    const signature = await otherAccount.signMessage(messageHashBytes);

    // Extract v, r, s from the signature
    const {
      v,
      r,
      s
    } = ethers.Signature.from(signature);

    await expect(onchainPoints.claimActivityRewards(
      otherAccount2.address,
      amounts,
      names,
      v,
      r,
      s
    )).to.emit(onchainPoints, "BalanceUpdated");

    // userBalance
    const userBalance = await onchainPoints.userBalance(otherAccount2.address);
    console.log("userBalance", userBalance);
    expect(userBalance).to.be.equal(35100);

  });

  it("Should spend tokens on behalf of a user with signature", async function () {
    const {
      token,
      predictionsOracle,
      conditionalToken,
      questionId,
      endTime,
      outcomeSlotCount,
      onchainPoints,
      randomAccount,
      randomAccount2
    } = await loadFixture(deploy);

    const [owner, otherAccount] = await ethers.getSigners();

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);

    const sendEthTx1 = await owner.sendTransaction({
      to: randomAccount.address,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx1.wait();

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

    // buy position on behalf of user
    const fundAmount = ethers.parseUnits("1", 18);
    await owner.sendTransaction({
      to: randomAccount.address,
      value: fundAmount
    });
    await onchainPoints.connect(randomAccount).approve(randomAccount2.address, buyAmount);

    const sig_data = await generateDelegatedSignature(randomAccount2, onchainPoints.target, "testNonce1", buyAmount, randomAccount.address);

    console.log("sig_data", sig_data);
    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);


    const balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    await expect(predictionsOracle.buyPositionWithSignatureOnBehalf(
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

    // Check balances after spend
    const finalBalance = await onchainPoints.userBalance(randomAccount.address);
    expect(finalBalance).to.equal(BigInt("1000000000000000000") - buyAmount);

    // Check allowance after spend
    const remainingAllowance = await onchainPoints.allowance(randomAccount.address, randomAccount2.address);
    expect(remainingAllowance).to.equal(0);

  });

  it("Should spend tokens on behalf of a user", async function () {
    const {
      token,
      predictionsOracle,
      conditionalToken,
      questionId,
      endTime,
      outcomeSlotCount,
      onchainPoints,
      randomAccount,
      randomAccount2
    } = await loadFixture(deploy);

    const [owner, otherAccount] = await ethers.getSigners();

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);

    const sendEthTx1 = await owner.sendTransaction({
      to: randomAccount.address,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx1.wait();

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

    // buy position on behalf of user
    const fundAmount = ethers.parseUnits("1", 18);
    await owner.sendTransaction({
      to: randomAccount.address,
      value: fundAmount
    });
    await owner.sendTransaction({
      to: randomAccount2.address,
      value: fundAmount
    });
    await onchainPoints.connect(randomAccount).approve(randomAccount2.address, buyAmount);

    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);

    const balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    await expect(predictionsOracle.connect(randomAccount2).buyPositionWithLockedOnBehalf(
      randomAccount.address,
      questionId,
      outcomeIndex,
      0,
      buyAmount)).to.emit(predictionsOracle, "BuyPosition");

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

    // Check balances after spend
    const finalBalance = await onchainPoints.userBalance(randomAccount.address);
    expect(finalBalance).to.equal(BigInt("1000000000000000000") - buyAmount);

    // Check allowance after spend
    const remainingAllowance = await onchainPoints.allowance(randomAccount.address, randomAccount2.address);
    expect(remainingAllowance).to.equal(0);

  });

  it("Should fail to spend tokens on behalf of a user if allowance is lower than amount", async function () {
    const {
      token,
      predictionsOracle,
      conditionalToken,
      questionId,
      endTime,
      outcomeSlotCount,
      onchainPoints,
      randomAccount,
      randomAccount2
    } = await loadFixture(deploy);

    const [owner, otherAccount] = await ethers.getSigners();

    // send eth to onchain points contract
    const sendEthTx = await owner.sendTransaction({
      to: onchainPoints.target,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx.wait();
    console.log(`OnchainPoints balance: ${await ethers.provider.getBalance(onchainPoints.target)} POP`);

    const sendEthTx1 = await owner.sendTransaction({
      to: randomAccount.address,
      value: ethers.parseUnits("100", 18),
    });
    await sendEthTx1.wait();

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

    // buy position on behalf of user
    const fundAmount = ethers.parseUnits("1", 18);
    await owner.sendTransaction({
      to: randomAccount.address,
      value: fundAmount
    });
    await owner.sendTransaction({
      to: randomAccount2.address,
      value: fundAmount
    });
    await onchainPoints.connect(randomAccount).approve(randomAccount2.address, BigInt("100"));

    await onchainPoints.addAuthorizedAddress(predictionsOracle.target);

    const balanceBefore = await hre.ethers.provider.getBalance(randomAccount.address);
    await expect(predictionsOracle.connect(randomAccount2).buyPositionWithLockedOnBehalf(
      randomAccount.address,
      questionId,
      outcomeIndex,
      0,
      buyAmount)).to.be.revertedWith("Insufficient allowance");

  });

});