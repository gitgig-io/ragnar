import { ethers } from "hardhat";
import fs from "fs";

const POINTS_TOKEN_FACTORY_TOTAL_SUPPLY = 20_000_000 * 100;
const POINTS_TOKEN_FACTORY_DECIMALS = 2;
const POINTS_TOKEN_FACTORY_FEE = ethers.parseEther("0.002");

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
    "GitGig Test USDC",
    "ggUSDC",
    6,
    1_000_000_000_000_000_000n,
    issuer.address,
  ]);
  const usdcAddress = await usdc.getAddress();
  console.log(`Test USDC: ${usdcAddress}`);

  const dai = await ethers.deployContract("TestERC20", [
    "GitGig Test DAI",
    "ggDAI",
    18,
    1_000_000_000_000_000_000_000_000_000_000n,
    issuer.address,
  ]);
  const daiAddress = await dai.getAddress();
  console.log(`Test DAI: ${daiAddress}`);

  const stablecoinAddrs = [usdcAddress, daiAddress];

  const identity = await ethers.deployContract("Identity", [
    custodian.address,
    notary.address,
    "http://localhost:4000",
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

  const bounties2 = await ethers.deployContract("Bounties", [
    bountiesConfigAddress,
    custodian.address,
    finance.address,
  ]);

  const bountiesAddr2 = await bounties2.getAddress();
  console.log(`Bounties2: ${bountiesAddr2}`);

  // add bounties contract to registry
  await bountiesRegistry.connect(custodian).addBountiesContract(bountiesAddr);
  await bountiesRegistry.connect(custodian).addBountiesContract(bountiesAddr2);

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

  // alow the pointsTokenFactory to register tokens in the registry
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
    bounties2: bountiesAddr2,
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

  fs.writeFileSync("addresses.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
