import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Identity } from "../../typechain-types";
import { TypedDataDomain, TypedDataEncoder, TypedDataField } from "ethers";

export async function mintSignature(identity: Identity, params: any[], signer: HardhatEthersSigner) {
  // const abiCoder = new ethers.AbiCoder();
  // const msg = abiCoder.encode(["address", "string", "string", "string", "uint16"], params);
  // console.log('msg: ', msg);
  // const hash = ethers.keccak256(msg);
  // console.log('data hash: ', hash);
  // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
  // const hashBytes = ethers.toBeArray(hash);

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


// export async function mintSignature(params: any[], signer: HardhatEthersSigner) {
//   const abiCoder = new ethers.AbiCoder();
//   const msg = abiCoder.encode(["address", "string", "string", "string", "uint16"], params);
//   // console.log('msg: ', msg);
//   const hash = ethers.keccak256(msg);
//   // console.log('data hash: ', hash);
//   // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
//   const hashBytes = ethers.toBeArray(hash);
//   const signature = await signer.signMessage(hashBytes);
//   return signature;
// }

export async function maintainerClaimSignature(params: any[], signer: HardhatEthersSigner) {
  const abiCoder = new ethers.AbiCoder();
  const msg = abiCoder.encode(["string", "string", "string", "string", "string[]"], params);
  const hash = ethers.keccak256(msg);
  // console.log('messageHash: ', hash);
  // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
  const hashBytes = ethers.toBeArray(hash);
  // console.log('ethMessageHash: ', ethers.hashMessage(hashBytes));
  const signature = await signer.signMessage(hashBytes);
  return signature;
}
