/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Messages } from '@salesforce/core';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_utils');

export function massageErrorMessage(err: Error): Error {
  if (err.name === 'STRING_TOO_LONG') {
    err['message'] = messages.getMessage('STRING_TOO_LONG');
  }

  return err;
}
