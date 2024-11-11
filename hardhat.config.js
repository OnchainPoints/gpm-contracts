require("@nomicfoundation/hardhat-toolbox");
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require('dotenv').config();
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    conduit: {
      url: process.env.RPC_URL_CONDUIT,
      chainId: 17071,
      accounts: [process.env.PRIVATE_KEY],
      gas: 2100000,
      gasPrice: 1000000000
    }
  },
  etherscan: {
    apiKey: {
      "conduit": "abc"
    },
    customChains: [
      {
        network: "conduit",
        chainId: 17071,
        urls: {
          apiURL: `https://explorer.onchainpoints.xyz/api`,
          browserURL: "https://explorer.onchainpoints.xyz/",
        }
      }
    ]
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? false : true
  }
};