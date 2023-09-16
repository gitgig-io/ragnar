import { expect } from "chai";
import { ethers } from "hardhat";

describe("Bounties", () => {
  async function bountiesFixture() {
    const [_owner, oracle, issuer, contributor] = await ethers.getSigners();
    const BountiesFactory = await ethers.getContractFactory("Bounties");
    const bounties = await BountiesFactory.deploy(oracle.address);
    return { bounties, oracle, issuer, contributor };
  }

  describe("Deployment", () => {
    it("should be able to deploy bounty contract", async () => {
      const { bounties } = await bountiesFixture();
      expect(bounties.getAddress()).to.be.a.string;
    });
  });

  describe("PostBounty", () => {
    it("should be able to post bounty", async () => {
      const { bounties, issuer } = await bountiesFixture();
      await bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", issuer.address, 5);
    });

    it("should not be able to post bounty on closed issue", async () => {
      const { bounties, oracle, issuer, contributor } = await bountiesFixture();
      await bounties.connect(oracle).closeIssue("1", "gitgig-io/ragnar", "123", [contributor.address]);
      await expect(bounties.connect(issuer).postBounty("1", "gitgig-io/ragnar", "123", issuer.address, 5)).to.be.revertedWith("Issue is already closed");
    });
  });

  describe("CloseIssue", () => {

  });

  describe("ClaimBounty", () => {
  });

  describe("SweepBounty", () => {

  });
});
