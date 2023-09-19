import { ethers } from "hardhat";
import fs from "fs";

// read addresses from file
const { bounties: BOUNTIES_ADDR, usdc: USDC_ADDR } = JSON.parse(fs.readFileSync("addresses.json", "utf8"));

async function postBounty() {
  const [_owner, oracle, issuer, contributor] = await ethers.getSigners();

  const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
  const usdc = TestUsdcFactory.attach(USDC_ADDR);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach(BOUNTIES_ADDR);

  // const tx = await bounties.test();

  const amount = 5;
  await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
  const tx = await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);
  console.log(tx.hash);
}

async function main() {
  await postBounty();
}

main();

