import { expect } from "chai";
import { ethers } from "hardhat";
import { maintainerClaimSignature, mintSignature } from "./helpers/signatureHelpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bounties, Identity, TestUsdc } from "../typechain-types";

describe("Bounties", () => {
  async function bountiesFixture() {
    const [owner, finance, signer, issuer, maintainer, contributor, contributor2, contributor3] = await ethers.getSigners();

    const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
    const usdc = await TestUsdcFactory.deploy(1_000_000, issuer.address);
    const usdcAddr = await usdc.getAddress();

    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(signer.address);

    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(finance.address, signer.address, await identity.getAddress(), [usdcAddr]);
    return { owner, bounties, identity, usdc, finance, signer, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  async function claimableBountyFixture(contributorIds?: string[]) {
    const fixtures = await bountiesFixture();
    const { signer, maintainer, contributor, contributor2, contributor3 } = fixtures;

    const platformId = "1";
    const maintainerUserId = "maintainer1";
    const contributorUserId = "contributor1";
    const repoId = "gitgig-io/ragnar";
    const issueId = "123";

    const contributorUserIds = contributorIds || [contributorUserId];
    const contributorSigners = [contributor, contributor2, contributor3].slice(0, contributorUserIds.length);
    const claimParams = [maintainerUserId, platformId, repoId, issueId, contributorUserIds];
    const claimSignature = await maintainerClaimSignature(claimParams, signer);
    const { maintainerClaim } = fixtures.bounties.connect(maintainer);
    const executeMaintainerClaim = async () => await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature] as any);

    return { ...fixtures, platformId, maintainerUserId, contributorUserId, repoId, issueId, claimParams, claimSignature, executeMaintainerClaim, contributorUserIds, contributorSigners };
  }

  interface LinkIdentityProps {
    identity: Identity;
    platformId: string;
    platformUserId: string;
    platformUsername: string;
    participant: HardhatEthersSigner;
    signer: HardhatEthersSigner;
  }

  async function linkIdentity({ identity, platformId, platformUserId, platformUsername, participant, signer }: LinkIdentityProps) {
    const mintParams = [participant.address, platformId, platformUserId, platformUsername];
    const mintSig = await mintSignature(mintParams, signer);
    const { mint } = identity.connect(participant);
    await mint.apply(mint, [...mintParams, mintSig] as any);
  }

  async function claimableLinkedBountyFixture(contributorIds?: string[]) {
    const fixtures = await claimableBountyFixture(contributorIds);
    const { identity, maintainer, signer, platformId, maintainerUserId } = fixtures;

    // map identity for maintainer
    await linkIdentity({ identity, platformId, platformUserId: maintainerUserId, platformUsername: "coder1", participant: maintainer, signer });

    return fixtures;
  }

  async function usdcFixture(issuer: HardhatEthersSigner) {
    const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
    const usdc = await TestUsdcFactory.deploy(1_000_000, issuer.address);
    return usdc;
  }

  interface PostBountyProps {
    amount: number;
    platformId: string;
    repoId: string;
    issueId: string;
    bounties: Bounties;
    issuer: HardhatEthersSigner;
    usdc: TestUsdc;
  }

  async function postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc }: PostBountyProps) {
    await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
    await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
  }

  async function maintainerFee(bounties: Bounties, amount: number) {
    const serviceFee = ethers.toNumber(await bounties.serviceFee());
    const maintainerFee = ethers.toNumber(await bounties.maintainerFee());
    const amountAfterServiceFee = amount - (serviceFee * amount / 100);
    return (maintainerFee * amountAfterServiceFee / 100);
  }

  async function serviceFee(bounties: Bounties, amount: number) {
    const serviceFee = ethers.toNumber(await bounties.serviceFee());
    return (serviceFee * amount / 100);
  }

  async function bountyAmountAfterFees(bounties: Bounties, postedAmount: number) {
    const serviceFee = ethers.toNumber(await bounties.serviceFee());
    const amountAfterServiceFee = postedAmount - (serviceFee * postedAmount / 100);

    const maintainerFee = ethers.toNumber(await bounties.maintainerFee());
    const amountAfterMaintainerFee = amountAfterServiceFee - (maintainerFee * amountAfterServiceFee / 100);

    return amountAfterMaintainerFee;
  }

  async function bountyAmountAfterFeesPerContributor(bounties: Bounties, postedAmount: number, numContributors: number) {
    const amountAfterServiceFee = await bountyAmountAfterFees(bounties, postedAmount);
    return amountAfterServiceFee / numContributors;
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

    it("should collect service fees", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = ethers.toBigInt(5);
      const serviceFee = await bounties.serviceFee();
      const expectedFee = amount * serviceFee / ethers.toBigInt(100);

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await usdc.balanceOf(await bounties.getAddress())).to.be.eq(amount);
      expect(await bounties.fees(await usdc.getAddress())).to.be.eq(expectedFee);
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

    it("should emit a BountyCreate event", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      const fee = await serviceFee(bounties, amount);
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount)).to.emit(bounties, "BountyCreate").withArgs(
        "1",
        "gitgig-io/ragnar",
        "123",
        await issuer.getAddress(),
        await usdc.getAddress(),
        "USDC",
        6,
        amount - fee,
        fee
      )
    });
  });

  describe("MaintainerClaim", () => {
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
      const expectedAmount = await maintainerFee(bounties, amount);
      expect(await usdc.balanceOf(await maintainer.getAddress())).to.be.eq(expectedAmount);
    });

    it("should emit BountyClaim event", async () => {
      const { bounties, maintainer, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const expectedAmount = await maintainerFee(bounties, amount);

      // when
      await expect(executeMaintainerClaim()).to.emit(bounties, "BountyClaim").withArgs(
        platformId,
        repoId,
        issueId,
        await maintainer.getAddress(),
        "maintainer",
        await usdc.getAddress(),
        await usdc.symbol(),
        await usdc.decimals(),
        expectedAmount,
      );
    });

    it("should revert if issue is already closed", async () => {
      const { executeMaintainerClaim } = await claimableLinkedBountyFixture();
      await executeMaintainerClaim();
      await expect(executeMaintainerClaim()).to.be.revertedWith("Issue is already closed");
    });

    it("should emit issue closed event", async () => {
      const { bounties, contributorUserIds, executeMaintainerClaim, platformId, repoId, issueId, maintainer, maintainerUserId } = await claimableLinkedBountyFixture();
      await expect(executeMaintainerClaim()).to.emit(bounties, "IssueTransition").withArgs(
        platformId,
        repoId,
        issueId,
        "closed",
        "open",
        maintainerUserId,
        await maintainer.getAddress(),
        contributorUserIds
      );
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
  });

  describe("ContributorClaim", () => {
    it("should allow resolver to claim bounty", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // contributor link wallet
      await linkIdentity({
        identity,
        platformId,
        platformUserId: contributorUserId,
        platformUsername: "coder1",
        participant: contributor,
        signer
      });

      // when
      const txn = await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should claim expected amount", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // contributor link wallet
      await linkIdentity({
        identity,
        platformId,
        platformUserId: contributorUserId,
        platformUsername: "coder1",
        participant: contributor,
        signer
      });

      // when
      await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      const expectedAmount = await bountyAmountAfterFees(bounties, amount);
      expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(expectedAmount);
    });

    it("should emit claim event", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // contributor link wallet
      await linkIdentity({
        identity,
        platformId,
        platformUserId: contributorUserId,
        platformUsername: "coder1",
        participant: contributor,
        signer
      });

      // when/then
      const expectedAmount = await bountyAmountAfterFees(bounties, amount);
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId)).to.emit(bounties, "BountyClaim").withArgs(
        platformId,
        repoId,
        issueId,
        await contributor.getAddress(),
        "contributor",
        await usdc.getAddress(),
        await usdc.symbol(),
        await usdc.decimals(),
        expectedAmount,
      );
    });

    it("should claim expected amount with two resolvers", async () => {
      // given
      const contributorUserIds = ["contributor1", "contributor2"];
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bounties, amount, contributorUserIds.length);

      // maintainer claim
      await executeMaintainerClaim();

      // contributors link wallet
      for (let i = 0; i < contributorUserIds.length; i++) {
        const contributorId = contributorUserIds[i];
        const contributor = contributorSigners[i];
        await linkIdentity({
          identity,
          platformId,
          platformUserId: contributorId,
          platformUsername: contributorId,
          participant: contributor,
          signer
        });
      }

      // when/then
      for (let i = 0; i < contributorSigners.length; i++) {
        const contributor = contributorSigners[i];
        await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);
        expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(contributorAmount);
      }
    });

    it("should claim expected amount with three resolvers", async () => {
      // given
      const contributorUserIds = ["contributor1", "contributor2", "contributor3"];
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bounties, amount, contributorUserIds.length);

      // maintainer claim
      await executeMaintainerClaim();

      // contributors link wallet
      for (let i = 0; i < contributorUserIds.length; i++) {
        const contributorId = contributorUserIds[i];
        const contributor = contributorSigners[i];
        await linkIdentity({
          identity,
          platformId,
          platformUserId: contributorId,
          platformUsername: contributorId,
          participant: contributor,
          signer
        });
      }

      // when/then
      for (let i = 0; i < contributorSigners.length; i++) {
        const contributor = contributorSigners[i];
        await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);
        expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(contributorAmount);
      }
    });

    it("should claim expected amount with three resolvers that link and claim serially", async () => {
      // given
      const contributorUserIds = ["contributor1", "contributor2", "contributor3"];
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bounties, amount, contributorUserIds.length);

      // maintainer claim
      await executeMaintainerClaim();

      // contributors link wallet
      for (let i = 0; i < contributorUserIds.length; i++) {
        const contributorId = contributorUserIds[i];
        const contributor = contributorSigners[i];
        await linkIdentity({
          identity,
          platformId,
          platformUserId: contributorId,
          platformUsername: contributorId,
          participant: contributor,
          signer
        });

        await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);
        expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(contributorAmount);
      }
    });

    it("should revert when non-resolver tries to claim bounty", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributor3 } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // link identity
      linkIdentity({
        identity,
        platformId,
        platformUserId: "non-resolver",
        platformUsername: "non-resolver",
        participant: contributor3,
        signer
      });

      await expect(bounties.connect(contributor3).contributorClaim(platformId, repoId, issueId)).to.be.revertedWith("You are not a resolver");
      expect(await usdc.balanceOf(await contributor3.getAddress())).to.be.eq(0);
    });

    it("should revert when resolver tries to claim bounty again", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, signer, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // contributor link wallet
      await linkIdentity({
        identity,
        platformId,
        platformUserId: contributorUserId,
        platformUsername: "coder1",
        participant: contributor,
        signer
      });

      // when
      await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId)).to.be.revertedWith("You have already claimed bounty");
      const expectedAmount = await bountyAmountAfterFees(bounties, amount);
      expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(expectedAmount);
    });
  });

  describe("WithdrawFees", () => {
    it('should allow finance team to withdraw', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // when
      await bounties.connect(finance).withdrawFees();

      // then
      const expectedFee = await serviceFee(bounties, amount);
      expect(await usdc.balanceOf(await finance.getAddress())).to.be.eq(expectedFee);
    });

    it('should zero out fees in contract after withdraw', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // when
      await bounties.connect(finance).withdrawFees();

      // then
      expect(await bounties.fees(await usdc.getAddress())).to.be.eq(0);
    });

    it('should revert when attempted by non-finance team', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // when/then
      await expect(bounties.connect(issuer).withdrawFees()).to.be.revertedWith("You are not the finance team");
    });

    it('should emit FeeWithdraw event', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const expectedFee = await serviceFee(bounties, amount);

      // when / then
      await expect(bounties.connect(finance).withdrawFees()).to.emit(bounties, "FeeWithdraw").withArgs(
        await usdc.getAddress(),
        await usdc.symbol(),
        await usdc.decimals(),
        finance.address,
        expectedFee
      );
    });

    it('should not emit FeeWithdraw event when no fees', async () => {
      const { bounties, finance } = await claimableLinkedBountyFixture();
      await expect(bounties.connect(finance).withdrawFees()).to.not.emit(bounties, "FeeWithdraw");
    });
  });

  describe("OwnerTransferOwnership", () => {
    it('should transfer ownership', async () => {
      const { bounties, owner, finance } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerTransferOwnership(finance.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.owner()).to.be.eq(finance.address);
    });

    it('should not allow non-owner to transfer ownership', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).ownerTransferOwnership(finance.address)).to.be.revertedWith(
        "You are not the owner"
      );
    });
  });

  describe("OwnerUpdateNotary", () => {
    it('should update notary', async () => {
      const { bounties, owner, finance } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerUpdateNotary(finance.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.notary()).to.be.eq(finance.address);
    });

    it('should not allow non-owner to update notary', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).ownerUpdateNotary(finance.address)).to.be.revertedWith(
        "You are not the owner"
      );
    });
  });

  describe("OwnerUpdateFinance", () => {
    it('should update finance', async () => {
      const { bounties, owner, issuer } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerUpdateFinance(issuer.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.finance()).to.be.eq(issuer.address);
    });

    it('should not allow non-owner to update finance', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).ownerUpdateFinance(issuer.address)).to.be.revertedWith(
        "You are not the owner"
      );
    });
  });

  describe("OwnerUpdateIdentity", () => {
    it('should update identity contract', async () => {
      const { bounties, owner, issuer } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerUpdateIdentity(issuer.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.identityContract()).to.be.eq(issuer.address);
    });

    it('should not allow non-owner to update identity contract', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).ownerUpdateIdentity(issuer.address)).to.be.revertedWith(
        "You are not the owner"
      );
    });
  });

  describe("OwnerUpdateServiceFee", () => {
    it('should update service fee', async () => {
      const { bounties, owner } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerUpdateServiceFee(50);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.serviceFee()).to.be.eq(50);
    });

    it('should not allow non-owner to update service fee', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).ownerUpdateServiceFee(50)).to.be.revertedWith(
        "You are not the owner"
      );
    });

    // TODO: figure out how to check for a TypeError
    it.skip('should not allow service fee below zero', async () => {
      const { bounties, owner } = await bountiesFixture();

      // when/then
      expect(() => bounties.connect(owner).ownerUpdateServiceFee(-1)).to.throw();
    });

    it('should not allow service fee over 100', async () => {
      const { bounties, owner } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(owner).ownerUpdateServiceFee(101)).to.be.revertedWith(
        "Invalid fee"
      );
    });
  });

  describe("OwnerUpdateMaintainerFee", () => {
    it('should update maintainer fee', async () => {
      const { bounties, owner } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerUpdateMaintainerFee(50);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.maintainerFee()).to.be.eq(50);
    });

    it('should not allow non-owner to update maintainer fee', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).ownerUpdateMaintainerFee(50)).to.be.revertedWith(
        "You are not the owner"
      );
    });

    it('should not allow maintainer fee over 100', async () => {
      const { bounties, owner } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(owner).ownerUpdateMaintainerFee(101)).to.be.revertedWith(
        "Invalid fee"
      );
    });

    // TODO: figure out how to test for a TypeError INVALID_ARGUMENT
    it.skip('should not allow maintainer fee below zero', async () => {
      const { bounties, owner } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(owner).ownerUpdateMaintainerFee(-1)).to.be.revertedWith(
        "Invalid fee"
      );
    });
  });

  describe("OwnerAddSupportedToken", () => {
    it('should add a supported token', async () => {
      const { bounties, owner, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);

      // when
      const txn = await bounties.connect(owner).ownerAddSupportedToken(await usdc2.getAddress());

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should update supported token array', async () => {
      const { bounties, owner, issuer, usdc } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await bounties.connect(owner).ownerAddSupportedToken(usdc2Addr);

      // then
      expect(await bounties.supportedTokens(0)).to.be.eq(await usdc.getAddress());
      expect(await bounties.supportedTokens(1)).to.be.eq(usdc2Addr);
    });

    it('should update supported token map', async () => {
      const { bounties, owner, issuer, usdc } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await bounties.connect(owner).ownerAddSupportedToken(usdc2Addr);

      // then
      expect(await bounties.isSupportedToken(await usdc.getAddress())).to.be.true;
      expect(await bounties.isSupportedToken(usdc2Addr)).to.be.true;
    });

    it('should emit TokenSupportChange event', async () => {
      const { bounties, owner, issuer, usdc } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when/then
      await expect(bounties.connect(owner).ownerAddSupportedToken(usdc2Addr)).to.emit(bounties, "TokenSupportChange").withArgs(
        true,
        usdc2Addr,
        "USDC",
        6
      );
    });

    it('should revert when called by non-owner', async () => {
      const { bounties, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await expect(bounties.connect(issuer).ownerAddSupportedToken(usdc2Addr)).to.be.revertedWith(
        "You are not the owner"
      );
    });

    it('should revert when called with already supported token', async () => {
      const { bounties, owner, usdc } = await bountiesFixture();

      // when
      await expect(bounties.connect(owner).ownerAddSupportedToken(await usdc.getAddress())).to.be.revertedWith(
        "Token already supported"
      );
    });
  });

  describe("OwnerRemoveSupportedToken", () => {
    it('should remove a supported token', async () => {
      const { bounties, owner, usdc } = await bountiesFixture();

      // when
      const txn = await bounties.connect(owner).ownerRemoveSupportedToken(await usdc.getAddress());

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should update supported token array', async () => {
      const { bounties, owner, usdc } = await bountiesFixture();

      // when
      await bounties.connect(owner).ownerRemoveSupportedToken(await usdc.getAddress());

      // then
      expect(await bounties.supportedTokens(0)).to.be.eq(ethers.ZeroAddress);
    });

    it('should update supported token map', async () => {
      const { bounties, owner, usdc } = await bountiesFixture();

      // when
      await bounties.connect(owner).ownerRemoveSupportedToken(await usdc.getAddress());

      // then
      expect(await bounties.isSupportedToken(await usdc.getAddress())).to.be.false;
    });

    it('should emit TokenSupportChange event', async () => {
      const { bounties, owner, usdc } = await bountiesFixture();
      const usdcAddr = await usdc.getAddress();

      // when/then
      await expect(bounties.connect(owner).ownerRemoveSupportedToken(usdcAddr)).to.emit(bounties, "TokenSupportChange").withArgs(
        false,
        usdcAddr,
        "USDC",
        6
      );
    });

    it('should revert when called by non-owner', async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();

      // when
      await expect(bounties.connect(issuer).ownerRemoveSupportedToken(await usdc.getAddress())).to.be.revertedWith(
        "You are not the owner"
      );
    });

    it('should revert when called with non-supported token', async () => {
      const { bounties, owner, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);

      // when
      await expect(bounties.connect(owner).ownerRemoveSupportedToken(await usdc2.getAddress())).to.be.revertedWith(
        "Token not supported"
      );
    });
  });

  describe("SweepBounty", () => {
    async function sweepableBountyFixture() {
      const fixtures = await bountiesFixture();
      const { bounties, issuer, usdc } = fixtures;

      const platformId = "1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";
      const amount = 5;

      const serviceFee = ethers.toNumber(await bounties.serviceFee()) * amount / 100;
      const bountyAmount = amount - serviceFee;
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
      expect(await bounties.bounties(platformId, repoId, issueId, await usdc.getAddress())).to.equal(bountyAmount);
      const supportedTokens = [await usdc.getAddress()];

      return { ...fixtures, amount, serviceFee, bountyAmount, platformId, repoId, issueId, supportedTokens };
    }

    it('should sweep a bounty', async () => {
      const { bounties, finance, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when
      const txn = await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should zero out bounty', async () => {
      const { bounties, finance, usdc, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when
      await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      expect(await bounties.bounties(platformId, repoId, issueId, await usdc.getAddress())).to.equal(0);
    });

    it('should transfer bounty tokens to message sender', async () => {
      const { bounties, finance, usdc, bountyAmount, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when
      await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      expect(await usdc.balanceOf(await finance.getAddress())).to.equal(bountyAmount);
    });

    it('should emit BountySweep event', async () => {
      const { bounties, finance, usdc, bountyAmount, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when/then
      expect(bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens)).to.emit(bounties, "BountySweep").withArgs(finance.address, "1", "gitgig-io/ragnar", "123", await usdc.getAddress(), "USDC", 6, bountyAmount);
    });


    it('should revert if not called by finance', async () => {
      const { bounties, issuer, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when/then
      await expect(bounties.connect(issuer).sweepBounty(platformId, repoId, issueId, supportedTokens)).to.be.revertedWith(
        "You are not the finance team"
      );
    });

    it('should revert if no bounty to sweep', async () => {
      const { bounties, finance, usdc } = await bountiesFixture();

      await expect(bounties.connect(finance).sweepBounty("1", "gitgig-io/ragnar", "123", [await usdc.getAddress()])).to.be.revertedWith(
        "No bounty to sweep"
      );
    });
  });
});
