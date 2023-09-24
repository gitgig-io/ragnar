import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";
import env from "dotenv";

env.config();

const { GOERLI_OWNER_KEY, GOERLI_RPC_URL } = process.env;

const config: HardhatUserConfig = {
  solidity: "0.8.19",
  networks: {
    goerli: {
      url: GOERLI_RPC_URL,
      accounts: [GOERLI_OWNER_KEY!]
    }
  }
};

export default config;
