import { ethers } from "hardhat";

const USDC_ADDR =
  "0xeB86B3E8e4AFc09319eceE2D1349AB2c60c8012c";
const BOUNTIES_ADDR =
  "0xE458FD74C6bea51dfCbF888260c32892550ec1A5";

async function postBounty() {
  const [_owner, oracle, issuer, contributor] = await ethers.getSigners();

  const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
  const usdc = TestUsdcFactory.attach(USDC_ADDR);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach(BOUNTIES_ADDR);

  const amount = 5;
  await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
  const tx = await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);
  console.log(tx.hash);
}

async function main() {
  await postBounty();
}

main();

