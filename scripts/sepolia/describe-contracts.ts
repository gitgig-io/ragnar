import { ethers } from "hardhat";
import { readFileSync } from "fs";

async function main() {
  const [owner, _custodian, _finance, _notary] = await ethers.getSigners();

  const addressesJson = await readFileSync("addresses-arb-sepolia.json").toString();
  const addresses = JSON.parse(addressesJson);

  const BountiesFactory = await ethers.getContractFactory("Bounties");
  const bounties = await BountiesFactory.attach(addresses.bounties);

  const IdentityFactory = await ethers.getContractFactory("Identity");
  const identity = await IdentityFactory.attach(addresses.identity);

  console.log("Balance: ", await identity.balanceOf(owner.address));
  console.log("Maintainer Fee: ", await bounties.maintainerFee());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
