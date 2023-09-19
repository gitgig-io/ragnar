import { ethers } from "hardhat";

const ADDR =
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

async function main() {
  const [owner] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("EventTest");
  const contract = Factory.attach(ADDR);

  const tx = await contract.connect(owner).test();
  console.log(tx.hash)
}

main();

