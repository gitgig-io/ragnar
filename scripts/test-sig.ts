import { ethers } from "hardhat";

async function main() {
  const [_owner, _custodian, _finance, notary] = await ethers.getSigners();

  const msg = "GitGig Wallet Link: 1699302916";
  const realMsgHash = ethers.id(msg);
  console.log('realMsgHash (id): ', realMsgHash);
  const realMsgHashBytes = ethers.toBeArray(realMsgHash);

  const otherRealMsgHash = ethers.keccak256(ethers.toUtf8Bytes(msg));
  console.log('otherRealMsgHash (keccak256): ', otherRealMsgHash);

  const length = String(realMsgHashBytes.length);
  console.log(length);

  const manualEthHash = ethers.keccak256(ethers.concat([
    ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n"),
    ethers.toUtf8Bytes(length),
    realMsgHashBytes
  ]));
  console.log('manualEthHash: ', manualEthHash);

  const manualEthHash2 = ethers.keccak256(ethers.concat([
    ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n"),
    ethers.toUtf8Bytes(String(ethers.toUtf8Bytes(msg).length)),
    ethers.toUtf8Bytes(msg)
  ]));
  console.log('manualEthHash2: ', manualEthHash2);

  const otherHashedMessage = ethers.hashMessage(ethers.toBeArray(otherRealMsgHash));
  console.log('otherHashedMessage: ', otherHashedMessage);

  const hashedMessage = ethers.hashMessage(msg);
  console.log('hashedMessage: ', hashedMessage);

  const signature = await notary.signMessage(msg);
  console.log('signature: ', signature);

  const recovered = ethers.recoverAddress(hashedMessage, signature);
  console.log('recovered: ', recovered);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
