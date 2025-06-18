/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Messages } from '@salesforce/core';
import { Many } from '@salesforce/ts-types';
import { IdRegistryValue } from './packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_utils');

export function massageErrorMessage(err: Error): Error {
  if (err.name === 'STRING_TOO_LONG') {
    err['message'] = messages.getMessage('STRING_TOO_LONG');
  }

  return err;
}

export function validateId(idObj: Many<IdRegistryValue>, value: string | undefined): void {
  if (!value || !validateIdNoThrow(idObj, value)) {
    throw messages.createError('invalidIdOrAlias', [
      Array.isArray(idObj) ? idObj.map((e) => e.label).join(' or ') : idObj.label,
      value,
      Array.isArray(idObj) ? idObj.map((e) => e.prefix).join(' or ') : idObj.prefix,
    ]);
  }
}

export function validateIdNoThrow(idObj: Many<IdRegistryValue>, value: string): IdRegistryValue | boolean {
  if (!value || (value.length !== 15 && value.length !== 18)) {
    return false;
  }
  return Array.isArray(idObj) ? idObj.some((e) => value.startsWith(e.prefix)) : value.startsWith(idObj.prefix);
}
