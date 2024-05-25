import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("PointsTokenRegistry", () => {
  async function accountsFixture() {
    const [owner, custodian, trusted, token, token2] = await ethers.getSigners();
    return { owner, custodian, trusted, token, token2 };
  };

  async function createPointsTokenRegistry(custodian: HardhatEthersSigner) {
    const pointsTokenRegistryFactory = await ethers.getContractFactory("PointsTokenRegistry");
    const pointsTokenRegistry = await pointsTokenRegistryFactory.deploy(custodian);

    return pointsTokenRegistry;
  }

  async function createPointsTokenRegistryFixture() {
    const accounts = await accountsFixture();
    const { custodian, trusted } = accounts;
    const registry = await createPointsTokenRegistry(custodian);

    await registry.connect(custodian).grantRole(await registry.TRUSTED_CONTRACT_ROLE(), trusted.address);

    return { ...accounts, registry };
  }

  async function pointsTokenRegistryFixture() {
    return await loadFixture(createPointsTokenRegistryFixture);
  }

  describe("Deployment", () => {
    it("should be able to deploy PointsTokenRegistry contract", async () => {
      const { registry } = await pointsTokenRegistryFixture();
      expect(registry.getAddress()).to.be.a.string;
    });
  });

  describe("Add", () => {
    it("should add token to registry", async () => {
      const { registry, token, trusted } = await pointsTokenRegistryFixture();
      expect(await registry.isPointsToken(token.address)).to.be.false;
      await registry.connect(trusted).add("1", "gitgig-io", "cpTST", token.address);
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(token.address);
      expect(await registry.isPointsToken(token.address)).to.be.true;
    });

    it("should revert when call by non-trusted-contract", async () => {
      const { custodian, registry, token } = await pointsTokenRegistryFixture();
      await expect(registry.connect(custodian).add("1", "gitgig-io", "cpTST", token.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    })

    it("should revert when owner symbol already exists", async () => {
      const { registry, token, token2, trusted } = await pointsTokenRegistryFixture();
      await registry.connect(trusted).add("1", "gitgig-io", "cpTST", token.address);
      await expect(registry.connect(trusted).add("1", "gitgig-io", "cpTST", token2.address))
        .to.be.revertedWithCustomError(registry, "SymbolAlreadyExists");
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(token.address);
    });
  });

  describe("GetContract", () => {
    it("should return token address for registered token", async () => {
      const { registry, token, trusted } = await pointsTokenRegistryFixture();
      await registry.connect(trusted).add("1", "gitgig-io", "cpTST", token.address);
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(token.address);
    });

    it("should return zero address for non-registered token", async () => {
      const { registry } = await pointsTokenRegistryFixture();
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(ethers.ZeroAddress);
    });
  });
});

