import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const TOTAL_SUPPLY = 1_000_000;
const DECIMALS = 0;

describe("ContributionPointsFactory", () => {
  async function bountiesFixture() {
    const [owner, custodian, finance, notary, issuer, maintainer, contributor, contributor2, contributor3] = await ethers.getSigners();

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
      []
    );

    return { owner, custodian, bounties, libBounties, identity, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  async function createCpToken(custodian: HardhatEthersSigner) {
    const contributionPointsFactoryFactory = await ethers.getContractFactory("ContributionPointsFactory");
    const contributionPointsFactory = await contributionPointsFactoryFactory.deploy(custodian, DECIMALS, TOTAL_SUPPLY);

    return contributionPointsFactory;
  }

  async function cpFixture() {
    const { owner, custodian, bounties, libBounties, identity, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 } = await bountiesFixture();

    const contributionPointsFactory = await createCpToken(custodian);

    await contributionPointsFactory.connect(custodian).addBountiesContract(bounties);
    await bounties
      .connect(custodian)
      .grantRole(await bounties.TRUSTED_CONTRACT_ROLE(), contributionPointsFactory);

    return { owner, custodian, bounties, libBounties, identity, contributionPointsFactory, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  describe("Deployment", () => {
    it("should be able to deploy contribution points factory contract", async () => {
      const { contributionPointsFactory } = await cpFixture();
      expect(contributionPointsFactory.getAddress()).to.be.a.string;
    });
  });

  describe("Create Contribution Points Token", () => {
    it("should be able to create a contribution points account", async () => {
      const { contributionPointsFactory } = await cpFixture();
      const address = await contributionPointsFactory.createContributionPointsToken("Test Points", "cpTST");
      expect(address).to.be.a.string;
    });

    it("should register token as a supported token on bounties contract", async () => {
      const { bounties, contributionPointsFactory } = await cpFixture();
      await expect(bounties.supportedTokens(0)).to.be.reverted;
      await contributionPointsFactory.createContributionPointsToken("Test Points", "cpTST");
      expect(await bounties.supportedTokens(0)).to.not.equal(ethers.ZeroAddress);
    });

    it("should emit PointsTokenCreated event", async () => {
      const { contributionPointsFactory, issuer } = await cpFixture();
      await expect(contributionPointsFactory.connect(issuer).createContributionPointsToken("Test Points", "cpTST"))
        .to.emit(contributionPointsFactory, "PointsTokenCreated")
        .withArgs(
          anyValue,
          "Test Points",
          "cpTST",
          DECIMALS,
          TOTAL_SUPPLY,
          issuer.address
        )
    });

    it("should revert when symbol does not start with cp", async () => {
      const { contributionPointsFactory, issuer } = await cpFixture();
      await expect(
        contributionPointsFactory
          .connect(issuer)
          .createContributionPointsToken("Test Points", "TST")
      ).to.be.revertedWithCustomError(contributionPointsFactory, "InvalidSymbol");
    });
  });

  describe("Add Bounties Contract", () => {
    it("should add contract to bountiesContracts", async () => {
      const { bounties, custodian } = await bountiesFixture();
      const contributionPointsFactory = await createCpToken(custodian);
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(contributionPointsFactory.bountiesContracts(0)).to.be.reverted;

      // when
      await contributionPointsFactory.connect(custodian).addBountiesContract(bountiesAddr);

      expect(await contributionPointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);
    });

    it("should not allow contract to be added twice", async () => {
      const { bounties, custodian } = await bountiesFixture();
      const contributionPointsFactory = await createCpToken(custodian);
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(contributionPointsFactory.bountiesContracts(0)).to.be.reverted;

      // when
      await contributionPointsFactory.connect(custodian).addBountiesContract(bountiesAddr);

      // then
      await expect(contributionPointsFactory.connect(custodian).addBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(contributionPointsFactory, "InvalidArgument");
    });

    it("should revert when called by non-custodian", async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      const contributionPointsFactory = await createCpToken(custodian);
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(contributionPointsFactory.bountiesContracts(0)).to.be.reverted;

      // when
      await expect(contributionPointsFactory.connect(issuer).addBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(contributionPointsFactory, "AccessControlUnauthorizedAccount");

      // still not there
      await expect(contributionPointsFactory.bountiesContracts(0)).to.be.reverted;
    });
  });

  describe("Remove Bounties Contract", () => {
    it("should remove contract from bountiesContracts", async () => {
      const { bounties, custodian } = await bountiesFixture();
      const contributionPointsFactory = await createCpToken(custodian);
      const bountiesAddr = await bounties.getAddress();

      await contributionPointsFactory.connect(custodian).addBountiesContract(bountiesAddr);
      expect(await contributionPointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);

      // when
      await contributionPointsFactory.connect(custodian).removeBountiesContract(bountiesAddr);

      await expect(contributionPointsFactory.bountiesContracts(0)).to.be.reverted;
    });

    it("should revert when contract not in bountiesContracts", async () => {
      const { bounties, custodian } = await bountiesFixture();
      const contributionPointsFactory = await createCpToken(custodian);
      const bountiesAddr = await bounties.getAddress();

      // when
      await expect(contributionPointsFactory.connect(custodian).removeBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(contributionPointsFactory, "InvalidArgument");
    });


    it("should revert when called by non-custodian", async () => {
      const { bounties, custodian, issuer } = await bountiesFixture();
      const contributionPointsFactory = await createCpToken(custodian);
      const bountiesAddr = await bounties.getAddress();

      await contributionPointsFactory.connect(custodian).addBountiesContract(bountiesAddr);
      expect(await contributionPointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);

      // when
      await expect(contributionPointsFactory.connect(issuer).removeBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(contributionPointsFactory, "AccessControlUnauthorizedAccount");

      // then
      expect(await contributionPointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);
    });
  });

  describe("Set Decimals", () => {
    it("should update decimals", async () => {
      const { contributionPointsFactory, custodian } = await cpFixture();
      await contributionPointsFactory.connect(custodian).setDecimals(18);
      expect(await contributionPointsFactory.dec()).to.equal(18);
    });

    it("should revert with InvalidArgument when out of range", async () => {
      const { contributionPointsFactory, custodian } = await cpFixture();
      await expect(contributionPointsFactory.connect(custodian).setDecimals(19))
        .to.be.revertedWithCustomError(contributionPointsFactory, "InvalidArgument");
      expect(await contributionPointsFactory.dec()).to.equal(DECIMALS); // default
    });

    it("should revert when called by non-custodian", async () => {
      const { contributionPointsFactory, issuer } = await cpFixture();
      await expect(contributionPointsFactory.connect(issuer).setDecimals(18))
        .to.be.revertedWithCustomError(contributionPointsFactory, "AccessControlUnauthorizedAccount");
      expect(await contributionPointsFactory.dec()).to.equal(DECIMALS);
    });
  });

  describe("Set Total Supply", () => {
    it("should update total supply", async () => {
      const { contributionPointsFactory, custodian } = await cpFixture();
      await contributionPointsFactory.connect(custodian).setTotalSupply(50_000)
      expect(await contributionPointsFactory.totalSupply()).to.equal(50_000);
    });

    it("should revert when called by non-custodian", async () => {
      const { contributionPointsFactory, issuer } = await cpFixture();
      await expect(contributionPointsFactory.connect(issuer).setTotalSupply(100_000))
        .to.be.revertedWithCustomError(contributionPointsFactory, "AccessControlUnauthorizedAccount");
      expect(await contributionPointsFactory.totalSupply()).to.equal(TOTAL_SUPPLY);
    });
  });
});

