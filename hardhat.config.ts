import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-web3";
import "hardhat-abi-exporter";
import env from "dotenv";

env.config();

const {
  ARB_SEPOLIA_RPC_URL,
  ARB_SEPOLIA_OWNER_KEY,
  ARB_SEPOLIA_CUSTODIAN_KEY,
  ARB_SEPOLIA_FINANCE_KEY,
  ARB_SEPOLIA_NOTARY_KEY
} = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
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
