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
      chainId: 8453,
      accounts: [process.env.PRIVATE_KEY]
    }
  },
  etherscan: {
    apiKey: {
      "conduit": "abc"
    },
    customChains: [
      {
        network: "conduit",
        chainId: 8453,
        urls: {
          apiURL: `https://api.basescan.org/v2/api`,
          browserURL: "https://basescan.org/",
        }
      }
    ]
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? false : true
  }
};