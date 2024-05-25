import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bounties, BountiesV2, PointsTokenFactory, Identity, OrgKycClaimValidator, MaintainerFees } from "../../typechain-types";
import { TypedDataDomain, TypedDataField } from "ethers";

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

export async function maintainerClaimSignature(bounties: Bounties | BountiesV2, params: any[], signer: HardhatEthersSigner) {
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

export async function createPointsTokenSignature(cpFactory: PointsTokenFactory, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigPointsFactory",
    version: "1",
    chainId: 1337,
    verifyingContract: await cpFactory.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    CreatePointsToken: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "platform", type: "string" },
      { name: "owner", type: "string" },
      { name: "creator", type: "address" },
    ]
  };

  const values: Record<string, any> = {
    name: params[0] as string,
    symbol: params[1] as string,
    platform: params[2] as string,
    owner: params[3] as string,
    creator: params[4] as string,
  };

  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}

export async function setKnownStatusSignature(validator: OrgKycClaimValidator, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigOrgKycClaimValidator",
    version: "1",
    chainId: 1337,
    verifyingContract: await validator.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    SetKnownStatus: [
      { name: "platformId", type: "string" },
      { name: "orgName", type: "string" },
      { name: "platformUserId", type: "string" },
      { name: "isKnown", type: "bool" },
      { name: "expires", type: "uint256" },
    ]
  };

  const values: Record<string, any> = {
    platformId: params[0] as string,
    orgName: params[1] as string,
    platformUserId: params[2] as string,
    isKnown: params[3] as boolean,
    expires: params[4] as number,
  };

  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}

/*
 *
 * Maintainer Fees
 *
 */

export async function setOwnerFeeSignature(maintainerFees: MaintainerFees, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigMaintainerFees",
    version: "1",
    chainId: 1337,
    verifyingContract: await maintainerFees.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    SetOwnerFee: [
      { name: "platform", type: "string" },
      { name: "owner", type: "string" },
      { name: "fee", type: "uint8" },
      { name: "expires", type: "uint256" },
    ]
  };

  const values: Record<string, any> = {
    platform: params[0] as string,
    owner: params[1] as string,
    fee: params[2] as number,
    expires: params[3] as number,
  };

  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}

export async function setRepoFeeSignature(maintainerFees: MaintainerFees, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigMaintainerFees",
    version: "1",
    chainId: 1337,
    verifyingContract: await maintainerFees.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    SetRepoFee: [
      { name: "platform", type: "string" },
      { name: "owner", type: "string" },
      { name: "repo", type: "string" },
      { name: "fee", type: "uint8" },
      { name: "expires", type: "uint256" },
    ]
  };

  const values: Record<string, any> = {
    platform: params[0] as string,
    owner: params[1] as string,
    repo: params[2] as string,
    fee: params[3] as number,
    expires: params[4] as number,
  };

  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}

export async function setIssueFeeSignature(maintainerFees: MaintainerFees, params: any[], signer: HardhatEthersSigner) {
  const domain: TypedDataDomain = {
    name: "GitGigMaintainerFees",
    version: "1",
    chainId: 1337,
    verifyingContract: await maintainerFees.getAddress(),
  };

  const types: Record<string, TypedDataField[]> = {
    SetIssueFee: [
      { name: "platform", type: "string" },
      { name: "owner", type: "string" },
      { name: "repo", type: "string" },
      { name: "issue", type: "string" },
      { name: "fee", type: "uint8" },
      { name: "expires", type: "uint256" },
    ]
  };

  const values: Record<string, any> = {
    platform: params[0] as string,
    owner: params[1] as string,
    repo: params[2] as string,
    issue: params[3] as string,
    fee: params[4] as number,
    expires: params[5] as number,
  };

  const signature = await signer.signTypedData(domain, types, values);
  return signature;
}
