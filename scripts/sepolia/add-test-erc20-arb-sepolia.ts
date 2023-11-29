import { ethers } from "hardhat";

const BOUNTIES_ADDR = "0x73d578371eb449726d727376393b02bb3b8e6a57";

async function main() {
  const [owner, custodian, _finance, _notary] = await ethers.getSigners();

  console.log('----- ACCOUNTS -----');
  console.log(`Owner: ${owner.address}`);
  console.log('--------------------');

  const bigSupply = ethers.toBigInt("1000000000000000000000000000");

  // const testUsdc = await ethers.deployContract("TestERC20", [
  //   "TestUSDC",
  //   "TUSD",
  //   6,
  //   bigSupply,
  //   owner.address
  // ]);

  // const tusdAddress = await testUsdc.getAddress();
  // console.log(`TestUSDC: ${tusdAddress}`);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = BountiesFactory.attach(BOUNTIES_ADDR);

  const txn = await bounties.connect(custodian).addToken("0xE6314Ce90116F8254E551145b5c61d2C8a393fAD");

  console.log(txn);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
