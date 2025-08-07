/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import {
  xgbPredictRunTime,
  xgbPredictLowerRunTime,
  xgbPredictUpperRunTime,
} from '../../src/package/packageUpgradePredict';

describe('XGB Models', () => {
  it('should test with different input values', () => {
    // You can modify these test inputs and expected values to test different scenarios
    const testCases = [
      {
        input: [297112.0, 0.0, 0.0, 0.0, 27.0], // Small package
        expectedRuntime: 19642.726562, // Replace with your expected value
        expectedLower: 11949.741211, // Replace with your expected value
        expectedUpper: 29086.148438, // Replace with your expected value
      },
      {
        input: [98298.0, 2.0, 32.0, 0.0, 7.0], // Medium package
        expectedRuntime: 256473.765625, // Replace with your expected value
        expectedLower: 31396.417969, // Replace with your expected value
        expectedUpper: 322991.484375, // Replace with your expected value
      },
      {
        input: [11566734.0, 250.0, 128.0, 239.0, 489.0], // Large package
        expectedRuntime: 887032.8125, // Replace with your expected value
        expectedLower: 626719.4375, // Replace with your expected value
        expectedUpper: 1816450.0, // Replace with your expected value
      },
    ];

    testCases.forEach((testCase, index) => {
      const runtime = xgbPredictRunTime(testCase.input);
      const lowerRuntime = xgbPredictLowerRunTime(testCase.input);
      const upperRuntime = xgbPredictUpperRunTime(testCase.input);

      // Verify results are numbers
      expect(runtime).to.be.a('number');
      expect(lowerRuntime).to.be.a('number');
      expect(upperRuntime).to.be.a('number');

      // Check if predictions are within 5% of expected values
      expect(Math.abs(runtime - testCase.expectedRuntime)).to.be.lessThanOrEqual(
        testCase.expectedRuntime * 0.05,
        `Test case ${index + 1}: Runtime prediction ${runtime} is not within 5% of expected ${testCase.expectedRuntime}`
      );
      expect(Math.abs(lowerRuntime - testCase.expectedLower)).to.be.lessThanOrEqual(
        testCase.expectedLower * 0.05,
        `Test case ${index + 1}: Lower runtime prediction ${lowerRuntime} is not within 5% of expected ${
          testCase.expectedLower
        }`
      );
      expect(Math.abs(upperRuntime - testCase.expectedUpper)).to.be.lessThanOrEqual(
        testCase.expectedUpper * 0.05,
        `Test case ${index + 1}: Upper runtime prediction ${upperRuntime} is not within 5% of expected ${
          testCase.expectedUpper
        }`
      );
    });
  });
});
