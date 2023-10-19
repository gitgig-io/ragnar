import { expect } from "chai";
import { ethers } from "hardhat";
import { mintSignature } from "./helpers/signatureHelpers";

describe("Identity", () => {
  async function identityFixture() {
    const [owner, signer, user, user2] = await ethers.getSigners();
    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(signer.address);
    return { identity, signer, owner, user, user2 };
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
      const { identity, signer, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, signer);

      // when
      const txn = await identity.mint(params[0], params[1], params[2], params[3], signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should emit an IdentityUpdate event", async () => {
      // given
      const { identity, signer, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, signer);

      // when/then
      expect(await identity.mint(params[0], params[1], params[2], params[3], signature)).to.emit(identity, "IdentityUpdate").withArgs(params);
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

    // TODO: add tests for nft attributes

    // it.only("fake test for printout out the wallet signed message", async () => {
    //   const { signer, user } = await identityFixture();

    //   const params = [user.address, "1", "123456", "bob"];
    //   const signature = await mintSignature(params, signer);
    //   // const msg = ethers.toUtf8Bytes("GitGig Wallet Link: 123456")
    //   // const hash = ethers.keccak256(msg);
    //   // // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
    //   // const hashBytes = ethers.toBeArray(hash);
    //   // const signature = await user.signMessage(hashBytes);
    //   console.log('mint signature: ', signature);
    // });

    // it("fake test for printing out the user signed message signature", async () => {
    //   const { signer, user } = await identityFixture();
    //   const msg = ethers.toUtf8Bytes("GitGig Wallet Link: 123456")
    //   const hash = ethers.keccak256(msg);
    //   console.log('hash: ', hash);

    //   const ethHash = ethers.hashMessage(hash);
    //   console.log('ethHash: ', ethHash);

    //   // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
    //   const hashBytes = ethers.toBeArray(hash);
    //   const signature = await user.signMessage(hashBytes);
    //   console.log('wallet signature: ', signature);
    // });
  });

  describe("Update", () => {
    async function signAndMintFixture() {
      const fixtures = await identityFixture();
      const { identity, signer, user, user2 } = fixtures;
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, signer);
      await identity.mint(params[0], params[1], params[2], params[3], signature);
      return { ...fixtures, params };
    }

    it("should be able to update identity NFT", async () => {
      const { identity, signer, user2, params } = await signAndMintFixture();
      params[0] = user2.address;
      const signature = await mintSignature(params, signer);

      // when
      const txn = await identity.mint(params[0], params[1], params[2], params[3], signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should emit an IdentityUpdate event", async () => {
      // given
      const { identity, signer, user2, params } = await signAndMintFixture();
      params[0] = user2.address;
      const signature = await mintSignature(params, signer);

      // when/then
      expect(await identity.mint(params[0], params[1], params[2], params[3], signature)).to.emit(identity, "IdentityUpdate").withArgs(params);
    });

    it("fails to update identity NFT with invalid signature", async () => {
      const { identity, signer, user2, params } = await signAndMintFixture();
      // generate sig with old user address
      const signature = await mintSignature(params, signer);
      params[0] = user2.address;

      await expect(identity.mint(params[0], params[1], params[2], params[3], signature)).to.be.revertedWith(
        "Invalid signature"
      );
    });

    it("fails to update identity NFT when not yet minted", async () => {
      const { identity, signer, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, signer);

      // when
      await expect(identity.update(params[0], params[1], params[2], params[3], signature)).to.be.revertedWith(
        "No identity to update"
      );
    });
  })
});
