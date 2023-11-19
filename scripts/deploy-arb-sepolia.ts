import { ethers } from "hardhat";
import fs from "fs";

async function main() {
  const [owner, custodian, finance, notary] = await ethers.getSigners();

  console.log('----- ACCOUNTS -----');
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log('--------------------');

  // not sure this is the right ARB address since it uses 0 decimals instead of 18
  const arbAddress = '0x7ff1f29bbfee60cfc4f004e9c8b58b57ff003b3a';
  const usdcAddress = '0xf3c3351d6bd0098eeb33ca8f830faf2a141ea2e1';
  const wethAddress = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73';

  const identity = await ethers.deployContract("Identity", [
    custodian.address,
    notary.address,
    "https://beta.app.gitgig.io"
  ]);

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

  fs.writeFileSync("addresses-arb-sepolia.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
