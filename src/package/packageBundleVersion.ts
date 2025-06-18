/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { BundleVersionCreateOptions, BundleSObjects, PackageVersionEvents } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';
import { applyErrorAction } from '../utils/packageUtils';
import { PackageBundleVersionCreate } from './packageBundleVersionCreate';

Messages.importMessagesDirectory(__dirname);

export class PackageBundleVersion {
  public static async create(
    options: BundleVersionCreateOptions,
    polling?: { frequency: Duration; timeout: Duration }
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    const createResult = await PackageBundleVersionCreate.createBundleVersion(
      options.connection,
      options.project,
      options
    );

    if (polling) {
      return PackageBundleVersion.pollCreateStatus(createResult.Id, options.connection, options.project, polling).catch(
        (error: SfError) => {
          if (error.name === 'PollingClientTimeout') {
            const modifiedError = new SfError(error.message);
            modifiedError.setData({ VersionCreateRequestId: createResult.Id });
            modifiedError.message += ` Run 'sf package bundle version create report -i ${createResult.Id}' to check the status.`;
            throw applyErrorAction(massageErrorMessage(modifiedError));
          }
          throw applyErrorAction(massageErrorMessage(error));
        }
      );
    }

    return createResult;
  }

  public static async pollCreateStatus(
    createPackageVersionRequestId: string,
    connection: Connection,
    project: SfProject,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
    }
    let remainingWaitTime: Duration = polling.timeout;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const report = await PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
        switch (report.RequestStatus) {
          case BundleSObjects.PkgBundleVersionCreateReqStatus.queued:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.enqueued, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case BundleSObjects.PkgBundleVersionCreateReqStatus.success: {
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            return { completed: true, payload: report };
          }
          case BundleSObjects.PkgBundleVersionCreateReqStatus.error:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.error, report);
            return { completed: true, payload: report };
        }
      },
      frequency: polling.frequency,
      timeout: polling.timeout,
    });

    try {
      return await pollingClient.subscribe<BundleSObjects.PackageBundleVersionCreateRequestResult>();
    } catch (err) {
      const report = await PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['timed-out'], report);
      if (err instanceof Error) {
        throw applyErrorAction(err);
      }
      throw err;
    }
  }
}
