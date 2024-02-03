import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OrgTokenRegistry", () => {
  async function accountsFixture() {
    const [owner, custodian, trusted, token, token2] = await ethers.getSigners();
    return { owner, custodian, trusted, token, token2 };
  };

  async function createOrgTokenRegistry(custodian: HardhatEthersSigner) {
    const orgTokenRegistryFactory = await ethers.getContractFactory("OrgTokenRegistry");
    const orgTokenRegistry = await orgTokenRegistryFactory.deploy(custodian);

    return orgTokenRegistry;
  }

  async function orgTokenRegistryFixture() {
    const accounts = await accountsFixture();
    const { custodian, trusted } = accounts;
    const registry = await createOrgTokenRegistry(custodian);

    await registry.connect(custodian).grantRole(await registry.TRUSTED_CONTRACT_ROLE(), trusted.address);

    return { ...accounts, registry };
  }

  describe("Deployment", () => {
    it("should be able to deploy OrgTokenRegistry contract", async () => {
      const { registry } = await orgTokenRegistryFixture();
      expect(registry.getAddress()).to.be.a.string;
    });
  });

  describe("Add", () => {
    it("should add token to registry", async () => {
      const { registry, token, trusted } = await orgTokenRegistryFixture();
      await registry.connect(trusted).add("1", "gitgig-io", "cpTST", token.address);
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(token.address);
    });

    it("should revert when call by non-trusted-contract", async () => {
      const { custodian, registry, token } = await orgTokenRegistryFixture();
      await expect(registry.connect(custodian).add("1", "gitgig-io", "cpTST", token.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    })

    it("should revert when org symbol already exists", async () => {
      const { registry, token, token2, trusted } = await orgTokenRegistryFixture();
      await registry.connect(trusted).add("1", "gitgig-io", "cpTST", token.address);
      await expect(registry.connect(trusted).add("1", "gitgig-io", "cpTST", token2.address))
        .to.be.revertedWithCustomError(registry, "SymbolAlreadyExists");
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(token.address);
    });
  });

  describe("GetContract", () => {
    it("should return token address for registered token", async () => {
      const { registry, token, trusted } = await orgTokenRegistryFixture();
      await registry.connect(trusted).add("1", "gitgig-io", "cpTST", token.address);
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(token.address);
    });

    it("should return zero address for non-registered token", async () => {
      const { registry } = await orgTokenRegistryFixture();
      expect(await registry.getContract("1", "gitgig-io", "cpTST")).to.equal(ethers.ZeroAddress);
    });
  });
});

