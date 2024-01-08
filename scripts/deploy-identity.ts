import { ethers } from "hardhat";

async function main() {
  const [owner, custodian, finance, notary] = await ethers.getSigners();

  console.log('----- ACCOUNTS -----');
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log('--------------------');

  const identity = await ethers.deployContract("Identity", [
    custodian.address,
    notary.address,
    "https://beta.app.gitgig.io"
  ]);

  const identityAddress = await identity.getAddress();
  console.log(`Identity: ${identityAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
