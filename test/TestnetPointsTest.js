// const { ethers, upgrades } = require("hardhat");
const {
    loadFixture,
    time
  } = require("@nomicfoundation/hardhat-network-helpers");

  const {
    expect
  } = require("chai");
const { ethers } = require("hardhat");
  
  describe("Testing Testnet Points contract", function () {
  

    async function generateSignature(signer, user, amounts, names, slotId) {
        const amountHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [amounts]));
        const namesHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string[]'], [names]));
        const messageHash = ethers.solidityPackedKeccak256(
            ['address', 'uint256', 'bytes32', 'bytes32'],
            [user.address, slotId, amountHash, namesHash]
        );
        const message = ethers.getBytes(messageHash);
        const signature = await signer.signMessage(message);
        const sig = ethers.Signature.from(signature);
        return {
            v: sig.v,
            r: sig.r,
            s: sig.s
        };
    }



    // We define a fixture to reuse the same setup in every test.
    // We use loadFixture to run this setup once, snapshot that state,
    // and reset Hardhat Network to that snapshot in every test.
    async function deploy() {
      // Contracts are deployed using the first signer/account by default
      const [owner, otherAccount] = await ethers.getSigners();

      const testnetPointsContact = await hre.ethers.getContractFactory("TestnetPoints");
      const testnetPoints = await upgrades.deployProxy(testnetPointsContact, [owner.address], {
          initializer: "initialize",
          kind: "uups"
      });
  
      console.log("Testnet points address: ", testnetPoints.target);
  
      await owner.sendTransaction({
          to: testnetPoints.target,
          value: ethers.parseUnits("100", 18)
        });
  
      const prefix = "day";
      const suffix = "_reward";
  
      for (let i = 1; i <= 10; i++) {
          let activity = prefix + i + suffix;
          let tx = await testnetPoints.createActivity(activity);
          await tx.wait();
          console.log("created activity: ", activity);
      }
  
      let tx = await testnetPoints.updateAdminAddresses([otherAccount.address], [1]);
      await tx.wait();
      console.log("added admin: ", otherAccount.address);
  
      // random account
      const randomAccount = ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const randomAccount2 = ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const randomAccount3 = ethers.Wallet.createRandom().connect(hre.ethers.provider);
      const tokenContract = await hre.ethers.getContractFactory("WPOP");
      const token = await tokenContract.deploy();
      
      const StakingContract = await hre.ethers.getContractFactory("StakingContract");

      const stakingContract = await upgrades.deployProxy(StakingContract, [30000000000000, 3000000000000, owner.address], {
          initializer: "initialize",
          kind: "uups"
      });

      let tx1 = await testnetPoints.updateStakingContractAddress(stakingContract.target);
      await tx1.wait();
  
      const sendEthTx = await owner.sendTransaction({
        to: stakingContract.target,
        value: ethers.parseUnits("100", 18),
      });
      await sendEthTx.wait();
      console.log(`Staking Contract balance: ${await ethers.provider.getBalance(stakingContract.target)} POP`);
  
  
      // send eth to onchain points contract
      const sendEthTx1 = await owner.sendTransaction({
        to: testnetPoints.target,
        value: ethers.parseUnits("100", 18),
      });
      await sendEthTx1.wait();
      console.log(`TestnetPoints balance: ${await ethers.provider.getBalance(testnetPoints.target)} POP`);
  
      const sendEthTx2 = await owner.sendTransaction({
        to: randomAccount.address,
        value: ethers.parseUnits("100", 18),
      });
      await sendEthTx2.wait();

      const sendEthTx3 = await owner.sendTransaction({
        to: randomAccount2.address,
        value: ethers.parseUnits("100", 18),
      });
      await sendEthTx3.wait();
  
      await stakingContract.stake({value: BigInt(10000)});
      await stakingContract.connect(otherAccount).stake({value: BigInt(10000)});
      await stakingContract.connect(randomAccount).stake({value: BigInt(10000)});
      await stakingContract.connect(randomAccount2).stake({value: BigInt(10000)});
      await time.increase(10000);
  
      return {
        token,
        randomAccount,
        randomAccount2,
        randomAccount3,
        testnetPoints,
        stakingContract
      };
    }
    
    it("Should handle claiming rewards", async function () {

      const {
        token,
        randomAccount,
        randomAccount2,
        randomAccount3,
        testnetPoints
      } = await loadFixture(deploy);

      const [owner, otherAccount] = await ethers.getSigners();

      let sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward"], 1);

      // claimActivityRewards shouldn't fail with valid signature
      await expect(
        testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      )
      .to.emit(testnetPoints, 'BalanceUpdated').withArgs(randomAccount.address, 100)
      .to.emit(testnetPoints, 'ActivityRewardsClaimed').withArgs("day1_reward", randomAccount.address, 1, 100);

      // claimActivityRewards should revert if the user has already claimed the reward
      await expect(
        testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      ).to.be.revertedWith("Activity rewards already claimed");

      // claimActivityRewards should revert with invalid activity
      sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward_invalid"], 1);
      await expect(
        testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward_invalid"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      ).to.be.revertedWith("Activity not found");

      // claimActivityRewards should revert with invalid signature
      sig_with_data = await generateSignature(owner, randomAccount, [100], ["day1_reward"], 1);
      await expect(
        testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      ).to.be.revertedWith("Signature is not valid");

      // claimActivityRewards should send the correct amount to the user if set
      await testnetPoints.updatePercentageToSendOnClaim(50);
      const percentageToSendOnClaim = await testnetPoints.percentageToSendOnClaim();
      const balanceBefore = await ethers.provider.getBalance(randomAccount2.address);
      const rewardAmount = BigInt(100);
      const expectedAmount = rewardAmount * percentageToSendOnClaim / BigInt(100);

      sig_with_data = await generateSignature(otherAccount, randomAccount2, [rewardAmount], ["day1_reward"], 2);
      await expect(
        testnetPoints.claimActivityRewards(randomAccount2.address, [rewardAmount], ["day1_reward"], 2, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      )
      .to.emit(testnetPoints, 'ActivityRewardsClaimed').withArgs("day1_reward", randomAccount2.address, 2, rewardAmount)
      .to.emit(testnetPoints, 'BalanceUpdated').withArgs(randomAccount2.address, expectedAmount);

      const balanceAfter = await ethers.provider.getBalance(randomAccount2.address);
      expect(balanceAfter).to.equal(balanceBefore + expectedAmount);

      await testnetPoints.updatePercentageToSendOnClaim(0);

      // claimActivityRewards should handle initial gas drop if set
      await testnetPoints.updateInitialGasDrop(100);
      let initialGasDrop = await testnetPoints.initialGasDrop();
      const balanceBefore2 = await testnetPoints.totalUserRewards(randomAccount3.address);
      console.log("balance before: ", balanceBefore2);

      sig_with_data = await generateSignature(otherAccount, randomAccount3, [100], ["day1_reward"], 3);
      await expect(
        testnetPoints.claimActivityRewards(randomAccount3.address, [100], ["day1_reward"], 3, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      ).to.emit(testnetPoints, 'BalanceUpdated').withArgs(randomAccount3.address, 100);

      const balanceAfter2 = await testnetPoints.totalUserRewards(randomAccount3.address);
      console.log("balance after: ", balanceAfter2);
      expect(balanceAfter2).to.equal(initialGasDrop);

      // claimActivityRewards should revert if the contract has no balance and percentageToSendOnClaim is set
      await testnetPoints.updatePercentageToSendOnClaim(50);
      await testnetPoints.emergencyWithdraw();

      sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day2_reward"], 1);
      await expect(
        testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day2_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
      ).to.be.revertedWith("Contract doesn't have enough balance");

    });

    it("It should withdraw and stake user rewards", async function () {
  
      const {
        token,
        randomAccount,
        randomAccount2,
        testnetPoints,
        stakingContract
      } = await loadFixture(deploy);
  
      const [owner, otherAccount] = await ethers.getSigners();

      let sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward"], 1);
      console.log(sig_with_data);

      let tx = await testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s);
      await tx.wait();

      let balance = await testnetPoints.userBalance(randomAccount.address);
      console.log("balance: ", balance);

      let userInfoBefore = await stakingContract.userInfo(randomAccount.address);
      console.log("totalStaked before: ", userInfoBefore.amount);

      // withdrawAndStakeRewards
      let tx2 = await testnetPoints.connect(randomAccount).withdrawAndStakeRewards();
      await tx2.wait();

      let userInfoAfter = await stakingContract.userInfo(randomAccount.address);
      console.log("totalStaked after: ", userInfoAfter.amount);

      let balanceAfter = await testnetPoints.userBalance(randomAccount.address);
      console.log("balance after: ", balanceAfter);

      // should fail without user balance
      await expect(
        testnetPoints.connect(randomAccount2).withdrawAndStakeRewards()
      ).to.be.revertedWith("No rewards to withdraw");

      // should fail without contract balance
      await testnetPoints.emergencyWithdraw();
      sig_with_data = await generateSignature(otherAccount, randomAccount2, [100], ["day1_reward"], 2);
      await testnetPoints.claimActivityRewards(randomAccount2.address, [100], ["day1_reward"], 2, sig_with_data.v, sig_with_data.r, sig_with_data.s);
      await expect(
        testnetPoints.connect(randomAccount2).withdrawAndStakeRewards()
      ).to.be.revertedWith("Contract doesn't have enough balance");

      // should fail without staking contract set
      await testnetPoints.updateStakingContractAddress("0x0000000000000000000000000000000000000000");
      await expect(
        testnetPoints.connect(randomAccount).withdrawAndStakeRewards()
      ).to.be.revertedWith("Staking contract address not set");

    })

    it("Should allow withdrawing of rewards without staking", async function () {

      const {
        token,
        randomAccount,
        randomAccount2,
        testnetPoints,
        stakingContract
      } = await loadFixture(deploy);

      const [owner, otherAccount] = await ethers.getSigners();

      let sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward"], 1);
      console.log(sig_with_data);

      let tx = await testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s);
      await tx.wait();

      const balanceBefore = await testnetPoints.userBalance(randomAccount.address);
      console.log("balance before: ", balanceBefore);
      expect(balanceBefore).to.equal(100);

      let tx2 = await testnetPoints.connect(randomAccount).withdrawRewards();
      await tx2.wait();

      const balanceAfter = await testnetPoints.userBalance(randomAccount.address);
      console.log("balance after: ", balanceAfter);
      expect(balanceAfter).to.equal(0);

      // should fail without balance
      await expect(
        testnetPoints.connect(randomAccount2).withdrawRewards()
      ).to.be.revertedWith("No rewards to withdraw");

      // should fail without contract balance
      await testnetPoints.emergencyWithdraw();
      sig_with_data = await generateSignature(otherAccount, randomAccount2, [100], ["day1_reward"], 2);
      await testnetPoints.claimActivityRewards(randomAccount2.address, [100], ["day1_reward"], 2, sig_with_data.v, sig_with_data.r, sig_with_data.s);
      await expect(
        testnetPoints.connect(randomAccount2).withdrawRewards()
      ).to.be.revertedWith("Contract doesn't have enough balance");


    });
      
    it("It should autostake earned rewards", async function () {
  
        const {
          token,
          randomAccount,
          randomAccount2,
          testnetPoints,
          stakingContract
        } = await loadFixture(deploy);
    
        const [owner, otherAccount] = await ethers.getSigners();
        await testnetPoints.updateAutoStakeRewards(true);
  
        let sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward"], 1);
        console.log(sig_with_data);
  
        let userInfoBefore = await stakingContract.userInfo(randomAccount.address);
        console.log("totalStaked before: ", userInfoBefore.amount);
  
        let tx = await testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s);
        await tx.wait();
  
        let balance = await testnetPoints.userBalance(randomAccount.address);
        console.log("balance: ", balance);
  
        let userInfoAfter = await stakingContract.userInfo(randomAccount.address);
        console.log("totalStaked after: ", userInfoAfter.amount);
  
        let balanceAfter = await testnetPoints.userBalance(randomAccount.address);
        console.log("balance after: ", balanceAfter);
  
      })

      it("Should correctly update the initial gas drop", async function () {

        const {
          testnetPoints
        } = await loadFixture(deploy);

        expect(await testnetPoints.initialGasDrop()).to.equal(0);
        await expect(
          testnetPoints.updateInitialGasDrop(100)
        ).to.emit(testnetPoints, 'InitialGasDropUpdated').withArgs(100);

        expect(await testnetPoints.initialGasDrop()).to.equal(100);

      });

      it("Should correctly update the amount to send on claim", async function () {
          
          const {
            testnetPoints
          } = await loadFixture(deploy);
  
          expect(await testnetPoints.percentageToSendOnClaim()).to.equal(0);

          await expect(
            testnetPoints.updatePercentageToSendOnClaim(100)
          ).to.not.be.reverted;

          expect(await testnetPoints.percentageToSendOnClaim()).to.equal(100);

          await expect(
            testnetPoints.updatePercentageToSendOnClaim(101)
          ).to.be.revertedWith("Percentage must be between 0 and 100");
  
        });

        it("Should correctly handle pausing the contract", async function () {
          
          const {
            testnetPoints,
            randomAccount
          } = await loadFixture(deploy);

          const [owner, otherAccount] = await ethers.getSigners();
  
          expect(await testnetPoints.isPaused()).to.equal(false);

          let sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward"], 1);
          let tx = await testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s);
          await tx.wait();

          await expect(
            testnetPoints.pause()
          ).to.not.be.reverted;
          expect(await testnetPoints.isPaused()).to.equal(true);

          // these should fail due to paused contract

          await expect(
            testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
          ).to.be.revertedWith("Contract is paused");

          await expect(
            testnetPoints.connect(randomAccount).withdrawRewards()
          ).to.be.revertedWith("Contract is paused");

          await expect(
            testnetPoints.connect(randomAccount).withdrawAndStakeRewards()
          ).to.be.revertedWith("Contract is paused");

          await expect(
            testnetPoints.unpause()
          ).to.not.be.reverted;
          expect(await testnetPoints.isPaused()).to.equal(false);
          
        });

        it("Should prevent creating duplicate activities", async function () {
          
          const {
            testnetPoints
          } = await loadFixture(deploy);
  
          await expect(
            testnetPoints.createActivity("day1_reward")
          ).to.be.revertedWith("Activity already exists");
  
        });

        it("Should enfore array lengths for function arguments", async function () {

          const {
            testnetPoints,
            randomAccount
          } = await loadFixture(deploy);

          const [owner, otherAccount] = await ethers.getSigners();

          await expect(
            testnetPoints.updateAdminAddresses([randomAccount.address, owner.address], [1])
          ).to.be.revertedWith("Array length mismatch");

          let sig_with_data = await generateSignature(otherAccount, randomAccount, [100], ["day1_reward", "day2_reward"], 1);

          await expect(
            testnetPoints.claimActivityRewards(randomAccount.address, [100], ["day1_reward", "day2_reward"], 1, sig_with_data.v, sig_with_data.r, sig_with_data.s)
          ).to.be.revertedWith("Array length mismatch");

        });

        it("Should prevent non-owner addresses from accessing restricted functions", async function () {
            
            const {
              testnetPoints,
              randomAccount
            } = await loadFixture(deploy);
  
            const [owner, otherAccount] = await ethers.getSigners();
  
            await expect(
              testnetPoints.connect(randomAccount).updateStakingContractAddress(randomAccount.address)
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).updateAutoStakeRewards(false)
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).updateInitialGasDrop(0)
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).createActivity("new_activity")
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).updatePercentageToSendOnClaim(0)
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).updateAdminAddresses([randomAccount.address], [1])
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).emergencyWithdraw()
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).pause()
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");

            await expect(
              testnetPoints.connect(randomAccount).unpause()
            ).to.be.revertedWithCustomError(testnetPoints, "OwnableUnauthorizedAccount");
  
          });
  
  });