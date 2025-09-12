const { ethers, upgrades } = require("hardhat");
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, ans => {
        resolve(ans);
    }))
}

async function main() {
    const [owner] = await ethers.getSigners();

    let popAddress;
    const deployNewPop = await askQuestion("Do you want to deploy a new POP token? (y/n) ");

    if (deployNewPop.toLowerCase() === 'y') {
        console.log("Deploying a new POP token...");
        const tokenContract = await hre.ethers.getContractFactory("POP");
        const token = await tokenContract.deploy("Prediction Oracle Points", "POP");
        await token.waitForDeployment();
        popAddress = token.target;
        console.log("POP token deployed to:", popAddress);
    } else {
        popAddress = await askQuestion("Please enter the address of the existing POP token: ");
        if (!ethers.isAddress(popAddress)) {
            console.error("Invalid address provided.");
            rl.close();
            process.exit(1);
        }
    }

    rl.close();

    console.log("Using POP token at address:", popAddress);

    // Deploy ConditionalTokens
    const conditionalTokenContract = await hre.ethers.getContractFactory("ConditionalTokens");
    const conditionalToken = await conditionalTokenContract.deploy("TEST URI"); // The URI can be changed
    await conditionalToken.waitForDeployment();
    console.log("ConditionalTokens deployed to:", conditionalToken.target);

    // Deploy Factory
    const fpmmFactoryContract = await hre.ethers.getContractFactory("Factory");
    const fpmmFactory = await fpmmFactoryContract.deploy();
    await fpmmFactory.waitForDeployment();
    console.log("Factory deployed to:", fpmmFactory.target);

    // Deploy PredictionsOracle
    const predictionOracleContract = await hre.ethers.getContractFactory("PredictionsOracle");
    const predictionsOracle = await upgrades.deployProxy(predictionOracleContract, [owner.address], {
        initializer: "initialize",
        kind: "uups"
    });
    await predictionsOracle.waitForDeployment();
    console.log("PredictionsOracle proxy deployed to:", predictionsOracle.target);

    // Configure contracts
    console.log("Configuring contracts...");
    await predictionsOracle.updateContracts(
        conditionalToken.target,
        fpmmFactory.target,
        popAddress
    );

    await conditionalToken.setOracleAddress(predictionsOracle.target);

    console.log("Deployment and configuration complete.");
    console.log({
        conditionalTokens: conditionalToken.target,
        fpmmFactory: fpmmFactory.target,
        predictionsOracle: predictionsOracle.target,
        popToken: popAddress
    });

    if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
        console.log("Skipping verification for local network.");
        return;
    }

    console.log("Waiting for block confirmations before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds delay

    console.log("Starting contract verification...");

    if (deployNewPop.toLowerCase() === 'y') {
        try {
            console.log("Verifying POP token...");
            await hre.run("verify:verify", {
                address: popAddress,
                constructorArguments: ["Prediction Oracle Points", "POP"],
            });
        } catch (error) {
            console.error("POP token verification failed:", error.message);
        }
    }

    try {
        console.log("Verifying ConditionalTokens...");
        await hre.run("verify:verify", {
            address: conditionalToken.target,
            constructorArguments: ["TEST URI"],
        });
    } catch (error) {
        console.error("ConditionalTokens verification failed:", error.message);
    }

    try {
        console.log("Verifying Factory...");
        await hre.run("verify:verify", {
            address: fpmmFactory.target,
            constructorArguments: [],
        });
    } catch (error) {
        console.error("Factory verification failed:", error.message);
    }

    try {
        console.log("Verifying PredictionsOracle (proxy)...");
        await hre.run("verify:verify", {
            address: predictionsOracle.target,
        });
    } catch (error) {
        console.error("PredictionsOracle verification failed:", error.message);
    }

    console.log("Verification process finished.");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
