import { ethers } from "hardhat";
import fs from "fs";
import { maintainerClaimSignature, mintSignature } from "../helpers/signatureHelpers";

// read addresses from file
const { bounties: BOUNTIES_ADDR, usdc: USDC_ADDR, identity: IDENTITY_ADDR } = JSON.parse(fs.readFileSync("addresses.json", "utf8"));

async function execute() {
  const [_owner, finance, signer, issuer, maintainer, contributor] = await ethers.getSigners();

  const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
  const usdc = TestUsdcFactory.attach(USDC_ADDR);

  const IdentityFactory = await ethers.getContractFactory("Identity");
  const identity = IdentityFactory.attach(IDENTITY_ADDR);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach(BOUNTIES_ADDR);

  const platformId = "1";
  const repoId = "gitgig-io/demo";
  const issueId = "3";

  const stocksUserId = "188319";
  const stocksUsername = "stocks29";

  const brennanUserId = "11755751";

  const contributorUserId = brennanUserId;

  const maintainerUserId = stocksUserId;
  const maintainerUsername = stocksUsername;

  // post bounty
  const amount = 5000;
  await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
  const tx = await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
  console.log(tx.hash);

  await new Promise(r => setTimeout(r, 1000));

  // maintainer link
  if (await identity.balanceOf(maintainer.address) > 0) {
    console.log('maintainer already linked');
  } else {
    const mintParams = [maintainer.address, platformId, maintainerUserId, maintainerUsername];
    const mintSig = await mintSignature(mintParams, signer);
    const { mint } = identity.connect(maintainer);
    await mint.apply(mint, [...mintParams, mintSig] as any);
  }

  // maintainer claim
  const claimParams = [maintainerUserId, platformId, repoId, issueId, [contributorUserId]];
  const claimSignature = await maintainerClaimSignature(claimParams, signer);
  const { maintainerClaim } = bounties.connect(maintainer);
  await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature]);
}

async function main() {
  await execute();
}

main();

