import { expect } from "chai";
import { ethers, network } from "hardhat";
import { mintSignature } from "./helpers/signatureHelpers";
import { Identity } from "../typechain-types";
// import * as Web3 from 'web3';
import { ERC721Validator } from '@nibbstack/erc721-validator';

describe("Identity", () => {
  async function identityFixture() {
    const [owner, custodian, notary, user, user2] = await ethers.getSigners();
    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(custodian.address, notary.address, "http://localhost:4000");
    return { identity, custodian, notary, owner, user, user2 };
  }

  async function applyMint(identity: Identity, params: any[], signature: Uint8Array | string) {
    return identity.mint(
      params[0] as string,
      params[1] as string,
      params[2] as string,
      params[3] as string,
      params[4] as number,
      signature
    );
  }

  async function applyTransfer(identity: Identity, params: any[], signature: string) {
    return identity.transfer(
      params[0] as string,
      params[1] as string,
      params[2] as string,
      params[3] as string,
      params[4] as number,
      signature
    );
  }

  async function signAndMintFixture() {
    const fixtures = await identityFixture();
    const { identity, notary, user } = fixtures;
    const mintParams = [user.address, "1", "123", "coder1", 1];
    const signature = await mintSignature(identity, mintParams, notary);
    await applyMint(identity, mintParams, signature);
    const transferParams = mintParams.slice(0, 4).concat([2]);
    return { ...fixtures, mintParams, transferParams };
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
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);

      // when
      const txn = await applyMint(identity, params, signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should revert with invalid nonce", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 2];
      const signature = await mintSignature(identity, params, notary);

      // when/then
      await expect(applyMint(identity, params, signature))
        .to.be.revertedWithCustomError(identity, 'InvalidNonce')
        .withArgs(2, 1);
    });

    it("should revert when paused", async () => {
      // given
      const { identity, custodian, notary, user } = await identityFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);

      // when/then
      await expect(applyMint(identity, params, signature))
        .to.be.revertedWithCustomError(identity, 'EnforcedPause');
    });

    it("should emit an IdentityUpdate event", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);

      // when/then
      expect(await identity.mint(user.address, "1", "123", "coder1", 1, signature))
        .to.emit(identity, "IdentityUpdate")
        .withArgs([1, ...params]);
    });

    it("should set platformUserForTokenId", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);

      // when
      await identity.mint(user.address, "1", "123", "coder1", 1, signature);

      // then
      const result = await identity.platformUser(1);
      expect(result.platformId).to.equal(params[1]);
      expect(result.userId).to.equal(params[2]);
      expect(result.username).to.equal(params[3]);
    });

    it("should set tokenIdForPlatformUser", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);
      expect(await identity.tokenIdForPlatformUser("1", "123")).to.equal(0);

      // when
      await identity.mint(user.address, "1", "123", "coder1", 1, signature);

      // then
      expect(await identity.tokenIdForPlatformUser("1", "123")).to.equal(1);
    });

    it("fails to mint identity NFT with invalid signature length", async () => {
      const { identity, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = ethers.toUtf8Bytes("abc123")

      await expect(applyMint(identity, params, signature))
        .to.be.revertedWithCustomError(identity, "ECDSAInvalidSignatureLength");
    });

    it("fails to mint identity NFT with signature from wrong account", async () => {
      const { identity, owner, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, owner);

      await expect(applyMint(identity, params, signature))
        .to.be.revertedWithCustomError(identity, "InvalidSignature");
    });

    it("fails to mint a second nft for a user", async () => {
      // given
      const { identity, notary, user } = await identityFixture();
      const platformId = "1";
      const platformUserId = "123";
      const params = [user.address, platformId, platformUserId, "coder1", 1];
      const signature = await mintSignature(identity, params, notary);
      await applyMint(identity, params, signature);

      // when
      await expect(applyMint(identity, params, signature))
        .to.be.revertedWithCustomError(identity, "AlreadyMinted")
        .withArgs(platformId, platformUserId);
    });

    // TODO: add tests for nft attributes

    // it.only("fake test for printout out the wallet signed message", async () => {
    //   const { notary, user } = await identityFixture();

    //   const params = [user.address, "1", "123456", "bob"];
    //   const signature = await mintSignature(identity, params, notary);
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
      const { identity, notary, user2, transferParams: params } = await signAndMintFixture();
      params[0] = user2.address;
      const signature = await mintSignature(identity, params, notary);

      // when
      const txn = await applyTransfer(identity, params, signature);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should update username in platformUserForTokenId", async () => {
      // given
      const { identity, notary, transferParams: params } = await signAndMintFixture();
      params[3] = "coder2";
      const signature = await mintSignature(identity, params, notary);

      // when
      await applyTransfer(identity, params, signature);

      // then
      const result = await identity.platformUser(1);
      expect(result.platformId).to.equal(params[1]);
      expect(result.userId).to.equal(params[2]);
      expect(result.username).to.equal(params[3]);
    });

    it("should revert with invalid nonce", async () => {
      // given
      const { identity, notary, transferParams: params } = await signAndMintFixture();
      params[4] = 3;
      const signature = await mintSignature(identity, params, notary);

      // when/then
      await expect(applyTransfer(identity, params, signature))
        .to.be.revertedWithCustomError(identity, 'InvalidNonce');
    });

    it("should revert when paused", async () => {
      // given
      const { identity, custodian, notary, user2, transferParams: params } = await signAndMintFixture();
      await identity.connect(custodian).pause();
      expect(await identity.paused()).to.be.true;
      params[0] = user2.address;
      const signature = await mintSignature(identity, params, notary);

      // when/then
      await expect(applyTransfer(identity, params, signature))
        .to.be.revertedWithCustomError(identity, 'EnforcedPause');
    });

    it("NFT should transfer to new wallet", async () => {
      const { identity, notary, user, user2, transferParams: params } = await signAndMintFixture();
      params[0] = user2.address;
      const signature = await mintSignature(identity, params, notary);

      // when
      await applyTransfer(identity, params, signature);

      // then
      expect(await identity.balanceOf(user2.address)).to.be.equal(1);
      expect(await identity.balanceOf(user.address)).to.be.equal(0);
    });

    it("should emit an IdentityUpdate event", async () => {
      // given
      const { identity, notary, user, user2, transferParams: params } = await signAndMintFixture();
      params[0] = user2.address;
      const tokenId = await identity.tokenOfOwnerByIndex(user.address, 0);
      const signature = await mintSignature(identity, params, notary);

      // when/then
      expect(await applyTransfer(identity, params, signature))
        .to.emit(identity, "IdentityUpdate")
        .withArgs([tokenId, ...params]);
    });

    it("fails to transfer identity NFT with invalid signature", async () => {
      const { identity, notary, user2, transferParams: params } = await signAndMintFixture();
      // generate sig with old user address
      const signature = await mintSignature(identity, params, notary);
      params[0] = user2.address;

      await expect(applyTransfer(identity, params, signature))
        .to.be.revertedWithCustomError(identity, "InvalidSignature");
    });

    it("fails to transfer identity NFT when not yet minted", async () => {
      const { identity, notary, user } = await identityFixture();
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);

      // when
      await expect(applyTransfer(identity, params, signature))
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
        .to.be.revertedWithCustomError(identity, "InvalidAddress")
        .withArgs(ethers.ZeroAddress);
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
      const params = [user.address, "1", "123", "coder1", 1];
      const signature = await mintSignature(identity, params, notary);
      const txn = await applyMint(identity, params, signature);
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
      const { identity, user, mintParams: params } = await signAndMintFixture();
      expect(await identity.ownerOf(ethers.Typed.string(params[1] as string), ethers.Typed.string(params[2] as string)))
        .to.equal(user.address);
    });
  });

  describe("Approve", () => {
    it('should revert', async () => {
      const { identity, user, user2, mintParams: params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1] as string, params[2] as string);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).approve(user2.address, tokenId))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("SetApprovalForAll", () => {
    it('should revert', async () => {
      const { identity, user, user2, mintParams: params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1] as string, params[2] as string);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).setApprovalForAll(user2.address, true))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("TransferFrom", () => {
    it('should revert', async () => {
      const { identity, user, user2, mintParams: params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1] as string, params[2] as string);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).transferFrom(user.address, user2.address, tokenId))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("SafeTransferFrom/3", () => {
    it('should revert', async () => {
      const { identity, user, user2, mintParams: params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1] as string, params[2] as string);
      expect(tokenId).to.be.greaterThan(0);

      // when/then
      await expect(identity.connect(user).safeTransferFrom(user.address, user2.address, tokenId))
        .to.be.revertedWithCustomError(identity, "NotSupported");
    });
  });

  describe("SafeTransferFrom/4", () => {
    it('should revert', async () => {
      const { identity, user, user2, mintParams: params } = await signAndMintFixture();
      const tokenId = await identity.tokenIdForPlatformUser(params[1] as string, params[2] as string);
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

  describe("TotalSupply", () => {
    it('should return zero when none minted', async () => {
      const { identity } = await identityFixture();
      expect(await identity.totalSupply()).to.equal(0);
    });

    it('should return total supply of minted', async () => {
      const { identity, notary, user2 } = await signAndMintFixture();
      expect(await identity.totalSupply()).to.equal(1);

      // mint another and ensure supply is correct
      const mintParams = [user2.address, "1", "234", "coder2", 1];
      const signature = await mintSignature(identity, mintParams, notary);
      await applyMint(identity, mintParams, signature);
      expect(await identity.totalSupply()).to.equal(2);
    });

    it('should return same total supply after transfer', async () => {
      const { identity, notary, transferParams: params } = await signAndMintFixture();
      expect(await identity.totalSupply()).to.equal(1);

      // mint another and ensure supply is correct
      const signature = await mintSignature(identity, params, notary);
      await applyTransfer(identity, params, signature);
      expect(await identity.totalSupply()).to.equal(1);
    });
  });

  describe("TokenByIndex", () => {
    it('should return custom error for index out of bounds', async () => {
      const { identity } = await identityFixture();
      await expect(identity.tokenByIndex(0))
        .to.be.revertedWithCustomError(identity, 'ERC721OutOfBoundsIndex');
    });

    it('should return token by index', async () => {
      const { identity, notary, user2 } = await signAndMintFixture();
      expect(await identity.tokenByIndex(0)).to.equal(1);

      const mintParams = [user2.address, "1", "234", "coder2", 1];
      const signature = await mintSignature(identity, mintParams, notary);
      await applyMint(identity, mintParams, signature);
      expect(await identity.tokenByIndex(1)).to.equal(2);
    });
  })

  describe("TokenOfOwnerByIndex", () => {
    it('should return token id', async () => {
      const { identity, notary, user, user2 } = await signAndMintFixture();

      const mintParams = [user2.address, "1", "234", "coder2", 1];
      const signature = await mintSignature(identity, mintParams, notary);
      await applyMint(identity, mintParams, signature);

      expect(await identity.tokenOfOwnerByIndex(user.address, 0)).to.equal(1);
      expect(await identity.tokenOfOwnerByIndex(user2.address, 0)).to.equal(2);
    });

    it('should return custom error for index out of bounds', async () => {
      const { identity, user } = await signAndMintFixture();
      await expect(identity.tokenOfOwnerByIndex(user.address, 1))
        .to.be.revertedWithCustomError(identity, 'ERC721OutOfBoundsIndex');
    });
  });

  describe("ERC721 Validation", () => {
    it('should validate', async () => {
      const { identity, user } = await signAndMintFixture();

      const validator = new ERC721Validator(web3, user.address);
      const contract = await identity.getAddress();
      const token = '1';

      const res1 = await validator.basic(1, contract);
      const res2 = await validator.token(2, contract, token);

      expect(res1.result).to.be.true;
      expect(res2.result).to.be.true;
    });
  });
});
