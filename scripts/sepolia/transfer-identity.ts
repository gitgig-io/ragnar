import { ethers } from "hardhat";
import { TypedDataDomain, TypedDataField } from "ethers";

async function main() {
  const [owner, custodian, finance, notary] = await ethers.getSigners();

  const identityFactory = await ethers.getContractFactory("Identity");
  const identity = await identityFactory.attach("0x63e38e25aC8f8fd1D986D9b112973c38dEE87E68");

  const params = [custodian.address, "1", "1", "coder3", 2];

  const domain: TypedDataDomain = {
    name: "GitGigIdentity",
    version: "1",
    chainId: 421614,
    verifyingContract: await identity.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    Identity: [
      { name: "userAddress", type: "address" },
      { name: "platformId", type: "string" },
      { name: "platformUserId", type: "string" },
      { name: "platformUsername", type: "string" },
      { name: "nonce", type: "uint16" },
    ]
  };

  const values: Record<string, any> = {
    userAddress: params[0] as string,
    platformId: params[1] as string,
    platformUserId: params[2] as string,
    platformUsername: params[3] as string,
    nonce: params[4] as number,
  };

  const signature = await notary.signTypedData(domain, types, values);

  const tx = await identity.connect(owner).transfer(
    params[0] as string,
    params[1] as string,
    params[2] as string,
    params[3] as string,
    params[4] as number,
    signature
  );
  console.log(tx);
}

main();
