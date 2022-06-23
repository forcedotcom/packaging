/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { randomBytes } from 'crypto';
import * as util from 'util';

/**
 * Returns a unique string. If template is supplied and contains a replaceable string (see node library util.format)
 * the unique string will be applied to the template using util.format. If the template does not contain a replaceable string
 * the unique string will be appended to the template.
 *
 * @param {string} template - can contain a replaceable string (%s)
 * @returns {string}
 */
// TODO: replace with testSetup.uniqid when it is available
export const genUniqueString = (template?: string): string => {
  const uniqueString = randomBytes(8).toString('hex');
  if (!template) {
    return uniqueString;
  }
  return template.includes('%s') ? util.format(template, uniqueString) : `${template}${uniqueString}`;
};
