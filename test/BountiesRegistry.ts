import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("BountiesRegistry", () => {
  async function accountsFixture() {
    const [owner, custodian, bountiesContract1, bountiesContract2] = await ethers.getSigners();
    return { owner, custodian, bountiesContract1, bountiesContract2 };
  };

  async function createBountiesRegistry(custodian: HardhatEthersSigner) {
    const bountiesRegistryFactory = await ethers.getContractFactory("BountiesRegistry");
    const bountiesRegistry = await bountiesRegistryFactory.deploy(custodian);

    return bountiesRegistry;
  }

  async function bountiesRegistryFixture() {
    const accounts = await accountsFixture();
    const { custodian } = accounts;
    const registry = await createBountiesRegistry(custodian);

    return { ...accounts, registry };
  }

  async function bountiesRegistryWithContractFixture() {
    const fixtures = await bountiesRegistryFixture();
    const { custodian, bountiesContract1, registry } = fixtures;
    await registry.connect(custodian).addBountiesContract(bountiesContract1.address);
    return fixtures;
  }

  describe("Deployment", () => {
    it("should be able to deploy BountiesRegistry contract", async () => {
      const { registry } = await bountiesRegistryFixture();
      expect(registry.getAddress()).to.be.a.string;
    });
  });

  describe("AddBountiesContract", () => {
    it("should add bounties contract to registry", async () => {
      const { registry, custodian, bountiesContract1 } = await bountiesRegistryFixture();
      await registry.connect(custodian).addBountiesContract(bountiesContract1.address);
      expect(await registry.isBountiesContract(bountiesContract1.address)).to.be.true;
    });

    it("should add second bounties contract to registry", async () => {
      const { registry, custodian, bountiesContract1, bountiesContract2 } = await bountiesRegistryWithContractFixture();
      await registry.connect(custodian).addBountiesContract(bountiesContract2.address);
      expect(await registry.isBountiesContract(bountiesContract1.address)).to.be.true;
      expect(await registry.isBountiesContract(bountiesContract2.address)).to.be.true;
    });

    it("should revert when call by non-custodian", async () => {
      const { registry, owner, bountiesContract1 } = await bountiesRegistryFixture();
      await expect(registry.connect(owner).addBountiesContract(bountiesContract1.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("should emit event when new contract registered", async () => {
      const { registry, custodian, bountiesContract1 } = await bountiesRegistryFixture();
      await expect(registry.connect(custodian).addBountiesContract(bountiesContract1.address))
        .to.emit(registry, "BountiesContractRegistered")
        .withArgs(bountiesContract1.address);
    });

    it("should revert when contract already registered", async () => {
      const { registry, custodian, bountiesContract1 } = await bountiesRegistryWithContractFixture();
      await expect(registry.connect(custodian).addBountiesContract(bountiesContract1.address))
        .to.be.revertedWithCustomError(registry, "BountiesContractAlreadyRegistered");
    });
  });

  describe("RemoveBountiesContract", () => {
    it("should remove bounties contract from registry", async () => {
      const { registry, custodian, bountiesContract1 } = await bountiesRegistryWithContractFixture();
      expect(await registry.isBountiesContract(bountiesContract1.address)).to.be.true;
      await registry.connect(custodian).removeBountiesContract(bountiesContract1.address);
      expect(await registry.isBountiesContract(bountiesContract1.address)).to.be.false;
    });

    it("should revert when call by non-custodian", async () => {
      const { registry, owner, bountiesContract1 } = await bountiesRegistryWithContractFixture();
      await expect(registry.connect(owner).removeBountiesContract(bountiesContract1.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("should emit event when contract removed", async () => {
      const { registry, custodian, bountiesContract1 } = await bountiesRegistryWithContractFixture();
      await expect(registry.connect(custodian).removeBountiesContract(bountiesContract1.address))
        .to.emit(registry, "BountiesContractUnregistered")
        .withArgs(bountiesContract1.address);
    });

    it("should revert when contract not registered", async () => {
      const { registry, custodian, bountiesContract1 } = await bountiesRegistryFixture();
      await expect(registry.connect(custodian).removeBountiesContract(bountiesContract1.address))
        .to.be.revertedWithCustomError(registry, "BountiesContractNotRegistered");
    });
  });

  describe("IsBountiesContract", () => {
    it("should return false for unregistered contract", async () => {
      const { registry, bountiesContract1 } = await bountiesRegistryFixture();
      expect(await registry.isBountiesContract(bountiesContract1.address)).to.be.false;
    });

    it("should return true for registered contract", async () => {
      const { registry, bountiesContract1 } = await bountiesRegistryWithContractFixture();
      expect(await registry.isBountiesContract(bountiesContract1.address)).to.be.true;
    });
  });
});

