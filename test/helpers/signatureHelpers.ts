import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bounties, Identity } from "../../typechain-types";
import { TypedDataDomain, TypedDataEncoder, TypedDataField } from "ethers";

export async function mintSignature(identity: Identity, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigIdentity",
    version: "1",
    chainId: 1337,
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

  // const domainHash = TypedDataEncoder.hashDomain(domain);
  // console.log('domainHash: ', domainHash);

  // const structHash = TypedDataEncoder.from(types).hash(values);
  // console.log(' structHash: ', structHash);

  // https://github.com/ethers-io/ethers.js/blob/main/src.ts/wallet/base-wallet.ts#L108
  // const hash = TypedDataEncoder.hash(domain, types, values);
  // console.log(' digest: ', hash);

  // https://docs.ethers.org/v6/api/providers/#Signer-signTypedData
  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}

export async function maintainerClaimSignature(bounties: Bounties, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigBounties",
    version: "1",
    chainId: 1337,
    verifyingContract: await bounties.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    MaintainerClaim: [
      { name: "maintainerUserId", type: "string" },
      { name: "platformId", type: "string" },
      { name: "repoId", type: "string" },
      { name: "issueId", type: "string" },
      { name: "resolverIds", type: "string[]" },
    ]
  };

  const values: Record<string, any> = {
    maintainerUserId: params[0] as string,
    platformId: params[1] as string,
    repoId: params[2] as string,
    issueId: params[3] as string,
    resolverIds: params[4] as string[],
  };

  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}
