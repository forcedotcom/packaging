/*
 * Copyright 2025, Salesforce, Inc.
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
import { expect } from 'chai';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { Connection, Messages } from '@salesforce/core';
import { SfProject } from '@salesforce/core/project';
import sinon from 'sinon';
import { PackageVersionDependency, VERSION_BEING_BUILT } from '../../src/package/packageVersionDependency';

Messages.importMessagesDirectory(__dirname);

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
      packageVersionId: '04tXXXXXXXXXXXXXXX',
    });
    expect(connectionStub.calledTwice).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('04tXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2Version');
    expect(connectionStub.secondCall.args[0]).to.contain('05iXXXXXXXXXXXXXXX');
    expect(connectionStub.secondCall.args[0]).to.contain('Package2VersionCreateRequest');
    expect(pvd['resolvedPackageVersionId']).to.equal('08cXXXXXXXXXXXXXXX');
  });

  it('should throw an error if invalid package id is provided', async () => {
    connectionStub.onFirstCall().resolves({
      records: [],
    });

    try {
      await PackageVersionDependency.create({
        connection: mockConnection,
        project: mockProject,
        packageVersionId: '04tXXXXXXXXXXXXXX1',
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
    resolveDependencyGraphJsonCall(
      connectionStub,
      [0, 1, 2],
      true,
      '{"nodes": [{"id": "04tXXXXXXXXXXXXXXX"}], "edges":[]}'
    );
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageVersionId: '08cXXXXXXXXXXXXXXX',
    });
    expect(pvd['resolvedPackageVersionId']).to.equal('08cXXXXXXXXXXXXXXX');
    const isValid = await pvd['validatePackageVersion']();
    expect(isValid).to.be.true;
    expect(connectionStub.called).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('08cXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2VersionCreateRequest');
  });

  it('should throw an error if calcTransitiveDependencies is false', async () => {
    resolveDependencyGraphJsonCall(
      connectionStub,
      [0, 1, 2],
      false,
      '{"nodes": [{"id": "04tXXXXXXXXXXXXXXX"}], "edges":[]}'
    );
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageVersionId: '08cXXXXXXXXXXXXXXX',
    });
    try {
      await pvd.getDependencyDotProducer();
      expect.fail('Expected TransitiveDependenciesRequiredError to be thrown');
    } catch (error: unknown) {
      expect((error as Error).name).to.equal('TransitiveDependenciesRequiredError');
    }
    expect(connectionStub.called).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('08cXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2VersionCreateRequest');
  });

  it('should throw an error if transitive dependency json is null', async () => {
    resolveDependencyGraphJsonCall(connectionStub, [0, 1, 2], true, null);
    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageVersionId: '08cXXXXXXXXXXXXXXX',
    });
    try {
      await pvd.getDependencyDotProducer();
      expect.fail('Expected InvalidDependencyGraphError to be thrown');
    } catch (error: unknown) {
      expect((error as Error).name).to.equal('InvalidDependencyGraphError');
    }
    expect(connectionStub.called).to.be.true;
    expect(connectionStub.firstCall.args[0]).to.contain('08cXXXXXXXXXXXXXXX');
    expect(connectionStub.firstCall.args[0]).to.contain('Package2VersionCreateRequest');
  });

  it('should create dependency nodes from the dependency graph json', async () => {
    const dependencyGraphJson = JSON.stringify({
      creator: 'test-creator',
      nodes: [{ id: VERSION_BEING_BUILT }, { id: '04tXXXXXXXXXXXXXX1' }, { id: '04tXXXXXXXXXXXXXX2' }],
      edges: [],
    });
    resolveDependencyGraphJsonCall(connectionStub, [0, 1, 2], true, dependencyGraphJson);
    resolveVersionBeingBuiltNodeCall(connectionStub, 3, '04tXXXXXXXXXXXXXX3', 'TestPackage1', 1, 0, 0, 0);
    resolveDependencyNodeCall(connectionStub, 4, '04tXXXXXXXXXXXXXX1', 'DependencyPackage1', 2, 1, 0, 0);
    resolveDependencyNodeCall(connectionStub, 5, '04tXXXXXXXXXXXXXX2', 'DependencyPackage2', 1, 2, 3, 0);
    resolveSelectedNodeIdsCall(connectionStub, 6, ['04tXXXXXXXXXXXXXX1', '04tXXXXXXXXXXXXXX2']);

    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageVersionId: '08cXXXXXXXXXXXXXXX',
    });
    const dotProducer = await pvd.getDependencyDotProducer();
    const dependencyGraphData = dotProducer['dependencyGraphData'];
    expect(dependencyGraphData).to.not.be.undefined;
    expect(dependencyGraphData.nodes).to.have.length(3);
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
      edges: [{ source: '04tXXXXXXXXXXXXXX1', target: VERSION_BEING_BUILT }],
    });
    resolveDependencyGraphJsonCall(connectionStub, [0, 1, 2], true, dependencyGraphJson);
    resolveVersionBeingBuiltNodeCall(connectionStub, 3, '04tXXXXXXXXXXXXXX2', 'TestPackage', 1, 0, 0, 0);
    resolveDependencyNodeCall(connectionStub, 4, '04tXXXXXXXXXXXXXX1', 'DependencyPackage', 2, 0, 0, 1);
    resolveSelectedNodeIdsCall(connectionStub, 5, ['04tXXXXXXXXXXXXXX1']);

    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageVersionId: '08cXXXXXXXXXXXXXXX',
    });
    const dotProducer = await pvd.getDependencyDotProducer();
    const dependencyGraphData = dotProducer['dependencyGraphData'];
    expect(dependencyGraphData.edges).to.have.length(1);

    // Check that VERSION_BEING_BUILT is replaced with actual subscriber package version id
    const edge1 = dependencyGraphData.edges.find(
      (e) => e.source === '04tXXXXXXXXXXXXXX1' && e.target === '04tXXXXXXXXXXXXXX2'
    );
    expect(edge1).to.not.be.undefined;
  });

  // tests that the dot file is created correctly
  it('should create the dot file from the dependency graph data', async () => {
    const dependencyGraphJson = JSON.stringify({
      creator: 'test-creator',
      nodes: [{ id: VERSION_BEING_BUILT }, { id: '04tXXXXXXXXXXXXXX1' }],
      edges: [{ source: '04tXXXXXXXXXXXXXX1', target: VERSION_BEING_BUILT }],
    });
    resolveDependencyGraphJsonCall(connectionStub, [0, 1, 2], true, dependencyGraphJson);
    resolveVersionBeingBuiltNodeCall(connectionStub, 3, '04tXXXXXXXXXXXXXX2', 'PackageBeingBuilt', 1, 5, 0, 0);
    resolveDependencyNodeCall(connectionStub, 4, '04tXXXXXXXXXXXXXX1', 'ParentPackage', 2, 1, 0, 0);
    resolveSelectedNodeIdsCall(connectionStub, 5, ['04tXXXXXXXXXXXXXX1']);

    const pvd = await PackageVersionDependency.create({
      connection: mockConnection,
      project: mockProject,
      packageVersionId: '08cXXXXXXXXXXXXXXX',
    });
    const dotProducer = await pvd.getDependencyDotProducer();
    const dotOutput = dotProducer.produce();

    expect(dotOutput).to.be.a('string');
    expect(dotOutput).to.contain('strict digraph G {');
    expect(dotOutput).to.contain('node_04tXXXXXXXXXXXXXX1 [label="ParentPackage@2.1.0.0" color="green"]');
    expect(dotOutput).to.contain('node_04tXXXXXXXXXXXXXX2 [label="PackageBeingBuilt@1.5.0.0" color="green"]');
    expect(dotOutput).to.contain('node_04tXXXXXXXXXXXXXX2 -> node_04tXXXXXXXXXXXXXX1');
    expect(dotOutput).to.contain('}');
  });
});

// package version is validated multiple times and requires multiple identical resolves
export function resolveDependencyGraphJsonCall(
  connectionStub: sinon.SinonStub,
  callIndices: number[],
  isTDCalculated: boolean,
  dependencyGraphJson: string | null
) {
  callIndices.forEach((callIndex) => {
    connectionStub.onCall(callIndex).resolves({
      records: [
        {
          CalcTransitiveDependencies: isTDCalculated,
          DependencyGraphJson: dependencyGraphJson,
        },
      ],
    });
  });
}

// return selected node 04t ids
export function resolveSelectedNodeIdsCall(
  connectionStub: sinon.SinonStub,
  callIndex: number,
  dependencyIds: string[]
) {
  const dependencyIdsArray = dependencyIds.map((id) => ({ subscriberPackageVersionId: id }));
  connectionStub.onCall(callIndex).resolves({
    records: [
      {
        Dependencies: {
          ids: dependencyIdsArray,
        },
      },
    ],
  });
}

// For VERSION_BEING_BUILT nodes (requires Package2Version nested structure)
export function resolveVersionBeingBuiltNodeCall(
  connectionStub: sinon.SinonStub,
  callIndex: number,
  versionId: string,
  packageName: string,
  majorVersion: number,
  minorVersion: number,
  patchVersion: number,
  buildNumber: number
) {
  connectionStub.onCall(callIndex).resolves({
    records: [
      {
        Package2: { Name: packageName },
        Package2Version: {
          SubscriberPackageVersionId: versionId,
          MajorVersion: majorVersion,
          MinorVersion: minorVersion,
          PatchVersion: patchVersion,
          BuildNumber: buildNumber,
        },
      },
    ],
  });
}

// For normal dependency nodes
export function resolveDependencyNodeCall(
  connectionStub: sinon.SinonStub,
  callIndex: number,
  versionId: string,
  packageName: string,
  majorVersion: number,
  minorVersion: number,
  patchVersion: number,
  buildNumber: number
) {
  connectionStub.onCall(callIndex).resolves({
    records: [
      {
        SubscriberPackageVersionId: versionId,
        Package2: { Name: packageName },
        MajorVersion: majorVersion,
        MinorVersion: minorVersion,
        PatchVersion: patchVersion,
        BuildNumber: buildNumber,
      },
    ],
  });
}
