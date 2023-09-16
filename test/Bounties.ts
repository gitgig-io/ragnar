import { expect } from "chai";
import { ethers } from "hardhat";

describe("Bounties", () => {
  async function bountiesFixture() {
    const [_owner, oracle, issuer, contributor] = await ethers.getSigners();

    const TestUsdcFactory = await ethers.getContractFactory("TestUsdc");
    const usdc = await TestUsdcFactory.deploy(1_000_000, issuer.address);
    const usdcAddr = await usdc.getAddress();

    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(oracle.address, [usdcAddr]);
    return { bounties, oracle, issuer, contributor, usdc };
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
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), 5);
    });

    it("should not be able to post bounty with unsupported token", async () => {
      const { bounties, issuer } = await bountiesFixture();
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", issuer.address, 5)).to.be.revertedWith("Unsupported token");
    });

    it("should not be able to post bounty on closed issue", async () => {
      const { bounties, oracle, issuer, contributor, usdc } = await bountiesFixture();
      await bounties.connect(oracle).closeIssue("1", "gitgig-io/ragnar", "123", [contributor.address]);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), 5)).to.be.revertedWith("Issue is already closed");
    });
  });

  describe("CloseIssue", () => {
    it("should return false if issue is not closed", async () => {
      const { bounties } = await bountiesFixture();
      expect(await bounties.isIssueClosed("1", "gitgig-io/ragnar", "123")).to.be.false;
    });

    it("should return true if issue is closed", async () => {
      const { bounties, oracle, contributor } = await bountiesFixture();
      await bounties.connect(oracle).closeIssue("1", "gitgig-io/ragnar", "123", [contributor.address]);
      expect(await bounties.isIssueClosed("1", "gitgig-io/ragnar", "123")).to.be.true;
    });
  });

  describe("ClaimBounty", () => {
  });

  describe("SweepBounty", () => {

  });
});
