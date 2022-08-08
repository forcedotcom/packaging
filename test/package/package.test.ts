/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { Package } from '../../src/package';

describe('Package', () => {
  describe('validateId', () => {
    it('should not throw for valid PackageId', async () => {
      Package.validateId('0Ho6A000002zgKSQAY', 'PackageId');
    });
    it('should not throw for valid PackageInstallRequestId', async () => {
      Package.validateId('0Hf1h0000006runCAA', 'PackageInstallRequestId');
    });
    it('should not throw for valid PackageUninstallRequestId', async () => {
      Package.validateId('06y6A000002zgKSQAY', 'PackageUninstallRequestId');
    });
    it('should not throw for valid SubscriberPackageVersionId', async () => {
      Package.validateId('04t6A000002zgKSQAY', 'SubscriberPackageVersionId');
    });
    it('should throw for invalid ID length', async () => {
      const msg = 'The PackageId: [0Ho6A000002zgKSQ] is invalid. It must be either 15 or 18 characters.';
      expect(() => Package.validateId('0Ho6A000002zgKSQ', 'PackageId')).to.throw(msg);
    });
    it('should throw for invalid ID prefix', async () => {
      const msg = 'The PackageId: [04t6A000002zgKSQAY] is invalid. It must start with "0Ho"';
      expect(() => Package.validateId('04t6A000002zgKSQAY', 'PackageId')).to.throw(msg);
    });
  });
});
