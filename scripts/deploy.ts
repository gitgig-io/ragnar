import { ethers } from "hardhat";
import fs from "fs";

async function main() {
  const [_owner, oracle, issuer] = await ethers.getSigners();

  const usdc = await ethers.deployContract("TestUsdc", [1_000_000, await issuer.getAddress()]);
  const usdcAddress = await usdc.getAddress();
  console.log(`Test USDC: ${usdcAddress}`);

  const bounties = await ethers.deployContract("Bounties", [await oracle.getAddress(), [await usdc.getAddress()]]);
  const bountiesAddr = await bounties.getAddress();
  console.log(`Bounties: ${bountiesAddr}`);

  // write out addresses to a file
  const addresses = {
    bounties: bountiesAddr,
    usdc: usdcAddress
  }

  fs.writeFileSync("addresses.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
