import { expect } from "chai";
import { ethers } from "hardhat";

describe("Identity", () => {
  async function identityFixture() {
    const [owner, signer] = await ethers.getSigners();
    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(signer.address);
    return { identity, signer, owner };
  }

  describe("Deployment", () => {
    it("should be able to deploy identity contract", async () => {
      const { identity } = await identityFixture();
      expect(identity.getAddress()).to.be.a.string;
    });
  });

  describe("Mint", () => {
    it("should be able to mint identity NFT", async () => {
      // given
      const { identity, signer } = await identityFixture();
      const msg = "some data";
      const hash = ethers.id(msg);
      // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
      const hashBytes = ethers.toBeArray(hash);
      const signature = await signer.signMessage(hashBytes);

      // when
      const txn = await identity.mint("1", msg, signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("fails to mint identity NFT with invalid signature", async () => {
      const { identity } = await identityFixture();
      const msg = "some data";
      const signature = ethers.toUtf8Bytes("abc123");

      await expect(identity.mint("1", msg, signature)).to.be.revertedWith(
        "Invalid signature"
      );
    });

    it("fails to mint identity NFT with signature from wrong account", async () => {
      const { identity, owner } = await identityFixture();
      const msg = "some data";
      const hash = ethers.id(msg);
      const hashBytes = ethers.toBeArray(hash);
      const signature = await owner.signMessage(hashBytes);


      await expect(identity.mint("1", msg, signature)).to.be.revertedWith(
        "Invalid signature"
      );
    });
  });
});
