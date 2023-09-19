import { ethers } from "hardhat";

const LOCK_ADDR = "0xA52A2032BfBf068F418c7b7BB2dcaad35d7Dfec8";

async function main() {
  const [owner] = await ethers.getSigners();

  const LockFactory = await ethers.getContractFactory("Lock");
  const lock = LockFactory.attach(LOCK_ADDR);

  const tx = await lock.connect(owner).withdraw();
  console.log(tx.hash)
}

main();

