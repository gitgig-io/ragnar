import { ethers } from "hardhat";
import fs from "fs";

async function main() {
  const [owner, custodian, finance, notary, issuer] = await ethers.getSigners();

  console.log('----- ACCOUNTS -----');
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log(`Issuer: ${issuer.address}`);
  console.log('--------------------');

  const usdc = await ethers.deployContract("TestUsdc", [1_000_000_000_000, await issuer.getAddress()]);
  const usdcAddress = await usdc.getAddress();
  console.log(`Test USDC: ${usdcAddress}`);

  const identity = await ethers.deployContract("Identity", [custodian.address, notary.address, "http://localhost:4000"]);
  const identityAddress = await identity.getAddress();
  console.log(`Identity: ${identityAddress}`);

  const bounties = await ethers.deployContract("Bounties", [
    custodian.address,
    finance.address,
    notary.address,
    await identity.getAddress(),
    [await usdc.getAddress()]
  ]);
  const bountiesAddr = await bounties.getAddress();
  console.log(`Bounties: ${bountiesAddr}`);

  // write out addresses to a file
  const addresses = {
    bounties: bountiesAddr,
    identity: identityAddress,
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
