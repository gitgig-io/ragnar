import { ethers } from "hardhat";
import fs from "fs";

async function main() {
  const [owner, custodian, finance, notary, issuer] = await ethers.getSigners();

  console.log('----- ACCOUNTS -----');
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log(`Issuer: ${issuer.address}`);
  console.log('--------------------');

  const usdc = await ethers.deployContract("TestERC20", [
    "TestUSDC",
    "USDC",
    6,
    1_000_000_000_000,
    issuer.address
  ]);
  const usdcAddress = await usdc.getAddress();
  console.log(`Test USDC: ${usdcAddress}`);

  const arb = await ethers.deployContract("TestERC20", [
    "TestARB",
    "ARB",
    16,
    1_000_000_000_000_000,
    issuer.address
  ]);
  const arbAddress = await arb.getAddress();
  console.log(`Test ARB: ${arbAddress}`);

  const weth = await ethers.deployContract("TestERC20", [
    "TestWETH",
    "WETH",
    16,
    1_000_000_000_000_000,
    issuer.address
  ]);
  const wethAddress = await weth.getAddress();
  console.log(`Test WETH: ${wethAddress}`);

  const identity = await ethers.deployContract("Identity", [custodian.address, notary.address, "http://localhost:4000"]);
  const identityAddress = await identity.getAddress();
  console.log(`Identity: ${identityAddress}`);

  const bounties = await ethers.deployContract("Bounties", [
    custodian.address,
    finance.address,
    notary.address,
    await identity.getAddress(),
    [usdcAddress, arbAddress, wethAddress]
  ]);
  const bountiesAddr = await bounties.getAddress();
  console.log(`Bounties: ${bountiesAddr}`);

  // write out addresses to a file
  const addresses = {
    bounties: bountiesAddr,
    identity: identityAddress,
    usdc: usdcAddress,
    arb: arbAddress,
    weth: wethAddress
  }

  fs.writeFileSync("addresses.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
