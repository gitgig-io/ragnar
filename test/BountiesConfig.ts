import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const BIG_SUPPLY = ethers.toBigInt("1000000000000000000000000000");

describe("BountiesConfig", () => {
  async function bountiesConfigFixture() {
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

    const BountiesConfigFactory = await ethers.getContractFactory("BountiesConfig");
    const config = await BountiesConfigFactory.deploy(
      custodian.address,
      notary.address,
      await identity.getAddress(),
      [usdcAddr, arbAddr, wethAddr]
    );

    return { owner, custodian, config, identity, usdc, arb, weth, finance, notary, issuer, maintainer, contributor, contributor2, contributor3 };
  }

  async function usdcFixture(issuer: HardhatEthersSigner) {
    const TestERC20Factory = await ethers.getContractFactory("TestERC20");
    const usdc = await TestERC20Factory.deploy("USDC", "USDC", 6, 1_000_000, issuer.address);
    return usdc;
  }

  describe("Deployment", () => {
    it("should be able to deploy bounty config contract", async () => {
      const { config } = await bountiesConfigFixture();
      expect(config.getAddress()).to.be.a.string;
    });
  });

  describe("AccessControl:Custodian", () => {
    it('should allow granting custodian role', async () => {
      const { config, custodian, finance } = await bountiesConfigFixture();

      // when
      await config.connect(custodian).grantRole(await config.CUSTODIAN_ROLE(), finance.address);

      // then
      expect(await config.hasRole(await config.CUSTODIAN_ROLE(), await finance.getAddress())).to.be.true;
    });

    it('should allow revoking custodian role', async () => {
      const { config, custodian, finance } = await bountiesConfigFixture();
      await config.connect(custodian).grantRole(await config.CUSTODIAN_ROLE(), finance.address);
      expect(await config.hasRole(await config.CUSTODIAN_ROLE(), finance.address)).to.be.true;

      // when
      await config.connect(custodian).revokeRole(await config.CUSTODIAN_ROLE(), finance.address);

      // then
      expect(await config.hasRole(await config.CUSTODIAN_ROLE(), finance.address)).to.be.false;
    });

    it('should emit RoleGranted event', async () => {
      const { config, custodian, finance } = await bountiesConfigFixture();

      // when
      await expect(config.connect(custodian).grantRole(await config.CUSTODIAN_ROLE(), finance.address))
        .to.emit(config, "RoleGranted")
        .withArgs(
          await config.CUSTODIAN_ROLE(),
          await finance.getAddress(),
          await custodian.getAddress(),
        );
    });

    it('should emit RoleRevoked event', async () => {
      const { config, custodian, finance } = await bountiesConfigFixture();
      await config.connect(custodian).grantRole(await config.CUSTODIAN_ROLE(), finance.address);
      expect(await config.hasRole(await config.CUSTODIAN_ROLE(), finance.address)).to.be.true;

      // when
      await expect(config.connect(custodian).revokeRole(await config.CUSTODIAN_ROLE(), finance.address))
        .to.emit(config, "RoleRevoked")
        .withArgs(
          await config.CUSTODIAN_ROLE(),
          finance.address,
          custodian.address
        );
    });

    it('should not allow non-custodian to grant custodian role', async () => {
      const { config, finance } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(finance).grantRole(await config.CUSTODIAN_ROLE(), finance.address))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetNotary", () => {
    it('should update notary', async () => {
      const { config, custodian, finance } = await bountiesConfigFixture();

      // when
      const txn = await config.connect(custodian).setNotary(finance.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await config.notary()).to.be.eq(finance.address);
    });

    it('should revert with invalid notary address', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(custodian).setNotary(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(config, "InvalidAddress")
        .withArgs(ethers.ZeroAddress);
    });

    it('should emit ConfigChange event', async () => {
      const { config, identity, custodian, finance } = await bountiesConfigFixture();

      // when
      await expect(config.connect(custodian).setNotary(finance.address))
        .to.emit(config, "ConfigChange")
        .withArgs(
          await finance.getAddress(),
          await identity.getAddress(),
          await config.serviceFee(),
          await config.maintainerFee()
        );
    });

    it('should not allow non-custodian to update notary', async () => {
      const { config, finance } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(finance).setNotary(finance.address))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetIdentity", () => {
    it('should update identity contract', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();

      // when
      const txn = await config.connect(custodian).setIdentity(issuer.address);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await config.identityContract()).to.be.eq(issuer.address);
    });

    it('should revert with invalid identity address', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(custodian).setIdentity(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(config, "InvalidAddress")
        .withArgs(ethers.ZeroAddress);
    });

    it('should emit ConfigChange event', async () => {
      const { config, custodian, notary, issuer } = await bountiesConfigFixture();

      // when
      await expect(config.connect(custodian).setIdentity(issuer.address))
        .to.emit(config, "ConfigChange")
        .withArgs(
          await notary.getAddress(),
          await issuer.getAddress(),
          await config.serviceFee(),
          await config.maintainerFee()
        );
    });

    it('should not allow non-custodian to update identity contract', async () => {
      const { config, finance, issuer } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(finance).setIdentity(issuer.address))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });
  });

  describe("SetServiceFee", () => {
    it('should update service fee', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when
      const txn = await config.connect(custodian).setServiceFee(50);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await config.serviceFee()).to.be.eq(50);
    });

    it('should emit ConfigChange event', async () => {
      const { config, identity, custodian, notary } = await bountiesConfigFixture();

      // when
      await expect(config.connect(custodian).setServiceFee(50))
        .to.emit(config, "ConfigChange")
        .withArgs(
          await notary.getAddress(),
          await identity.getAddress(),
          50,
          await config.maintainerFee()
        );
    });

    it('should not allow non-custodian to update service fee', async () => {
      const { config, finance } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(finance).setServiceFee(50))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });

    // TODO: figure out how to check for a TypeError
    it.skip('should not allow service fee below zero', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when/then
      expect(() => config.connect(custodian).setServiceFee(-1)).to.throw();
    });

    it('should not allow service fee over 100', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(custodian).setServiceFee(101))
        .to.be.revertedWithCustomError(config, "InvalidFee")
        .withArgs(101);
    });
  });

  describe("SetCustomServiceFee", () => {
    it('should update service fee', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();

      // when
      const txn = await config.connect(custodian).setCustomServiceFee(issuer.address, 3);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await config.effectiveServiceFee(issuer.address)).to.be.eq(3);
    });

    it('should emit CustomFeeChange event when enabled', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();

      // when
      await expect(config.connect(custodian).setCustomServiceFee(issuer.address, 3))
        .to.emit(config, "CustomFeeChange")
        .withArgs(
          issuer.address,
          "service",
          3,
          true
        );
    });

    it('should emit CustomFeeChange event when disabled', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();

      // when
      await config.connect(custodian).setCustomServiceFee(issuer.address, 3);
      await expect(config.connect(custodian).setCustomServiceFee(issuer.address, 20))
        .to.emit(config, "CustomFeeChange")
        .withArgs(
          issuer.address,
          "service",
          20,
          false
        );
    });

    it('should not allow non-custodian to update service fee', async () => {
      const { config, finance, issuer } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(finance).setCustomServiceFee(issuer.address, 3))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });

    // TODO: figure out how to check for a TypeError
    it.skip('should not allow service fee below zero', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();

      // when/then
      expect(() => config.connect(custodian).setCustomServiceFee(issuer.address, -1)).to.throw();
    });

    it('should not allow service fee over 100', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(custodian).setCustomServiceFee(issuer.address, 101))
        .to.be.revertedWithCustomError(config, "InvalidFee")
        .withArgs(101);
    });
  });

  describe("EffectiveServiceFee", () => {
    it('should return the default service fee when no custom fee set', async () => {
      const { config, issuer } = await bountiesConfigFixture();
      expect(await config.effectiveServiceFee(issuer.address)).to.be.eq(20);
    });

    it('should return the custom service fee when set', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();
      await config.connect(custodian).setCustomServiceFee(issuer.address, 3);
      expect(await config.effectiveServiceFee(issuer.address)).to.be.eq(3);
    });

    it('should return the default service fee when custom fee set for other wallet', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();
      await config.connect(custodian).setCustomServiceFee(custodian.address, 3);
      expect(await config.effectiveServiceFee(issuer.address)).to.be.eq(20);
    });
  });

  describe("SetMaintainerFee", () => {
    it('should update maintainer fee', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when
      const txn = await config.connect(custodian).setMaintainerFee(50);

      // then
      expect(txn.hash).to.be.a.string;
      expect(await config.maintainerFee()).to.be.eq(50);
    });

    it('should emit ConfigChange event', async () => {
      const { config, identity, custodian, notary } = await bountiesConfigFixture();

      // when
      await expect(config.connect(custodian).setMaintainerFee(50))
        .to.emit(config, "ConfigChange")
        .withArgs(
          await notary.getAddress(),
          await identity.getAddress(),
          await config.serviceFee(),
          50
        );
    });

    it('should not allow non-custodian to update maintainer fee', async () => {
      const { config, finance } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(finance).setMaintainerFee(50))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });

    it('should not allow maintainer fee over 100', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(custodian).setMaintainerFee(101))
        .to.be.revertedWithCustomError(config, "InvalidFee")
        .withArgs(101);
    });

    // TODO: figure out how to test for a TypeError INVALID_ARGUMENT
    it.skip('should not allow maintainer fee below zero', async () => {
      const { config, custodian } = await bountiesConfigFixture();

      // when/then
      await expect(config.connect(custodian).setMaintainerFee(-1))
        .to.be.revertedWithCustomError(config, "InvalidFee")
        .withArgs(-1);
    });
  });

  describe("AddToken", () => {
    it('should add a supported token', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();
      const usdc2 = await usdcFixture(issuer);

      // when
      const txn = await config.connect(custodian).addToken(await usdc2.getAddress());

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should update supported token map', async () => {
      const { config, custodian, issuer, usdc, arb, weth } = await bountiesConfigFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await config.connect(custodian).addToken(usdc2Addr);

      // then
      expect(await config.isSupportedToken(await usdc.getAddress())).to.be.true;
      expect(await config.isSupportedToken(await arb.getAddress())).to.be.true;
      expect(await config.isSupportedToken(await weth.getAddress())).to.be.true;
      expect(await config.isSupportedToken(usdc2Addr)).to.be.true;
    });

    it('should emit TokenSupportChange event', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when/then
      await expect(config.connect(custodian).addToken(usdc2Addr)).to.emit(config, "TokenSupportChange").withArgs(
        true,
        usdc2Addr,
        "USDC",
        6
      );
    });

    it('should revert when called by non-custodian', async () => {
      const { config, issuer } = await bountiesConfigFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await expect(config.connect(issuer).addToken(usdc2Addr))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });

    it('should revert when called with already supported token', async () => {
      const { config, custodian, usdc } = await bountiesConfigFixture();
      const usdcAddr = await usdc.getAddress();

      // when
      await expect(config.connect(custodian).addToken(usdcAddr))
        .to.be.revertedWithCustomError(config, "TokenSupportError")
        .withArgs(usdcAddr, true);
    });
  });

  describe("RemoveToken", () => {
    it('should remove a supported token', async () => {
      const { config, custodian, usdc } = await bountiesConfigFixture();

      // when
      const txn = await config.connect(custodian).removeToken(await usdc.getAddress());

      // then
      expect(txn.hash).to.be.a.string;
    });

    it('should update supported token map', async () => {
      const { config, custodian, usdc } = await bountiesConfigFixture();

      // when
      await config.connect(custodian).removeToken(await usdc.getAddress());

      // then
      expect(await config.isSupportedToken(await usdc.getAddress())).to.be.false;
    });

    it('should emit TokenSupportChange event', async () => {
      const { config, custodian, usdc } = await bountiesConfigFixture();
      const usdcAddr = await usdc.getAddress();

      // when/then
      await expect(config.connect(custodian).removeToken(usdcAddr)).to.emit(config, "TokenSupportChange").withArgs(
        false,
        usdcAddr,
        "USDC",
        6
      );
    });

    it('should revert when called by non-custodian', async () => {
      const { config, issuer, usdc } = await bountiesConfigFixture();

      // when
      await expect(config.connect(issuer).removeToken(await usdc.getAddress()))
        .to.be.revertedWithCustomError(config, "AccessControlUnauthorizedAccount");
    });

    it('should revert when called with non-supported token', async () => {
      const { config, custodian, issuer } = await bountiesConfigFixture();
      const usdc2 = await usdcFixture(issuer);
      const usdc2Addr = await usdc2.getAddress();

      // when
      await expect(config.connect(custodian).removeToken(usdc2Addr))
        .to.be.revertedWithCustomError(config, "TokenSupportError")
        .withArgs(usdc2Addr, false);
    });
  });

});
