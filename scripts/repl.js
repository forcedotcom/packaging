#!/usr/bin/env node

const repl = require('repl');
const { Org, SfProject } = require('@salesforce/core');
const { Package, PackageVersion, SubscriberPackageVersion, Package1Version } = require('../lib/exported');

const startMessage = `
Usage:
  // Get an org Connection
  const conn = await getConnection(username);

  // Get an SfProject
  const project = SfProject.getInstance(projectPath);

  // Use the Connection and SfProject when calling methods of:
    * Package
    * PackageVersion
    * SubscriberPackageVersion
    * Package1Version
`;
console.log(startMessage);

const replServer = repl.start({ breakEvalOnSigint: true });
replServer.setupHistory('.repl_history', (err, repl) => {});

const context = {
  Package,
  PackageVersion,
  SubscriberPackageVersion,
  Package1Version,
  SfProject,
  getConnection: async (username) => {
    const org = await Org.create({ aliasOrUsername: username });
    return org.getConnection();
  },
};

Object.assign(replServer.context, context);
