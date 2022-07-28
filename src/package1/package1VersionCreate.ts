/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import { Connection, Lifecycle, Messages, PollingClient } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { Package1VersionCreateRequest, PackagingSObjects } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

export async function package1VersionCreate(
  connection: Connection,
  options: Package1VersionCreateRequest,
  pollingOptions = { frequency: Duration.seconds(5), timeout: Duration.seconds(0) }
): Promise<PackagingSObjects.PackageUploadRequest> {
  const createRequest = await connection.tooling.sobject('PackageUploadRequest').create(options);
  if (pollingOptions.timeout.seconds) {
    let timeout = pollingOptions.timeout.seconds;
    const pollingClient = await PollingClient.create({
      poll: async () => {
        const pollingResult = await connection.tooling.sobject('PackageUploadRequest').retrieve(createRequest.id);
        switch (pollingResult.Status) {
          case 'SUCCESS':
            return { completed: true, payload: pollingResult };
          case 'IN_PROGRESS':
          case 'QUEUED':
            timeout -= pollingOptions.frequency.seconds;
            await Lifecycle.getInstance().emit('package1VersionCreate:progress', { timeout, pollingResult });

            return { completed: false, payload: pollingResult };
          default: {
            if (pollingResult?.Errors?.errors?.length > 0) {
              throw messages.createError('package1VersionCreateCommandUploadFailure', [
                (pollingResult.Errors.errors.map((e: Error) => e.message) as string[]).join(os.EOL),
              ]);
            } else {
              throw messages.createError('package1VersionCreateCommandUploadFailureDefault');
            }
          }
        }
      },
      ...pollingOptions,
    });
    return pollingClient.subscribe<PackagingSObjects.PackageUploadRequest>();
  } else {
    // jsforce templates weren't working when setting the type to PackageUploadRequest, so we have to cast `as unkown as PackagingSObjects.PackageUploadRequest`
    return (await connection.tooling
      .sobject('PackageUploadRequest')
      .retrieve(createRequest.id)) as unknown as PackagingSObjects.PackageUploadRequest;
  }
}
