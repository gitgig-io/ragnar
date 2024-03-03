import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { createPointsTokenSignature } from "./helpers/signatureHelpers";
import { PointsTokenRegistry, PointsTokenFactory } from "../typechain-types";

const TOTAL_SUPPLY = 20_000_000 * 100; // * 100 because of two decimals
const DECIMALS = 2;
const FEE = ethers.WeiPerEther / ethers.toBigInt(5);

describe("PointsTokenFactory", () => {
  async function bountiesFixture() {
    const [
      owner,
      custodian,
      finance,
      notary,
      issuer,
      maintainer,
      contributor,
      contributor2,
      contributor3,
    ] = await ethers.getSigners();

    const IdentityFactory = await ethers.getContractFactory("Identity");
    const identity = await IdentityFactory.deploy(
      custodian.address,
      notary.address,
      "http://localhost:3000",
    );

    const ClaimValidatorFactory = await ethers.getContractFactory("StaticClaimValidator");
    const claimValidator = await ClaimValidatorFactory.deploy(true);

    const BountiesConfigFactory = await ethers.getContractFactory("BountiesConfig");
    const bountiesConfig = await BountiesConfigFactory.deploy(
      custodian.address,
      notary.address,
      await identity.getAddress(),
      await claimValidator.getAddress(),
      []
    );

    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(
      await bountiesConfig.getAddress(),
      custodian.address,
      finance.address,
    );

    return {
      owner,
      custodian,
      bounties,
      bountiesConfig,
      identity,
      finance,
      notary,
      issuer,
      maintainer,
      contributor,
      contributor2,
      contributor3,
    };
  }

  async function createPointsTokenRegistry(custodian: HardhatEthersSigner) {
    const pointsTokenRegistryFactory = await ethers.getContractFactory(
      "PointsTokenRegistry",
    );
    const pointsTokenRegistry = await pointsTokenRegistryFactory.deploy(custodian);

    return pointsTokenRegistry;
  }

  async function createPointsTokenFactory(
    custodian: HardhatEthersSigner,
    finance: HardhatEthersSigner,
    notary: HardhatEthersSigner,
    registry: PointsTokenRegistry,
  ) {
    const pointsFactoryFactory = await ethers.getContractFactory(
      "PointsTokenFactory",
    );
    const pointsFactory = await pointsFactoryFactory.deploy(
      custodian,
      finance,
      notary,
      await registry.getAddress(),
      DECIMALS,
      TOTAL_SUPPLY,
      FEE,
    );

    return pointsFactory;
  }

  async function pFixture() {
    const {
      owner,
      custodian,
      bounties,
      bountiesConfig,
      identity,
      finance,
      notary,
      issuer,
      maintainer,
      contributor,
      contributor2,
      contributor3,
    } = await bountiesFixture();

    const registry = await createPointsTokenRegistry(custodian);

    const pointsFactory = await createPointsTokenFactory(
      custodian,
      finance,
      notary,
      registry,
    );

    await pointsFactory.connect(custodian).addBountiesConfigContract(bountiesConfig);
    await bountiesConfig
      .connect(custodian)
      .grantRole(await bountiesConfig.TRUSTED_CONTRACT_ROLE(), pointsFactory);

    registry
      .connect(custodian)
      .grantRole(
        await registry.TRUSTED_CONTRACT_ROLE(),
        pointsFactory.getAddress(),
      );

    return {
      owner,
      custodian,
      bounties,
      bountiesConfig,
      identity,
      pointsFactory,
      registry,
      finance,
      notary,
      issuer,
      maintainer,
      contributor,
      contributor2,
      contributor3,
    };
  }

  const BASE_PARAMS = ["Test Points", "pTST", "1", "GitGig"] as const;

  async function pointsTokenParamsFixture(
    pointsFactory: PointsTokenFactory,
    issuer: HardhatEthersSigner,
    notary: HardhatEthersSigner,
  ) {
    const sigParams = [...BASE_PARAMS, issuer.address];
    const signature = await createPointsTokenSignature(
      pointsFactory,
      sigParams,
      notary,
    );
    return [...BASE_PARAMS, signature];
  }

  async function applyCreatePointsToken(
    pointsFactory: PointsTokenFactory,
    issuer: HardhatEthersSigner,
    params: any[],
    fee = FEE,
  ) {
    const { createPointsToken: realCreate } = pointsFactory.connect(issuer);
    return realCreate.apply(pointsFactory, [...params, { value: fee }] as any);
  }

  async function createPointsToken(
    pointsFactory: PointsTokenFactory,
    issuer: HardhatEthersSigner,
    notary: HardhatEthersSigner,
    fee = FEE,
  ) {
    const params = await pointsTokenParamsFixture(
      pointsFactory,
      issuer,
      notary,
    );
    return applyCreatePointsToken(pointsFactory, issuer, params, fee);
  }

  describe("Deployment", () => {
    it("should be able to deploy points factory contract", async () => {
      const { pointsFactory } = await pFixture();
      expect(pointsFactory.getAddress()).to.be.a.string;
    });
  });

  describe("Create Points Token", () => {
    it("should be able to create a points token", async () => {
      const { pointsFactory, issuer, notary } = await pFixture();
      const tx = await createPointsToken(pointsFactory, issuer, notary);
      expect(tx.hash).to.be.a.string;
    });

    it("should revert when paused", async () => {
      const { pointsFactory, custodian, issuer, notary } = await pFixture();
      await pointsFactory.connect(custodian).pause();

      await expect(createPointsToken(pointsFactory, issuer, notary))
        .to.revertedWithCustomError(pointsFactory, "EnforcedPause");
    });

    it("should revert if value is less than fee", async () => {
      const { pointsFactory, issuer, notary } = await pFixture();
      const value = FEE - ethers.toBigInt(1);
      await expect(createPointsToken(pointsFactory, issuer, notary, value))
        .to.be.revertedWithCustomError(pointsFactory, "WrongFeeAmount")
        .withArgs(value);
    });

    it("should revert if value is more than fee", async () => {
      const { pointsFactory, issuer, notary } = await pFixture();
      const value = FEE + ethers.toBigInt(1);
      await expect(createPointsToken(pointsFactory, issuer, notary, value))
        .to.be.revertedWithCustomError(pointsFactory, "WrongFeeAmount")
        .withArgs(value);
    });

    it("should register token as a supported token on bounties contract", async () => {
      const { bountiesConfig, pointsFactory, issuer, notary, registry } = await pFixture();
      let tokenAddr = await registry.getContract("1", "GitGig", "pTST");
      expect(tokenAddr).to.equal(ethers.ZeroAddress);

      // when
      await createPointsToken(pointsFactory, issuer, notary);

      // then
      tokenAddr = await registry.getContract("1", "GitGig", "pTST");
      expect(tokenAddr).to.not.equal(ethers.ZeroAddress);
      expect(await bountiesConfig.isSupportedToken(tokenAddr)).to.be.true;
    });

    it("should emit PointsTokenCreate event", async () => {
      const { pointsFactory, issuer, notary } = await pFixture();
      await expect(createPointsToken(pointsFactory, issuer, notary))
        .to.emit(pointsFactory, "PointsTokenCreate")
        .withArgs(
          anyValue,
          "Test Points",
          "pTST",
          DECIMALS,
          TOTAL_SUPPLY,
          issuer.address,
          "1",
          "GitGig",
        );
    });

    it("should revert when symbol does not start with p", async () => {
      const { pointsFactory, issuer, notary } = await pFixture();
      const params = ["Test Points", "TST", "1", "GitGig"];
      const sigParams = [...params, issuer.address];
      const signature = await createPointsTokenSignature(
        pointsFactory,
        sigParams,
        notary,
      );

      await expect(
        applyCreatePointsToken(pointsFactory, issuer, [...params, signature]),
      )
        .to.be.revertedWithCustomError(pointsFactory, "InvalidSymbol");
    });

    it("should revert with invalid signature", async () => {
      const { pointsFactory, issuer } = await pFixture();
      const params = ["Test Points", "pTST", "1", "GitGig"];
      const sigParams = [...params, issuer.address];
      const wrongSignature = await createPointsTokenSignature(
        pointsFactory,
        sigParams,
        issuer,
      );

      await expect(
        applyCreatePointsToken(pointsFactory, issuer, [
          ...params,
          wrongSignature,
        ]),
      )
        .to.be.revertedWithCustomError(pointsFactory, "InvalidSignature");
    });

    it("should register token in registry", async () => {
      const { pointsFactory, issuer, notary, registry } = await pFixture();
      expect(
        await registry.getContract(
          BASE_PARAMS[2],
          BASE_PARAMS[3],
          BASE_PARAMS[1],
        ),
      )
        .to.equal(ethers.ZeroAddress);

      // when
      await createPointsToken(pointsFactory, issuer, notary);

      // then
      expect(
        await registry.getContract(
          BASE_PARAMS[2],
          BASE_PARAMS[3],
          BASE_PARAMS[1],
        ),
      )
        .to.not.equal(ethers.ZeroAddress);
    });

    it("should revert when owner already has symbol", async () => {
      const { pointsFactory, issuer, notary, registry } = await pFixture();
      await createPointsToken(pointsFactory, issuer, notary);

      await expect(createPointsToken(pointsFactory, issuer, notary))
        .to.be.revertedWithCustomError(registry, "SymbolAlreadyExists");
    });
  });

  describe("Add Bounties Contract", () => {
    it("should add contract to bountiesContracts", async () => {
      const { bounties, custodian, finance, notary } = await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(pointsFactory.bountiesConfigContracts(0)).to.be.reverted;

      // when
      await pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr);

      expect(await pointsFactory.bountiesConfigContracts(0)).to.equal(bountiesAddr);
    });

    it("should not allow contract to be added twice", async () => {
      const { bounties, custodian, finance, notary } = await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(pointsFactory.bountiesConfigContracts(0)).to.be.reverted;

      // when
      await pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr);

      // then
      await expect(
        pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr),
      )
        .to.be.revertedWithCustomError(pointsFactory, "InvalidArgument");
    });

    it("should revert when called by non-custodian", async () => {
      const { bounties, custodian, finance, issuer, notary } =
        await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      // ensure not there
      await expect(pointsFactory.bountiesConfigContracts(0)).to.be.reverted;

      // when
      await expect(
        pointsFactory.connect(issuer).addBountiesConfigContract(bountiesAddr),
      )
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );

      // still not there
      await expect(pointsFactory.bountiesConfigContracts(0)).to.be.reverted;
    });

    it("should emit ConfigChange event", async () => {
      const { bounties, custodian, finance, notary } = await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      // when/then
      await expect(
        pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr),
      )
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Remove Bounties Config Contract", () => {
    it("should remove contract from bountiesContracts", async () => {
      const { bounties, custodian, finance, notary } = await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      await pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr);
      expect(await pointsFactory.bountiesConfigContracts(0)).to.equal(bountiesAddr);

      // when
      await pointsFactory.connect(custodian).removeBountiesConfigContract(
        bountiesAddr,
      );

      await expect(pointsFactory.bountiesConfigContracts(0)).to.be.reverted;
    });

    it("should revert when contract not in bountiesContracts", async () => {
      const { bounties, custodian, finance, notary } = await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      // when
      await expect(
        pointsFactory.connect(custodian).removeBountiesConfigContract(bountiesAddr),
      )
        .to.be.revertedWithCustomError(pointsFactory, "InvalidArgument");
    });

    it("should revert when called by non-custodian", async () => {
      const { bounties, custodian, finance, issuer, notary } =
        await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      await pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr);
      expect(await pointsFactory.bountiesConfigContracts(0)).to.equal(bountiesAddr);

      // when
      await expect(
        pointsFactory.connect(issuer).removeBountiesConfigContract(bountiesAddr),
      )
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );

      // then
      expect(await pointsFactory.bountiesConfigContracts(0)).to.equal(bountiesAddr);
    });

    it("should emit ConfigChange event", async () => {
      const { bounties, custodian, finance, notary } = await bountiesFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const pointsFactory = await createPointsTokenFactory(
        custodian,
        finance,
        notary,
        registry,
      );
      const bountiesAddr = await bounties.getAddress();

      await pointsFactory.connect(custodian).addBountiesConfigContract(bountiesAddr);
      expect(await pointsFactory.bountiesConfigContracts(0)).to.equal(bountiesAddr);

      // when/then
      await expect(
        pointsFactory.connect(custodian).removeBountiesConfigContract(bountiesAddr),
      )
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Set Decimals", () => {
    it("should update decimals", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await pointsFactory.connect(custodian).setDecimals(18);
      expect(await pointsFactory.dec()).to.equal(18);
    });

    it("should revert with InvalidArgument when out of range", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await expect(pointsFactory.connect(custodian).setDecimals(19))
        .to.be.revertedWithCustomError(pointsFactory, "InvalidArgument");
      expect(await pointsFactory.dec()).to.equal(DECIMALS); // default
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer } = await pFixture();
      await expect(pointsFactory.connect(issuer).setDecimals(18))
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );
      expect(await pointsFactory.dec()).to.equal(DECIMALS);
    });

    it("should emit ConfigChange event", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await expect(pointsFactory.connect(custodian).setDecimals(18))
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Set Total Supply", () => {
    it("should update total supply", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await pointsFactory.connect(custodian).setTotalSupply(50_000);
      expect(await pointsFactory.totalSupply()).to.equal(50_000);
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer } = await pFixture();
      await expect(pointsFactory.connect(issuer).setTotalSupply(100_000))
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );
      expect(await pointsFactory.totalSupply()).to.equal(TOTAL_SUPPLY);
    });

    it("should emit ConfigChange event", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await expect(pointsFactory.connect(custodian).setTotalSupply(50_000))
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Set Fee", () => {
    it("should update fee", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await pointsFactory.connect(custodian).setFee(50_000);
      expect(await pointsFactory.fee()).to.equal(50_000);
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer } = await pFixture();
      await expect(pointsFactory.connect(issuer).setFee(100_000))
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );
      expect(await pointsFactory.fee()).to.equal(FEE);
    });

    it("should emit ConfigChange event", async () => {
      const { pointsFactory, custodian } = await pFixture();
      await expect(pointsFactory.connect(custodian).setFee(50_000))
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Set Registry", () => {
    it("should update registry", async () => {
      const { pointsFactory, custodian } = await pFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const regAddr = await registry.getAddress();

      await pointsFactory.connect(custodian).setRegistry(regAddr);
      expect(await pointsFactory.registry()).to.equal(regAddr);
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer } = await pFixture();
      await expect(pointsFactory.connect(issuer).setFee(100_000))
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );
      expect(await pointsFactory.fee()).to.equal(FEE);
    });

    it("should emit ConfigChange event", async () => {
      const { pointsFactory, custodian } = await pFixture();
      const registry = await createPointsTokenRegistry(custodian);
      const regAddr = await registry.getAddress();

      await expect(pointsFactory.connect(custodian).setRegistry(regAddr))
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Set Notary", () => {
    it("should update notary", async () => {
      const { pointsFactory, custodian, issuer } = await pFixture();

      await pointsFactory.connect(custodian).setNotary(issuer.address);
      expect(await pointsFactory.notary()).to.equal(issuer.address);
    });

    it("should revert when called by non-custodian", async () => {
      const { pointsFactory, issuer, notary } = await pFixture();
      await expect(pointsFactory.connect(issuer).setNotary(issuer.address))
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );
      expect(await pointsFactory.notary()).to.equal(notary.address);
    });

    it("should emit ConfigChange event", async () => {
      const { pointsFactory, custodian, issuer } = await pFixture();

      await expect(pointsFactory.connect(custodian).setNotary(issuer.address))
        .to.emit(pointsFactory, "ConfigChange");
    });
  });

  describe("Withdraw Fees", () => {
    it("should withdraw all fees", async () => {
      const { pointsFactory, issuer, notary, finance } = await pFixture();
      await createPointsToken(pointsFactory, issuer, notary);
      const finBal = await ethers.provider.getBalance(finance.address);
      expect(await ethers.provider.getBalance(await pointsFactory.getAddress()))
        .to.be.greaterThan(0);

      // when
      await pointsFactory.connect(finance).withdrawFees();

      // then - ensure finance wallet increased value
      expect(await ethers.provider.getBalance(await pointsFactory.getAddress()))
        .to.equal(0);
      expect(await ethers.provider.getBalance(finance.address)).to.be
        .greaterThan(finBal);
    });

    it("should emit FeeWithdraw event", async () => {
      const { pointsFactory, issuer, notary, finance } = await pFixture();
      await createPointsToken(pointsFactory, issuer, notary);

      // when/then
      await expect(pointsFactory.connect(finance).withdrawFees())
        .to.emit(pointsFactory, "FeeWithdraw")
        .withArgs(finance.address, FEE);
    });

    it("should revert when called by non-finance", async () => {
      const { custodian, pointsFactory, issuer, notary } = await pFixture();
      await createPointsToken(pointsFactory, issuer, notary);

      // when/then
      await expect(pointsFactory.connect(custodian).withdrawFees())
        .to.be.revertedWithCustomError(
          pointsFactory,
          "AccessControlUnauthorizedAccount",
        );
    });
  });

  describe("Pause", () => {
    it('should pause', async () => {
      const { pointsFactory, custodian } = await pFixture();

      // when
      await pointsFactory.connect(custodian).pause();

      // then
      expect(await pointsFactory.paused()).to.be.true;
    });

    it('should emit Paused event', async () => {
      const { pointsFactory, custodian } = await pFixture();

      // when
      await expect(pointsFactory.connect(custodian).pause())
        .to.emit(pointsFactory, "Paused")
        .withArgs(custodian.address);
    });


    it('should revert when called by non-custodian', async () => {
      const { pointsFactory, finance } = await pFixture();

      // when
      await expect(pointsFactory.connect(finance).pause())
        .to.be.revertedWithCustomError(pointsFactory, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Unpause", () => {
    it('should unpause', async () => {
      const { pointsFactory, custodian } = await pFixture();
      await pointsFactory.connect(custodian).pause();
      expect(await pointsFactory.paused()).to.be.true;

      await pointsFactory.connect(custodian).unpause();

      // then
      expect(await pointsFactory.paused()).to.be.false;
    });

    it('should emit Unpaused event', async () => {
      const { pointsFactory, custodian } = await pFixture();
      await pointsFactory.connect(custodian).pause();
      expect(await pointsFactory.paused()).to.be.true;

      await expect(pointsFactory.connect(custodian).unpause())
        .to.emit(pointsFactory, "Unpaused")
        .withArgs(custodian.address);
    });

    it('should revert when called by non-custodian', async () => {
      const { pointsFactory, custodian, finance } = await pFixture();
      await pointsFactory.connect(custodian).pause();
      expect(await pointsFactory.paused()).to.be.true;

      // when
      await expect(pointsFactory.connect(finance).unpause())
        .to.be.revertedWithCustomError(pointsFactory, "AccessControlUnauthorizedAccount");
    });
  });

});
