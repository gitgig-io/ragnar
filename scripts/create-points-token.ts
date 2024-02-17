import { ethers } from "hardhat";
// TODO: move this helper lib out of test/
import { createPointsTokenSignature } from "../test/helpers/signatureHelpers";
import { PointsTokenFactory } from "../typechain-types";

/**
 * Usage:
 *
 * FACTORY_CONTRACT_ADDR=0xa513E6E4b8f2a923D98304ec87F64353C4D5C853 \
 * PLATFORM_ID=1 \
 * ORG="gitgig-io" \
 * TOKEN_NAME="Test Points" \
 * TOKEN_SYMBOL=pTST \
 * npx hardhat run scripts/create-points-token.ts --network localhost
 *
 */

const { FACTORY_CONTRACT_ADDR, PLATFORM_ID, ORG, TOKEN_NAME, TOKEN_SYMBOL } = process.env;

async function main() {
  const [owner, _custodian, _finance, notary] = await ethers.getSigners();

  const factory = await ethers.getContractFactory("PointsTokenFactory");
  const tokenFactory = factory.attach(FACTORY_CONTRACT_ADDR!) as PointsTokenFactory;

  console.log('creating points tokens...');
  const baseParams = [
    TOKEN_NAME!,
    TOKEN_SYMBOL!,
    PLATFORM_ID!,
    ORG!,
  ];

  const creator = owner;

  const sig = await createPointsTokenSignature(tokenFactory, [...baseParams, creator.address], notary);

  const { createPointsToken } = tokenFactory.connect(creator);
  const value = ethers.WeiPerEther / ethers.toBigInt(5);
  const txn = await createPointsToken.apply(tokenFactory, [...baseParams, sig, { value }] as any);

  console.log(txn);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
