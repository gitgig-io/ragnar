import { ethers } from "hardhat";
import fs from "fs";

const POINTS_TOKEN_FACTORY_TOTAL_SUPPLY = 20_000_000 * 100;
const POINTS_TOKEN_FACTORY_DECIMALS = 2;
const POINTS_TOKEN_FACTORY_FEE = ethers.WeiPerEther / ethers.toBigInt(5);

async function main() {
  const [owner, custodian, finance, notary, issuer] = await ethers.getSigners();

  console.log("----- ACCOUNTS -----");
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log(`Issuer: ${issuer.address}`);
  console.log("--------------------");

  const usdc = await ethers.deployContract("TestERC20", [
    "TestUSDC",
    "USDC",
    6,
    1_000_000_000_000,
    issuer.address,
  ]);
  const usdcAddress = await usdc.getAddress();
  console.log(`Test USDC: ${usdcAddress}`);

  const bigSupply = ethers.toBigInt("1000000000000000000000000000");

  const arb = await ethers.deployContract("TestERC20", [
    "TestARB",
    "ARB",
    18,
    bigSupply,
    issuer.address,
  ]);
  const arbAddress = await arb.getAddress();
  console.log(`Test ARB: ${arbAddress}`);

  const weth = await ethers.deployContract("TestERC20", [
    "TestWETH",
    "WETH",
    18,
    bigSupply,
    issuer.address,
  ]);
  const wethAddress = await weth.getAddress();
  console.log(`Test WETH: ${wethAddress}`);

  const identity = await ethers.deployContract("Identity", [
    custodian.address,
    notary.address,
    "http://localhost:4000",
  ]);
  const identityAddress = await identity.getAddress();
  console.log(`Identity: ${identityAddress}`);

  const bounties = await ethers.deployContract("Bounties", [
    custodian.address,
    finance.address,
    notary.address,
    await identity.getAddress(),
    [usdcAddress, arbAddress, wethAddress],
  ]);
  const bountiesAddr = await bounties.getAddress();
  console.log(`Bounties: ${bountiesAddr}`);

  const tokenRegistry = await ethers.deployContract("OrgTokenRegistry", [
    custodian.address,
  ]);
  const tokenRegistryAddr = await tokenRegistry.getAddress();
  console.log(`Org Token Registry: ${tokenRegistryAddr}`);

  const pointsTokenFactory = await ethers.deployContract("PointsTokenFactory", [
    custodian.address,
    finance.address,
    notary.address,
    tokenRegistryAddr,
    POINTS_TOKEN_FACTORY_DECIMALS,
    POINTS_TOKEN_FACTORY_TOTAL_SUPPLY,
    POINTS_TOKEN_FACTORY_FEE,
  ]);
  const pointsTokenFactoryAddr = await pointsTokenFactory.getAddress();
  console.log(`Points Token Factory: ${pointsTokenFactoryAddr}`);

  await pointsTokenFactory.connect(custodian).addBountiesContract(bounties);

  // allow the token factory to add supported tokens to the bounties contract
  await bounties
    .connect(custodian)
    .grantRole(await bounties.TRUSTED_CONTRACT_ROLE(), pointsTokenFactory);

  // alow the pointsTokenFactory to register tokens in the registry
  tokenRegistry
    .connect(custodian)
    .grantRole(
      await tokenRegistry.TRUSTED_CONTRACT_ROLE(),
      pointsTokenFactoryAddr,
    );

  // set a custom fee for the issuer
  await bounties.connect(custodian).setCustomServiceFee(issuer.address, 10);

  // write out addresses to a file
  const addresses = {
    // infra
    bounties: bountiesAddr,
    identity: identityAddress,
    pointsTokenFactory: pointsTokenFactoryAddr,
    orgTokenRegistry: tokenRegistryAddr,

    // tokens
    usdc: usdcAddress,
    arb: arbAddress,
    weth: wethAddress,
  };

  fs.writeFileSync("addresses.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
