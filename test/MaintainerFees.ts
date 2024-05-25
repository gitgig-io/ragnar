import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { ethers } from 'hardhat';
import { MaintainerFees } from "../typechain-types";
import { setIssueFeeSignature, setOwnerFeeSignature, setRepoFeeSignature } from "./helpers/signatureHelpers";

describe('MaintainerFees', () => {
  async function accounts() {
    const [owner, custodian, notary, maintainer] = await ethers.getSigners();
    return { owner, custodian, notary, maintainer };
  }

  async function maintainerFeesFixture() {
    const { custodian, notary, ...otherAccounts } = await accounts();
    const maintainerFeesFactory = await ethers.getContractFactory('MaintainerFees');
    const maintainerFees = await maintainerFeesFactory.deploy(custodian.address, notary.address);

    return { maintainerFees, custodian, notary, ...otherAccounts };
  }

  async function loadMaintainerFeesFixture() {
    const fixtures = await loadFixture(maintainerFeesFixture);
    return fixtures;
  }

  interface SetFeeFixtureProps {
    fee: number;
    maintainerFees: MaintainerFees;
    notary: HardhatEthersSigner;
  }

  interface SetFeeProps extends SetFeeFixtureProps {
    maintainer: HardhatEthersSigner;
  }

  function paramFixtures() {
    return {
      platform: "1",
      owner: "gitgig-io",
      repo: "demo",
      issue: "555"
    }
  }

  async function ownerFeeFixture({ fee, maintainerFees, notary }: SetFeeFixtureProps) {
    const now = await time.latest();
    const { platform, owner, ...rest } = paramFixtures();
    const expires = now + (20 * 60);
    const params = [platform, owner, fee, expires];
    const signature = await setOwnerFeeSignature(maintainerFees, params, notary);
    const executeSetOwnerFee = (maintainer: HardhatEthersSigner) =>
      maintainerFees.connect(maintainer).setOwnerFee(platform, owner, fee, expires, signature);
    return { executeSetOwnerFee, platform, owner, expires, signature, ...rest };
  }

  async function setOwnerFee({ maintainer, ...rest }: SetFeeProps) {
    const { executeSetOwnerFee, ...remaining } = await ownerFeeFixture(rest);
    await executeSetOwnerFee(maintainer);
    return remaining;
  }

  async function repoFeeFixture({ fee, maintainerFees, notary }: SetFeeFixtureProps) {
    const now = await time.latest();
    const { platform, owner, repo, issue } = paramFixtures();
    const expires = now + (20 * 60);
    const params = [platform, owner, repo, fee, expires];
    const signature = await setRepoFeeSignature(maintainerFees, params, notary);
    const executeSetRepoFee = (maintainer: HardhatEthersSigner) =>
      maintainerFees.connect(maintainer).setRepoFee(platform, owner, repo, fee, expires, signature);
    return { executeSetRepoFee, platform, owner, repo, issue, expires, signature };
  }

  async function setRepoFee({ maintainer, ...rest }: SetFeeProps) {
    const { executeSetRepoFee, ...remaining } = await repoFeeFixture(rest);
    await executeSetRepoFee(maintainer);
    return remaining;
  }

  async function issueFeeFixture({ fee, maintainerFees, notary }: SetFeeFixtureProps) {
    const now = await time.latest();
    const { platform, owner, repo, issue } = paramFixtures();
    const expires = now + (20 * 60);
    const params = [platform, owner, repo, issue, fee, expires];
    const signature = await setIssueFeeSignature(maintainerFees, params, notary);
    const executeSetIssueFee = (maintainer: HardhatEthersSigner) =>
      maintainerFees.connect(maintainer).setIssueFee(platform, owner, repo, issue, fee, expires, signature);
    return { executeSetIssueFee, platform, owner, repo, issue, expires, signature };
  }

  async function setIssueFee({ maintainer, ...rest }: SetFeeProps) {
    const { executeSetIssueFee, ...remaining } = await issueFeeFixture(rest);
    await executeSetIssueFee(maintainer);
    return remaining;
  }

  describe('getCustomFee', () => {
    it('should default to not set', async () => {
      const { maintainerFees } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = paramFixtures();
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([false, 255n]);
    });

    it('should reflect explicitly set owner fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setOwnerFee({ fee: 10, maintainer, maintainerFees, notary });

      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 10n]);
    });

    it('should reflect explicitly set repo fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setRepoFee({ fee: 20, maintainer, maintainerFees, notary });

      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 20n]);
    });

    it('should reflect explicitly set issue fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 33, maintainer, maintainerFees, notary });

      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 33n]);
    });

    it('should return repo fee when repo and owner fee set', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const issue = "999";
      const { platform, owner } = await setOwnerFee({ fee: 10, maintainer, maintainerFees, notary });
      const { executeSetRepoFee, repo } = await repoFeeFixture({ fee: 77, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 10n]);

      // when
      await executeSetRepoFee(maintainer);

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 77n]);
    });

    it('should return repo fee when issue and repo fee set', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo } = await setRepoFee({ fee: 10, maintainer, maintainerFees, notary });
      const { executeSetIssueFee, issue } = await issueFeeFixture({ fee: 77, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 10n]);

      // when
      await executeSetIssueFee(maintainer);

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 77n]);
    });

    it('should return issue fee when issue and owner fee set', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner } = await setOwnerFee({ fee: 10, maintainer, maintainerFees, notary });
      const { executeSetIssueFee, repo, issue } = await issueFeeFixture({ fee: 77, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 10n]);

      // when
      await executeSetIssueFee(maintainer);

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 77n]);
    });

    it('should return issue fee when issue and repo and owner fee set', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setOwnerFee({ fee: 10, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 10n]);
      await setRepoFee({ fee: 20, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 20n]);
      const { executeSetIssueFee } = await issueFeeFixture({ fee: 77, maintainerFees, notary });

      // when
      await executeSetIssueFee(maintainer);

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 77n]);
    });

    it('should return issue fee when issue and repo and owner fee set regardless of order set', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 88, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 88n]);
      await setRepoFee({ fee: 20, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 88n]);
      await setOwnerFee({ fee: 10, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 88n]);
    });

    it('should fall back to higher level fee when low level fee unset', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 88, maintainer, maintainerFees, notary });
      await setRepoFee({ fee: 20, maintainer, maintainerFees, notary });
      await setOwnerFee({ fee: 10, maintainer, maintainerFees, notary });

      // issue fee
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 88n]);

      // unset issue fee
      await setIssueFee({ fee: 255, maintainer, maintainerFees, notary });

      // repo fee
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 20n]);

      // unset repo fee
      await setRepoFee({ fee: 255, maintainer, maintainerFees, notary });

      // owner fee
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 10n]);

      // unset owner fee
      await setOwnerFee({ fee: 255, maintainer, maintainerFees, notary });

      // no custom fee
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([false, 255n]);
    });
  });

  describe('setOwnerFee', () => {
    it('should set custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();

      // when
      const { platform, owner } = await setOwnerFee({ fee: 33, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([true, 33n]);
    });

    it('should not affect other owners', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();

      // when
      const { platform, owner } = await setOwnerFee({ fee: 33, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([true, 33n]);
      expect(await maintainerFees.getCustomFee(platform, "other", "demo", "456")).to.eql([false, 255n]);
    });

    it('should update custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await setOwnerFee({ fee: 33, maintainer, maintainerFees, notary });

      // when
      const { platform, owner } = await setOwnerFee({ fee: 40, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([true, 40n]);
    });

    it('should unset custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner } = await setOwnerFee({ fee: 33, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([true, 33n]);

      // when
      await setOwnerFee({ fee: 255, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([false, 255n]);
    });

    it('should emit UpdateOwnerFee event', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 33;
      const { executeSetOwnerFee, platform, owner } = await ownerFeeFixture({ fee, maintainerFees, notary });

      // when/then
      await expect(executeSetOwnerFee(maintainer))
        .to.emit(maintainerFees, 'UpdateOwnerFee')
        .withArgs(platform, owner, fee, maintainer.address);
    });

    it('should allow 100 fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 100;

      // when
      const { platform, owner } = await setOwnerFee({ fee, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([true, 100n]);
    });

    it('should allow 0 fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 0;

      // when
      const { platform, owner } = await setOwnerFee({ fee, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([true, 0n]);
    });

    it('should revert with expires too far in future', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 50;
      const { platform, owner, expires, signature } = await ownerFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(maintainerFees.connect(maintainer).setOwnerFee(platform, owner, fee, expires + 2000, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'TimeframeError');
    });

    it('should revert with expires too far in past', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 50;
      const { platform, owner, expires, signature } = await ownerFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(maintainerFees.connect(maintainer).setOwnerFee(platform, owner, fee, expires - 2000, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'TimeframeError');
    });

    it('should revert when signature does not match', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 33;
      const { platform, owner, expires } = await ownerFeeFixture({ fee, maintainerFees, notary });
      const { signature } = await ownerFeeFixture({ fee, maintainerFees, notary: maintainer });

      // when
      await expect(maintainerFees.connect(maintainer).setOwnerFee(platform, owner, fee, expires, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'InvalidSignature');

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([false, 255n]);
    });

    it('should revert with invalid fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 101;
      const { executeSetOwnerFee, platform, owner } = await ownerFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(executeSetOwnerFee(maintainer))
        .to.be.revertedWithCustomError(maintainerFees, 'InvalidFee');

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, "demo", "456")).to.eql([false, 255n]);
    });

    it('should revert when paused', async () => {
      const { custodian, maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await maintainerFees.connect(custodian).pause();
      const { executeSetOwnerFee } = await ownerFeeFixture({ fee: 50, maintainerFees, notary });

      // when
      await expect(executeSetOwnerFee(maintainer))
        .to.be.revertedWithCustomError(maintainerFees, 'EnforcedPause');
    });
  });

  describe('setRepoFee', () => {
    it('should set custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();

      // when
      const { platform, owner, repo } = await setRepoFee({ fee: 33, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([true, 33n]);
    });

    it('should not affect other repos', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();

      // when
      const { platform, owner, repo } = await setRepoFee({ fee: 33, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([true, 33n]);
      expect(await maintainerFees.getCustomFee(platform, owner, "other", "456")).to.eql([false, 255n]);
    });

    it('should update custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await setRepoFee({ fee: 33, maintainer, maintainerFees, notary });

      // when
      const { platform, owner, repo } = await setRepoFee({ fee: 40, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([true, 40n]);
    });

    it('should unset custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo } = await setRepoFee({ fee: 33, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([true, 33n]);

      // when
      await setRepoFee({ fee: 255, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([false, 255n]);
    });

    it('should emit UpdateRepoFee event', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 33;
      const { executeSetRepoFee, platform, owner, repo } = await repoFeeFixture({ fee, maintainerFees, notary });

      // when/then
      await expect(executeSetRepoFee(maintainer))
        .to.emit(maintainerFees, 'UpdateRepoFee')
        .withArgs(platform, owner, repo, fee, maintainer.address);
    });

    it('should allow 100 fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 100;

      // when
      const { platform, owner, repo } = await setRepoFee({ fee, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([true, 100n]);
    });

    it('should allow 0 fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 0;

      // when
      const { platform, owner, repo } = await setRepoFee({ fee, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([true, 0n]);
    });

    it('should revert with expires too far in future', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 50;
      const { platform, owner, repo, expires, signature } = await repoFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(maintainerFees.connect(maintainer).setRepoFee(platform, owner, repo, fee, expires + 2000, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'TimeframeError');
    });

    it('should revert with expires too far in past', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 50;
      const { platform, owner, repo, expires, signature } = await repoFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(maintainerFees.connect(maintainer).setRepoFee(platform, owner, repo, fee, expires - 2000, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'TimeframeError');
    });

    it('should revert when signature does not match', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 33;
      const { platform, owner, repo, expires } = await repoFeeFixture({ fee, maintainerFees, notary });
      const { signature } = await repoFeeFixture({ fee, maintainerFees, notary: maintainer });

      // when
      await expect(maintainerFees.connect(maintainer).setRepoFee(platform, owner, repo, fee, expires, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'InvalidSignature');

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([false, 255n]);
    });

    it('should revert with invalid fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 101;
      const { executeSetRepoFee, platform, owner, repo } = await repoFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(executeSetRepoFee(maintainer))
        .to.be.revertedWithCustomError(maintainerFees, 'InvalidFee');

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "456")).to.eql([false, 255n]);
    });

    it('should revert when paused', async () => {
      const { custodian, maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await maintainerFees.connect(custodian).pause();
      const { executeSetRepoFee } = await repoFeeFixture({ fee: 50, maintainerFees, notary });

      // when
      await expect(executeSetRepoFee(maintainer))
        .to.be.revertedWithCustomError(maintainerFees, 'EnforcedPause');
    });
  });

  describe('setIssueFee', () => {
    it('should set custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();

      // when
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 33, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 33n]);
    });

    it('should not affect other issues', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();

      // when
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 33, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 33n]);
      expect(await maintainerFees.getCustomFee(platform, owner, repo, "999")).to.eql([false, 255n]);
    });

    it('should update custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await setIssueFee({ fee: 33, maintainer, maintainerFees, notary });

      // when
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 40, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 40n]);
    });

    it('should unset custom fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const { platform, owner, repo, issue } = await setIssueFee({ fee: 33, maintainer, maintainerFees, notary });
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 33n]);

      // when
      await setIssueFee({ fee: 255, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([false, 255n]);
    });

    it('should emit UpdateIssueFee event', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 33;
      const { executeSetIssueFee, platform, owner, repo, issue } = await issueFeeFixture({ fee, maintainerFees, notary });

      // when/then
      await expect(executeSetIssueFee(maintainer))
        .to.emit(maintainerFees, 'UpdateIssueFee')
        .withArgs(platform, owner, repo, issue, fee, maintainer.address);
    });

    it('should allow 100 fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 100;

      // when
      const { platform, owner, repo, issue } = await setIssueFee({ fee, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 100n]);
    });

    it('should allow 0 fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 0;

      // when
      const { platform, owner, repo, issue } = await setIssueFee({ fee, maintainer, maintainerFees, notary });

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([true, 0n]);
    });

    it('should revert with expires too far in future', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 50;
      const { platform, owner, repo, issue, expires, signature } = await issueFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(maintainerFees.connect(maintainer).setIssueFee(platform, owner, repo, issue, fee, expires + 2000, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'TimeframeError');
    });

    it('should revert with expires too far in past', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 50;
      const { platform, owner, repo, issue, expires, signature } = await issueFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(maintainerFees.connect(maintainer).setIssueFee(platform, owner, repo, issue, fee, expires - 2000, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'TimeframeError');
    });

    it('should revert when signature does not match', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 33;
      const { platform, owner, repo, issue, expires } = await issueFeeFixture({ fee, maintainerFees, notary });
      const { signature } = await issueFeeFixture({ fee, maintainerFees, notary: maintainer });

      // when
      await expect(maintainerFees.connect(maintainer).setIssueFee(platform, owner, repo, issue, fee, expires, signature))
        .to.be.revertedWithCustomError(maintainerFees, 'InvalidSignature');

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([false, 255n]);
    });

    it('should revert with invalid fee', async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      const fee = 101;
      const { executeSetIssueFee, platform, owner, repo, issue } = await issueFeeFixture({ fee, maintainerFees, notary });

      // when
      await expect(executeSetIssueFee(maintainer))
        .to.be.revertedWithCustomError(maintainerFees, 'InvalidFee');

      // then
      expect(await maintainerFees.getCustomFee(platform, owner, repo, issue)).to.eql([false, 255n]);
    });

    it('should revert when paused', async () => {
      const { custodian, maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await maintainerFees.connect(custodian).pause();
      const { executeSetIssueFee } = await issueFeeFixture({ fee: 50, maintainerFees, notary });

      // when
      await expect(executeSetIssueFee(maintainer))
        .to.be.revertedWithCustomError(maintainerFees, 'EnforcedPause');
    });
  });

  describe('setNotary', () => {
    it("should update notary", async () => {
      const { maintainerFees, custodian, maintainer } = await loadMaintainerFeesFixture();

      await maintainerFees.connect(custodian).setNotary(maintainer.address);
      expect(await maintainerFees.notary()).to.equal(maintainer.address);
    });

    it("should revert when called by non-custodian", async () => {
      const { maintainerFees, maintainer, notary } = await loadMaintainerFeesFixture();
      await expect(maintainerFees.connect(maintainer).setNotary(maintainer.address))
        .to.be.revertedWithCustomError(
          maintainerFees,
          "AccessControlUnauthorizedAccount",
        );
      expect(await maintainerFees.notary()).to.equal(notary.address);
    });

    it("should emit ConfigChange event", async () => {
      const { maintainerFees, custodian, maintainer } = await loadMaintainerFeesFixture();

      await expect(maintainerFees.connect(custodian).setNotary(maintainer.address))
        .to.emit(maintainerFees, "ConfigChange")
        .withArgs(maintainer.address, 255n);
    });
  });

  describe('pause', () => {
    it('should pause', async () => {
      const { maintainerFees, custodian } = await loadMaintainerFeesFixture();

      // when
      await maintainerFees.connect(custodian).pause();

      // then
      expect(await maintainerFees.paused()).to.be.true;
    });

    it('should emit Paused event', async () => {
      const { maintainerFees, custodian } = await loadMaintainerFeesFixture();

      // when
      await expect(maintainerFees.connect(custodian).pause())
        .to.emit(maintainerFees, "Paused")
        .withArgs(custodian.address);
    });


    it('should revert when called by non-custodian', async () => {
      const { maintainerFees, maintainer } = await loadMaintainerFeesFixture();

      // when
      await expect(maintainerFees.connect(maintainer).pause())
        .to.be.revertedWithCustomError(maintainerFees, "AccessControlUnauthorizedAccount");
    });
  });

  describe('unpause', () => {
    it('should unpause', async () => {
      const { maintainerFees, custodian } = await loadMaintainerFeesFixture();
      await maintainerFees.connect(custodian).pause();

      // when
      await maintainerFees.connect(custodian).unpause();

      // then
      expect(await maintainerFees.paused()).to.be.false;
    });

    it('should emit Unpaused event', async () => {
      const { maintainerFees, custodian } = await loadMaintainerFeesFixture();
      await maintainerFees.connect(custodian).pause();

      // when
      await expect(maintainerFees.connect(custodian).unpause())
        .to.emit(maintainerFees, "Unpaused")
        .withArgs(custodian.address);
    });


    it('should revert when called by non-custodian', async () => {
      const { custodian, maintainerFees, maintainer } = await loadMaintainerFeesFixture();
      await maintainerFees.connect(custodian).pause();

      // when
      await expect(maintainerFees.connect(maintainer).unpause())
        .to.be.revertedWithCustomError(maintainerFees, "AccessControlUnauthorizedAccount");
    });
  });
});
