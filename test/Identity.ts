import { expect } from "chai";
import { ethers } from "hardhat";
import { mintSignature } from "./helpers/signatureHelpers";

describe("Identity", () => {
  async function identityFixture() {
    const [owner, custodian, notary, user, user2] = await ethers.getSigners();
    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(custodian.address, notary.address, "http://localhost:4000");
    return { identity, custodian, notary, owner, user, user2 };
  }

  async function signAndMintFixture() {
    const fixtures = await identityFixture();
    const { identity, notary, user } = fixtures;
    const params = [user.address, "1", "123", "coder1"];
    const signature = await mintSignature(params, notary);
    await identity.mint(params[0], params[1], params[2], params[3], signature);
    return { ...fixtures, params };
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
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);

      // when
      const txn = await identity.mint(params[0], params[1], params[2], params[3], signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should revert when paused", async () => {
      // given
      const { identity, custodian, notary, user } = await identityFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);

      // when/then
      await expect(identity.mint(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, 'EnforcedPause');
    });

    it("should emit an IdentityUpdate event", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);

      // when/then
      expect(await identity.mint(params[0], params[1], params[2], params[3], signature))
        .to.emit(identity, "IdentityUpdate")
        .withArgs([1, ...params]);
    });

    it("should set platformUserForTokenId", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);

      // when
      await identity.mint(params[0], params[1], params[2], params[3], signature);

      // then
      const result = await identity.platformUserForTokenId(1);
      expect(result.platformId).to.equal(params[1]);
      expect(result.userId).to.equal(params[2]);
      expect(result.username).to.equal(params[3]);
    });

    it("should set tokenIdForPlatformUser", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);
      expect(await identity.tokenIdForPlatformUser(params[1], params[2])).to.equal(0);

      // when
      await identity.mint(params[0], params[1], params[2], params[3], signature);

      // then
      expect(await identity.tokenIdForPlatformUser(params[1], params[2])).to.equal(1);
    });

    it("fails to mint identity NFT with invalid signature", async () => {
      const { identity, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = ethers.toUtf8Bytes("abc123");

      await expect(identity.mint(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, "InvalidSignature");
    });

    it("fails to mint identity NFT with signature from wrong account", async () => {
      const { identity, owner, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, owner);

      await expect(identity.mint(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, "InvalidSignature");
    });

    it("fails to mint a second nft for a user", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);
      await identity.mint(params[0], params[1], params[2], params[3], signature);

      // when
      await expect(identity.mint(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, "AlreadyMinted");
    });

    // TODO: add tests for nft attributes

    // it.only("fake test for printout out the wallet signed message", async () => {
    //   const { notary, user } = await identityFixture();

    //   const params = [user.address, "1", "123456", "bob"];
    //   const signature = await mintSignature(params, notary);
    //   // const msg = ethers.toUtf8Bytes("GitGig Wallet Link: 123456")
    //   // const hash = ethers.keccak256(msg);
    //   // // without this conversion the number of bytes will be 64 instead of 32 which is wrong.
    //   // const hashBytes = ethers.toBeArray(hash);
    //   // const signature = await user.signMessage(hashBytes);
    //   console.log('mint signature: ', signature);
    // });

    // it("fake test for printing out the user signed message signature", async () => {
    //   const { notary, user } = await identityFixture();
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

  describe("Transfer", () => {
    // TODO: make sure old wallet balance is 0 and new wallet balance is 1 after updating
    // TODO: what if the target wallet already has an NFT?

    it("should be able to transfer identity NFT", async () => {
      const { identity, notary, user2, params } = await signAndMintFixture();
      params[0] = user2.address;
      const signature = await mintSignature(params, notary);

      // when
      const txn = await identity.transfer(params[0], params[1], params[2], params[3], signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should update username in platformUserForTokenId", async () => {
      // given
      const { identity, notary, params } = await signAndMintFixture();
      params[3] = "coder2";
      const signature = await mintSignature(params, notary);

      // when
      await identity.transfer(params[0], params[1], params[2], params[3], signature);

      // then
      const result = await identity.platformUserForTokenId(1);
      expect(result.platformId).to.equal(params[1]);
      expect(result.userId).to.equal(params[2]);
      expect(result.username).to.equal(params[3]);
    });

    it("should revert when paused", async () => {
      // given
      const { identity, custodian, notary, user2, params } = await signAndMintFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;
      params[0] = user2.address;
      const signature = await mintSignature(params, notary);

      // when/then
      await expect(identity.transfer(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, 'EnforcedPause');
    });

    it("NFT should transfer to new wallet", async () => {
      const { identity, notary, user, user2, params } = await signAndMintFixture();
      params[0] = user2.address;
      const signature = await mintSignature(params, notary);

      // when
      await identity.transfer(params[0], params[1], params[2], params[3], signature);

      // then
      expect(await identity.balanceOf(user2.address)).to.be.equal(1);
      expect(await identity.balanceOf(user.address)).to.be.equal(0);
    });

    it("should emit an IdentityUpdate event", async () => {
      // given
      const { identity, notary, user, user2, params } = await signAndMintFixture();
      params[0] = user2.address;
      const tokenId = await identity.tokenOfOwnerByIndex(user.address, 0);
      const signature = await mintSignature(params, notary);

      // when/then
      expect(await identity.transfer(params[0], params[1], params[2], params[3], signature))
        .to.emit(identity, "IdentityUpdate")
        .withArgs([tokenId, ...params]);
    });

    it("fails to transfer identity NFT with invalid signature", async () => {
      const { identity, notary, user2, params } = await signAndMintFixture();
      // generate sig with old user address
      const signature = await mintSignature(params, notary);
      params[0] = user2.address;

      await expect(identity.transfer(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, "InvalidSignature");
    });

    it("fails to transfer identity NFT when not yet minted", async () => {
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);

      // when
      await expect(identity.transfer(params[0], params[1], params[2], params[3], signature))
        .to.be.revertedWithCustomError(identity, "ERC721NonexistentToken");
    });
  });

  describe("Pause", () => {
    it('should pause', async () => {
      const { identity, custodian } = await identityFixture();

      // when
      await identity.connect(custodian).pause();

      // then
      expect(await identity.paused()).to.be.true;
    });

    it('should emit Paused event', async () => {
      const { identity, custodian } = await identityFixture();

      // when
      await expect(identity.connect(custodian).pause())
        .to.emit(identity, "Paused")
        .withArgs(custodian.address);
    });


    it('should revert when called by non-custodian', async () => {
      const { identity, user } = await identityFixture();

      // when
      await expect(identity.connect(user).pause())
        .to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Unpause", () => {
    it('should unpause', async () => {
      const { identity, custodian } = await identityFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;

      await identity.connect(custodian).unpause();

      // then
      expect(await identity.paused()).to.be.false;
    });

    it('should emit Unpaused event', async () => {
      const { identity, custodian } = await identityFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;

      await expect(identity.connect(custodian).unpause())
        .to.emit(identity, "Unpaused")
        .withArgs(custodian.address);
    });

    it('should revert when called by non-custodian', async () => {
      const { identity, custodian, user } = await identityFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;

      // when
      await expect(identity.connect(user).unpause())
        .to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetNotary", () => {
    it('should update notary', async () => {
      const { identity, custodian, user } = await identityFixture();

      // when
      const txn = await identity.connect(custodian).setNotary(user.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await identity.notary()).to.be.eq(user.address);
    });

    it('should emit ConfigChange event', async () => {
      const { identity, custodian, user } = await identityFixture();

      // when
      expect(await identity.connect(custodian).setNotary(user.address))
        .to.emit(identity, "ConfigChange")
        .withArgs(user.address);
    });

    it('should not allow non-custodian to update notary', async () => {
      const { identity, user } = await identityFixture();

      // when/then
      await expect(identity.connect(user).setNotary(user.address))
        .to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });

    it('should revert when attempting to set to zero address', async () => {
      const { identity, custodian } = await identityFixture();

      // when/then
      await expect(identity.connect(custodian).setNotary(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(identity, "InvalidAccount");
    });
  });

  describe("SetBaseUri", () => {
    it('should update base uri', async () => {
      const { identity, custodian } = await identityFixture();

      // when
      const txn = await identity.connect(custodian)
        .setBaseUri("http://localhost:9000");

      // then
      expect(txn.hash).to.be.a.string;
      expect(await identity.baseUri()).to.be.eq("http://localhost:9000");
    });

    it('should emit ConfigChange event', async () => {
      const { identity, custodian, notary } = await identityFixture();

      // when
      expect(await identity.connect(custodian)
        .setBaseUri("http://localhost:9000"))
        .to.emit(identity, "ConfigChange")
        .withArgs(notary.address, "http://localhost:9000");
    });

    it('should not allow non-custodian to update notary', async () => {
      const { identity, user } = await identityFixture();

      // when/then
      await expect(identity.connect(user)
        .setBaseUri("http://localhost:9000"))
        .to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });
  });

  describe("AccessControl:Custodian", () => {
    it('should allow granting custodian role', async () => {
      const { identity, custodian, user } = await identityFixture();

      // when
      await identity.connect(custodian).grantRole(await identity.CUSTODIAN_ROLE(), user.address);

      // then
      expect(await identity.hasRole(await identity.CUSTODIAN_ROLE(), await user.getAddress())).to.be.true;
    });

    it('should allow revoking custodian role', async () => {
      const { identity, custodian, user } = await identityFixture();
      await identity.connect(custodian).grantRole(await identity.CUSTODIAN_ROLE(), user.address);
      expect(await identity.hasRole(await identity.CUSTODIAN_ROLE(), user.address)).to.be.true;

      // when
      await identity.connect(custodian).revokeRole(await identity.CUSTODIAN_ROLE(), user.address);

      // then
      expect(await identity.hasRole(await identity.CUSTODIAN_ROLE(), user.address)).to.be.false;
    });

    it('should emit RoleGranted event', async () => {
      const { identity, custodian, user } = await identityFixture();

      // when
      await expect(identity.connect(custodian).grantRole(await identity.CUSTODIAN_ROLE(), user.address))
        .to.emit(identity, "RoleGranted")
        .withArgs(
          await identity.CUSTODIAN_ROLE(),
          await user.getAddress(),
          await custodian.getAddress(),
        );
    });

    it('should emit RoleRevoked event', async () => {
      const { identity, custodian, user } = await identityFixture();
      await identity.connect(custodian).grantRole(await identity.CUSTODIAN_ROLE(), user.address);
      expect(await identity.hasRole(await identity.CUSTODIAN_ROLE(), user.address)).to.be.true;

      // when
      await expect(identity.connect(custodian).revokeRole(await identity.CUSTODIAN_ROLE(), user.address))
        .to.emit(identity, "RoleRevoked")
        .withArgs(
          await identity.CUSTODIAN_ROLE(),
          user.address,
          custodian.address
        );
    });

    it('should not allow non-custodian to grant custodian role', async () => {
      const { identity, user } = await identityFixture();

      // when/then
      await expect(identity.connect(user).grantRole(await identity.CUSTODIAN_ROLE(), user.address))
        .to.be.revertedWithCustomError(identity, "AccessControlUnauthorizedAccount");
    });
  });

  describe("TokenURI", () => {
    it('should return token URI', async () => {
      const { identity, user, notary } = await identityFixture();
      const params = [user.address, "1", "123", "coder1"];
      const signature = await mintSignature(params, notary);
      const txn = await identity.mint(params[0], params[1], params[2], params[3], signature);
      const tokenId = await identity.tokenOfOwnerByIndex(user, 0);
      const identityAddr = (await identity.getAddress()).toLowerCase();

      // when
      const uri = await identity.tokenURI(tokenId);

      // then
      expect(uri).to.be.a.string;
      expect(uri).to.equal(
        `http://localhost:4000/api/chains/${txn.chainId}/contracts/${identityAddr}/tokens/${tokenId}`
      );
    });
  });

  describe("OwnerOf/2", () => {
    it('should return zero address for non-existent token', async () => {
      const { identity } = await identityFixture();
      // this works, but ts compiler is not happy.
      expect(await identity.ownerOf(ethers.Typed.string('1'), ethers.Typed.string('123')))
        .to.equal(ethers.ZeroAddress);
    });

    it('should return owner address', async () => {
      const { identity, user, params } = await signAndMintFixture();
      expect(await identity.ownerOf(ethers.Typed.string(params[1]), ethers.Typed.string(params[2])))
        .to.equal(user.address);
    });
  });

  describe("Approve", () => {
    it('should revert', async () => {
      const { identity, user, user2, params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1], params[2]);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).approve(user2.address, tokenId))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("SetApprovalForAll", () => {
    it('should revert', async () => {
      const { identity, user, user2, params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1], params[2]);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).setApprovalForAll(user2.address, true))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("TransferFrom", () => {
    it('should revert', async () => {
      const { identity, user, user2, params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1], params[2]);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).transferFrom(user.address, user2.address, tokenId))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("SafeTransferFrom/3", () => {
    it('should revert', async () => {
      const { identity, user, user2, params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1], params[2]);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).safeTransferFrom(user.address, user2.address, tokenId))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("SafeTransferFrom/4", () => {
    it('should revert', async () => {
      const { identity, user, user2, params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1], params[2]);
      expect(tokenId).to.be.greaterThan(0);
      const bytes = ethers.toUtf8Bytes("");

      // when/then
      await expect(
        identity.connect(user).safeTransferFrom(
          ethers.Typed.address(user.address),
          ethers.Typed.address(user2.address),
          ethers.Typed.uint256(tokenId),
          ethers.Typed.bytes(bytes))
      ).to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });
});
