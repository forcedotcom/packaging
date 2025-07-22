/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { Connection, Messages } from '@salesforce/core';
import { SfProject } from '@salesforce/core/project';
import sinon from 'sinon';
import { PackageVersionDependency, VERSION_BEING_BUILT } from '../../src/package/packageVersionDependency';

Messages.importMessagesDirectory(__dirname);
// const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_dependency');

describe('Package Version Dependencies', () => {
  const $$ = new TestContext();
  let mockConnection: Connection;
  let mockProject: SfProject;
  let testData: MockTestOrgData;
  let connectionStub: sinon.SinonStub;

  beforeEach(async () => {
    testData = new MockTestOrgData();
    mockConnection = await testData.getConnection();
    mockProject = await SfProject.resolve();
    connectionStub = $$.SANDBOX.stub(mockConnection.tooling, 'query');
  });

  afterEach(() => {
    $$.restore();
  });

  // tests that package version id is correctly resolved to 08c package version id
  it('should resolve 04t package version id to 08c package version id', async () => {
    connectionStub.onFirstCall().resolves({
      records: [{ Id: '05iXXXXXXXXXXXXXXX' }],
    });
    connectionStub.onSecondCall().resolves({
      records: [{ Id: '08cXXXXXXXXXXXXXXX' }],
    });
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '04tXXXXXXXXXXXXXXX',
    });
    expect(connectionStub.calledTwice).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('04tXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2Version');
    expect(connectionStub.secondCall.args[0]).to.contain('05iXXXXXXXXXXXXXXX');
    expect(connectionStub.secondCall.args[0]).to.contain('Package2VersionCreateRequest');
    expect(pvd['resolvedPackageId']).to.equal('08cXXXXXXXXXXXXXXX');
  });

  it('should throw an error if invalid package id is provided', async () => {
    connectionStub.onFirstCall().resolves({
      records: [],
    });

    try {
      await PackageVersionDependency.create({
        connection: mockConnection,
        project: mockProject,
        packageId: '04tXXXXXXXXXXXXXX1',
      });
      expect.fail('Expected InvalidPackageVersionIdError to be thrown');
    } catch (error: unknown) {
      expect((error as Error).name).to.equal('InvalidPackageVersionIdError');
      expect((error as Error).message).to.contain('04tXXXXXXXXXXXXXX1');
    }

    expect(connectionStub.calledOnce).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('04tXXXXXXXXXXXXXX1');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2Version');
  });

  // tests that package version id is correctly validated
  it('should return true if calcTransitiveDependencies is true and transitive dependency json exists', async () => {
    connectionStub.onFirstCall().resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: '{"nodes": [{"id": "04tXXXXXXXXXXXXXXX"}], "edges":[]}',
        },
      ],
    });
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '08cXXXXXXXXXXXXXXX',
    });
    expect(pvd['resolvedPackageId']).to.equal('08cXXXXXXXXXXXXXXX');
    const isValid = await pvd['validatePackageVersion']();
    expect(isValid).to.be.true;
    expect(connectionStub.calledOnce).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('08cXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2VersionCreateRequest');
  });

  it('should throw an error if calcTransitiveDependencies is false', async () => {
    connectionStub.onFirstCall().resolves({
      records: [
        {
          CalcTransitiveDependencies: false,
          DependencyGraphJson: '{"nodes": [{"id": "04tXXXXXXXXXXXXXXX"}], "edges":[]}',
        },
      ],
    });
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '08cXXXXXXXXXXXXXXX',
    });
    try {
      await pvd.getDependencyDotProducer();
      expect.fail('Expected TransitiveDependenciesRequiredError to be thrown');
    } catch (error: unknown) {
      expect((error as Error).name).to.equal('TransitiveDependenciesRequiredError');
    }
    expect(connectionStub.calledOnce).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('08cXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2VersionCreateRequest');
  });

  it('should throw an error if transitive dependency json is null', async () => {
    connectionStub.onFirstCall().resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: null,
        },
      ],
    });
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '08cXXXXXXXXXXXXXXX',
    });
    try {
      await pvd.getDependencyDotProducer();
      expect.fail('Expected InvalidDependencyGraphError to be thrown');
    } catch (error: unknown) {
      expect((error as Error).name).to.equal('InvalidDependencyGraphError');
    }
    expect(connectionStub.calledOnce).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('08cXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2VersionCreateRequest');
  });

  // tests that dependency nodes are created correctly from the dependency graph json
  it('should create dependency nodes from the dependency graph json', async () => {
    const dependencyGraphJson = JSON.stringify({
      creator: 'test-creator',
      nodes: [{ id: VERSION_BEING_BUILT }, { id: '04tXXXXXXXXXXXXXX1' }, { id: '04tXXXXXXXXXXXXXX2' }],
      edges: [],
    });

    // First call: validatePackageVersion
    connectionStub.onCall(0).resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
    // Second call: getDependencyDotProducer (same query)
    connectionStub.onCall(1).resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
    // Third call: Setup mock for VERSION_BEING_BUILT node query
    connectionStub.onCall(2).resolves({
      records: [
        {
          Package2: { Name: 'TestPackage1' },
          Package2Version: {
            SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX3',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 0,
          },
        },
      ],
    });
    // Fourth call: Setup mocks for regular package version nodes
    connectionStub.onCall(3).resolves({
      records: [
        {
          SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX1',
          Package2: { Name: 'DependencyPackage1' },
          MajorVersion: 2,
          MinorVersion: 1,
          PatchVersion: 0,
          BuildNumber: 0,
        },
      ],
    });
    connectionStub.onCall(4).resolves({
      records: [
        {
          SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX2',
          Package2: { Name: 'DependencyPackage2' },
          MajorVersion: 1,
          MinorVersion: 2,
          PatchVersion: 3,
          BuildNumber: 0,
        },
      ],
    });

    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '08cXXXXXXXXXXXXXXX',
    });
    const dotProducer = await pvd.getDependencyDotProducer();
    const dependencyGraphData = dotProducer['dependencyGraphData'];
    expect(dependencyGraphData).to.not.be.undefined;
    expect(dependencyGraphData.nodes).to.have.length(3);
    // Check nodes
    const versionBeingBuiltNode = dependencyGraphData.nodes.find(
      (n) => n.subscriberPackageVersionId === '04tXXXXXXXXXXXXXX3'
    );
    expect(versionBeingBuiltNode).to.not.be.undefined;
    expect(versionBeingBuiltNode?.packageName).to.equal('TestPackage1');
    expect(versionBeingBuiltNode?.version.toString()).to.equal('1.0.0.0');
    const dep1Node = dependencyGraphData.nodes.find((n) => n.subscriberPackageVersionId === '04tXXXXXXXXXXXXXX1');
    expect(dep1Node).to.not.be.undefined;
    expect(dep1Node?.packageName).to.equal('DependencyPackage1');
    expect(dep1Node?.version.toString()).to.equal('2.1.0.0');
    const dep2Node = dependencyGraphData.nodes.find((n) => n.subscriberPackageVersionId === '04tXXXXXXXXXXXXXX2');
    expect(dep2Node).to.not.be.undefined;
    expect(dep2Node?.packageName).to.equal('DependencyPackage2');
    expect(dep2Node?.version.toString()).to.equal('1.2.3.0');
  });

  // tests that dependency edges are created correctly from the dependency graph json
  it('should create dependency edges from the dependency graph json', async () => {
    const dependencyGraphJson = JSON.stringify({
      creator: 'test-creator',
      nodes: [{ id: VERSION_BEING_BUILT }, { id: '04tXXXXXXXXXXXXXX1' }],
      edges: [
        { source: VERSION_BEING_BUILT, target: '04tXXXXXXXXXXXXXX1' },
        { source: '04tXXXXXXXXXXXXXX1', target: VERSION_BEING_BUILT },
      ],
    });

    // First call: validatePackageVersion
    connectionStub.onCall(0).resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
    // Second call: getDependencyDotProducer (same query)
    connectionStub.onCall(1).resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
    // Third call: Setup mock for VERSION_BEING_BUILT node query
    connectionStub.onCall(2).resolves({
      records: [
        {
          Package2: { Name: 'TestPackage' },
          Package2Version: {
            SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX2',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
        },
      ],
    });
    // Fourth call: Setup mock for dependency package
    connectionStub.onCall(3).resolves({
      records: [
        {
          SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX1',
          Package2: { Name: 'DependencyPackage' },
          MajorVersion: 2,
          MinorVersion: 0,
          PatchVersion: 0,
          BuildNumber: 1,
        },
      ],
    });

    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '08cXXXXXXXXXXXXXXX',
    });
    const dotProducer = await pvd.getDependencyDotProducer();
    const dependencyGraphData = dotProducer['dependencyGraphData'];
    expect(dependencyGraphData.edges).to.have.length(2);

    // Check that VERSION_BEING_BUILT is replaced with actual subscriber package version id
    const edge1 = dependencyGraphData.edges.find(
      (e) => e.source === '04tXXXXXXXXXXXXXX2' && e.target === '04tXXXXXXXXXXXXXX1'
    );
    expect(edge1).to.not.be.undefined;
    const edge2 = dependencyGraphData.edges.find(
      (e) => e.source === '04tXXXXXXXXXXXXXX1' && e.target === '04tXXXXXXXXXXXXXX2'
    );
    expect(edge2).to.not.be.undefined;
  });

  // tests that the dot file is created correctly
  it('should create the dot file from the dependency graph data', async () => {
    const dependencyGraphJson = JSON.stringify({
      creator: 'test-creator',
      nodes: [{ id: VERSION_BEING_BUILT }, { id: '04tXXXXXXXXXXXXXX1' }],
      edges: [{ source: '04tXXXXXXXXXXXXXX1', target: VERSION_BEING_BUILT }],
    });

    // First call: validatePackageVersion
    connectionStub.onCall(0).resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
    // Second call: getDependencyDotProducer (same query)
    connectionStub.onCall(1).resolves({
      records: [
        {
          CalcTransitiveDependencies: true,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
    // Third call: Setup mocks for package queries
    connectionStub.onCall(2).resolves({
      records: [
        {
          Package2: { Name: 'PackageBeingBuilt' },
          Package2Version: {
            SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX2',
            MajorVersion: 1,
            MinorVersion: 5,
            PatchVersion: 0,
            BuildNumber: 0,
          },
        },
      ],
    });
    connectionStub.onCall(3).resolves({
      records: [
        {
          SubscriberPackageVersionId: '04tXXXXXXXXXXXXXX1',
          Package2: { Name: 'ParentPackage' },
          MajorVersion: 2,
          MinorVersion: 1,
          PatchVersion: 0,
          BuildNumber: 0,
        },
      ],
    });

    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageId: '08cXXXXXXXXXXXXXXX',
    });
    const dotProducer = await pvd.getDependencyDotProducer();
    const dotOutput = dotProducer.produce();

    expect(dotOutput).to.be.a('string');
    expect(dotOutput).to.contain('strict digraph G {');
    expect(dotOutput).to.contain('node_04tXXXXXXXXXXXXXX1 [label="ParentPackage@2.1.0.0"]');
    expect(dotOutput).to.contain('node_04tXXXXXXXXXXXXXX2 [label="PackageBeingBuilt@1.5.0.0"]');
    expect(dotOutput).to.contain('node_04tXXXXXXXXXXXXXX2 -> node_04tXXXXXXXXXXXXXX1');
    expect(dotOutput).to.contain('}');
  });
});
