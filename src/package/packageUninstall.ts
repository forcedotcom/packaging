/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import os from 'node:os';
import { Connection, Lifecycle, Messages, PollingClient, SfError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { PackageEvents, PackagingSObjects } from '../interfaces';
import { applyErrorAction, combineSaveErrors, massageErrorMessage } from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_uninstall');
const pkgMessages = Messages.loadMessages('@salesforce/packaging', 'package');

type UninstallResult = PackagingSObjects.SubscriberPackageVersionUninstallRequest;

export async function getUninstallErrors(conn: Connection, id: string): Promise<Array<{ Message: string }>> {
  const errorQueryResult = await conn.tooling.query<{ Message: string }>(
    `"SELECT Message FROM PackageVersionUninstallRequestError WHERE ParentRequest.Id = '${id}' ORDER BY Message"`
  );
  return errorQueryResult?.records ?? [];
}

export async function pollUninstall(
  uninstallRequestId: string,
  conn: Connection,
  frequency: Duration,
  wait: Duration
): Promise<UninstallResult> {
  const poll = async (id: string): Promise<{ completed: boolean; payload: UninstallResult }> => {
    const uninstallRequest = (await conn.tooling
      .sobject('SubscriberPackageVersionUninstallRequest')
      .retrieve(id)) as UninstallResult;

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
  };
  const pollingClient = await PollingClient.create({
    poll: () => poll(uninstallRequestId),
    frequency,
    timeout: wait,
  });
  return pollingClient.subscribe();
}

export async function uninstallPackage(
  id: string,
  conn: Connection,
  frequency: Duration = Duration.seconds(0),
  wait: Duration = Duration.seconds(0)
): Promise<UninstallResult> {
  try {
    const uninstallRequest = await conn.tooling.sobject('SubscriberPackageVersionUninstallRequest').create({
      SubscriberPackageVersionId: id,
    });

    if (uninstallRequest.success) {
      if (wait.seconds === 0) {
        return (await conn.tooling
          .sobject('SubscriberPackageVersionUninstallRequest')
          .retrieve(uninstallRequest.id)) as UninstallResult;
      } else {
        return await pollUninstall(uninstallRequest.id, conn, frequency, wait);
      }
    }
    throw combineSaveErrors('SubscriberPackageVersionUninstallRequest', 'create', uninstallRequest.errors);
  } catch (err) {
    if (err instanceof Error) {
      throw applyErrorAction(massageErrorMessage(err));
    }
    throw err;
  }
}
