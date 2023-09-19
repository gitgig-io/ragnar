import { ethers } from "hardhat";

async function main() {
  const [_owner, oracle, issuer] = await ethers.getSigners();

  const usdc = await ethers.deployContract("TestUsdc", [1_000_000, await issuer.getAddress()]);
  console.log(`Test USDC: ${await usdc.getAddress()}`);

  const bounties = await ethers.deployContract("Bounties", [await oracle.getAddress(), [await usdc.getAddress()]]);
  console.log(`Bounties: ${await bounties.getAddress()}`);

  // const currentTimestampInSeconds = Math.round(Date.now() / 1000);
  // const unlockTime = currentTimestampInSeconds + 60;

  // const lockedAmount = ethers.parseEther("0.001");

  // const lock = await ethers.deployContract("Lock", [unlockTime], {
  //   value: lockedAmount,
  // });

  // await lock.waitForDeployment();

  // console.log(
  //   `Lock with ${ethers.formatEther(
  //     lockedAmount
  //   )}ETH and unlock timestamp ${unlockTime} deployed to ${lock.target}`
  // );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
