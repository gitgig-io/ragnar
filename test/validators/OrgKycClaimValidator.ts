import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setKnownStatusSignature } from "../helpers/signatureHelpers";
import { OrgKycClaimValidator } from "../../typechain-types";

const KYC_THRESHOLD = ethers.toBigInt(500) * ethers.toBigInt(10) ** ethers.toBigInt(18);

describe("OrgKycClaimValidator", () => {
  const platformId = "1";
  const repoId = "gitgig-io/demo";
  const [orgName] = repoId.split("/");
  const issueId = "123";
  const platformUserId = "9999";

  async function accountsFixture() {
    const [owner, custodian, notary, issuer, identityContact, tokenFactory, bountiesContract1, bountiesContract2] = await ethers.getSigners();
    return { owner, custodian, notary, issuer, identityContact, tokenFactory, bountiesContract1, bountiesContract2 };
  };

  async function deployStableToken(issuer: HardhatEthersSigner) {
    const stableToken = await ethers.deployContract("TestERC20",
      ["Stable", "STBL", 2, 1_000_000_000_000, issuer.address]);
    return stableToken;
  }

  async function orgKycClaimValidatorFixture() {
    const accounts = await accountsFixture();
    const { custodian, issuer, notary, tokenFactory } = accounts;

    const stableToken = await deployStableToken(issuer);

    const pointsToken = await ethers.deployContract("TestERC20",
      ["Points", "PTS", 2, 1_000_000_000_000, issuer.address]);

    const arbToken = await ethers.deployContract("TestERC20",
      ["Arbitrum", "ARB", 3, 1_000_000_000_000, issuer.address]);

    const bountiesRegistry = await ethers.deployContract("BountiesRegistry", [custodian.address]);

    const tokenRegistry = await ethers.deployContract("PointsTokenRegistry", [custodian.address]);
    tokenRegistry.connect(custodian).grantRole(await tokenRegistry.TRUSTED_CONTRACT_ROLE(), tokenFactory.address);
    tokenRegistry.connect(tokenFactory).add("1", "gitgig-io", await pointsToken.symbol(), await pointsToken.getAddress());

    const claimValidatorFactory = await ethers.getContractFactory("OrgKycClaimValidator");
    const claimValidator = await claimValidatorFactory.deploy(
      custodian.address,
      await bountiesRegistry.getAddress(),
      await tokenRegistry.getAddress(),
      notary.address,
    );

    claimValidator.connect(custodian).setStablecoin(await stableToken.getAddress(), true);

    return { ...accounts, claimValidator, bountiesRegistry, tokenRegistry, stableToken, pointsToken, arbToken };
  }

  async function orgKycClaimValidatorWithBountiesContractFixture() {
    const fixtures = await orgKycClaimValidatorFixture();
    const { custodian, bountiesContract1, bountiesRegistry } = fixtures;
    await bountiesRegistry.connect(custodian).addBountiesContract(bountiesContract1.address);
    return fixtures;
  }

  function toAmount(amount: number, decimals: number) {
    const amt = ethers.toBigInt(amount);
    const shift = ethers.toBigInt(18 - decimals);
    return amt * ethers.toBigInt(10) ** shift;
  }

  interface SetKnownStatusProps {
    platformId: string;
    orgName: string;
    platformUserId: string;
    expires?: number;
    isKnown: boolean;
  }

  function timestamp(date = new Date()) {
    return Math.floor(date.getTime() / 1000);
  }

  function expiresTimestamp(date = new Date()) {
    return timestamp(date) + 5 * 60;
  }

  async function createSetKnownStatusSignature(validator: OrgKycClaimValidator, notary: HardhatEthersSigner, props: SetKnownStatusProps) {
    const params = [
      props.platformId,
      props.orgName,
      props.platformUserId,
      props.isKnown,
      props.expires,
    ];

    return setKnownStatusSignature(validator, params, notary);
  }

  async function setKnownStatus(validator: OrgKycClaimValidator, notary: HardhatEthersSigner, props: SetKnownStatusProps) {
    const { platformId, orgName, platformUserId, isKnown } = props;
    const expires = props.expires || expiresTimestamp();
    props.expires = expires;
    const signature = await createSetKnownStatusSignature(validator, notary, props);
    return validator.setKnownStatus(platformId, orgName, platformUserId, isKnown, expires, signature);
  }

  describe("Deployment", () => {
    it("should be able to deploy contract", async () => {
      const { claimValidator } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(claimValidator.getAddress()).to.be.a.string;
    });
  });

  describe("Validate", () => {
    it("should reject calls from non-bounties contract", async () => {
      const { owner, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      await expect(claimValidator.connect(owner).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 49999
      )).to.be.revertedWithCustomError(claimValidator, "AccessControlUnauthorizedAccount");
    });

    it("should allow calls from registered bounties contract", async () => {
      const { bountiesContract1, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 49999
      )).to.be.true;
    });

    it("should set the orgUserStableAmountClaimed", async () => {
      const { bountiesContract1, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);

      // when
      await claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 49999
      );

      // then
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(toAmount(49999, 2));
    });

    it("should allow multiple stablecoin claims for single org under the user/org limit", async () => {
      const { bountiesContract1, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);

      // when
      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 20000
      )).to.not.be.reverted;

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, `${orgName}/other`, "234", platformUserId, await stableToken.getAddress(), 29999
      )).to.not.be.reverted;

      // then
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(toAmount(49999, 2));
    });

    it("should allow multiple stablecoin claims for multiple orgs under the user/org limit", async () => {
      const { bountiesContract1, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);

      // when
      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 499_99
      )).to.not.be.reverted;

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, "other-org/other", "234", platformUserId, await stableToken.getAddress(), 499_99
      )).to.not.be.reverted;

      // then
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(toAmount(499_99, 2));
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, "other-org", platformUserId)).to.equal(toAmount(499_99, 2));
    });

    it("should reject stablecoin claims over the user/org limit", async () => {
      const { bountiesContract1, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);

      // when

      // returns false check
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 500_00
      )).to.be.false;

      await claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await stableToken.getAddress(), 500_00
      );

      // does not change value
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
    });

    it("should allow stablecoin claims over the user/org limit when user known", async () => {
      const { bountiesContract1, claimValidator, identityContact, notary, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.true;

      // when
      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, `${orgName}/other`, "234", platformUserId, await stableToken.getAddress(), 1000_00
      )).to.not.be.reverted;

      // test return value
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, `${orgName}/other`, "234", platformUserId, await stableToken.getAddress(), 1000_00
      )).to.be.true;

      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(toAmount(1000_00, 2));
    });

    it("should allow all point token claims when user is unknown", async () => {
      const { bountiesContract1, claimValidator, identityContact, pointsToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);

      // when

      // returns false check
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await pointsToken.getAddress(), 50000000
      )).to.be.true;

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await pointsToken.getAddress(), 50000000
      )).to.not.be.reverted;

      // does not change value
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
    });

    it("should allow all point token claims when user is known", async () => {
      const { bountiesContract1, claimValidator, identityContact, notary, pointsToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.true;

      // when

      // returns false check
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await pointsToken.getAddress(), 50000000
      )).to.be.true;

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await pointsToken.getAddress(), 50000000
      )).to.not.be.reverted;

      // does not change value
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
    });

    it("should reject non-stable/point claims when user unknown", async () => {
      const { bountiesContract1, claimValidator, identityContact, arbToken } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);

      // when

      // returns false check
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await arbToken.getAddress(), 20000
      )).to.be.false;

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await arbToken.getAddress(), 20000
      )).to.not.be.reverted;

      // does not change value
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
    });

    it("should revert with malformed repoId", async () => {
      const { bountiesContract1, claimValidator, identityContact, stableToken } = await orgKycClaimValidatorWithBountiesContractFixture();

      // when/then
      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, "foo", issueId, platformUserId, await stableToken.getAddress(), 49999
      )).to.be.revertedWithCustomError(claimValidator, "OrgExtractionError")
        .withArgs("foo");
    });

    it("should allow non-stable/point claims when user known to org", async () => {
      const { bountiesContract1, claimValidator, identityContact, arbToken, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.true;

      // when

      // returns true check
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, repoId, issueId, platformUserId, await arbToken.getAddress(), 20000
      )).to.be.true

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, repoId, issueId, platformUserId, await arbToken.getAddress(), 20000
      )).to.not.be.reverted;

      // does not change value
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
    });

    it("should reject non-stable/point claims when user known to other org", async () => {
      const { bountiesContract1, claimValidator, identityContact, arbToken, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      const otherOrgName = "other-org";
      const otherOrgRepoId = `${otherOrgName}/demo`;
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, orgName, platformUserId)).to.equal(0);
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.true;
      expect(await claimValidator.isKnownToOrg(platformId, otherOrgName, platformUserId)).to.be.false;

      // when

      // returns false check
      expect(await claimValidator.connect(bountiesContract1).validate.staticCall(
        identityContact.address, platformId, otherOrgRepoId, issueId, platformUserId, await arbToken.getAddress(), 20000
      )).to.be.false;

      await expect(claimValidator.connect(bountiesContract1).validate(
        identityContact.address, platformId, otherOrgRepoId, issueId, platformUserId, await arbToken.getAddress(), 20000
      )).to.not.be.reverted;

      // does not change value
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, repoId, platformUserId)).to.equal(0);
      expect(await claimValidator.orgUserStableAmountClaimed(platformId, otherOrgRepoId, platformUserId)).to.equal(0);
    });
  });

  describe("SetKnownStatus", () => {
    it("should set status to true when sig matches", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.false;

      // when
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });

      // then
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.true;
    });

    it("should set status to false when sig matches", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.true;

      // when
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: false });

      // then
      expect(await claimValidator.isKnownToOrg(platformId, orgName, platformUserId)).to.be.false;
    });

    it("should emit event when setting to true", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();

      // when/then
      await expect(setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true }))
        .to.emit(claimValidator, "KnownUserStatusUpdate")
        .withArgs(platformId, orgName, platformUserId, true);
    });

    it("should emit event when setting to false", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });

      // when/then
      await expect(setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: false }))
        .to.emit(claimValidator, "KnownUserStatusUpdate")
        .withArgs(platformId, orgName, platformUserId, false);
    });

    it("should revert when sig does not match", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      const expires = expiresTimestamp();
      const signature = await createSetKnownStatusSignature(claimValidator, notary, { platformId, orgName: "otherorg", platformUserId, isKnown: false, expires });

      // when/then
      await expect(claimValidator.setKnownStatus(platformId, orgName, platformUserId, true, expires, signature))
        .to.be.revertedWithCustomError(claimValidator, "InvalidSignature");
    });

    it("should revert when already in false status", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      await expect(setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: false }))
        .to.be.revertedWithCustomError(claimValidator, "AlreadySet");
    });

    it("should revert when already in true status", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      await setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true });
      await expect(setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true }))
        .to.be.revertedWithCustomError(claimValidator, "AlreadySet");
    });

    it("should revert when expires too early", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      const expires = timestamp() - 6 * 60;

      // when/then
      await expect(setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true, expires }))
        .to.be.revertedWithCustomError(claimValidator, "TimeframeError");
    });

    it("should revert when expires too late", async () => {
      const { claimValidator, notary } = await orgKycClaimValidatorWithBountiesContractFixture();
      const expires = expiresTimestamp() + 5 * 60;

      // when/then
      await expect(setKnownStatus(claimValidator, notary, { platformId, orgName, platformUserId, isKnown: true, expires }))
        .to.be.revertedWithCustomError(claimValidator, "TimeframeError");
    });
  });

  describe("SetStablecoin", () => {
    it("should set stablecoin to true", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      expect(await claimValidator.connect(custodian).isStablecoin(await stableToken.getAddress())).to.be.false;

      // when
      await claimValidator.connect(custodian).setStablecoin(await stableToken.getAddress(), true);

      // then
      expect(await claimValidator.connect(custodian).isStablecoin(await stableToken.getAddress())).to.be.true;
    });

    it("should set stablecoin to false", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      expect(await claimValidator.connect(custodian).isStablecoin(await stableToken.getAddress())).to.be.false;
      await claimValidator.connect(custodian).setStablecoin(await stableToken.getAddress(), true);
      expect(await claimValidator.connect(custodian).isStablecoin(await stableToken.getAddress())).to.be.true;

      // when
      await claimValidator.connect(custodian).setStablecoin(await stableToken.getAddress(), false);

      // then
      expect(await claimValidator.connect(custodian).isStablecoin(await stableToken.getAddress())).to.be.false;
    });

    it("should emit event when setting stablecoin to true", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      const stableTokenAddress = await stableToken.getAddress();

      // when/then
      await expect(claimValidator.connect(custodian).setStablecoin(stableTokenAddress, true))
        .to.emit(claimValidator, "StablecoinRegistration")
        .withArgs(stableTokenAddress, true);
    });

    it("should emit event when setting stablecoin to false", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      const stableTokenAddress = await stableToken.getAddress();
      await claimValidator.connect(custodian).setStablecoin(await stableToken.getAddress(), true);

      // when/then
      await expect(claimValidator.connect(custodian).setStablecoin(stableTokenAddress, false))
        .to.emit(claimValidator, "StablecoinRegistration")
        .withArgs(stableTokenAddress, false);
    });

    it("should revert when already stablecoin", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      const stableTokenAddress = await stableToken.getAddress();
      await claimValidator.connect(custodian).setStablecoin(await stableToken.getAddress(), true);

      // when/then
      await expect(claimValidator.connect(custodian).setStablecoin(stableTokenAddress, true))
        .to.be.revertedWithCustomError(claimValidator, "AlreadySet");
    });

    it("should revert when not already stablecoin", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      const stableTokenAddress = await stableToken.getAddress();

      // when/then
      await expect(claimValidator.connect(custodian).setStablecoin(stableTokenAddress, false))
        .to.be.revertedWithCustomError(claimValidator, "AlreadySet");
    });

    it("should revert when called by non-custodian", async () => {
      const { claimValidator, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const stableToken = await deployStableToken(issuer);
      const stableTokenAddress = await stableToken.getAddress();

      // when/then
      await expect(claimValidator.connect(issuer).setStablecoin(stableTokenAddress, true))
        .to.be.revertedWithCustomError(claimValidator, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetBountiesRegistry", () => {
    it("should set bounties registry", async () => {
      const { claimValidator, custodian, bountiesContract1 } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.bountiesRegistry()).to.not.equal(bountiesContract1.address);

      // when
      await claimValidator.connect(custodian).setBountiesRegistry(bountiesContract1.address);

      // then
      expect(await claimValidator.bountiesRegistry()).to.equal(bountiesContract1.address);
    });

    it("should emit ConfigChange event", async () => {
      const { claimValidator, custodian, tokenRegistry, notary, bountiesContract1 } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.bountiesRegistry()).to.not.equal(bountiesContract1.address);

      // when/then
      await expect(claimValidator.connect(custodian).setBountiesRegistry(bountiesContract1.address))
        .to.emit(claimValidator, "ConfigChange")
        .withArgs(
          bountiesContract1.address,
          await tokenRegistry.getAddress(),
          notary.address,
          KYC_THRESHOLD
        );
    });

    it("should revert when called by non-custodian", async () => {
      const { claimValidator, issuer, bountiesContract1 } = await orgKycClaimValidatorWithBountiesContractFixture();

      // when/then
      await expect(claimValidator.connect(issuer).setBountiesRegistry(bountiesContract1.address))
        .to.be.revertedWithCustomError(claimValidator, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetTokenRegistry", () => {
    it("should set token registry", async () => {
      const { claimValidator, custodian, bountiesContract1 } = await orgKycClaimValidatorWithBountiesContractFixture();
      const tokenRegistry = await ethers.deployContract("PointsTokenRegistry", [custodian.address]);
      const tokenRegistryAddress = await tokenRegistry.getAddress();
      expect(await claimValidator.tokenRegistry()).to.not.equal(tokenRegistryAddress);

      // when
      await claimValidator.connect(custodian).setTokenRegistry(tokenRegistryAddress);

      // then
      expect(await claimValidator.tokenRegistry()).to.equal(tokenRegistryAddress);
    });

    it("should emit ConfigChange event", async () => {
      const { claimValidator, custodian, notary, bountiesRegistry } = await orgKycClaimValidatorWithBountiesContractFixture();
      const tokenRegistry = await ethers.deployContract("PointsTokenRegistry", [custodian.address]);
      const tokenRegistryAddress = await tokenRegistry.getAddress();

      // when/then
      await expect(claimValidator.connect(custodian).setTokenRegistry(tokenRegistryAddress))
        .to.emit(claimValidator, "ConfigChange")
        .withArgs(
          await bountiesRegistry.getAddress(),
          tokenRegistryAddress,
          notary.address,
          KYC_THRESHOLD
        );
    });

    it("should revert when called by non-custodian", async () => {
      const { claimValidator, custodian, issuer } = await orgKycClaimValidatorWithBountiesContractFixture();
      const tokenRegistry = await ethers.deployContract("PointsTokenRegistry", [custodian.address]);
      const tokenRegistryAddress = await tokenRegistry.getAddress();

      // when/then
      await expect(claimValidator.connect(issuer).setTokenRegistry(tokenRegistryAddress))
        .to.be.revertedWithCustomError(claimValidator, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetNotary", () => {
    it("should set notary", async () => {
      const { claimValidator, custodian, bountiesContract1 } = await orgKycClaimValidatorWithBountiesContractFixture();
      expect(await claimValidator.notary()).to.not.equal(bountiesContract1.address);

      // when
      await claimValidator.connect(custodian).setNotary(bountiesContract1.address);

      // then
      expect(await claimValidator.notary()).to.equal(bountiesContract1.address);
    });

    it("should emit ConfigChange event", async () => {
      const { claimValidator, custodian, bountiesContract1, bountiesRegistry, tokenRegistry } = await orgKycClaimValidatorWithBountiesContractFixture();

      // when/then
      await expect(claimValidator.connect(custodian).setNotary(bountiesContract1.address))
        .to.emit(claimValidator, "ConfigChange")
        .withArgs(
          await bountiesRegistry.getAddress(),
          await tokenRegistry.getAddress(),
          bountiesContract1.address,
          KYC_THRESHOLD
        );
    });

    it("should revert when called by non-custodian", async () => {
      const { claimValidator, issuer, bountiesContract1 } = await orgKycClaimValidatorWithBountiesContractFixture();

      // when/then
      await expect(claimValidator.connect(issuer).setNotary(bountiesContract1.address))
        .to.be.revertedWithCustomError(claimValidator, "AccessControlUnauthorizedAccount");
    });
  });
});

