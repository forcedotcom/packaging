/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

/* --------------------------------------------------------------------------------------------------------------------
 * WARNING: This file has been deprecated and should now be considered locked against further changes.  Its contents
 * have been partially or wholly superseded by functionality included in the @salesforce/core npm package, and exists
 * now to service prior uses in this repository only until they can be ported to use the new @salesforce/core library.
 *
 * If you need or want help deciding where to add new functionality or how to migrate to the new library, please
 * contact the CLI team at alm-cli@salesforce.com.
 * ----------------------------------------------------------------------------------------------------------------- */

export const consts = {
  DEFAULT_USER_DIR_MODE: '700',
  DEFAULT_USER_FILE_MODE: '600',
  DEFAULT_STREAM_TIMEOUT_MINUTES: 6,
  MIN_STREAM_TIMEOUT_MINUTES: 2,
  DEFAULT_SRC_WAIT_MINUTES: 33,
  DEFAULT_MDAPI_WAIT_MINUTES: 0,
  DEFAULT_MDAPI_RETRIEVE_WAIT_MINUTES: -1,
  DEFAULT_MDAPI_POLL_INTERVAL_MINUTES: 0.1,
  DEFAULT_MDAPI_POLL_INTERVAL_MILLISECONDS: 0.1 * 60 * 1000,
  MIN_SRC_WAIT_MINUTES: 1,
  MIN_SRC_DEPLOY_WAIT_MINUTES: 0,
  WORKSPACE_CONFIG_FILENAME: 'sfdx-project.json',
  OLD_WORKSPACE_CONFIG_FILENAME: 'sfdx-workspace.json',
  DEFAULT_DEV_HUB_USERNAME: 'defaultdevhubusername',
  DEFAULT_USERNAME: 'defaultusername',
  ACKNOWLEDGED_USAGE_COLLECTION_FILENAME: 'acknowledgedUsageCollection.json',
  PACKAGE_VERSION_INFO_FILE_ZIP: 'package-version-info.zip',
  // tokens to be replaced on source:push
  INSTANCE_URL_TOKEN: '__SFDX_INSTANCE_URL__',
  PACKAGE2_DESCRIPTOR_FILE: 'package2-descriptor.json',
  PACKAGE_INSTALL_POLL_FREQUENCY: 5000, // 5000ms
  PACKAGE_INSTALL_POLL_TIMEOUT: 5, // 5 minutes
};
