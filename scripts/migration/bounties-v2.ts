import { ethers } from "hardhat";
import { BountiesConfig, BountiesRegistry } from "../../typechain-types";
import fs from "fs";

const {
  BOUNTIES_CONFIG_ADDRESS,
  BOUNTIES_REGISTRY_ADDRESS,
} = process.env;

async function main() {
  const [owner, custodian, finance, notary, issuer] = await ethers.getSigners();

  console.log("----- ACCOUNTS -----");
  console.log(`Owner: ${owner.address}`);
  console.log(`Custodian: ${custodian.address}`);
  console.log(`Finance: ${finance.address}`);
  console.log(`Notary: ${notary.address}`);
  console.log(`Issuer: ${issuer.address}`);
  console.log("--------------------");

  const bountiesConfigFactory = await ethers.getContractFactory("BountiesConfig");
  const bountiesConfig = bountiesConfigFactory.attach(BOUNTIES_CONFIG_ADDRESS!) as BountiesConfig;
  const bountiesConfigAddr = await bountiesConfig.getAddress();
  console.log(`Bounties Config: ${bountiesConfigAddr}`);

  const bountiesRegistryFactory = await ethers.getContractFactory("BountiesRegistry");
  const bountiesRegistry = bountiesRegistryFactory.attach(BOUNTIES_REGISTRY_ADDRESS!) as BountiesRegistry;
  const bountiesRegistryAddr = await bountiesRegistry.getAddress();
  console.log(`Bounties Registry: ${bountiesRegistryAddr}`);

  // 1. deploy MaintainerFees contract
  const maintainerFeesFactory = await ethers.getContractFactory('MaintainerFees');
  const maintainerFees = await maintainerFeesFactory.deploy(custodian.address, notary.address);
  const maintainerFeesAddr = await maintainerFees.getAddress();
  console.log(`Maintainer Fees: ${maintainerFeesAddr}`);

  // 2. deploy BountiesV2 contract
  const StringUtilsFactory = await ethers.getContractFactory("StringUtils");
  const stringUtils = await StringUtilsFactory.deploy();

  const BountyUtilsFactory = await ethers.getContractFactory("BountyUtils", {
    libraries: {
      StringUtils: await stringUtils.getAddress(),
    }
  });
  const bountyUtils = await BountyUtilsFactory.deploy();

  const BountiesV2Factory = await ethers.getContractFactory("BountiesV2", {
    libraries: {
      BountyUtils: await bountyUtils.getAddress(),
      StringUtils: await stringUtils.getAddress(),
    }
  });

  const bountiesV2 = await BountiesV2Factory.deploy(
    bountiesConfigAddr,
    maintainerFeesAddr,
    custodian.address,
    finance.address,
  );
  const bountiesV2Addr = await bountiesV2.getAddress();
  console.log(`BountiesV2: ${bountiesV2Addr}`);

  // add bounties contract to registry
  await bountiesRegistry.connect(custodian).addBountiesContract(await bountiesV2.getAddress());

  // update addresses.json
  const addressesJson = fs.readFileSync("addresses.json", "utf8");
  const addresses = JSON.parse(addressesJson);

  addresses.maintainerFees = maintainerFeesAddr;
  addresses.bountiesV2 = bountiesV2Addr;

  // write out addresses to a file
  fs.writeFileSync("addresses.json", JSON.stringify(addresses));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
