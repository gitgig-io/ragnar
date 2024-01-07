import { ethers } from "hardhat";

const { CONTRACT_ADDR, CONTRACT_TYPE } = process.env;

async function main() {
  const [_owner, custodian, _finance, _notary] = await ethers.getSigners();

  const factory = await ethers.getContractFactory(CONTRACT_TYPE);
  const contract = factory.attach(CONTRACT_ADDR);

  const isPaused = await contract.paused();

  let txn;
  if (isPaused) {
    console.log('unpausing...');
    txn = await contract.connect(custodian).unpause();
  } else {
    console.log('pausing...');
    txn = await contract.connect(custodian).pause();
  }

  console.log(txn);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
