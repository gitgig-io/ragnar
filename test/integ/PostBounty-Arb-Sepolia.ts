import { ethers } from "hardhat";

// read addresses from file
async function postBounty() {
  const [owner, _oracle, _issuer, _contributor] = await ethers.getSigners();
  const oracle = owner;
  const issuer = owner;

  const usdcAddress = '0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892';
  const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
  const usdc = TestUsdcFactory.attach(usdcAddress);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach("0x037b6d63DfB57e53C6E15d845a299A7026eF93F0");

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

