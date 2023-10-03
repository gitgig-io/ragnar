import { expect } from "chai";
import { ethers } from "hardhat";
import { maintainerClaimSignature, mintSignature } from "./helpers/signatureHelpers";

describe("Bounties", () => {
  async function bountiesFixture() {
    const [_owner, oracle, signer, issuer, maintainer, contributor] = await ethers.getSigners();

    const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
    const usdc = await TestUsdcFactory.deploy(1_000_000, issuer.address);
    const usdcAddr = await usdc.getAddress();

    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(signer.address);

    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(oracle.address, signer.address, await identity.getAddress(), [usdcAddr]);
    return { bounties, identity, oracle, signer, issuer, maintainer, contributor, usdc };
  }

  describe("Deployment", () => {
    it("should be able to deploy bounty contract", async () => {
      const { bounties } = await bountiesFixture();
      expect(bounties.getAddress()).to.be.a.string;
    });
  });

  describe("PostBounty", () => {
    it("should be able to post bounty", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await usdc.balanceOf(await bounties.getAddress())).to.be.eq(amount);
    });

    it("should not be able to post bounty with unsupported token", async () => {
      const { bounties, issuer } = await bountiesFixture();
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", issuer.address, 5)).to.be.revertedWith("Unsupported token");
    });

    it("should not be able to post bounty on closed issue", async () => {
      // given
      const { bounties, identity, maintainer, signer, issuer, contributor, usdc } = await bountiesFixture();
      const platformId = "1";
      const maintainerUserId = "m1";
      const claimParams = [maintainerUserId, platformId, "gitgig-io/ragnar", "123", [contributor.address]];
      const claimSignature = await maintainerClaimSignature(claimParams, signer);

      // map identity for maintainer
      const mintParams = [maintainer.address, platformId, maintainerUserId, "coder1"];
      const mintSig = await mintSignature(mintParams, signer);
      const { mint } = identity.connect(maintainer);
      mint.apply(mint, [...mintParams, mintSig] as any);

      // when
      const { maintainerClaim } = bounties.connect(maintainer);
      await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature] as any);

      // then
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), 5)).to.be.revertedWith("Issue is already closed");
    });

    it("should emit a BountyCreated event", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount)).to.emit(bounties, "BountyCreated").withArgs(
        "1",
        "gitgig-io/ragnar",
        "123",
        await issuer.getAddress(),
        await usdc.getAddress(),
        "USDC",
        6,
        amount,
      )
    });
  });

  describe("MaintainerClaim", () => {
    async function claimableBountyFixture() {
      const fixtures = await bountiesFixture();
      const { signer, contributor, maintainer } = fixtures;
      const platformId = "1";
      const maintainerUserId = "m1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";
      const claimParams = [maintainerUserId, platformId, repoId, issueId, [contributor.address]];
      const claimSignature = await maintainerClaimSignature(claimParams, signer);
      const { maintainerClaim } = fixtures.bounties.connect(maintainer);
      const executeMaintainerClaim = async () => await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature] as any);
      return { ...fixtures, platformId, maintainerUserId, repoId, issueId, claimParams, claimSignature, executeMaintainerClaim };
    }

    async function claimableLinkedBountyFixture() {
      const fixtures = await claimableBountyFixture();
      const { identity, maintainer, signer, platformId, maintainerUserId } = fixtures;

      // map identity for maintainer
      const mintParams = [maintainer.address, platformId, maintainerUserId, "coder1"];
      const mintSig = await mintSignature(mintParams, signer);
      const { mint } = identity.connect(maintainer);
      await mint.apply(mint, [...mintParams, mintSig] as any);

      return fixtures;
    }

    it("should allow maintainer to claim with valid signature", async () => {
      const { executeMaintainerClaim } = await claimableLinkedBountyFixture();
      const txn = await executeMaintainerClaim();
      expect(txn.hash).to.be.a.string;
    });

    it("should transfer tokens to maintainer", async () => {
      const { bounties, maintainer, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);

      // when
      await executeMaintainerClaim();

      // then
      const expectedAmount = amount * 0.1;
      expect(await usdc.balanceOf(await maintainer.getAddress())).to.be.eq(expectedAmount);
    });

    it("should revert if issue is already closed", async () => {
      const { executeMaintainerClaim } = await claimableLinkedBountyFixture();
      await executeMaintainerClaim();
      await expect(executeMaintainerClaim()).to.be.revertedWith("Issue is already closed");
    });

    it("should emit issue closed event", async () => {
      const { bounties, executeMaintainerClaim } = await claimableLinkedBountyFixture();
      await expect(executeMaintainerClaim()).to.emit(bounties, "IssueClosed");
    });

    it("should revert if maintainer has not linked identity", async () => {
      const { executeMaintainerClaim } = await claimableBountyFixture();
      await expect(executeMaintainerClaim()).to.be.revertedWith("Maintainer identity not established");
    });

    it("should revert with invalid signature", async () => {
      const { bounties, claimParams, maintainer } = await claimableLinkedBountyFixture();
      // signing with maintainer key instead of signer key
      const wrongSignature = await maintainerClaimSignature(claimParams, maintainer);
      const { maintainerClaim } = bounties.connect(maintainer);
      await expect(maintainerClaim.apply(maintainerClaim, [...claimParams, wrongSignature] as any)).to.be.revertedWith("Invalid signature");
    });

    // TODO: write more tests
  });

  describe("SweepBounty", () => {

  });
});
