import { ethers } from "hardhat";
import fs from "fs";

// read addresses from file
const { bounties: BOUNTIES_ADDR, usdc: USDC_ADDR, identity: _IDENTITY_ADDR } = JSON.parse(fs.readFileSync("addresses.json", "utf8"));

async function postBounty() {
  const [_owner, _finance, _signer, issuer, _maintainer, _contributor] = await ethers.getSigners();

  const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
  const usdc = TestUsdcFactory.attach(USDC_ADDR);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach(BOUNTIES_ADDR);

  const platformId = "1";
  const repoId = "gitgig-io/demo";
  const issueId = "1";

  // post bounty
  const amount = 5000;
  await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
  const tx = await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
  console.log(tx.hash);
}

async function main() {
  await postBounty();
}

main();

