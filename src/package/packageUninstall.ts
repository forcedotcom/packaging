/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import { Connection, Lifecycle, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { PackageEvents, PackagingSObjects } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_uninstall');
const pkgMessages = Messages.loadMessages('@salesforce/packaging', 'package');

type UninstallResult = PackagingSObjects.SubscriberPackageVersionUninstallRequest;

export async function getUninstallErrors(conn: Connection, id: string): Promise<Array<{ Message: string }>> {
  const errorQueryResult = await conn.tooling.query<{ Message: string }>(
    `"SELECT Message FROM PackageVersionUninstallRequestError WHERE ParentRequest.Id = '${id}' ORDER BY Message"`
  );
  return errorQueryResult?.records || [];
}

async function poll(id: string, conn: Connection): Promise<StatusResult> {
  const uninstallRequest = await conn.tooling.sobject('SubscriberPackageVersionUninstallRequest').retrieve(id);

  switch (uninstallRequest.Status) {
    case 'Success': {
      return { completed: true, payload: uninstallRequest };
    }
    case 'InProgress':
    case 'Queued': {
      await Lifecycle.getInstance().emit(PackageEvents.uninstall, {
        ...uninstallRequest,
      });
      return { completed: false, payload: uninstallRequest };
    }
    default: {
      const err = pkgMessages.getMessage('defaultErrorMessage', [id, uninstallRequest.Id]);
      const errorMessages = await getUninstallErrors(conn, id);

      const errors = errorMessages.map((error, index) => `(${index + 1}) ${error.Message}${os.EOL}`);
      const combinedErrors = errors.length ? `\n=== Errors\n${errors.join(os.EOL)}` : '';
      throw new SfError(`${err}${combinedErrors}`, 'UNINSTALL_ERROR', [messages.getMessage('uninstallErrorAction')]);
    }
  }
}

export async function uninstallPackage(
  id: string,
  conn: Connection,
  wait: Duration = Duration.seconds(0)
): Promise<UninstallResult> {
  const uninstallRequest = await conn.tooling.sobject('SubscriberPackageVersionUninstallRequest').create({
    SubscriberPackageVersionId: id,
  });

  if (wait.seconds === 0) {
    return (await conn.tooling
      .sobject('SubscriberPackageVersionUninstallRequest')
      .retrieve(uninstallRequest.id)) as UninstallResult;
  } else {
    const pollingClient = await PollingClient.create({
      poll: () => poll(uninstallRequest.id, conn),
      frequency: Duration.seconds(5),
      timeout: wait,
    });
    return pollingClient.subscribe();
  }
}
