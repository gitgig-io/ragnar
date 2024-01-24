import { expect } from "chai";
import { ethers } from "hardhat";
import { maintainerClaimSignature, mintSignature } from "./helpers/signatureHelpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bounties, Identity, TestERC20 } from "../typechain-types";

const BIG_SUPPLY = ethers.toBigInt("1000000000000000000000000000");

describe("Bounties", () => {
  async function bountiesFixture() {
    const [owner, custodian, finance, notary, issuer, maintainer, contributor, contributor2, contributor3] = await ethers.getSigners();

    const TestERC20Factory = await ethers.getContractFactory("TestERC20");

    const usdc = await TestERC20Factory.deploy("USDC", "USDC", 6, 1_000_000_000_000, issuer.address);
    const usdcAddr = await usdc.getAddress();

    const arb = await TestERC20Factory.deploy("Arbitrum", "ARB", 18, BIG_SUPPLY, issuer.address);
    const arbAddr = await arb.getAddress();

    const weth = await TestERC20Factory.deploy("Wrapped ETH", "WETH", 18, BIG_SUPPLY, issuer.address);
    const wethAddr = await weth.getAddress();

    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(custodian.address, notary.address, "http://localhost:3000");

    const LibBountiesFactory = await ethers.getContractFactory("LibBounties");
    const libBounties = await LibBountiesFactory.deploy();

    const BountiesFactory = await ethers.getContractFactory("Bounties", {
      // TODO: make LibBounties swappable in the Bounties contract?
      libraries: {
        LibBounties: await libBounties.getAddress()
      }

    });

    const bounties = await BountiesFactory.deploy(
      custodian.address,
      finance.address,
      notary.address,
      await identity.getAddress(),
      [usdcAddr, arbAddr, wethAddr]
    );

    return { owner, custodian, bounties, libBounties, identity, usdc, arb, weth, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  async function claimableBountyFixture(contributorIds?: string[]) {
    const fixtures = await bountiesFixture();
    const { bounties, notary, maintainer, contributor, contributor2, contributor3 } = fixtures;

    const platformId = "1";
    const maintainerUserId = "maintainer1";
    const contributorUserId = "contributor1";
    const repoId = "gitgig-io/ragnar";
    const issueId = "123";

    const contributorUserIds = contributorIds || [contributorUserId];
    const contributorSigners = [contributor, contributor2, contributor3].slice(0, contributorUserIds.length);
    const claimParams = [maintainerUserId, platformId, repoId, issueId, contributorUserIds];
    const claimSignature = await maintainerClaimSignature(bounties, claimParams, notary);
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
    notary: HardhatEthersSigner;
    nonce?: number;
  }

  async function linkIdentity({ identity, platformId, platformUserId, platformUsername, participant, notary, nonce = 1 }: LinkIdentityProps) {
    const mintParams = [participant.address, platformId, platformUserId, platformUsername, nonce];
    const mintSig = await mintSignature(identity, mintParams, notary);
    const { mint } = identity.connect(participant);
    await mint.apply(mint, [...mintParams, mintSig] as any);
  }

  async function claimableLinkedBountyFixture(contributorIds?: string[]) {
    const fixtures = await claimableBountyFixture(contributorIds);
    const { identity, maintainer, notary, platformId, maintainerUserId } = fixtures;

    // map identity for maintainer
    await linkIdentity({ identity, platformId, platformUserId: maintainerUserId, platformUsername: "coder1", participant: maintainer, notary });

    return fixtures;
  }

  async function usdcFixture(issuer: HardhatEthersSigner) {
    const TestERC20Factory = await ethers.getContractFactory("TestERC20");
    const usdc = await TestERC20Factory.deploy("USDC", "USDC", 6, 1_000_000, issuer.address);
    return usdc;
  }

  interface PostBountyProps {
    amount: number;
    platformId: string;
    repoId: string;
    issueId: string;
    bounties: Bounties;
    issuer: HardhatEthersSigner;
    usdc: TestERC20;
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

    it("should revert when contract is paused", async () => {
      const { bounties, issuer, usdc, custodian } = await bountiesFixture();
      const amount = 5;
      await bounties.connect(custodian).pause();

      // when/then
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount))
        .to.be.revertedWithCustomError(bounties, 'EnforcedPause');
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
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", issuer.address, 5))
        .to.be.revertedWithCustomError(bounties, "TokenSupportError")
        .withArgs(issuer.address, false);
    });

    it("should not be able to post bounty on closed issue", async () => {
      // given
      const { bounties, identity, maintainer, notary, issuer, contributor, usdc } = await bountiesFixture();
      const platformId = "1";
      const maintainerUserId = "m1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";
      const claimParams = [maintainerUserId, platformId, repoId, issueId, [contributor.address]];
      const claimSignature = await maintainerClaimSignature(bounties, claimParams, notary);

      // map identity for maintainer
      const mintParams = [maintainer.address, platformId, maintainerUserId, "coder1", 1];
      const mintSig = await mintSignature(identity, mintParams, notary);
      const { mint } = identity.connect(maintainer);
      mint.apply(mint, [...mintParams, mintSig] as any);

      // when
      const { maintainerClaim } = bounties.connect(maintainer);
      await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature] as any);

      // then
      await expect(bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), 5))
        .to.be.revertedWithCustomError(bounties, "IssueClosed")
        .withArgs(platformId, repoId, issueId);
    });

    it("should emit a BountyCreate event", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      const fee = await serviceFee(bounties, amount);
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount))
        .to.emit(bounties, "BountyCreate")
        .withArgs(
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

    it("should respect custom service fees", async () => {
      const { bounties, custodian, issuer, usdc } = await bountiesFixture();
      await bounties.connect(custodian).setCustomServiceFee(issuer.address, 10);
      const amount = ethers.toBigInt(5);
      const customServiceFee = await bounties.effectiveServiceFee(issuer.address);
      const expectedFee = amount * customServiceFee / ethers.toBigInt(100);
      const serviceFee = await bounties.serviceFee();
      expect(serviceFee).to.not.be.eq(customServiceFee);

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await usdc.balanceOf(await bounties.getAddress())).to.be.eq(amount);
      expect(await bounties.fees(await usdc.getAddress())).to.be.eq(expectedFee);
    });

    it("should not respect custom service fees for other users", async () => {
      const { bounties, custodian, notary, issuer, usdc } = await bountiesFixture();
      await bounties.connect(custodian).setCustomServiceFee(notary.address, 10);
      const amount = ethers.toBigInt(5);
      const customServiceFee = await bounties.effectiveServiceFee(issuer.address);
      const expectedFee = amount * customServiceFee / ethers.toBigInt(100);
      const serviceFee = await bounties.serviceFee();
      expect(serviceFee).to.be.eq(customServiceFee);

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await usdc.balanceOf(await bounties.getAddress())).to.be.eq(amount);
      expect(await bounties.fees(await usdc.getAddress())).to.be.eq(expectedFee);
    });
  });

  describe("MaintainerClaim", () => {
    it("should allow maintainer to claim with valid signature", async () => {
      const { executeMaintainerClaim } = await claimableLinkedBountyFixture();
      const txn = await executeMaintainerClaim();
      expect(txn.hash).to.be.a.string;
    });

    it("should revert when contract is paused", async () => {
      const { executeMaintainerClaim, bounties, custodian } = await claimableLinkedBountyFixture();
      await bounties.connect(custodian).pause();

      // when/then
      await expect(executeMaintainerClaim()).to.be.revertedWithCustomError(bounties, 'EnforcedPause');
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

    it("should transfer tokens to contributors that have minted identity", async () => {
      // given
      const contributorUserIds = ["contributor1", "contributor2", "contributor3"];
      const autoClaimContributorUserIds = contributorUserIds.slice(1);
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bounties, amount, contributorUserIds.length);

      // contributors link wallet
      for (let i = 0; i < contributorUserIds.length; i++) {
        const contributorId = contributorUserIds[i];

        if (autoClaimContributorUserIds.includes(contributorId)) {
          const contributor = contributorSigners[i];
          await linkIdentity({
            identity,
            platformId,
            platformUserId: contributorId,
            platformUsername: contributorId,
            participant: contributor,
            notary
          });
        }
      }

      // maintainer claim
      await executeMaintainerClaim();

      // when/then
      for (let i = 0; i < contributorUserIds.length; i++) {
        const contributorUserId = contributorUserIds[i];
        const expectedAmount = autoClaimContributorUserIds.includes(contributorUserId) ? contributorAmount : 0;
        const contributor = contributorSigners[i];
        expect(await usdc.balanceOf(contributor.address)).to.be.eq(expectedAmount);
      }
    });


    it("should emit BountyClaim event", async () => {
      const { bounties, maintainer, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const expectedAmount = await maintainerFee(bounties, amount);

      // when
      await expect(executeMaintainerClaim())
        .to.emit(bounties, "BountyClaim")
        .withArgs(
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
      const { bounties, platformId, repoId, issueId, executeMaintainerClaim } = await claimableLinkedBountyFixture();
      await executeMaintainerClaim();
      await expect(executeMaintainerClaim())
        .to.be.revertedWithCustomError(bounties, "IssueClosed")
        .withArgs(platformId, repoId, issueId);
    });

    it("should emit issue closed event", async () => {
      const { bounties, contributorUserIds, executeMaintainerClaim, platformId, repoId, issueId, maintainer, maintainerUserId } = await claimableLinkedBountyFixture();
      await expect(executeMaintainerClaim())
        .to.emit(bounties, "IssueTransition")
        .withArgs(
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
      const { bounties, platformId, maintainerUserId, executeMaintainerClaim } = await claimableBountyFixture();
      await expect(executeMaintainerClaim())
        .to.be.revertedWithCustomError(bounties, "IdentityNotFound")
        .withArgs(platformId, maintainerUserId);
    });

    it("should revert with invalid signature", async () => {
      const { bounties, claimParams, maintainer } = await claimableLinkedBountyFixture();
      // signing with maintainer key instead of notary key
      const wrongSignature = await maintainerClaimSignature(bounties, claimParams, maintainer);
      const { maintainerClaim } = bounties.connect(maintainer);
      await expect(maintainerClaim.apply(maintainerClaim, [...claimParams, wrongSignature] as any))
        .to.be.revertedWithCustomError(bounties, "InvalidSignature");
    });
  });

  describe("ContributorClaim", () => {
    it("should allow resolver to claim bounty", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

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
        notary
      });

      // when
      const txn = await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it("should revert for resolver with same user id on different platform", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();
      const otherPlatformId = '2';
      expect(otherPlatformId).to.not.equal(platformId);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // contributor link wallet
      await linkIdentity({
        identity,
        platformId: otherPlatformId,
        platformUserId: contributorUserId,
        platformUsername: "coder1",
        participant: contributor,
        notary
      });

      // when/then
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId))
        .to.be.revertedWithCustomError(bounties, 'InvalidResolver')
        .withArgs(platformId, repoId, issueId, contributor.address);
    });

    it("should revert when paused", async () => {
      // given
      const { executeMaintainerClaim, custodian, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

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
        notary
      });

      // pause contract
      await bounties.connect(custodian).pause();

      // when
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId))
        .to.be.revertedWithCustomError(bounties, 'EnforcedPause');
    });

    it("should claim expected amount", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

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
        notary
      });

      // when
      await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      const expectedAmount = await bountyAmountAfterFees(bounties, amount);
      expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(expectedAmount);
    });

    it("should emit claim event", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

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
        notary
      });

      // when/then
      const expectedAmount = await bountyAmountAfterFees(bounties, amount);
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId))
        .to.emit(bounties, "BountyClaim")
        .withArgs(
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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

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
          notary
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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

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
          notary
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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

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
          notary
        });

        await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);
        expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(contributorAmount);
      }
    });

    it("should revert when non-resolver tries to claim bounty", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor3 } = await claimableLinkedBountyFixture();

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
        notary
      });

      await expect(bounties.connect(contributor3).contributorClaim(platformId, repoId, issueId))
        .to.be.revertedWithCustomError(bounties, 'InvalidResolver')
        .withArgs(platformId, repoId, issueId, contributor3.address);
      expect(await usdc.balanceOf(await contributor3.getAddress())).to.be.eq(0);
    });

    it("should revert when resolver tries to claim bounty again", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

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
        notary
      });

      // when
      await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId))
        .to.be.revertedWithCustomError(bounties, "AlreadyClaimed")
        .withArgs(platformId, repoId, issueId, contributor.address);

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
      await expect(bounties.connect(issuer).withdrawFees())
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should emit FeeWithdraw event', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, usdc });
      const expectedFee = await serviceFee(bounties, amount);

      // when / then
      await expect(bounties.connect(finance).withdrawFees())
        .to.emit(bounties, "FeeWithdraw")
        .withArgs(
          await usdc.getAddress(),
          await usdc.symbol(),
          await usdc.decimals(),
          finance.address,
          expectedFee
        );
    });

    it('should not emit FeeWithdraw event when no fees', async () => {
      const { bounties, finance } = await claimableLinkedBountyFixture();
      await expect(bounties.connect(finance).withdrawFees())
        .to.not.emit(bounties, "FeeWithdraw");
    });
  });

  describe("AccessControl:Custodian", () => {
    it('should allow granting custodian role', async () => {
      const { bounties, custodian, finance } = await bountiesFixture();

      // when
      await bounties.connect(custodian).grantRole(await bounties.CUSTODIAN_ROLE(), finance.address);

      // then
      expect(await bounties.hasRole(await bounties.CUSTODIAN_ROLE(), await finance.getAddress())).to.be.true;
    });

    it('should allow revoking custodian role', async () => {
      const { bounties, custodian, finance } = await bountiesFixture();
      await bounties.connect(custodian).grantRole(await bounties.CUSTODIAN_ROLE(), finance.address);
      expect(await bounties.hasRole(await bounties.CUSTODIAN_ROLE(), finance.address)).to.be.true;

      // when
      await bounties.connect(custodian).revokeRole(await bounties.CUSTODIAN_ROLE(), finance.address);

      // then
      expect(await bounties.hasRole(await bounties.CUSTODIAN_ROLE(), finance.address)).to.be.false;
    });

    it('should emit RoleGranted event', async () => {
      const { bounties, custodian, finance } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).grantRole(await bounties.CUSTODIAN_ROLE(), finance.address))
        .to.emit(bounties, "RoleGranted")
        .withArgs(
          await bounties.CUSTODIAN_ROLE(),
          await finance.getAddress(),
          await custodian.getAddress(),
        );
    });

    it('should emit RoleRevoked event', async () => {
      const { bounties, custodian, finance } = await bountiesFixture();
      await bounties.connect(custodian).grantRole(await bounties.CUSTODIAN_ROLE(), finance.address);
      expect(await bounties.hasRole(await bounties.CUSTODIAN_ROLE(), finance.address)).to.be.true;

      // when
      await expect(bounties.connect(custodian).revokeRole(await bounties.CUSTODIAN_ROLE(), finance.address))
        .to.emit(bounties, "RoleRevoked")
        .withArgs(
          await bounties.CUSTODIAN_ROLE(),
          finance.address,
          custodian.address
        );
    });

    it('should not allow non-custodian to grant custodian role', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).grantRole(await bounties.CUSTODIAN_ROLE(), finance.address))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetNotary", () => {
    it('should update notary', async () => {
      const { bounties, custodian, finance } = await bountiesFixture();

      // when
      const txn = await bounties.connect(custodian).setNotary(finance.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.notary()).to.be.eq(finance.address);
    });

    it('should revert with invalid notary address', async () => {
      const { bounties, libBounties, custodian } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(custodian).setNotary(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(libBounties, "InvalidAddress")
        .withArgs(ethers.ZeroAddress);
    });

    it('should emit ConfigChange event', async () => {
      const { bounties, identity, custodian, finance } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).setNotary(finance.address))
        .to.emit(bounties, "ConfigChange")
        .withArgs(
          await finance.getAddress(),
          await identity.getAddress(),
          await bounties.serviceFee(),
          await bounties.maintainerFee()
        );
    });

    it('should not allow non-custodian to update notary', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).setNotary(finance.address))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });
  });

  describe("AccessControl:Finance", () => {
    it('should grant finance role', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when
      const txn = await bounties.connect(finance).grantRole(await bounties.FINANCE_ROLE(), issuer.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.hasRole(await bounties.FINANCE_ROLE(), issuer.address)).to.be.true;
    });

    it('should emit RoleGranted event', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when
      await expect(bounties.connect(finance).grantRole(await bounties.FINANCE_ROLE(), issuer.address))
        .to.emit(bounties, "RoleGranted")
        .withArgs(
          await bounties.FINANCE_ROLE(),
          issuer.address,
          finance.address,
        );
    });

    it('should not allow non-finance to grant finance role', async () => {
      const { bounties, issuer } = await bountiesFixture();

      // TODO: should finance be able to grant finance role? probably
      // when/then
      await expect(bounties.connect(issuer).grantRole(await bounties.FINANCE_ROLE(), issuer.address))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetIdentity", () => {
    it('should update identity contract', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when
      const txn = await bounties.connect(custodian).setIdentity(issuer.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.identityContract()).to.be.eq(issuer.address);
    });

    it('should revert with invalid identity address', async () => {
      const { bounties, libBounties, custodian } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(custodian).setIdentity(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(libBounties, "InvalidAddress")
        .withArgs(ethers.ZeroAddress);
    });

    it('should emit ConfigChange event', async () => {
      const { bounties, custodian, notary, issuer } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).setIdentity(issuer.address))
        .to.emit(bounties, "ConfigChange")
        .withArgs(
          await notary.getAddress(),
          await issuer.getAddress(),
          await bounties.serviceFee(),
          await bounties.maintainerFee()
        );
    });

    it('should not allow non-custodian to update identity contract', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).setIdentity(issuer.address))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetServiceFee", () => {
    it('should update service fee', async () => {
      const { bounties, custodian } = await bountiesFixture();

      // when
      const txn = await bounties.connect(custodian).setServiceFee(50);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.serviceFee()).to.be.eq(50);
    });

    it('should emit ConfigChange event', async () => {
      const { bounties, identity, custodian, notary } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).setServiceFee(50))
        .to.emit(bounties, "ConfigChange")
        .withArgs(
          await notary.getAddress(),
          await identity.getAddress(),
          50,
          await bounties.maintainerFee()
        );
    });

    it('should not allow non-custodian to update service fee', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).setServiceFee(50))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    // TODO: figure out how to check for a TypeError
    it.skip('should not allow service fee below zero', async () => {
      const { bounties, custodian } = await bountiesFixture();

      // when/then
      expect(() => bounties.connect(custodian).setServiceFee(-1)).to.throw();
    });

    it('should not allow service fee over 100', async () => {
      const { bounties, libBounties, custodian } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(custodian).setServiceFee(101))
        .to.be.revertedWithCustomError(libBounties, "InvalidFee")
        .withArgs(101);
    });
  });

  describe("SetCustomServiceFee", () => {
    it('should update service fee', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when
      const txn = await bounties.connect(custodian).setCustomServiceFee(issuer.address, 3);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.effectiveServiceFee(issuer.address)).to.be.eq(3);
    });

    it('should emit CustomFeeChange event when enabled', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).setCustomServiceFee(issuer.address, 3))
        .to.emit(bounties, "CustomFeeChange")
        .withArgs(
          issuer.address,
          "service",
          3,
          true
        );
    });

    it('should emit CustomFeeChange event when disabled', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when
      await bounties.connect(custodian).setCustomServiceFee(issuer.address, 3);
      await expect(bounties.connect(custodian).setCustomServiceFee(issuer.address, 20))
        .to.emit(bounties, "CustomFeeChange")
        .withArgs(
          issuer.address,
          "service",
          20,
          false
        );
    });

    it('should not allow non-custodian to update service fee', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).setCustomServiceFee(issuer.address, 3))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    // TODO: figure out how to check for a TypeError
    it.skip('should not allow service fee below zero', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when/then
      expect(() => bounties.connect(custodian).setCustomServiceFee(issuer.address, -1)).to.throw();
    });

    it('should not allow service fee over 100', async () => {
      const { bounties, libBounties, custodian, issuer } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(custodian).setCustomServiceFee(issuer.address, 101))
        .to.be.revertedWithCustomError(libBounties, "InvalidFee")
        .withArgs(101);
    });
  });

  describe("EffectiveServiceFee", () => {
    it('should return the default service fee when no custom fee set', async () => {
      const { bounties, issuer } = await bountiesFixture();
      expect(await bounties.effectiveServiceFee(issuer.address)).to.be.eq(20);
    });

    it('should return the custom service fee when set', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      await bounties.connect(custodian).setCustomServiceFee(issuer.address, 3);
      expect(await bounties.effectiveServiceFee(issuer.address)).to.be.eq(3);
    });

    it('should return the default service fee when custom fee set for other wallet', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      await bounties.connect(custodian).setCustomServiceFee(custodian.address, 3);
      expect(await bounties.effectiveServiceFee(issuer.address)).to.be.eq(20);
    });
  });

  describe("SetMaintainerFee", () => {
    it('should update maintainer fee', async () => {
      const { bounties, custodian } = await bountiesFixture();

      // when
      const txn = await bounties.connect(custodian).setMaintainerFee(50);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await bounties.maintainerFee()).to.be.eq(50);
    });

    it('should emit ConfigChange event', async () => {
      const { bounties, identity, custodian, notary } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).setMaintainerFee(50))
        .to.emit(bounties, "ConfigChange")
        .withArgs(
          await notary.getAddress(),
          await identity.getAddress(),
          await bounties.serviceFee(),
          50
        );
    });

    it('should not allow non-custodian to update maintainer fee', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).setMaintainerFee(50))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should not allow maintainer fee over 100', async () => {
      const { bounties, libBounties, custodian } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(custodian).setMaintainerFee(101))
        .to.be.revertedWithCustomError(libBounties, "InvalidFee")
        .withArgs(101);
    });

    // TODO: figure out how to test for a TypeError INVALID_ARGUMENT
    it.skip('should not allow maintainer fee below zero', async () => {
      const { bounties, libBounties, custodian } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(custodian).setMaintainerFee(-1))
        .to.be.revertedWithCustomError(libBounties, "InvalidFee")
        .withArgs(-1);
    });
  });

  describe("AddToken", () => {
    it('should add a supported token', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);

      // when
      const txn = await bounties.connect(custodian).addToken(await usdc2.getAddress());

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should update supported token array', async () => {
      const { bounties, custodian, issuer, usdc, arb, weth } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await bounties.connect(custodian).addToken(usdc2Addr);

      // then
      expect(await bounties.supportedTokens(0)).to.be.eq(await usdc.getAddress());
      expect(await bounties.supportedTokens(1)).to.be.eq(await arb.getAddress());
      expect(await bounties.supportedTokens(2)).to.be.eq(await weth.getAddress());
      expect(await bounties.supportedTokens(3)).to.be.eq(usdc2Addr);
    });

    it('should update supported token map', async () => {
      const { bounties, custodian, issuer, usdc, arb, weth } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await bounties.connect(custodian).addToken(usdc2Addr);

      // then
      expect(await bounties.isSupportedToken(await usdc.getAddress())).to.be.true;
      expect(await bounties.isSupportedToken(await arb.getAddress())).to.be.true;
      expect(await bounties.isSupportedToken(await weth.getAddress())).to.be.true;
      expect(await bounties.isSupportedToken(usdc2Addr)).to.be.true;
    });

    it('should emit TokenSupportChange event', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when/then
      await expect(bounties.connect(custodian).addToken(usdc2Addr)).to.emit(bounties, "TokenSupportChange").withArgs(
        true,
        usdc2Addr,
        "USDC",
        6
      );
    });

    it('should revert when called by non-custodian', async () => {
      const { bounties, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await expect(bounties.connect(issuer).addToken(usdc2Addr))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should revert when called with already supported token', async () => {
      const { bounties, custodian, usdc } = await bountiesFixture();
      const usdcAddr = await usdc.getAddress();

      // when
      await expect(bounties.connect(custodian).addToken(usdcAddr))
        .to.be.revertedWithCustomError(bounties, "TokenSupportError")
        .withArgs(usdcAddr, true);
    });
  });

  describe("RemoveToken", () => {
    it('should remove a supported token', async () => {
      const { bounties, custodian, usdc } = await bountiesFixture();

      // when
      const txn = await bounties.connect(custodian).removeToken(await usdc.getAddress());

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should update supported token array', async () => {
      const { bounties, custodian, usdc } = await bountiesFixture();

      // when
      await bounties.connect(custodian).removeToken(await usdc.getAddress());

      // then
      expect(await bounties.supportedTokens(0)).to.be.eq(ethers.ZeroAddress);
    });

    it('should update supported token map', async () => {
      const { bounties, custodian, usdc } = await bountiesFixture();

      // when
      await bounties.connect(custodian).removeToken(await usdc.getAddress());

      // then
      expect(await bounties.isSupportedToken(await usdc.getAddress())).to.be.false;
    });

    it('should emit TokenSupportChange event', async () => {
      const { bounties, custodian, usdc } = await bountiesFixture();
      const usdcAddr = await usdc.getAddress();

      // when/then
      await expect(bounties.connect(custodian).removeToken(usdcAddr)).to.emit(bounties, "TokenSupportChange").withArgs(
        false,
        usdcAddr,
        "USDC",
        6
      );
    });

    it('should revert when called by non-custodian', async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();

      // when
      await expect(bounties.connect(issuer).removeToken(await usdc.getAddress()))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should revert when called with non-supported token', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await expect(bounties.connect(custodian).removeToken(usdc2Addr))
        .to.be.revertedWithCustomError(bounties, "TokenSupportError")
        .withArgs(usdc2Addr, false);
    });
  });

  describe("Pause", () => {
    it('should pause', async () => {
      const { bounties, custodian } = await bountiesFixture();

      // when
      await bounties.connect(custodian).pause();

      // then
      expect(await bounties.paused()).to.be.true;
    });

    it('should emit Paused event', async () => {
      const { bounties, custodian } = await bountiesFixture();

      // when
      await expect(bounties.connect(custodian).pause())
        .to.emit(bounties, "Paused")
        .withArgs(custodian.address);
    });


    it('should revert when called by non-custodian', async () => {
      const { bounties, finance } = await bountiesFixture();

      // when
      await expect(bounties.connect(finance).pause())
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Unpause", () => {
    it('should unpause', async () => {
      const { bounties, custodian } = await bountiesFixture();
      await bounties.connect(custodian).pause();
      expect(await bounties.paused()).to.be.true;

      await bounties.connect(custodian).unpause();

      // then
      expect(await bounties.paused()).to.be.false;
    });

    it('should emit Unpaused event', async () => {
      const { bounties, custodian } = await bountiesFixture();
      await bounties.connect(custodian).pause();
      expect(await bounties.paused()).to.be.true;

      await expect(bounties.connect(custodian).unpause())
        .to.emit(bounties, "Unpaused")
        .withArgs(custodian.address);
    });

    it('should revert when called by non-custodian', async () => {
      const { bounties, custodian, finance } = await bountiesFixture();
      await bounties.connect(custodian).pause();
      expect(await bounties.paused()).to.be.true;

      // when
      await expect(bounties.connect(finance).unpause()).to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
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
      await expect(bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens))
        .to.emit(bounties, "BountySweep")
        .withArgs(finance.address, "1", "gitgig-io/ragnar", "123", await usdc.getAddress(), "USDC", 6, bountyAmount);
    });


    it('should revert if not called by finance', async () => {
      const { bounties, issuer, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when/then
      await expect(bounties.connect(issuer).sweepBounty(platformId, repoId, issueId, supportedTokens))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should revert if no bounty to sweep', async () => {
      const { bounties, finance, usdc } = await bountiesFixture();
      const platformId = "1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";
      const usdcAddr = await usdc.getAddress();

      await expect(bounties.connect(finance).sweepBounty("1", "gitgig-io/ragnar", "123", [usdcAddr]))
        .to.be.revertedWithCustomError(bounties, "NoBounty")
        .withArgs(platformId, repoId, issueId, [usdcAddr]);
    });
  });
});
