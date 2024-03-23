import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { Bounties, BountiesConfig, Identity, TestERC20 } from "../typechain-types";
import { maintainerClaimSignature, mintSignature } from "./helpers/signatureHelpers";

const BIG_SUPPLY = ethers.toBigInt("1000000000000000000000000000");

describe("Bounties", () => {
  async function getAddresses() {
    const [owner, custodian, finance, notary, issuer, maintainer, contributor, contributor2, contributor3] = await ethers.getSigners();
    return { owner, custodian, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  async function bountiesFixture() {
    const { owner, custodian, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 } = await getAddresses();

    const TestERC20Factory = await ethers.getContractFactory("TestERC20");

    const usdc = await TestERC20Factory.deploy("USDC", "USDC", 6, 1_000_000_000_000, issuer.address);
    const usdcAddr = await usdc.getAddress();

    const dai = await TestERC20Factory.deploy("DAI", "DAI", 18, BIG_SUPPLY, issuer.address);
    const daiAddr = await dai.getAddress();

    const weth = await TestERC20Factory.deploy("Wrapped ETH", "WETH", 18, BIG_SUPPLY, issuer.address);
    const wethAddr = await weth.getAddress();

    const stablecoinAddrs = [usdcAddr, daiAddr];

    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(custodian.address, notary.address, "http://localhost:3000");

    const bountiesRegistry = await ethers.deployContract("BountiesRegistry", [custodian.address]);
    const tokenRegistry = await ethers.deployContract("PointsTokenRegistry", [custodian.address]);

    const ClaimValidatorFactory = await ethers.getContractFactory("OrgKycClaimValidator");
    const claimValidator = await ClaimValidatorFactory.deploy(
      custodian.address,
      await bountiesRegistry.getAddress(),
      await tokenRegistry.getAddress(),
      notary.address,
    );

    for (let i = 0; i < stablecoinAddrs.length; i++) {
      const stable = stablecoinAddrs[i];
      claimValidator.connect(custodian).setStablecoin(stable, true);
    }

    const BountiesConfigFactory = await ethers.getContractFactory("BountiesConfig");
    const bountiesConfig = await BountiesConfigFactory.deploy(
      custodian.address,
      notary.address,
      await identity.getAddress(),
      await claimValidator.getAddress(),
      [usdcAddr, daiAddr, wethAddr]
    );

    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(
      await bountiesConfig.getAddress(),
      custodian.address,
      finance.address,
    );

    // add bounties contract to registry
    bountiesRegistry.connect(custodian).addBountiesContract(await bounties.getAddress());

    return { owner, custodian, bounties, bountiesConfig, bountiesRegistry, claimValidator, tokenRegistry, identity, usdc, dai, weth, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
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

  interface PostBountyProps {
    amount: number;
    platformId: string;
    repoId: string;
    issueId: string;
    bounties: Bounties;
    issuer: HardhatEthersSigner;
    token: TestERC20;
  }

  async function postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token }: PostBountyProps) {
    await token.connect(issuer).approve(await bounties.getAddress(), amount);
    await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await token.getAddress(), amount);
  }

  async function maintainerFee(bountiesConfig: BountiesConfig, amount: number) {
    const serviceFee = ethers.toNumber(await bountiesConfig.serviceFee());
    const maintainerFee = ethers.toNumber(await bountiesConfig.maintainerFee());
    const amountAfterServiceFee = amount - (serviceFee * amount / 100);
    return (maintainerFee * amountAfterServiceFee / 100);
  }

  async function serviceFee(bountiesConfig: BountiesConfig, amount: number) {
    const serviceFee = ethers.toNumber(await bountiesConfig.serviceFee());
    return (serviceFee * amount / 100);
  }

  async function bountyAmountAfterFees(bountiesConfig: BountiesConfig, postedAmount: number) {
    const serviceFee = ethers.toNumber(await bountiesConfig.serviceFee());
    const amountAfterServiceFee = postedAmount - (serviceFee * postedAmount / 100);

    const maintainerFee = ethers.toNumber(await bountiesConfig.maintainerFee());
    const amountAfterMaintainerFee = amountAfterServiceFee - (maintainerFee * amountAfterServiceFee / 100);

    return amountAfterMaintainerFee;
  }

  async function bountyAmountAfterFeesPerContributor(bountiesConfig: BountiesConfig, postedAmount: number, numContributors: number) {
    const amountAfterServiceFee = await bountyAmountAfterFees(bountiesConfig, postedAmount);
    return amountAfterServiceFee / numContributors;
  }

  async function falseValidatorFixture() {
    const ClaimValidatorFactory = await ethers.getContractFactory("StaticClaimValidator");
    return await ClaimValidatorFactory.deploy(false);
  }

  async function singleClaimValidatorFixture() {
    const ClaimValidatorFactory = await ethers.getContractFactory("SingleClaimValidator");
    return await ClaimValidatorFactory.deploy();
  }

  interface WhitelistEntry {
    platformId: string;
    platformUserId: string;
  }

  async function whitelistClaimValidatorFixture(custodian: HardhatEthersSigner, whitelist: WhitelistEntry[]) {
    const ClaimValidatorFactory = await ethers.getContractFactory("WhitelistClaimValidator");
    const claimValidator = await ClaimValidatorFactory.deploy(custodian.address);

    await Promise.all(whitelist.map(({ platformId, platformUserId }) => {
      claimValidator.connect(custodian).add(platformId, platformUserId);
    }));

    return claimValidator;
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
      const { bounties, bountiesConfig, issuer, usdc } = await bountiesFixture();
      const amount = ethers.toBigInt(5);
      const serviceFee = await bountiesConfig.serviceFee();
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
      const { bounties, bountiesConfig, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      const fee = await serviceFee(bountiesConfig, amount);
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
          fee,
          anyValue
        )
    });

    it("should respect custom service fees", async () => {
      const { bounties, bountiesConfig, custodian, issuer, usdc } = await bountiesFixture();
      await bountiesConfig.connect(custodian).setCustomServiceFee(issuer.address, 10);
      const amount = ethers.toBigInt(5);
      const customServiceFee = await bountiesConfig.effectiveServiceFee(issuer.address);
      const expectedFee = amount * customServiceFee / ethers.toBigInt(100);
      const serviceFee = await bountiesConfig.serviceFee();
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
      const { bounties, bountiesConfig, custodian, notary, issuer, usdc } = await bountiesFixture();
      await bountiesConfig.connect(custodian).setCustomServiceFee(notary.address, 10);
      const amount = ethers.toBigInt(5);
      const customServiceFee = await bountiesConfig.effectiveServiceFee(issuer.address);
      const expectedFee = amount * customServiceFee / ethers.toBigInt(100);
      const serviceFee = await bountiesConfig.serviceFee();
      expect(serviceFee).to.be.eq(customServiceFee);

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await usdc.balanceOf(await bounties.getAddress())).to.be.eq(amount);
      expect(await bounties.fees(await usdc.getAddress())).to.be.eq(expectedFee);
    });

    it("should add token to bountyTokens list", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await bounties.bountyTokens("1", "gitgig-io/ragnar", "123", 0)).to.be.eq(await usdc.getAddress());
    });

    it("should set reclaimableAt on first bounty posted on issue", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const platform = "1";
      const repo = "gitgig-io/ragnar";
      const issue = "123";
      const amount = 5;
      expect(await bounties.reclaimableAt(platform, repo, issue)).to.be.eq(0);

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platform, repo, issue, await usdc.getAddress(), amount);

      // then
      const now = Math.floor((new Date()).getTime() / 1000);
      const beforeReclaimable = now + (60 * 60 * 24 * 13);
      const afterReclaimable = now + (60 * 60 * 24 * 15);
      expect(await bounties.reclaimableAt(platform, repo, issue)).to.be.greaterThan(beforeReclaimable);
      expect(await bounties.reclaimableAt(platform, repo, issue)).to.be.lessThan(afterReclaimable);
    });

    it("should not update reclaimableAt on second bounty posted on issue", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const platform = "1";
      const repo = "gitgig-io/ragnar";
      const issue = "123";
      const amount = 5;

      // first bounty
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platform, repo, issue, await usdc.getAddress(), amount);
      const reclaimableAt = await bounties.reclaimableAt(platform, repo, issue);

      // move time forward a few days
      await time.increase(60 * 60 * 24 * 5);

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platform, repo, issue, await usdc.getAddress(), amount);

      // then
      expect(await bounties.reclaimableAt(platform, repo, issue)).to.be.equal(reclaimableAt);
    });

    it("should revert when adding 26th token", async () => {
      const { bounties, bountiesConfig, custodian, issuer } = await bountiesFixture();
      const TestERC20Factory = await ethers.getContractFactory("TestERC20");

      const platformId = "1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";

      const amount = 500;

      const createTokenAndPostBounty = async () => {
        const token = await TestERC20Factory.deploy("TKN", "Token", 0, 1_000_000_000_000, issuer.address);
        const tokenAddr = await token.getAddress();

        // add token support
        await bountiesConfig.connect(custodian).addToken(tokenAddr);

        // post bounty
        await token.connect(issuer).approve(await bounties.getAddress(), amount);
        await bounties.connect(issuer).postBounty(platformId, repoId, issueId, tokenAddr, amount);

        return token;
      };

      let tokens = [];
      for (let i = 0; i < 24; i++) {
        const token = createTokenAndPostBounty();
        tokens.push(token);
      }

      expect(createTokenAndPostBounty()).to.be.revertedWithCustomError(bounties, 'MaxTokensError');
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
      const { bounties, bountiesConfig, maintainer, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);

      // when
      await executeMaintainerClaim();

      // then
      const expectedAmount = await maintainerFee(bountiesConfig, amount);
      expect(await usdc.balanceOf(await maintainer.getAddress())).to.be.eq(expectedAmount);
    });

    it("should transfer tokens to contributors that have minted identity", async () => {
      // given
      const contributorUserIds = ["contributor1", "contributor2", "contributor3"];
      const autoClaimContributorUserIds = contributorUserIds.slice(1);
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bountiesConfig, amount, contributorUserIds.length);

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
      const { bounties, bountiesConfig, maintainer, maintainerUserId, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      const expectedAmount = await maintainerFee(bountiesConfig, amount);

      // when
      await expect(executeMaintainerClaim())
        .to.emit(bounties, "BountyClaim")
        .withArgs(
          platformId,
          repoId,
          issueId,
          maintainerUserId,
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

    it("should revert when validator returns false for maintainer", async () => {
      const { bounties, bountiesConfig, custodian, issuer, usdc, platformId, repoId, issueId, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      const claimValidator = await falseValidatorFixture();
      await bountiesConfig.connect(custodian).setClaimValidator(await claimValidator.getAddress());

      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      await expect(executeMaintainerClaim())
        .to.be.revertedWithCustomError(bounties, "ClaimValidationError");
    });

    it("should not revert when validator returns true for maintainer but false for contributors", async () => {
      const { bounties, bountiesConfig, identity, notary, custodian, issuer, usdc, maintainer, maintainerUserId, platformId, repoId, issueId, contributorUserIds, contributorSigners, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // set validator which only returns true for maintainer
      const claimValidator = await whitelistClaimValidatorFixture(custodian, [{ platformId, platformUserId: maintainerUserId }]);
      await bountiesConfig.connect(custodian).setClaimValidator(await claimValidator.getAddress());

      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      expect(contributorUserIds.length).to.greaterThan(0);
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

      // when
      await expect(executeMaintainerClaim()).to.not.be.reverted;

      // then - ensure tokens have only been transferred to the maintainer
      expect(await usdc.balanceOf(maintainer.address)).to.be.greaterThan(0);
      for (let i = 0; i < contributorUserIds.length; i++) {
        const contributor = contributorSigners[i];
        expect(await usdc.balanceOf(contributor.address)).to.be.equal(0);
      }
    });

    it("should claim for any link contributors for which validator returns true", async () => {
      const { bounties, bountiesConfig, identity, notary, custodian, issuer, usdc, maintainer, maintainerUserId, platformId, repoId, issueId, contributorUserIds, contributorSigners, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // set validator which only returns true for maintainer
      const claimValidator = await whitelistClaimValidatorFixture(custodian, [
        { platformId, platformUserId: maintainerUserId },
        { platformId, platformUserId: contributorUserIds[0] },
      ]);
      await bountiesConfig.connect(custodian).setClaimValidator(await claimValidator.getAddress());

      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      expect(contributorUserIds.length).to.greaterThan(0);
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

      // when
      await expect(executeMaintainerClaim()).to.not.be.reverted;

      // then - ensure tokens have only been transferred to the maintainer
      expect(await usdc.balanceOf(maintainer.address)).to.be.greaterThan(0);
      expect(await usdc.balanceOf(contributorSigners[0].address)).to.be.greaterThan(0);
      for (let i = 1; i < contributorUserIds.length; i++) {
        const contributor = contributorSigners[i];
        expect(await usdc.balanceOf(contributor.address)).to.be.equal(0);
      }
    });
  });

  describe("ContributorClaim", () => {
    it("should allow resolver to claim bounty", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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
      const expectedAmount = await bountyAmountAfterFees(bountiesConfig, amount);
      expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(expectedAmount);
    });

    it("should emit claim event", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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
      const expectedAmount = await bountyAmountAfterFees(bountiesConfig, amount);
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId))
        .to.emit(bounties, "BountyClaim")
        .withArgs(
          platformId,
          repoId,
          issueId,
          contributorUserId,
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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bountiesConfig, amount, contributorUserIds.length);

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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bountiesConfig, amount, contributorUserIds.length);

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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributorSigners } = await claimableLinkedBountyFixture(contributorUserIds);

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      const contributorAmount = await bountyAmountAfterFeesPerContributor(bountiesConfig, amount, contributorUserIds.length);

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
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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
      const { executeMaintainerClaim, identity, usdc, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

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

      const expectedAmount = await bountyAmountAfterFees(bountiesConfig, amount);
      expect(await usdc.balanceOf(await contributor.getAddress())).to.be.eq(expectedAmount);
    });

    it("should revert when validator returns false for all tokens", async () => {
      // given
      const { executeMaintainerClaim, identity, usdc, custodian, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      // maintainer claim
      await executeMaintainerClaim();

      // update bountiesConfig so validator always returns false
      const claimValidator = await falseValidatorFixture();
      await bountiesConfig.connect(custodian).setClaimValidator(await claimValidator.getAddress());

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
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId))
        .to.be.revertedWithCustomError(bounties, "ClaimValidationError");
    });

    it("should not revert when validator returns true for at least one token", async () => {
      // given
      const { executeMaintainerClaim, identity, dai, usdc, custodian, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: dai });

      // maintainer claim
      await executeMaintainerClaim();

      // update bountiesConfig so validator always returns false
      const claimValidator = await singleClaimValidatorFixture();
      await bountiesConfig.connect(custodian).setClaimValidator(await claimValidator.getAddress());

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
      await expect(bounties.connect(contributor).contributorClaim(platformId, repoId, issueId)).to.not.be.reverted;
      // ensure they got the USDC but not the DAI
      expect(await usdc.balanceOf(await contributor.getAddress())).to.be.greaterThan(0);
      expect(await dai.balanceOf(await contributor.getAddress())).to.equal(0);
    });

    it("should allow user to claim second token when previously rejected by validator", async () => {
      // given
      const { executeMaintainerClaim, identity, dai, usdc, custodian, issuer, notary, bounties, bountiesConfig, platformId, repoId, issueId, contributor, contributorUserId } = await claimableLinkedBountyFixture();
      const staticClaimValidatorAddr = await bountiesConfig.claimValidatorContract();

      // post bounty
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: dai });

      // maintainer claim
      await executeMaintainerClaim();

      // update bountiesConfig so validator always returns false
      const singleClaimValidator = await singleClaimValidatorFixture();
      await bountiesConfig.connect(custodian).setClaimValidator(await singleClaimValidator.getAddress());

      // contributor link wallet
      await linkIdentity({
        identity,
        platformId,
        platformUserId: contributorUserId,
        platformUsername: "coder1",
        participant: contributor,
        notary
      });

      await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // ensure they got the USDC but not the ARB
      expect(await usdc.balanceOf(await contributor.getAddress())).to.equal(360)
      expect(await dai.balanceOf(await contributor.getAddress())).to.equal(0);

      // set the validator back
      await bountiesConfig.connect(custodian).setClaimValidator(staticClaimValidatorAddr);

      // when
      await bounties.connect(contributor).contributorClaim(platformId, repoId, issueId);

      // then
      expect(await usdc.balanceOf(await contributor.getAddress())).to.equal(360);
      expect(await dai.balanceOf(await contributor.getAddress())).to.equal(360);
    });
  });

  describe("WithdrawFees", () => {
    it('should allow finance team to withdraw', async () => {
      const { bounties, bountiesConfig, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      // when
      await bounties.connect(finance).withdrawFees(await usdc.getAddress());

      // then
      const expectedFee = await serviceFee(bountiesConfig, amount);
      expect(await usdc.balanceOf(await finance.getAddress())).to.be.eq(expectedFee);
    });

    it('should zero out fees in contract after withdraw', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      // when
      await bounties.connect(finance).withdrawFees(await usdc.getAddress());

      // then
      expect(await bounties.fees(await usdc.getAddress())).to.be.eq(0);
    });

    it('should revert when attempted by non-finance team', async () => {
      const { bounties, platformId, repoId, issueId, issuer, usdc } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });

      // when/then
      await expect(bounties.connect(issuer).withdrawFees(await usdc.getAddress()))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should emit Withdraw event', async () => {
      const { bounties, bountiesConfig, platformId, repoId, issueId, issuer, usdc, finance } = await claimableLinkedBountyFixture();
      const amount = 500;
      await postBounty({ amount, platformId, repoId, issueId, bounties, issuer, token: usdc });
      const expectedFee = await serviceFee(bountiesConfig, amount);

      // when / then
      await expect(bounties.connect(finance).withdrawFees(await usdc.getAddress()))
        .to.emit(bounties, "Withdraw")
        .withArgs(
          await usdc.getAddress(),
          await usdc.symbol(),
          await usdc.decimals(),
          finance.address,
          expectedFee,
          "fee"
        );
    });

    it('should revert when no fees', async () => {
      const { bounties, finance, usdc } = await claimableLinkedBountyFixture();
      await expect(bounties.connect(finance).withdrawFees(usdc.getAddress()))
        .to.be.revertedWithCustomError(bounties, "NoAmount");
    });
  });

  describe("WithdrawUnsupportedToken", () => {
    const SUPPLY = 1_000_000;

    async function tokenFixture(recipient: string) {
      const TestERC20Factory = await ethers.getContractFactory("TestERC20");
      const token = await TestERC20Factory.deploy("Test", "TEST", 6, SUPPLY, recipient);
      return { token };
    }

    it('should allow finance team to withdraw', async () => {
      const { bounties, finance } = await bountiesFixture();
      const { token } = await tokenFixture(await bounties.getAddress());

      // when
      await bounties.connect(finance).withdrawUnsupportedToken(await token.getAddress());

      // then
      expect(await token.balanceOf(await finance.getAddress())).to.be.eq(SUPPLY);
    });

    it('should not allow withdraw of supported token', async () => {
      const { bounties, finance, usdc } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).withdrawUnsupportedToken(await usdc.getAddress()))
        .to.be.revertedWithCustomError(bounties, "TokenSupportError");
    });

    it('should revert when attempted by non-finance team', async () => {
      const { bounties, custodian } = await bountiesFixture();
      const { token } = await tokenFixture(await bounties.getAddress());

      // when/then
      await expect(bounties.connect(custodian).withdrawUnsupportedToken(await token.getAddress()))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });

    it('should emit Withdraw event', async () => {
      const { bounties, finance } = await bountiesFixture();
      const { token } = await tokenFixture(await bounties.getAddress());

      // when / then
      await expect(bounties.connect(finance).withdrawUnsupportedToken(await token.getAddress()))
        .to.emit(bounties, "Withdraw")
        .withArgs(
          await token.getAddress(),
          await token.symbol(),
          await token.decimals(),
          finance.address,
          SUPPLY,
          "unsupported"
        );
    });

    it('should revert when no fees', async () => {
      const { bounties, issuer, finance } = await bountiesFixture();
      const { token } = await tokenFixture(issuer.address);

      // when / then
      await expect(bounties.connect(finance).withdrawUnsupportedToken(await token.getAddress()))
        .to.be.revertedWithCustomError(bounties, "NoAmount");
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

      // when/then
      await expect(bounties.connect(issuer).grantRole(await bounties.FINANCE_ROLE(), issuer.address))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetConfigContract", () => {
    it('should update config contract', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when
      await bounties.connect(custodian).setConfigContract(issuer.address);

      // then
      expect(await bounties.configContract()).to.equal(issuer.address);
    });

    it('should emit ConfigChange event', async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();

      // when / then
      await expect(bounties.connect(custodian).setConfigContract(issuer.address))
        .to.emit(bounties, "ConfigChange")
        .withArgs(issuer.address);
    });

    it('should not allow non-custodian to update service fee', async () => {
      const { bounties, finance, issuer } = await bountiesFixture();

      // when/then
      await expect(bounties.connect(finance).setConfigContract(issuer.address))
        .to.be.revertedWithCustomError(bounties, "AccessControlUnauthorizedAccount");
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
      const { bounties, bountiesConfig, issuer, usdc } = fixtures;

      const platformId = "1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";
      const amount = 5;

      const serviceFee = ethers.toNumber(await bountiesConfig.serviceFee()) * amount / 100;
      const bountyAmount = amount - serviceFee;
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
      expect(await bounties.bounties(platformId, repoId, issueId, await usdc.getAddress())).to.equal(bountyAmount);
      const supportedTokens = [await usdc.getAddress()];

      return { ...fixtures, amount, serviceFee, bountyAmount, platformId, repoId, issueId, supportedTokens };
    }

    const RECLAIM_TIMEFRAME = 60 * 60 * 24 * (14 + 1);
    const SWEEP_TIMEFRAME = 60 * 60 * 24 * (14 + 90);

    async function sweepableBountyAfterReclaimFixture() {
      const fixtures = await sweepableBountyFixture();
      await time.increase(SWEEP_TIMEFRAME);
      return fixtures;
    }

    it('should sweep a bounty when required timeframe has passed', async () => {
      const { bounties, finance, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();

      // when
      const txn = await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should revert when before reclaim timeframe', async () => {
      const { bounties, finance, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();

      // when/then
      await expect(bounties
        .connect(finance)
        .sweepBounty(platformId, repoId, issueId, supportedTokens)
      ).to.be.revertedWithCustomError(bounties, "TimeframeError");
    });

    it('should revert when during reclaim timeframe', async () => {
      const { bounties, finance, platformId, repoId, issueId, supportedTokens } = await sweepableBountyFixture();
      time.increase(RECLAIM_TIMEFRAME);

      // when/then
      await expect(bounties
        .connect(finance)
        .sweepBounty(platformId, repoId, issueId, supportedTokens)
      ).to.be.revertedWithCustomError(bounties, "TimeframeError");
    });

    it('should revert when paused', async () => {
      const { bounties, custodian, finance, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();
      await bounties.connect(custodian).pause();

      // when/then
      await expect(bounties
        .connect(finance)
        .sweepBounty(platformId, repoId, issueId, supportedTokens)
      ).to.revertedWithCustomError(bounties, 'EnforcedPause');
    });

    it('should zero out bounty', async () => {
      const { bounties, finance, usdc, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();

      // when
      await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      expect(await bounties.bounties(platformId, repoId, issueId, await usdc.getAddress())).to.equal(0);
    });

    it('should transfer bounty tokens to message sender', async () => {
      const { bounties, finance, usdc, bountyAmount, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();

      // when
      await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      expect(await usdc.balanceOf(await finance.getAddress())).to.equal(bountyAmount);
    });

    it('should emit BountySweep event', async () => {
      const { bounties, finance, usdc, bountyAmount, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();

      // when/then
      await expect(bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens))
        .to.emit(bounties, "BountySweep")
        .withArgs(finance.address, "1", "gitgig-io/ragnar", "123", await usdc.getAddress(), "USDC", 6, bountyAmount);
    });


    it('should revert if not called by finance', async () => {
      const { bounties, issuer, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();

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
      await time.increase(SWEEP_TIMEFRAME);

      await expect(bounties.connect(finance).sweepBounty("1", "gitgig-io/ragnar", "123", [usdcAddr]))
        .to.be.revertedWithCustomError(bounties, "NoBounty")
        .withArgs(platformId, repoId, issueId, [usdcAddr]);
    });

    it('should remove the token from bountyTokens', async () => {
      const { bounties, finance, platformId, repoId, issueId, supportedTokens } = await sweepableBountyAfterReclaimFixture();
      expect(supportedTokens.length).to.equal(1);
      expect(await bounties.bountyTokens(platformId, repoId, issueId, 0)).to.not.equal(ethers.ZeroAddress);

      // when
      await bounties.connect(finance).sweepBounty(platformId, repoId, issueId, supportedTokens);

      // then
      await expect(bounties.bountyTokens(platformId, repoId, issueId, 0)).to.be.reverted;
    });
  });

  describe('ReclaimBounty', () => {
    async function reclaimableBountyFixture() {
      const fixtures = await bountiesFixture();
      const { bounties, bountiesConfig, issuer, usdc } = fixtures;

      const platformId = "1";
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";
      const amount = 100;

      const serviceFee = ethers.toNumber(await bountiesConfig.serviceFee()) * amount / 100;
      const bountyAmount = amount - serviceFee;
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
      expect(await bounties.bounties(platformId, repoId, issueId, await usdc.getAddress())).to.equal(bountyAmount);
      const issuedToken = await usdc.getAddress();

      return { ...fixtures, amount, serviceFee, bountyAmount, platformId, repoId, issueId, issuedToken };
    }

    const RECLAIM_TIMEFRAME = 60 * 60 * 24 * (14 + 1);

    async function reclaimableBountyAfterReclaimAvailableFixture() {
      const fixtures = await reclaimableBountyFixture();
      await time.increase(RECLAIM_TIMEFRAME);
      return fixtures;
    }

    it('should revert when reclaiming before required timeframe', async () => {
      const { bounties, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyFixture();

      // when/then
      await expect(bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken)
      ).to.revertedWithCustomError(bounties, 'TimeframeError');
    });

    it('should reclaim after required timeframe', async () => {
      const { bounties, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();

      // when
      const tx = await bounties.connect(issuer).reclaim(platformId, repoId, issueId, issuedToken);

      // then
      expect(tx.hash).to.be.a.string;
    });

    it('should reclaim well after required timeframe', async () => {
      const { bounties, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      await time.increase(RECLAIM_TIMEFRAME * 10);

      // when
      const tx = await bounties.connect(issuer).reclaim(platformId, repoId, issueId, issuedToken);

      // then
      expect(tx.hash).to.be.a.string;
    });

    it('should revert when paused', async () => {
      const { bounties, custodian, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      await bounties.connect(custodian).pause();

      // when/then
      await expect(bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken)
      ).to.revertedWithCustomError(bounties, 'EnforcedPause');
    });

    it('should revert when issue is closed', async () => {
      const { bounties, issuer, platformId, repoId, issueId, usdc, executeMaintainerClaim } = await claimableLinkedBountyFixture();

      // maintainer claim
      await executeMaintainerClaim();

      // when/then
      await expect(bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, await usdc.getAddress())
      ).to.revertedWithCustomError(bounties, 'IssueClosed');
    });

    it('should transfer bounty minus fee to issuer', async () => {
      const { bounties, issuer, bountyAmount, usdc, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      const priorBalance = await usdc.balanceOf(issuer);
      const expectedBalance = priorBalance + ethers.toBigInt(bountyAmount);

      // when
      await bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken);

      // then
      expect(await usdc.balanceOf(issuer)).to.equal(expectedBalance);
    });

    it('should only transfer bounty that issuer posted', async () => {
      const { bounties, custodian, issuer, bountyAmount, serviceFee: issuerServiceFee, usdc, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      const amount = 100_000_000;
      const bountiesAddr = await bounties.getAddress();

      // transfer from issuer to custodian
      await usdc.connect(issuer).transfer(custodian.address, amount);

      const priorBalance = await usdc.balanceOf(issuer);
      const expectedBalance = priorBalance + ethers.toBigInt(bountyAmount);

      // custodian post bounty
      await usdc.connect(custodian).approve(bountiesAddr, amount);
      await bounties.connect(custodian).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);

      // when
      await bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken);

      // then
      expect(await usdc.balanceOf(issuer)).to.equal(expectedBalance);
      expect(await usdc.balanceOf(bountiesAddr)).to.equal(amount + issuerServiceFee);
    });

    it('should allow reclaiming immediately after posting when in reclaim timeframe', async () => {
      const { bounties, custodian, issuer, usdc, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      const bountiesAddr = await bounties.getAddress();
      const amount = 100_000_000;

      // transfer from issuer to custodian
      await usdc.connect(issuer).transfer(custodian.address, amount);

      // custodian post bounty
      await usdc.connect(custodian).approve(bountiesAddr, amount);
      await bounties.connect(custodian).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);

      // when/then
      await bounties
        .connect(custodian)
        .reclaim(platformId, repoId, issueId, issuedToken);
    });

    it('should revert when no amount to reclaim', async () => {
      const { bounties, custodian, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();

      // when/then
      await expect(bounties
        .connect(custodian)
        .reclaim(platformId, repoId, issueId, issuedToken)
      ).to.be.revertedWithCustomError(bounties, 'NoBounty');
    });

    it('should revert when already reclaimed', async () => {
      const { bounties, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      await bounties.connect(issuer).reclaim(platformId, repoId, issueId, issuedToken);

      // when/then
      await expect(bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken)
      ).to.be.revertedWithCustomError(bounties, 'NoBounty');
    });

    it('should reduce the amount of the bounty by the reclaimed amount', async () => {
      const { bounties, bountiesConfig, custodian, issuer, bountyAmount: issuerBountyAmount, usdc, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      const amount = 100_000_000;
      const fee = await serviceFee(bountiesConfig, amount);
      const bountiesAddr = await bounties.getAddress();
      const custodianBountyAmount = amount - fee;

      // transfer from issuer to custodian
      await usdc.connect(issuer).transfer(custodian.address, amount);

      // custodian post bounty
      await usdc.connect(custodian).approve(bountiesAddr, amount);
      await bounties.connect(custodian).postBounty(platformId, repoId, issueId, await usdc.getAddress(), amount);
      expect(await bounties.bounties(platformId, repoId, issueId, issuedToken)).to.be.eq(custodianBountyAmount + issuerBountyAmount);

      // when
      await bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken);

      // then
      expect(await bounties.bounties(platformId, repoId, issueId, issuedToken)).to.be.eq(custodianBountyAmount);
    });

    it('should remove token from bountyTokens when that bounty token amount goes to zero', async () => {
      const { bounties, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      expect(await bounties.bountyTokens(platformId, repoId, issueId, 0)).to.match(/0x/);

      // when
      await bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken);

      // then
      await expect(bounties.bountyTokens(platformId, repoId, issueId, 0)).to.be.reverted;
    });

    it('should reset reclaimableAt when bounty has been fully reclaimed', async () => {
      const { bounties, issuer, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();
      expect(await bounties.reclaimableAt(platformId, repoId, issueId)).to.not.equal(0);

      // when
      await bounties
        .connect(issuer)
        .reclaim(platformId, repoId, issueId, issuedToken);

      // then
      expect(await bounties.reclaimableAt(platformId, repoId, issueId)).to.equal(0);
    });


    it('should emit Reclaim event', async () => {
      const { bounties, issuer, usdc, bountyAmount, platformId, repoId, issueId, issuedToken } = await reclaimableBountyAfterReclaimAvailableFixture();

      // when
      await expect(bounties.connect(issuer).reclaim(platformId, repoId, issueId, issuedToken))
        .to.emit(bounties, 'BountyReclaim')
        .withArgs(
          platformId,
          repoId,
          issueId,
          issuer.address,
          issuedToken,
          await usdc.symbol(),
          await usdc.decimals(),
          bountyAmount
        );
    });
  });

  describe('Scaling', () => {
    it('should handle a bounty with 25 tokens without autoclaim', async () => {
      const { bounties, bountiesConfig, claimValidator, custodian, identity, issuer, maintainer, notary, contributor, contributor2, contributor3 } = await bountiesFixture();
      const TestERC20Factory = await ethers.getContractFactory("TestERC20");

      const platformId = "1";
      const maintainerUserId = "maintainer1";
      const contributors = [
        { signer: contributor, userId: "contributor1" },
        { signer: contributor2, userId: "contributor2" },
        { signer: contributor3, userId: "contributor3" }
      ]
      const contributorUserIds = contributors.map(c => c.userId);
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";

      const amount = 500;

      let tokens = [];
      for (let i = 0; i < 25; i++) {
        const token = await TestERC20Factory.deploy("TKN", "Token", 2, 1_000_000_000_000, issuer.address);
        const tokenAddr = await token.getAddress();

        // add token support
        await bountiesConfig.connect(custodian).addToken(tokenAddr);

        // set token as a stable
        await claimValidator.connect(custodian).setStablecoin(tokenAddr, true);

        // post bounty
        await token.connect(issuer).approve(await bounties.getAddress(), amount);
        await bounties.connect(issuer).postBounty(platformId, repoId, issueId, tokenAddr, amount);
        tokens.push(token);
      }

      // maintainer link
      await linkIdentity({ identity, platformId, platformUserId: maintainerUserId, platformUsername: "coder1", participant: maintainer, notary });

      // maintainer claim
      const claimParams = [maintainerUserId, platformId, repoId, issueId, contributorUserIds];
      const claimSignature = await maintainerClaimSignature(bounties, claimParams, notary);
      const { maintainerClaim } = bounties.connect(maintainer);
      const executeMaintainerClaim = async () => await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature] as any);
      await executeMaintainerClaim();

      for (let i = 0; i < contributors.length; i++) {
        const contributor = contributors[i];
        await linkIdentity({ identity, platformId, platformUserId: contributor.userId, platformUsername: contributor.userId, participant: contributor.signer, notary });
        await bounties.connect(contributor.signer).contributorClaim(platformId, repoId, issueId);
      }

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        expect(await token.balanceOf(maintainer.address)).to.be.greaterThan(0);

        for (let j = 0; j < contributors.length; j++) {
          const contributor = contributors[j];
          expect(await token.balanceOf(contributor.signer.address)).to.be.greaterThan(0);
        }
      }
    });

    it('should handle a bounty with 25 tokens with autoclaim', async () => {
      const { bounties, bountiesConfig, claimValidator, custodian, identity, issuer, maintainer, notary, contributor, contributor2, contributor3 } = await bountiesFixture();
      const TestERC20Factory = await ethers.getContractFactory("TestERC20");

      const platformId = "1";
      const maintainerUserId = "maintainer1";
      const contributors = [
        { signer: contributor, userId: "contributor1" },
        { signer: contributor2, userId: "contributor2" },
        { signer: contributor3, userId: "contributor3" }
      ]
      const contributorUserIds = contributors.map(c => c.userId);
      const repoId = "gitgig-io/ragnar";
      const issueId = "123";

      const amount = 500;

      let tokens = [];
      for (let i = 0; i < 25; i++) {
        const token = await TestERC20Factory.deploy("TKN", "Token", 2, 1_000_000_000_000, issuer.address);
        const tokenAddr = await token.getAddress();

        // add token support
        await bountiesConfig.connect(custodian).addToken(tokenAddr);

        // set token as a stable
        await claimValidator.connect(custodian).setStablecoin(tokenAddr, true);

        // post bounty
        await token.connect(issuer).approve(await bounties.getAddress(), amount);
        await bounties.connect(issuer).postBounty(platformId, repoId, issueId, tokenAddr, amount);
        tokens.push(token);
      }

      // maintainer link
      await linkIdentity({ identity, platformId, platformUserId: maintainerUserId, platformUsername: "coder1", participant: maintainer, notary });

      // contributor link
      for (let i = 0; i < contributors.length; i++) {
        const contributor = contributors[i];
        await linkIdentity({ identity, platformId, platformUserId: contributor.userId, platformUsername: contributor.userId, participant: contributor.signer, notary });
      }

      // maintainer claim
      const claimParams = [maintainerUserId, platformId, repoId, issueId, contributorUserIds];
      const claimSignature = await maintainerClaimSignature(bounties, claimParams, notary);
      const { maintainerClaim } = bounties.connect(maintainer);
      const executeMaintainerClaim = async () => await maintainerClaim.apply(maintainerClaim, [...claimParams, claimSignature] as any);
      await executeMaintainerClaim();

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        expect(await token.balanceOf(maintainer.address)).to.be.greaterThan(0);

        for (let j = 0; j < contributors.length; j++) {
          const contributor = contributors[j];
          expect(await token.balanceOf(contributor.signer.address)).to.be.greaterThan(0);
        }
      }
    });
  });
});
