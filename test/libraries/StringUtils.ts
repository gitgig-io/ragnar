import { expect } from "chai";
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ethers } from 'hardhat';

describe('StringUtils', () => {
  async function stringUtilsFixture() {
    const stringUtilsFactory = await ethers.getContractFactory('StringUtils');
    const stringUtils = await stringUtilsFactory.deploy();

    return { stringUtils };
  }

  async function loadStringUtilsFixture() {
    const fixtures = await loadFixture(stringUtilsFixture);
    return fixtures;
  }

  describe('split', () => {
    it('should split string', async () => {
      const { stringUtils } = await loadStringUtilsFixture();
      expect(await stringUtils.split('gitgig-io/demo', '/')).to.eql(['gitgig-io', 'demo']);
    });

    it('should only return first 2 parts', async () => {
      const { stringUtils } = await loadStringUtilsFixture();
      expect(await stringUtils.split('gitgig-io/demo/blah', '/')).to.eql(['gitgig-io', 'demo']);
    });

    it('should revert if less than 2 parts', async () => {
      const { stringUtils } = await loadStringUtilsFixture();
      await expect(stringUtils.split('gitgig-io', '/')).to.revertedWith("Input string does not contain exactly two parts");
    });
  });

  describe('eq', () => {
    it('should return true for same strings', async () => {
      const { stringUtils } = await loadStringUtilsFixture();
      expect(await stringUtils.eq('foo', 'foo')).to.be.true;
    });

    it('should return false for different strings', async () => {
      const { stringUtils } = await loadStringUtilsFixture();
      expect(await stringUtils.eq('foo', 'bar')).to.be.false;
    });
  });
});
