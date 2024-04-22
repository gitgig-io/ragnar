import { ethers } from "hardhat";
import fs from "fs";

const POINTS_TOKEN_FACTORY_TOTAL_SUPPLY = 20_000_000 * 100;
const POINTS_TOKEN_FACTORY_DECIMALS = 2;
const POINTS_TOKEN_FACTORY_FEE = ethers.parseEther("0.002");

async function main() {
  const [owner, custodian, finance, notary] = await ethers.getSigners();

  console.log("----- ACCOUNTS -----");
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log("--------------------");

  const usdcAddress = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
  console.log(`USDC: ${usdcAddress}`);

  const daiAddress = "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1";
  console.log(`DAI: ${daiAddress}`);

  const stablecoinAddrs = [usdcAddress, daiAddress];

  const identity = await ethers.deployContract("Identity", [
    custodian.address,
    notary.address,
    "https://app.gitgig.io"
  ]);
  const identityAddress = await identity.getAddress();
  console.log(`Identity: ${identityAddress}`);

  const bountiesRegistry = await ethers.deployContract("BountiesRegistry", [custodian.address]);
  const bountiesRegistryAddr = await bountiesRegistry.getAddress();
  console.log(`Bounties Registry: ${bountiesRegistryAddr}`);

  const tokenRegistry = await ethers.deployContract("PointsTokenRegistry", [custodian.address]);
  const tokenRegistryAddr = await tokenRegistry.getAddress();
  console.log(`Points Token Registry: ${tokenRegistryAddr}`);

  const ClaimValidatorFactory = await ethers.getContractFactory("OrgKycClaimValidator");
  const claimValidator = await ClaimValidatorFactory.deploy(
    custodian.address,
    bountiesRegistryAddr,
    tokenRegistryAddr,
    notary.address,
  );
  const claimValidatorAddress = await claimValidator.getAddress();
  console.log(`ClaimValidator: ${claimValidatorAddress}`);

  for (let i = 0; i < stablecoinAddrs.length; i++) {
    const stable = stablecoinAddrs[i];
    await claimValidator.connect(custodian).setStablecoin(stable, true);
  }

  const BountiesConfigFactory = await ethers.getContractFactory("BountiesConfig");
  const bountiesConfig = await BountiesConfigFactory.deploy(
    custodian.address,
    notary.address,
    identityAddress,
    claimValidatorAddress,
    [usdcAddress, daiAddress]
  );
  const bountiesConfigAddress = await bountiesConfig.getAddress();
  console.log(`BountiesConfig: ${bountiesConfigAddress}`);

  const bounties = await ethers.deployContract("Bounties", [
    bountiesConfigAddress,
    custodian.address,
    finance.address,
  ]);

  const bountiesAddr = await bounties.getAddress();
  console.log(`Bounties: ${bountiesAddr}`);

  // add bounties contract to registry
  await bountiesRegistry.connect(custodian).addBountiesContract(bountiesAddr);

  const pointsTokenFactory = await ethers.deployContract("PointsTokenFactory", [
    custodian.address,
    finance.address,
    notary.address,
    bountiesRegistryAddr,
    tokenRegistryAddr,
    POINTS_TOKEN_FACTORY_DECIMALS,
    POINTS_TOKEN_FACTORY_TOTAL_SUPPLY,
    POINTS_TOKEN_FACTORY_FEE,
  ]);
  const pointsTokenFactoryAddr = await pointsTokenFactory.getAddress();
  console.log(`Points Token Factory: ${pointsTokenFactoryAddr}`);

  await pointsTokenFactory.connect(custodian).addBountiesConfigContract(bountiesConfig);

  // allow the token factory to add supported tokens to the bounties contract
  await bountiesConfig
    .connect(custodian)
    .grantRole(await bountiesConfig.TRUSTED_CONTRACT_ROLE(), pointsTokenFactory);

  // allow the pointsTokenFactory to register tokens in the registry
  await tokenRegistry
    .connect(custodian)
    .grantRole(
      await tokenRegistry.TRUSTED_CONTRACT_ROLE(),
      pointsTokenFactoryAddr,
    );

  // set service fee to 0
  await bountiesConfig.connect(custodian).setServiceFee(0);

  // set a custom fee for the issuer
  // await bountiesConfig.connect(custodian).setCustomServiceFee(issuer.address, 10);

  // write out addresses to a file
  const addresses = {
    // infra
    bounties: bountiesAddr,
    bountiesConfig: bountiesConfigAddress,
    bountiesRegistry: bountiesRegistryAddr,
    claimValidator: claimValidatorAddress,
    identity: identityAddress,
    pointsTokenFactory: pointsTokenFactoryAddr,
    pointsTokenRegistry: tokenRegistryAddr,

    // tokens
    dai: daiAddress,
    usdc: usdcAddress,
  };

  fs.writeFileSync("addresses-arb.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
