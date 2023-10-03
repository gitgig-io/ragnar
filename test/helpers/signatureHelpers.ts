import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function mintSignature(params: string[], signer: HardhatEthersSigner) {
  const abiCoder = new ethers.AbiCoder();
  const msg = abiCoder.encode(["address", "string", "string", "string"], params);
  // console.log('msg: ', msg);
  const hash = ethers.keccak256(msg);
  // console.log('data hash: ', hash);
  // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
  const hashBytes = ethers.toBeArray(hash);
  const signature = await signer.signMessage(hashBytes);
  return signature;
}

export async function maintainerClaimSignature(params: any[], signer: HardhatEthersSigner) {
  const abiCoder = new ethers.AbiCoder();
  const msg = abiCoder.encode(["string", "string", "string", "string", "string[]"], params);
  // console.log('msg: ', msg);
  const hash = ethers.keccak256(msg);
  // console.log('data hash: ', hash);
  // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
  const hashBytes = ethers.toBeArray(hash);
  const signature = await signer.signMessage(hashBytes);
  return signature;
}
