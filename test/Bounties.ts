import { expect } from "chai";
import { ethers } from "hardhat";
import { maintainerClaimSignature, mintSignature } from "./helpers/signatureHelpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bounties, Identity, TestUsdc } from "../typechain-types";

describe("Bounties", () => {
  async function bountiesFixture() {
    const [_owner, oracle, signer, issuer, maintainer, contributor, contributor2, contributor3] = await ethers.getSigners();

    const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
    const usdc = await TestUsdcFactory.deploy(1_000_000, issuer.address);
    const usdcAddr = await usdc.getAddress();

    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(signer.address);

    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(oracle.address, signer.address, await identity.getAddress(), [usdcAddr]);
    return { bounties, identity, usdc, oracle, signer, issuer, maintainer, contributor, contributor2, contributor3 };
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

    it("should emit BountyClaimed event", async () => {
      const { bounties, maintainer, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const expectedAmount = await maintainerFee(bounties, amount);

      // when
      await expect(executeMaintainerClaim()).to.emit(bounties, "BountyClaimed").withArgs(
        platformId,
        repoId,
        issueId,
        await maintainer.getAddress(),
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
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId)).to.emit(bounties, "BountyClaimed").withArgs(
        platformId,
        repoId,
        issueId,
        await contributor.getAddress(),
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

  describe("SweepBounty", () => {

  });
});
