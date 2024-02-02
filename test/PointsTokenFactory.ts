import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { createPointsTokenSignature } from "./helpers/signatureHelpers";
import { PointsTokenFactory } from "../typechain-types";

const TOTAL_SUPPLY = 20_000_000;
const DECIMALS = 2;
// TODO: is this 0.2 eth?
const FEE = ethers.WeiPerEther / ethers.toBigInt(5);

describe("PointsTokenFactory", () => {
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

  async function createCpFactory(custodian: HardhatEthersSigner, notary: HardhatEthersSigner) {
    const pointsFactoryFactory = await ethers.getContractFactory("PointsTokenFactory");
    const pointsFactory = await pointsFactoryFactory.deploy(custodian, notary, DECIMALS, TOTAL_SUPPLY, FEE);

    return pointsFactory;
  }

  async function cpFixture() {
    const { owner, custodian, bounties, libBounties, identity, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 } = await bountiesFixture();

    const pointsFactory = await createCpFactory(custodian, notary);

    await pointsFactory.connect(custodian).addBountiesContract(bounties);
    await bounties
      .connect(custodian)
      .grantRole(await bounties.TRUSTED_CONTRACT_ROLE(), pointsFactory);

    return { owner, custodian, bounties, libBounties, identity, pointsFactory, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  describe("Deployment", () => {
    it("should be able to deploy contribution points factory contract", async () => {
      const { pointsFactory } = await cpFixture();
      expect(pointsFactory.getAddress()).to.be.a.string;
    });
  });

  describe("Create Points Token", () => {
    async function pointsTokenParamsFixture(pointsFactory: PointsTokenFactory, issuer: HardhatEthersSigner, notary: HardhatEthersSigner) {
      const baseParams = ["Test Points", "cpTST", "1", "GitGig"];
      const sigParams = [...baseParams, issuer.address];
      const signature = await createPointsTokenSignature(pointsFactory, sigParams, notary);
      return [...baseParams, signature];
    }

    async function applyCreatePointsToken(pointsFactory: PointsTokenFactory, issuer: HardhatEthersSigner, params: any[], fee = FEE) {
      const { createPointsToken: realCreate } = pointsFactory.connect(issuer);
      return realCreate.apply(pointsFactory, [...params, { value: fee }] as any);
    }

    async function createPointsToken(pointsFactory: PointsTokenFactory, issuer: HardhatEthersSigner, notary: HardhatEthersSigner, fee = FEE) {
      const params = await pointsTokenParamsFixture(pointsFactory, issuer, notary);
      return applyCreatePointsToken(pointsFactory, issuer, params, fee);
    }

    it("should be able to create a points token", async () => {
      const { pointsFactory, issuer, notary } = await cpFixture();
      const tx = await createPointsToken(pointsFactory, issuer, notary);
      expect(tx.hash).to.be.a.string;
    });

    it("should revert if value is less than fee", async () => {
      const { pointsFactory, issuer, notary } = await cpFixture();
      const value = FEE - ethers.toBigInt(1);
      await expect(createPointsToken(pointsFactory, issuer, notary, value))
        .to.be.revertedWithCustomError(pointsFactory, "WrongFeeAmount")
        .withArgs(value);
    });

    it("should revert if value is more than fee", async () => {
      const { pointsFactory, issuer, notary } = await cpFixture();
      const value = FEE + ethers.toBigInt(1);
      await expect(createPointsToken(pointsFactory, issuer, notary, value))
        .to.be.revertedWithCustomError(pointsFactory, "WrongFeeAmount")
        .withArgs(value);
    });


    it("should register token as a supported token on bounties contract", async () => {
      const { bounties, pointsFactory, issuer, notary } = await cpFixture();
      await expect(bounties.supportedTokens(0)).to.be.reverted;

      await createPointsToken(pointsFactory, issuer, notary);
      expect(await bounties.supportedTokens(0)).to.not.equal(ethers.ZeroAddress);
    });

    it("should emit PointsTokenCreated event", async () => {
      const { pointsFactory, issuer, notary } = await cpFixture();
      await expect(createPointsToken(pointsFactory, issuer, notary))
        .to.emit(pointsFactory, "PointsTokenCreated")
        .withArgs(
          anyValue,
          "Test Points",
          "cpTST",
          DECIMALS,
          TOTAL_SUPPLY,
          issuer.address,
          "1",
          "GitGig"
        );
    });

    it("should revert when symbol does not start with cp", async () => {
      const { pointsFactory, issuer, notary } = await cpFixture();
      const params = ["Test Points", "TST", "1", "GitGig"];
      const sigParams = [...params, issuer.address];
      const signature = await createPointsTokenSignature(pointsFactory, sigParams, notary);

      await expect(applyCreatePointsToken(pointsFactory, issuer, [...params, signature]))
        .to.be.revertedWithCustomError(pointsFactory, "InvalidSymbol");
    });

    it("should revert with invalid signature", async () => {
      const { pointsFactory, issuer } = await cpFixture();
      const params = ["Test Points", "cpTST", "1", "GitGig"];
      const sigParams = [...params, issuer.address];
      const wrongSignature = await createPointsTokenSignature(pointsFactory, sigParams, issuer);

      await expect(applyCreatePointsToken(pointsFactory, issuer, [...params, wrongSignature]))
        .to.be.revertedWithCustomError(pointsFactory, "InvalidSignature");
    });
  });

  describe("Add Bounties Contract", () => {
    it("should add contract to bountiesContracts", async () => {
      const { bounties, custodian, notary } = await bountiesFixture();
      const pointsFactory = await createCpFactory(custodian, notary);
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(pointsFactory.bountiesContracts(0)).to.be.reverted;

      // when
      await pointsFactory.connect(custodian).addBountiesContract(bountiesAddr);

      expect(await pointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);
    });

    it("should not allow contract to be added twice", async () => {
      const { bounties, custodian, notary } = await bountiesFixture();
      const pointsFactory = await createCpFactory(custodian, notary);
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(pointsFactory.bountiesContracts(0)).to.be.reverted;

      // when
      await pointsFactory.connect(custodian).addBountiesContract(bountiesAddr);

      // then
      await expect(pointsFactory.connect(custodian).addBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(pointsFactory, "InvalidArgument");
    });

    it("should revert when called by non-custodian", async () => {
      const { bounties, custodian, issuer, notary } = await bountiesFixture();
      const pointsFactory = await createCpFactory(custodian, notary);
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(pointsFactory.bountiesContracts(0)).to.be.reverted;

      // when
      await expect(pointsFactory.connect(issuer).addBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(pointsFactory, "AccessControlUnauthorizedAccount");

      // still not there
      await expect(pointsFactory.bountiesContracts(0)).to.be.reverted;
    });
  });

  describe("Remove Bounties Contract", () => {
    it("should remove contract from bountiesContracts", async () => {
      const { bounties, custodian, notary } = await bountiesFixture();
      const pointsFactory = await createCpFactory(custodian, notary);
      const bountiesAddr = await bounties.getAddress();

      await pointsFactory.connect(custodian).addBountiesContract(bountiesAddr);
      expect(await pointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);

      // when
      await pointsFactory.connect(custodian).removeBountiesContract(bountiesAddr);

      await expect(pointsFactory.bountiesContracts(0)).to.be.reverted;
    });

    it("should revert when contract not in bountiesContracts", async () => {
      const { bounties, custodian, notary } = await bountiesFixture();
      const pointsFactory = await createCpFactory(custodian, notary);
      const bountiesAddr = await bounties.getAddress();

      // when
      await expect(pointsFactory.connect(custodian).removeBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(pointsFactory, "InvalidArgument");
    });


    it("should revert when called by non-custodian", async () => {
      const { bounties, custodian, issuer, notary } = await bountiesFixture();
      const pointsFactory = await createCpFactory(custodian, notary);
      const bountiesAddr = await bounties.getAddress();

      await pointsFactory.connect(custodian).addBountiesContract(bountiesAddr);
      expect(await pointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);

      // when
      await expect(pointsFactory.connect(issuer).removeBountiesContract(bountiesAddr))
        .to.be.revertedWithCustomError(pointsFactory, "AccessControlUnauthorizedAccount");

      // then
      expect(await pointsFactory.bountiesContracts(0)).to.equal(bountiesAddr);
    });
  });

  describe("Set Decimals", () => {
    it("should update decimals", async () => {
      const { pointsFactory, custodian } = await cpFixture();
      await pointsFactory.connect(custodian).setDecimals(18);
      expect(await pointsFactory.dec()).to.equal(18);
    });

    it("should revert with InvalidArgument when out of range", async () => {
      const { pointsFactory, custodian } = await cpFixture();
      await expect(pointsFactory.connect(custodian).setDecimals(19))
        .to.be.revertedWithCustomError(pointsFactory, "InvalidArgument");
      expect(await pointsFactory.dec()).to.equal(DECIMALS); // default
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer } = await cpFixture();
      await expect(pointsFactory.connect(issuer).setDecimals(18))
        .to.be.revertedWithCustomError(pointsFactory, "AccessControlUnauthorizedAccount");
      expect(await pointsFactory.dec()).to.equal(DECIMALS);
    });
  });

  describe("Set Total Supply", () => {
    it("should update total supply", async () => {
      const { pointsFactory, custodian } = await cpFixture();
      await pointsFactory.connect(custodian).setTotalSupply(50_000)
      expect(await pointsFactory.totalSupply()).to.equal(50_000);
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer } = await cpFixture();
      await expect(pointsFactory.connect(issuer).setTotalSupply(100_000))
        .to.be.revertedWithCustomError(pointsFactory, "AccessControlUnauthorizedAccount");
      expect(await pointsFactory.totalSupply()).to.equal(TOTAL_SUPPLY);
    });
  });
});

