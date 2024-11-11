// const { ethers, upgrades } = require("hardhat");
const {
    loadFixture,
    time
} = require("@nomicfoundation/hardhat-network-helpers");
const {
    expect
} = require("chai");
const {
    ethers, upgrades
} = require("hardhat");

describe("Staking Contract", function () {

    // We define a fixture to reuse the same setup in every test.
    // We use loadFixture to run this setup once, snapshot that state,
    // and reset Hardhat Network to that snapshot in every test.
    async function deploy() {
        // Contracts are deployed using the first signer/account by default
        const [owner] = await ethers.getSigners();
     
        const StakingContract = await hre.ethers.getContractFactory("StakingContract");
        const stakingContract = await upgrades.deployProxy(StakingContract, [1, 1, owner.address], {
            initializer: "initialize",
            kind: "uups"
        });

        const sendEthTx = await owner.sendTransaction({
            to: stakingContract.target,
            value: ethers.parseUnits("100", 18),
          });
          await sendEthTx.wait();
          console.log(`Staking Contract balance: ${await ethers.provider.getBalance(stakingContract.target)} POP`);
      

        return {
            stakingContract
        };
    }

    it("Should test staking contract", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
              
        console.log("Owner address: ", owner.address);
        
        const rewardPerSecond = await stakingContract.rewardPerSecond();
        console.log("Reward per second: ", rewardPerSecond.toString());

        await stakingContract.stake({value: BigInt(10000)});
        const userInfo = await stakingContract.userInfo(owner.address);
        console.log("User info: ", userInfo);
        expect(userInfo.amount).to.equal(BigInt(10000));
        // totalStaked
        expect(await stakingContract.totalStaked()).to.equal(BigInt(10000));

        await time.increase(10000);
        const earnedRewards = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards.toString());
        expect(earnedRewards).to.closeTo(BigInt(10000), BigInt(100));
        // pending points
        const earnedPoints = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints.toString());
        expect(earnedPoints).to.closeTo(BigInt(10000), BigInt(100));
        // increase reward bps
        // changeRewardPerSecond
        await stakingContract.changeRewardPerSecond(2);
        // change points bps
        await stakingContract.changePointsPerSecond(2);
        const rewardPerSecond2 = await stakingContract.rewardPerSecond();
        console.log("Reward per second: ", rewardPerSecond2.toString());
        
        // increase time by 1 day
        await time.increase(10000);
        const earnedRewards2 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards2.toString());
        expect(earnedRewards2).to.closeTo(BigInt(30000), BigInt(100));
        // pending points
        const earnedPoints2 = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints2.toString());
        expect(earnedPoints2).to.closeTo(BigInt(30000), BigInt(100));

        // claim rewards
        await stakingContract.claimRewards();
        const userInfo2 = await stakingContract.userInfo(owner.address);
        console.log("User info after claim: ", userInfo2);

        // change reward rate
        await stakingContract.changeRewardPerSecond(5);
        // change points rate
        await stakingContract.changePointsPerSecond(5);
        const rewardPerSecond3 = await stakingContract.rewardPerSecond();
        console.log("Reward per second: ", rewardPerSecond3.toString());

        // increase time by 1 day
        await time.increase(10000);
        const earnedRewards3 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards3.toString());
        expect(earnedRewards3).to.closeTo(BigInt(50000), BigInt(100));

        // pending points
        const earnedPoints3 = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints3.toString());
        expect(earnedPoints3).to.closeTo(BigInt(80000), BigInt(100));
   // unstake
        await stakingContract.unstake(BigInt(10000));
        const userInfo3 = await stakingContract.userInfo(owner.address);
        console.log("User info after unstake: ", userInfo3);
        expect(userInfo3.amount).to.equal(BigInt(0));
    });

    it("Should test multiple staking from same account", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
              
        console.log("Owner address: ", owner.address);
        const sendEthTx = await owner.sendTransaction({
            to: stakingContract.target,
            value: ethers.parseUnits("100", 18),
          });
          await sendEthTx.wait();
          console.log(`Staking Contract balance: ${await ethers.provider.getBalance(stakingContract.target)} POP`);
      
        
        const rewardPerSecond = await stakingContract.rewardPerSecond();
        console.log("Reward per second: ", rewardPerSecond.toString());

        await stakingContract.stake({value: BigInt(10000)});
        const userInfo = await stakingContract.userInfo(owner.address);
        console.log("User info: ", userInfo);
        expect(userInfo.amount).to.equal(BigInt(10000));
        // totalStaked
        expect(await stakingContract.totalStaked()).to.equal(BigInt(10000));

        await time.increase(10000);
        const earnedRewards = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards.toString());
        expect(earnedRewards).to.closeTo(BigInt(10000), BigInt(100));
        // pending points
        const earnedPoints = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints.toString());
        expect(earnedPoints).to.closeTo(BigInt(10000), BigInt(100));
        
        // stake again
        await stakingContract.stake({value: BigInt(10000)});
        
        // increase time by 1 day
        await time.increase(10000);
        const earnedRewards2 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards2.toString());
        expect(earnedRewards2).to.closeTo(BigInt(20000), BigInt(100));

        // pending points
        const earnedPoints2 = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints2.toString());
        expect(earnedPoints2).to.closeTo(BigInt(20000), BigInt(100));

        // claim rewards
        await stakingContract.claimRewards();
        const userInfo2 = await stakingContract.userInfo(owner.address);
        console.log("User info after claim: ", userInfo2);

        // change reward rate
        await stakingContract.changeRewardPerSecond(5);
        const rewardPerSecond3 = await stakingContract.rewardPerSecond();
        console.log("Reward per second: ", rewardPerSecond3.toString());

        // increase time by 1 day
        await time.increase(10000);
        const earnedRewards3 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards3.toString());
   // unstake
        await stakingContract.unstake(BigInt(10000));
        const userInfo3 = await stakingContract.userInfo(owner.address);
        console.log("User info after unstake: ", userInfo3);
        expect(userInfo3.amount).to.equal(BigInt(10000));
    });

    it("Should test staking from multiple accounts", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();
              
        console.log("Owner address: ", owner.address);
        const sendEthTx = await owner.sendTransaction({
            to: stakingContract.target,
            value: ethers.parseUnits("100", 18),
          });
          await sendEthTx.wait();
          console.log(`Staking Contract balance: ${await ethers.provider.getBalance(stakingContract.target)} POP`);

          await stakingContract.changeRewardPerSecond(3);
          await stakingContract.changePointsPerSecond(3);
  
        
        const rewardPerSecond = await stakingContract.rewardPerSecond();
        console.log("Reward per second: ", rewardPerSecond.toString());

        // stake 100 wei
        await stakingContract.stake({value: BigInt(10000)});
        const userInfo = await stakingContract.userInfo(owner.address);
        console.log("User info: ", userInfo);
        expect(userInfo.amount).to.equal(BigInt(10000));
        // totalStaked
        expect(await stakingContract.totalStaked()).to.equal(BigInt(10000));

        // stake from other account
        await stakingContract.connect(otherAccount).stake({value: BigInt(10000)});
        const userInfo2 = await stakingContract.userInfo(otherAccount.address);
        console.log("User info: ", userInfo2);
        expect(userInfo2.amount).to.equal(BigInt(10000));
        // totalStaked
        expect(await stakingContract.totalStaked()).to.equal(BigInt(20000));

        // stake from account 3
        await stakingContract.connect(otherAccount2).stake({value: BigInt(10000)});
        const userInfo3 = await stakingContract.userInfo(otherAccount2.address);
        console.log("User info: ", userInfo3);
        expect(userInfo3.amount).to.equal(BigInt(10000));

        // increase time by 1 day
        await time.increase(10000);
        
        const earnedRewards = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards.toString());
        expect(earnedRewards).to.closeTo(BigInt(10000), BigInt(100));

        // pending points
        const earnedPoints = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints.toString());
        expect(earnedPoints).to.closeTo(BigInt(10000), BigInt(100));


        const earnedRewards2 = await stakingContract.earnedRewards(otherAccount.address);
        console.log("Pending reward: ", earnedRewards2.toString());
        expect(earnedRewards2).to.closeTo(BigInt(10000), BigInt(100));

        // pending points
        const earnedPoints2 = await stakingContract.earnedUserPoints(otherAccount.address);
        console.log("Pending points: ", earnedPoints2.toString());
        expect(earnedPoints2).to.closeTo(BigInt(10000), BigInt(100));

        const earnedRewards3 = await stakingContract.earnedRewards(otherAccount2.address);
        console.log("Pending reward: ", earnedRewards3.toString());
        expect(earnedRewards3).to.closeTo(BigInt(10000), BigInt(100));

        // pending points
        const earnedPoints3 = await stakingContract.earnedUserPoints(otherAccount2.address);
        console.log("Pending points: ", earnedPoints3.toString());
        expect(earnedPoints3).to.closeTo(BigInt(10000), BigInt(100));

        // claim rewards for owner
        await stakingContract.claimRewards();
        const userInfo4 = await stakingContract.userInfo(owner.address);
        console.log("User info after claim: ", userInfo4);
        // pending rewards should be 0
        const earnedRewards4 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards4.toString());
        expect(earnedRewards4).to.equal(BigInt(0));

        // increase reward rate
        await stakingContract.changeRewardPerSecond(6);
        // increase points rate
        await stakingContract.changePointsPerSecond(6);

        // increase time by 1 day
        await time.increase(10000);

        const earnedRewards5 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards5.toString());
        expect(earnedRewards5).to.closeTo(BigInt(20000), BigInt(100));

        // pending points
        const earnedPoints5 = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints5.toString());
        expect(earnedPoints5).to.closeTo(BigInt(30000), BigInt(100));

        const earnedRewards6 = await stakingContract.earnedRewards(otherAccount.address);
        console.log("Pending reward: ", earnedRewards6.toString());
        expect(earnedRewards6).to.closeTo(BigInt(30000), BigInt(100));

        // pending points
        const earnedPoints6 = await stakingContract.earnedUserPoints(otherAccount.address);
        console.log("Pending points: ", earnedPoints6.toString());
        expect(earnedPoints6).to.closeTo(BigInt(30000), BigInt(100));
          
        const earnedRewards7 = await stakingContract.earnedRewards(otherAccount2.address);
        console.log("Pending reward: ", earnedRewards7.toString());
        expect(earnedRewards7).to.closeTo(BigInt(30000), BigInt(100));

        // pending points
        const earnedPoints7 = await stakingContract.earnedUserPoints(otherAccount2.address);
        console.log("Pending points: ", earnedPoints7.toString());
        expect(earnedPoints7).to.closeTo(BigInt(30000), BigInt(100));

        // claim for other account
        await stakingContract.connect(otherAccount).claimRewards();
        const userInfo5 = await stakingContract.userInfo(otherAccount.address);
        console.log("User info after claim: ", userInfo5);
        // pending rewards should be 0
        const earnedRewards8 = await stakingContract.earnedRewards(otherAccount.address);
        console.log("Pending reward: ", earnedRewards8.toString());
        expect(earnedRewards8).to.equal(BigInt(0));

        // increase reward rate
        await stakingContract.changeRewardPerSecond(9);
        // increase points rate
        await stakingContract.changePointsPerSecond(9);


        // increase time by 1 day
        await time.increase(10000);

        const earnedRewards9 = await stakingContract.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards9.toString());
        expect(earnedRewards9).to.closeTo(BigInt(50000), BigInt(100));
        // pending points
        const earnedPoints9 = await stakingContract.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints9.toString());
        expect(earnedPoints9).to.closeTo(BigInt(60000), BigInt(100));

        const earnedRewards10 = await stakingContract.earnedRewards(otherAccount.address);
        console.log("Pending reward: ", earnedRewards10.toString());
        expect(earnedRewards10).to.closeTo(BigInt(30000), BigInt(100));

        // pending points
        const earnedPoints10 = await stakingContract.earnedUserPoints(otherAccount.address);
        console.log("Pending points: ", earnedPoints10.toString());
        expect(earnedPoints10).to.closeTo(BigInt(60000), BigInt(100));

        const earnedRewards11 = await stakingContract.earnedRewards(otherAccount2.address);
        console.log("Pending reward: ", earnedRewards11.toString());
        expect(earnedRewards11).to.closeTo(BigInt(60000), BigInt(100));

        // pending points
        const earnedPoints11 = await stakingContract.earnedUserPoints(otherAccount2.address);
        console.log("Pending points: ", earnedPoints11.toString());
        expect(earnedPoints11).to.closeTo(BigInt(60000), BigInt(100));
    });

    it("Should test the claiming of points and rewards", async function () {

        const [owner] = await ethers.getSigners();
        
        // new contract without reward rate
        const StakingContract2 = await hre.ethers.getContractFactory("StakingContract");
        const stakingContract2 = await upgrades.deployProxy(StakingContract2, [0, 0, owner.address], {
            initializer: "initialize",
            kind: "uups"
        });

        const sendEthTx = await owner.sendTransaction({
            to: stakingContract2.target,
            value: ethers.parseUnits("1000", 18),
          });
        await sendEthTx.wait();

        expect(await stakingContract2.getCurrentRewardPerSecond()).to.equal(BigInt(0));
        expect(await stakingContract2.getCurrentPointsPerSecond()).to.equal(BigInt(0));

        const stakedAmount = BigInt(10000);
        await stakingContract2.stake({value: stakedAmount});

        await time.increase(10000);

        const earnedRewards = await stakingContract2.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards.toString());
        expect(earnedRewards).to.equal(BigInt(0));

        const earnedPoints = await stakingContract2.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints.toString());
        expect(earnedPoints).to.equal(BigInt(0));
        
        // try to claim rewards
        const balanceBefore = await ethers.provider.getBalance(owner.address);
        await stakingContract2.claimRewards();
        const balanceAfter = await ethers.provider.getBalance(owner.address);
        console.log("Balance before: ", balanceBefore.toString());
        console.log("Balance after: ", balanceAfter.toString());
        expect(balanceAfter).to.be.lessThanOrEqual(balanceBefore); // LTE because of gas fees

        // increase reward rate
        const rewardRate = BigInt("10000000000000000"); // arbitrary high value to cover gas fees for final check
        const timePassed = 10000;
        await stakingContract2.changeRewardPerSecond(rewardRate);
        await stakingContract2.changePointsPerSecond(rewardRate);

        await time.increase(timePassed);

        const expectedReward = BigInt(timePassed) * BigInt(rewardRate); // only owner has staked, so owner gets all rewards
        console.log("Expected reward: ", expectedReward); 

        const earnedRewards2 = await stakingContract2.earnedRewards(owner.address);
        console.log("Pending reward: ", earnedRewards2.toString());
        expect(earnedRewards2).to.be.equal(expectedReward + rewardRate); // 1 second extra for block passing after changing reward rate

        const earnedPoints2 = await stakingContract2.earnedUserPoints(owner.address);
        console.log("Pending points: ", earnedPoints2.toString());
        expect(earnedPoints2).to.be.equal(expectedReward);

        // claim rewards
        const balanceBefore2 = await ethers.provider.getBalance(owner.address);
        await stakingContract2.claimRewards();
        const balanceAfter2 = await ethers.provider.getBalance(owner.address);
        console.log("Balance before: ", balanceBefore2.toString());
        console.log("Balance after: ", balanceAfter2.toString());
        expect(balanceAfter2).to.be.greaterThan(balanceBefore2);


    });

    it("Should fail to stake 0 amount", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        await expect(
            stakingContract.stake({value: BigInt(0)})
        ).to.be.revertedWith("Cannot stake 0");

    });

    it("Should fail to unstake more than staked amount", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        await stakingContract.stake({value: BigInt(10000)});
        const userInfo = await stakingContract.userInfo(owner.address);
        expect(userInfo.amount).to.equal(BigInt(10000));
        // totalStaked
        expect(await stakingContract.totalStaked()).to.equal(BigInt(10000));

        await expect(
            stakingContract.unstake(BigInt(20000))
        ).to.be.revertedWith("Insufficient staked amount");

    });

    it("Should return correct data for getter functions", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner, otherAccount, otherAccount2, otherAccount3] = await ethers.getSigners();

        expect(await stakingContract.getStakedBalance(owner.address)).to.equal(BigInt(0));
        expect(await stakingContract.getCurrentRewardPerSecond()).to.equal(BigInt(1));
        expect(await stakingContract.getCurrentPointsPerSecond()).to.equal(BigInt(1));

        const startUserInfo = await stakingContract.getUserInfo(owner.address);
        expect(startUserInfo.amount).to.equal(BigInt(0));

        // update values
        await stakingContract.changeRewardPerSecond(2);
        await stakingContract.changePointsPerSecond(2);
        await stakingContract.stake({value: BigInt(10000)});

        const endUserInfo = await stakingContract.getUserInfo(owner.address);
        expect(endUserInfo.amount).to.equal(BigInt(10000));
        expect(await stakingContract.getStakedBalance(owner.address)).to.equal(BigInt(10000));
        expect(await stakingContract.getCurrentRewardPerSecond()).to.equal(BigInt(2));
        expect(await stakingContract.getCurrentPointsPerSecond()).to.equal(BigInt(2));
        
    });

    it("Should test emergency withdraw", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner] = await ethers.getSigners();

        const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
        const contractBalanceBefore = await ethers.provider.getBalance(stakingContract.target);
        console.log(`Owner balance before: ${ownerBalanceBefore} POP`);
        console.log(`Contract balance before: ${contractBalanceBefore} POP`);
        
        await stakingContract.emergencyWithdraw();

        const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
        const contractBalanceAfter = await ethers.provider.getBalance(stakingContract.target);
        console.log(`Owner balance after: ${ownerBalanceAfter} POP`);
        console.log(`Contract balance after: ${contractBalanceAfter} POP`);

        expect(contractBalanceAfter).to.equal(BigInt(0));
        expect(ownerBalanceAfter).to.be.above(ownerBalanceBefore);

    });

    it("Should restrict access to onlyOwner functions", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();
        
        await expect(
            stakingContract.connect(otherAccount).changeRewardPerSecond(2)
        ).to.be.revertedWithCustomError(stakingContract, "OwnableUnauthorizedAccount");

        await expect(
            stakingContract.connect(otherAccount).changePointsPerSecond(2)
        ).to.be.revertedWithCustomError(stakingContract, "OwnableUnauthorizedAccount");

        await expect(
            stakingContract.connect(otherAccount).emergencyWithdraw()
        ).to.be.revertedWithCustomError(stakingContract, "OwnableUnauthorizedAccount");

    });

    it("Should successfully upgrade the contract", async function () {

        const {
            stakingContract
        } = await loadFixture(deploy);

        const [owner, otherAccount] = await ethers.getSigners();

        await stakingContract.changeRewardPerSecond(2);
        await stakingContract.changePointsPerSecond(2);
        await stakingContract.stake({value: BigInt(10000)});
        await time.increase(10000);

        const totalStakedBefore = await stakingContract.totalStaked();
        const accRewardPerShareBefore = await stakingContract.accRewardPerShare();
        const accPointsPerShareBefore = await stakingContract.accPointsPerShare();
        const lastUpdateTimeBefore = await stakingContract.lastUpdateTime();
        const rewardPerSecondBefore = await stakingContract.rewardPerSecond();
        const pointsPerSecondBefore = await stakingContract.pointsPerSecond();

        const StakingContract2 = await hre.ethers.getContractFactory("StakingContract");
        const upgraded = await upgrades.upgradeProxy(stakingContract.target, StakingContract2);
        await upgraded.waitForDeployment();

        expect(await stakingContract.getAddress()).to.equal(await upgraded.getAddress());

        const totalStakedAfter = await upgraded.totalStaked();
        expect(totalStakedAfter).to.equal(totalStakedBefore);
        const accRewardPerShareAfter = await upgraded.accRewardPerShare();
        expect(accRewardPerShareAfter).to.equal(accRewardPerShareBefore);
        const accPointsPerShareAfter = await upgraded.accPointsPerShare();
        expect(accPointsPerShareAfter).to.equal(accPointsPerShareBefore);
        const lastUpdateTimeAfter = await upgraded.lastUpdateTime();
        expect(lastUpdateTimeAfter).to.equal(lastUpdateTimeBefore);
        const rewardPerSecondAfter = await upgraded.rewardPerSecond();
        expect(rewardPerSecondAfter).to.equal(rewardPerSecondBefore);
        const pointsPerSecondAfter = await upgraded.pointsPerSecond();
        expect(pointsPerSecondAfter).to.equal(pointsPerSecondBefore);

        // only owner can upgrade
        const StakingContractNotOwner = await hre.ethers.getContractFactory("StakingContract", otherAccount);
        await expect(
            upgrades.upgradeProxy(stakingContract.target, StakingContractNotOwner)
        ).to.be.revertedWithCustomError(stakingContract, "OwnableUnauthorizedAccount");

    });

  });