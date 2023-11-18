import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";
import env from "dotenv";

env.config();

const {
  GOERLI_OWNER_KEY,
  GOERLI_FINANCE_KEY,
  GOERLI_SIGNER_KEY,
  GOERLI_RPC_URL
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
    goerli: {
      url: GOERLI_RPC_URL,
      accounts: [
        GOERLI_OWNER_KEY!,
        GOERLI_FINANCE_KEY!,
        GOERLI_SIGNER_KEY!
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
