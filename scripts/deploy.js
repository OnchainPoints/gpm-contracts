

async function deploy() {
    // Contracts are deployed using the first signer/account by default
    const [owner] = await ethers.getSigners();

    const tokenContract = await hre.ethers.getContractFactory("WPOP");
    const token = await tokenContract.deploy();

    const onchainPointsContract = await hre.ethers.getContractFactory("OnchainPoints");
    const onchainPoints = await upgrades.deployProxy(onchainPointsContract, [owner.address], {
        initializer: "initialize",
        kind: "uups"
    });

    console.log("Owner address: ", owner.address);
    console.log("WPOP address: ", token.target);
    console.log("Onchain Points address: ", onchainPoints.target);

}

deploy();