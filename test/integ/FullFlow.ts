import { ethers } from "hardhat";
import fs from "fs";
import { maintainerClaimSignature, mintSignature } from "../helpers/signatureHelpers";

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// read addresses from file
const { bounties: BOUNTIES_ADDR, arb: ARB_ADDR, usdc: USDC_ADDR, weth: WETH_ADDR, identity: IDENTITY_ADDR } = JSON.parse(fs.readFileSync("addresses.json", "utf8"));

const { ISSUE_ID } = process.env;

async function execute(issueId: string) {
  const [_owner, _custodian, finance, notary, issuer, maintainer, contributor] = await ethers.getSigners();

  const TestERC20Factory = await ethers.getContractFactory("TestERC20");
  const arb = TestERC20Factory.attach(ARB_ADDR);
  const usdc = TestERC20Factory.attach(USDC_ADDR);
  const weth = TestERC20Factory.attach(WETH_ADDR);

  const IdentityFactory = await ethers.getContractFactory("Identity");
  const identity = IdentityFactory.attach(IDENTITY_ADDR);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach(BOUNTIES_ADDR);

  const platformId = "1";
  const repoId = "gitgig-io/demo";
  // const issueId = "5";

  const stocksUserId = "188319";
  const stocksUsername = "stocks29";

  const brennanUserId = "11755751";
  const brennanUsername = "brennan3";

  const contributorUserId = brennanUserId;
  const contributorUsername = brennanUsername;

  const maintainerUserId = stocksUserId;
  const maintainerUsername = stocksUsername;

  const rl = readline.createInterface({ input, output });

  await rl.question("Next step: create bounty. Press enter to continue");

  // post bounty
  const amount = 50000000000;

  for (const token of [arb, usdc, weth]) {
    await token.connect(issuer).approve(await bounties.getAddress(), amount);
    const tx = await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await token.getAddress(), amount);
    console.log(tx.hash);
  }

  await rl.question("Close the github issue and then press enter to continue");

  // maintainer link
  if (await identity.balanceOf(maintainer.address) > 0) {
    console.log('maintainer already linked');
  } else {
    await rl.question("Next step: maintainer link identity. Press enter to continue");
    const mintParams = [maintainer.address, platformId, maintainerUserId, maintainerUsername, 1];
    const mintSig = await mintSignature(identity, mintParams, notary);
    const { mint } = identity.connect(maintainer);
    await mint.apply(mint, [...mintParams, mintSig] as any);
  }

  await rl.question("Next step: maintainer claim. Press enter to continue");

  // maintainer claim
  const claimParams = [maintainerUserId, platformId, repoId, issueId, [contributorUserId]];
  const claimSignature = await maintainerClaimSignature(bounties, claimParams, notary);
  const { maintainerClaim } = bounties.connect(maintainer);
  await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature]);

  // contributor link
  if (await identity.balanceOf(contributor.address) > 0) {
    console.log('contributor already linked');
  } else {
    await rl.question("Next step: contributor link identity. Press enter to continue");
    const mintParams = [contributor.address, platformId, contributorUserId, contributorUsername, 1];
    const mintSig = await mintSignature(identity, mintParams, notary);
    const { mint } = identity.connect(contributor);
    await mint.apply(mint, [...mintParams, mintSig] as any);
  }

  await rl.question("Next step: contributor claim. Press enter to continue");

  await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

  await rl.question("Next step: fee withdraw. Press enter to continue");

  // withdraw fees
  await bounties.connect(finance).withdrawFees();

  rl.close();
}

async function main() {
  if (!ISSUE_ID) {
    throw new Error("ISSUE_ID not set");
  }

  await execute(ISSUE_ID);
}

main();

