import { ethers } from "hardhat";

const { CONTRACT_ADDR, PLATFORM_ID, REPO_ID, ISSUE_ID, TOKEN_CONTRACT } = process.env;

async function main() {
  const [_owner, _custodian, finance, _notary] = await ethers.getSigners();

  const factory = await ethers.getContractFactory("Bounties");
  const contract = factory.attach(CONTRACT_ADDR);

  console.log('sweeping...');
  const txn = await contract.connect(finance).sweepBounty(PLATFORM_ID, REPO_ID, ISSUE_ID, [TOKEN_CONTRACT]);

  console.log(txn);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
