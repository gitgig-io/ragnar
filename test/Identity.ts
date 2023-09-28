import { expect } from "chai";
import { ethers } from "hardhat";

describe("Identity", () => {
  async function identityFixture() {
    const [owner, signer, user] = await ethers.getSigners();
    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(signer.address);
    return { identity, signer, owner, user };
  }

  describe("Deployment", () => {
    it("should be able to deploy identity contract", async () => {
      const { identity } = await identityFixture();
      expect(identity.getAddress()).to.be.a.string;
    });
  });

  describe("Mint", () => {
    async function mintSignature(params: string[], signer: any) {
      const abiCoder = new ethers.AbiCoder();
      const msg = abiCoder.encode(["address", "string", "string", "string"], params);
      const hash = ethers.keccak256(msg);
      // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
      const hashBytes = ethers.toBeArray(hash);
      const signature = await signer.signMessage(hashBytes);
      return signature;
    }

    it("should be able to mint identity NFT", async () => {
      // given
      const { identity, signer, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, signer);

      // when
      const txn = await identity.mint(params[0], params[1], params[2], params[3], signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("fails to mint identity NFT with invalid signature", async () => {
      const { identity, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = ethers.toUtf8Bytes("abc123");

      await expect(identity.mint(params[0], params[1], params[2], params[3], signature)).to.be.revertedWith(
        "Invalid signature"
      );
    });

    it("fails to mint identity NFT with signature from wrong account", async () => {
      const { identity, owner, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, owner);

      await expect(identity.mint(params[0], params[1], params[2], params[3], signature)).to.be.revertedWith(
        "Invalid signature"
      );
    });

    it("fails to mint a second nft for a user", async () => {
      // given
      const { identity, signer, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, signer);
      await identity.mint(params[0], params[1], params[2], params[3], signature);

      // when
      await expect(identity.mint(params[0], params[1], params[2], params[3], signature)).to.be.revertedWith(
        "Already minted"
      );
    });
  });
});
