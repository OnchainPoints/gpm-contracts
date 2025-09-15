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
      chainId: 11167,
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
        chainId: 11167,
        urls: {
          apiURL: `https://explorer-devnet.powerloom.dev/api`,
          browserURL: "https://explorer-devnet.powerloom.dev/",
        }
      }
    ]
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? false : true
  }
};