import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Bounties } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = 10_000;

describe("PointsToken", () => {
  async function accountsFixture() {
    const [owner, custodian, issuer, contributor, contributor2, bountiesContract1] = await ethers.getSigners();
    return { owner, custodian, issuer, contributor, contributor2, bountiesContract1 };
  };

  async function createBountiesRegistry(custodian: HardhatEthersSigner) {
    const BountiesRegistry = await ethers.getContractFactory("BountiesRegistry");
    return await BountiesRegistry.deploy(custodian.address);
  }

  async function createPointsTokenFixture() {
    const fixtures = await accountsFixture();
    const { custodian, issuer } = fixtures;
    const bountiesRegistry = await createBountiesRegistry(custodian);
    const PointsTokenFactory = await ethers.getContractFactory("PointsToken");
    const pointsToken = await PointsTokenFactory.connect(issuer).deploy(
      await bountiesRegistry.getAddress(),
      "Test Token",
      "cpTST",
      "1",
      "my-org",
      2,
      2_000_000_000,
      issuer,
    );
    return { ...fixtures, pointsToken, bountiesRegistry };
  };

  async function pointsTokenFixture() {
    return await loadFixture(createPointsTokenFixture);
  }

  async function createPointsTokenWithBountiesFixture() {
    const fixtures = await pointsTokenFixture();
    const { bountiesRegistry, custodian, issuer, bountiesContract1, pointsToken } = fixtures;
    await bountiesRegistry.connect(custodian).addBountiesContract(await bountiesContract1.getAddress());
    await pointsToken.connect(issuer).transfer(bountiesContract1.address, AMOUNT);
    return fixtures;
  }

  async function pointsTokenWithBountiesFixture() {
    return await loadFixture(createPointsTokenWithBountiesFixture);
  }

  describe("Deployment", () => {
    it('should deploy successfully', async () => {
      const { pointsToken } = await pointsTokenFixture();
      expect(await pointsToken.getAddress()).to.not.be.undefined;
    });
  });

  describe("Transfer", () => {
    it('should allow token issuer to transfer', async () => {
      const { issuer, contributor, pointsToken } = await pointsTokenFixture();

      // when
      await pointsToken.connect(issuer).transfer(contributor.address, AMOUNT);

      expect(await pointsToken.balanceOf(contributor.address)).to.equal(AMOUNT);
    });

    it('should allow bounties contract to transfer', async () => {
      const { bountiesContract1, contributor, pointsToken } = await pointsTokenWithBountiesFixture();

      // when
      await pointsToken.connect(bountiesContract1).transfer(contributor.address, AMOUNT);

      expect(await pointsToken.balanceOf(contributor.address)).to.equal(AMOUNT);
    });

    it('should revert when contributor tries to transfer', async () => {
      const { issuer, contributor, contributor2, pointsToken } = await pointsTokenWithBountiesFixture();
      await pointsToken.connect(issuer).transfer(contributor.address, AMOUNT);

      // when
      await expect(pointsToken.connect(contributor).transfer(contributor2.address, AMOUNT))
        .to.be.revertedWithCustomError(pointsToken, "ERC20InvalidSender");

      expect(await pointsToken.balanceOf(contributor2.address)).to.equal(0);
    });

    it('should revert when unregistered bounties contract tries to transfer', async () => {
      const { bountiesContract1, contributor, pointsToken } = await pointsTokenFixture();

      // when
      await expect(pointsToken.connect(bountiesContract1).transfer(contributor.address, AMOUNT))
        .to.be.revertedWithCustomError(pointsToken, "ERC20InvalidSender");

      expect(await pointsToken.balanceOf(contributor.address)).to.equal(0);
    });
  });

  describe("TransferFrom", () => {
    it('should allow token issuer transfer via approved sender', async () => {
      const { issuer, contributor, pointsToken } = await pointsTokenFixture();
      await pointsToken.connect(issuer).approve(contributor.address, AMOUNT);

      // when
      await pointsToken.connect(contributor).transferFrom(issuer.address, contributor.address, AMOUNT);

      expect(await pointsToken.balanceOf(contributor.address)).to.equal(AMOUNT);
    });

    it('should allow bounties contract to transfer via approved sender', async () => {
      const { bountiesContract1, contributor, pointsToken } = await pointsTokenWithBountiesFixture();
      await pointsToken.connect(bountiesContract1).approve(contributor.address, AMOUNT);

      // when
      await pointsToken.connect(contributor).transferFrom(bountiesContract1.address, contributor.address, AMOUNT);

      expect(await pointsToken.balanceOf(contributor.address)).to.equal(AMOUNT);
    });

    it('should revert when contributor tries to transfer via unregistered bounties contract', async () => {
      const { bountiesContract1, contributor, pointsToken } = await pointsTokenFixture();
      await pointsToken.connect(bountiesContract1).approve(contributor.address, AMOUNT);

      // when
      await expect(pointsToken.connect(contributor).transferFrom(bountiesContract1.address, contributor.address, AMOUNT))
        .to.be.revertedWithCustomError(pointsToken, "ERC20InvalidSender");

      expect(await pointsToken.balanceOf(contributor.address)).to.equal(0);
    });
  });

  describe("Decimals", () => {
    it('should return decimals', async () => {
      const { pointsToken } = await pointsTokenFixture();
      expect(await pointsToken.decimals()).to.equal(2);
    });
  });
});
