import { ethers } from "hardhat";
import fs from "fs";

async function main() {
  const [owner, _oracle, _issuer] = await ethers.getSigners();
  const oracle = owner;
  const usdcAddress = '0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892';

  const bounties = await ethers.deployContract("Bounties", [await oracle.getAddress(), [usdcAddress]]);
  const bountiesAddr = await bounties.getAddress();
  console.log(`Bounties: ${bountiesAddr}`);

  // write out addresses to a file
  const addresses = {
    bounties: bountiesAddr,
    usdc: usdcAddress
  }

  fs.writeFileSync("addresses-arb-goerli.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});