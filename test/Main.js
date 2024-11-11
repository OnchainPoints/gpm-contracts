const {
  loadFixture,
  time
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  expect
} = require("chai");

describe("Deployment", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deploy() {
    // Contracts are deployed using the first signer/account by default
    const [owner] = await ethers.getSigners();

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

    await token.deposit({
      value: BigInt("100000000000000000000")
    });

    return {
      token,
      conditionalToken,
      fpmmFactory,
      predictionsOracle,
      onchainPoints,
      owner
    };
  }


  describe("Condition Token Testing", function () {

    it("It should prepare a condition on conditional token contract", async function () {
      const {
        token,
        conditionalToken,
      } = await loadFixture(deploy);

      const [owner, otherAccount] = await ethers.getSigners();
      // function prepareCondition (address oracle, bytes32 questionId, uint outcomeSlotCount) external
      const oracle = owner.address;
      const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684333";
      const outcomeSlotCount = 2;
      // event ConditionPreparation (bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount) 
      expect(conditionalToken.prepareCondition(oracle, questionId, outcomeSlotCount)).to.emit(conditionalToken, "ConditionPreparation");
      const conditionId = await conditionalToken.getConditionId(oracle, questionId, outcomeSlotCount);
      console.log("conditionId", conditionId);
      expect(conditionId).to.be.a("string");

      // function getOutcomeSlotCount (bytes32 conditionId) external view returns (uint) Gets the outcome slot count of a condition.
      const outcomeSlotCountResult = await conditionalToken.getOutcomeSlotCount(conditionId);
      expect(outcomeSlotCountResult).to.be.equal(2n);

    });

    it("It should Split Position Properly", async function () {
      const {
        token,
        conditionalToken,
      } = await loadFixture(deploy);

      const [owner, otherAccount] = await ethers.getSigners();
      // function prepareCondition (address oracle, bytes32 questionId, uint outcomeSlotCount) external
      const oracle = owner.address;
      const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684333";
      const outcomeSlotCount = 2;
      // event ConditionPreparation (bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount) 
      expect(conditionalToken.prepareCondition(oracle, questionId, outcomeSlotCount)).to.emit(conditionalToken, "ConditionPreparation");
      const conditionId = await conditionalToken.getConditionId(oracle, questionId, outcomeSlotCount);
      console.log("conditionId", conditionId);
      expect(conditionId).to.be.a("string");

      const amount = "1000000" // could be any amount
      // approve the conditional token contract to spend the token
      await token.approve(conditionalToken.target, amount);
      // // Split Position
      // // function splitPosition (address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint[] calldata partition, uint amount) external 
      const collateralToken = token.target;
      const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000"
      const partition = [0b01, 0b10];

      expect(conditionalToken.splitPosition(collateralToken, parentCollectionId, conditionId, partition, amount)).to.emit(conditionalToken, "PositionSplit");
      // function balanceOf (address owner, uint256 positionId) external view returns (uint256)

      // get collection id
      const collectionId1 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 1);
      console.log("collectionId1", collectionId1);
      const positionId1 = await conditionalToken.getPositionId(collateralToken, collectionId1);
      console.log("positionId1", positionId1);

      // get collection id
      const collectionId2 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 2);
      console.log("collectionId2", collectionId2);
      const positionId2 = await conditionalToken.getPositionId(collateralToken, collectionId2);
      console.log("positionId2", positionId2);

      // check batch balance
      const batchBalance = await conditionalToken.balanceOfBatch([owner.address, owner.address], [positionId1, positionId2]);
      console.log("batchBalance", batchBalance.toString());

    });

    it("It should create FPMM contract and add funding", async function () {
      const {
        token,
        conditionalToken,
        fpmmFactory,
      } = await loadFixture(deploy);

      const [owner, otherAccount] = await ethers.getSigners();
      // function prepareCondition (address oracle, bytes32 questionId, uint outcomeSlotCount) external
      const oracle = owner.address;
      const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684333";
      const outcomeSlotCount = 2;
      // event ConditionPreparation (bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount) 
      expect(conditionalToken.prepareCondition(oracle, questionId, outcomeSlotCount)).to.emit(conditionalToken, "ConditionPreparation");
      const conditionId = await conditionalToken.getConditionId(oracle, questionId, outcomeSlotCount);
      console.log("conditionId", conditionId);
      expect(conditionId).to.be.a("string");

      console.log("token balance", await token.balanceOf(owner.address));

      const collateralToken = token.target;
      const conditionIds = [conditionId];
      const fee = 0;
      const marketEndTime = Math.floor(Date.now() / 1000) + 1000;

      const tx = await fpmmFactory.createFixedProductMarketMaker(conditionalToken.target, collateralToken, conditionIds, fee, marketEndTime, "0x" + "0".repeat(40));
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);

      const abi = [
        "event FixedProductMarketMakerCreation(address indexed creator, address fixedProductMarketMaker, address indexed conditionalTokens, address indexed collateralToken, bytes32[] conditionIds, uint fee)"
      ];

      // // // get abi from the contract
      const iface = new ethers.Interface(abi);

      const data = receipt.logs[0].data;
      const topics = receipt.logs[0].topics;
      console.log("topics", topics);
      // decode event
      const event = iface.decodeEventLog("FixedProductMarketMakerCreation", data, topics);
      const fpmmAddress = event[1];

      console.log("fpmmAddress", fpmmAddress);

      // // load fpmm contract
      const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
      const fpmm = await fpmmContract.attach(fpmmAddress);
      console.log("fpmm", fpmm.target);

      // // function addFunding(uint addedFunds, uint[] calldata distributionHint)
      const addedFunds = 1000;
      const distributionHint = [1, 1];

      console.log("collateralToken", await fpmm.collateralToken());
      console.log("conditionIds", await fpmm.conditionIds(0));
      console.log("fee", await fpmm.fee());

      await token.approve(fpmm.target, addedFunds);
      // conditionIds
      console.log("conditionIds DATA", await fpmm.conditionIds(0));
      await fpmm.addFunding(addedFunds, distributionHint);

    });


    it("It should test the entire flow from setting up tokens to redeeming positions", async function () {
      const {
        token,
        conditionalToken,
        fpmmFactory,
      } = await loadFixture(deploy);

      const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
      // function prepareCondition (address oracle, bytes32 questionId, uint outcomeSlotCount) external
      const oracle = owner.address;
      const questionId = "0x4b22fe478b95fdaa835ddddf631ab29f12900b62061e0c5fd8564ddb7b684333";
      const outcomeSlotCount = 2;
      // event ConditionPreparation (bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount) 
      expect(conditionalToken.prepareCondition(oracle, questionId, outcomeSlotCount)).to.emit(conditionalToken, "ConditionPreparation");
      const conditionId = await conditionalToken.getConditionId(oracle, questionId, outcomeSlotCount);
      console.log("conditionId", conditionId);
      expect(conditionId).to.be.a("string");

      console.log("token balance", await token.balanceOf(owner.address));

      await token.transfer(otherAccount.address, 1000000000);
      await token.transfer(otherAccount2.address, 1000000000);
      await token.transfer(otherAccount3.address, 10000000000);

      const collateralToken = token.target;
      const conditionIds = [conditionId];
      const fee = 0;
      const marketEndTime = Math.floor(Date.now() / 1000) + 1000;

      console.log("marketEndTime", marketEndTime);

      const tx = await fpmmFactory.createFixedProductMarketMaker(conditionalToken.target, collateralToken, conditionIds, fee, marketEndTime, "0x" + "0".repeat(40));
      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);

      const abi = [
        "event FixedProductMarketMakerCreation(address indexed creator, address fixedProductMarketMaker, address indexed conditionalTokens, address indexed collateralToken, bytes32[] conditionIds, uint fee)"
      ];

      // // // get abi from the contract
      const iface = new ethers.Interface(abi);

      const data = receipt.logs[0].data;
      const topics = receipt.logs[0].topics;
      // decode event
      const event = iface.decodeEventLog("FixedProductMarketMakerCreation", data, topics);
      const fpmmAddress = event[1];

      console.log("fpmmAddress", fpmmAddress);

      // // load fpmm contract
      const fpmmContract = await hre.ethers.getContractFactory("FixedProductMarketMaker");
      const fpmm = await fpmmContract.attach(fpmmAddress);
      console.log("fpmm", fpmm.target);

      // // function addFunding(uint addedFunds, uint[] calldata distributionHint)
      const addedFunds = 100000000;
      const distributionHint = [1, 1];

      console.log("collateralToken", await fpmm.collateralToken());
      console.log("conditionIds", await fpmm.conditionIds(0));
      console.log("fee", await fpmm.fee());

      await token.approve(fpmm.target, addedFunds);

      await fpmm.addFunding(addedFunds, distributionHint);

      const parentCollectionId = "0x0000000000000000000000000000000000000000000000000000000000000000";

      const collectionId1 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 1);
      const collectionId2 = await conditionalToken.getCollectionId(parentCollectionId, conditionId, 2);
      const positionId1 = await conditionalToken.getPositionId(token.target, collectionId1);
      const positionId2 = await conditionalToken.getPositionId(token.target, collectionId2);

      const fpmmBalances = await conditionalToken.balanceOfBatch([fpmm.target, fpmm.target], [positionId1, positionId2]);
      console.log("fpmmBalances1", fpmmBalances);

      await token.connect(otherAccount).approve(fpmm.target, addedFunds);
      await token.connect(otherAccount2).approve(fpmm.target, addedFunds);
      await token.connect(otherAccount3).approve(fpmm.target, 10000000000);


      await fpmm.connect(otherAccount).buy(100000000, 0, 0);
      await fpmm.connect(otherAccount2).buy(100000000, 0, 0);
      await fpmm.connect(otherAccount3).buy(100000000, 0, 0);
      await fpmm.connect(otherAccount3).buy(3000000000, 1, 0);

      const fpmmBalances2 = await conditionalToken.balanceOfBatch([fpmm.target, fpmm.target], [positionId1, positionId2]);
      console.log("fpmmBalances2", fpmmBalances2);

      token_balance = await token.balanceOf(conditionalToken.target);
      console.log("token_balance", token_balance.toString());
      // calculateProbabilities
      const probabilities = await fpmm.calculateProbabilities();
      console.log("probabilities", [probabilities[0].toString() / 1e9, probabilities[1].toString() / 1e9]);

      //calcBuyAmount(uint investmentAmount, uint outcomeIndex)
      const investmentAmount = 1000000;
      const buyAmountOutcome1 = await fpmm.calcBuyAmount(investmentAmount, 0);
      console.log("buyAmount for 1e6 collateral token option 1", buyAmountOutcome1.toString());

      // price
      const priceForOutcome1 = Number(investmentAmount) / Number(buyAmountOutcome1);
      console.log("priceForOutcome1", priceForOutcome1.toString());

      const buyAmountOutcome2 = await fpmm.calcBuyAmount(investmentAmount, 1);
      console.log("buyAmount for 1e6 collateral token option 2", buyAmountOutcome2.toString());

      // price
      const priceForOutcome2 = Number(investmentAmount) / Number(buyAmountOutcome2);
      console.log("priceForOutcome2", priceForOutcome2.toString());


      // calculate report payouts
      const payouts = [1, 0];
      await conditionalToken.reportPayouts(questionId, payouts);

      indexSets = [1, 2];
      // check balance before redeem
      console.log("balance", await token.balanceOf(otherAccount.address));
      await conditionalToken.connect(otherAccount).redeemPositions(collateralToken, parentCollectionId, conditionId, indexSets);
      // check balance
      console.log("balance after redeem", await token.balanceOf(otherAccount.address));

      indexSets = [1, 2];
      // check balance before redeem
      console.log("balance", await token.balanceOf(otherAccount2.address));
      await conditionalToken.connect(otherAccount2).redeemPositions(collateralToken, parentCollectionId, conditionId, indexSets);
      // check balance
      console.log("balance after redeem", await token.balanceOf(otherAccount2.address));

  });

  });


});