import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-web3";
import "hardhat-abi-exporter";
import "hardhat-gas-reporter";
import env from "dotenv";

env.config();

const {
  ARB_GOERLI_RPC_URL,
  // sepolia
  ARB_SEPOLIA_RPC_URL,
  ARB_SEPOLIA_OWNER_KEY,
  ARB_SEPOLIA_CUSTODIAN_KEY,
  ARB_SEPOLIA_FINANCE_KEY,
  ARB_SEPOLIA_NOTARY_KEY,
  COINMARKETCAP_API_KEY,
  // arbitrum (production)
  ARB_RPC_URL,
  ARB_OWNER_KEY,
  ARB_CUSTODIAN_KEY,
  ARB_FINANCE_KEY,
  ARB_NOTARY_KEY
} = process.env;

const config: HardhatUserConfig = {
  gasReporter: {
    currency: "USD",
    coinmarketcap: COINMARKETCAP_API_KEY,
    gasPriceApi: "https://api.arbiscan.io/api?module=proxy&action=eth_gasPrice",
    gasPrice: 0.2,
    enabled: (process.env.REPORT_GAS) ? true : false
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        details: {
          yulDetails: {
            optimizerSteps: "u",
          }
        },
        runs: 100
      },
      viaIR: true
    }
  },
  networks: {
    arbitrum: {
      url: ARB_RPC_URL!,
      accounts: [
        ARB_OWNER_KEY!,
        ARB_CUSTODIAN_KEY!,
        ARB_FINANCE_KEY!,
        ARB_NOTARY_KEY!
      ]
    },
    goerli: {
      url: ARB_GOERLI_RPC_URL!,
      accounts: [
        ARB_SEPOLIA_OWNER_KEY!,
        ARB_SEPOLIA_CUSTODIAN_KEY!,
        ARB_SEPOLIA_FINANCE_KEY!,
        ARB_SEPOLIA_NOTARY_KEY!
      ]
    },
    sepolia: {
      url: ARB_SEPOLIA_RPC_URL!,
      accounts: [
        ARB_SEPOLIA_OWNER_KEY!,
        ARB_SEPOLIA_CUSTODIAN_KEY!,
        ARB_SEPOLIA_FINANCE_KEY!,
        ARB_SEPOLIA_NOTARY_KEY!
      ]
    },
    hardhat: {
      chainId: 1337,
      gasPrice: 200000000,
      initialBaseFeePerGas: 0,
    }
  }
};

export default config;
