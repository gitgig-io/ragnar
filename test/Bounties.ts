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
      const amount = 5;

      // when
      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount);

      // then
      // ensure the smart contract has the tokens now
      expect(await usdc.balanceOf(await bounties.getAddress())).to.be.eq(amount);
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

    it("should emit a BountyCreated event", async () => {
      const { bounties, issuer, usdc } = await bountiesFixture();
      const amount = 5;

      await usdc.connect(issuer).approve(await bounties.getAddress(), amount);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", await usdc.getAddress(), amount)).to.emit(bounties, "BountyCreated").withArgs(
        ["1", "gitgig-io/ragnar"],
        "123",
        [await issuer.getAddress(), 0],
        [await usdc.getAddress(), amount, "USDC"],
      )
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

    it("should revert if no resolvers specified", async () => {
      const { bounties, oracle } = await bountiesFixture();
      expect(await bounties.isIssueClosed("1", "gitgig-io/ragnar", "123")).to.be.false;
      await expect(bounties.connect(oracle).closeIssue("1", "gitgig-io/ragnar", "123", [])).to.be.revertedWith("No resolvers specified");
      expect(await bounties.isIssueClosed("1", "gitgig-io/ragnar", "123")).to.be.false;
    });
  });

  describe("ClaimBounty", () => {
  });

  describe("SweepBounty", () => {

  });
});
