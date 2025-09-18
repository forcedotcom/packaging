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
import { EOL } from 'node:os';
import { Messages, Connection } from '@salesforce/core';
import { SfProject } from '@salesforce/core/project';
import { AsyncCreatable } from '@salesforce/kit';
import {
  PackageVersionDependencyOptions,
  DependencyGraphNode,
  DependencyGraphEdge,
  DependencyGraphData,
} from '../interfaces';
import { VersionNumber } from './versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_dependency');

export const VERSION_BEING_BUILT = 'VERSION_BEING_BUILT';
const SELECT_PACKAGE_VERSION_DEPENDENCY =
  'SELECT CalcTransitiveDependencies, DependencyGraphJson FROM Package2VersionCreateRequest';

export class PackageVersionDependency extends AsyncCreatable<PackageVersionDependencyOptions> {
  private connection: Connection;
  private project?: SfProject;
  private userPackageVersionId: string;
  private verbose: boolean;
  private edgeDirection: 'root-first' | 'root-last';
  private resolvedPackageVersionCreateRequestId: string;
  private allPackageVersionId: string;

  public constructor(public options: PackageVersionDependencyOptions) {
    super(options);
    this.connection = options.connection;
    this.project = options.project;
    this.userPackageVersionId = options.packageVersionId;
    this.verbose = options.verbose ?? false;
    this.edgeDirection = options.edgeDirection ?? 'root-first';
    this.resolvedPackageVersionCreateRequestId = '';
    this.allPackageVersionId = '';
  }

  public async init(): Promise<void> {
    await this.resolvePackageCreateRequestId();
  }

  /**
   * Returns a DependencyDotProducer that can be used to produce a DOT code representation of the package dependency graph.
   */
  public async getDependencyDotProducer(): Promise<DependencyDotProducer> {
    if (!this.isValidPackageVersion()) {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }

    let dependencyGraphJson: string;
    if (await this.isTransitiveDependenciesCalculated()) {
      dependencyGraphJson = await this.getTransitiveDependencyGraph();
    } else {
      dependencyGraphJson = await this.createFlatDependencyGraph();
    }

    const producer = new DependencyDotProducer(
      this.connection,
      dependencyGraphJson,
      this.verbose,
      this.edgeDirection,
      this.resolvedPackageVersionCreateRequestId
    );
    await producer.init();
    return producer;
  }

  private async getTransitiveDependencyGraph(): Promise<string> {
    const query = `${SELECT_PACKAGE_VERSION_DEPENDENCY} WHERE Id = '${this.resolvedPackageVersionCreateRequestId}'`;
    const result = await this.connection.tooling.query<{
      CalcTransitiveDependencies: boolean;
      DependencyGraphJson: string | null;
    }>(query);

    if (result.records[0].DependencyGraphJson == null) {
      return '';
    }

    return result.records[0].DependencyGraphJson;
  }

  private async createFlatDependencyGraph(): Promise<string> {
    if (!this.allPackageVersionId) {
      throw messages.createError('noDependencyGraphJsonMustProvideVersion');
    }

    const query = `SELECT Dependencies FROM SubscriberPackageVersion WHERE Id = '${this.allPackageVersionId}'`;
    const result = await this.connection.tooling.query<{
      Dependencies: { ids: Array<{ subscriberPackageVersionId: string }> } | null;
    }>(query);

    if (result.records?.length !== 1) {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }

    const flatDependencyGraph: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> } = {
      nodes: [],
      edges: [],
    };

    flatDependencyGraph.nodes.push({ id: this.allPackageVersionId });

    result.records[0].Dependencies?.ids.forEach((dependency) => {
      flatDependencyGraph.nodes.push({ id: dependency.subscriberPackageVersionId });
      flatDependencyGraph.edges.push({
        source: dependency.subscriberPackageVersionId,
        target: this.allPackageVersionId,
      });
    });

    return JSON.stringify(flatDependencyGraph);
  }

  /**
   * Resolves id input to a 08c. User can input a 08c or 04t.
   * Currently a 04t is not supported in filtering the Package2VersionCreateRequest. So a user's input of 04t will be resolved to a 05i and then a 08c.
   */
  private async resolvePackageCreateRequestId(): Promise<void> {
    const versionId = this.project?.getPackageIdFromAlias(this.userPackageVersionId) ?? this.userPackageVersionId;

    // User provided a Package2VersionCreateRequest ID (08c) and doesn't need to be resolved
    if (versionId.startsWith('08c')) {
      this.resolvedPackageVersionCreateRequestId = versionId;
    } else if (versionId.startsWith('04t')) {
      // User provided a SubscriberPackageVersionId (04t) and needs to be resolved to a Package2VersionCreateRequest ID (08c)
      this.allPackageVersionId = versionId;

      // TODO: Make this one query when W-18944974 is fixed.
      const package2VersionId = await this.query05iFrom04t(versionId);
      this.resolvedPackageVersionCreateRequestId = await this.query08cFrom05i(package2VersionId);
    } else {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }
  }

  private async query05iFrom04t(package04t: string): Promise<string> {
    const query05i = `SELECT Id FROM Package2Version WHERE SubscriberPackageVersionId = '${package04t}'`;
    const result05i = await this.connection.tooling.query<{ Id: string }>(query05i);
    if (result05i.records?.length !== 1) {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }
    return result05i.records[0].Id;
  }

  private async query08cFrom05i(package05i: string): Promise<string> {
    const query08c = `SELECT Id FROM Package2VersionCreateRequest WHERE Package2VersionId = '${package05i}'`;
    const result08c = await this.connection.tooling.query<{ Id: string }>(query08c);
    if (result08c.records?.length !== 1) {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }
    return result08c.records[0].Id;
  }

  private isValidPackageVersion(): boolean {
    if (!this.resolvedPackageVersionCreateRequestId) {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }

    return true;
  }

  private async verifyCreateRequesIdExistsOnDevHub(): Promise<boolean> {
    const query = `${SELECT_PACKAGE_VERSION_DEPENDENCY} WHERE Id = '${this.resolvedPackageVersionCreateRequestId}'`;
    const result = await this.connection.tooling.query<{
      CalcTransitiveDependencies: boolean;
      DependencyGraphJson: string | null;
    }>(query);
    if (result.records?.length === 0) {
      throw messages.createError('invalidPackageVersionIdError', [this.userPackageVersionId]);
    }
    return true;
  }

  private async isTransitiveDependenciesCalculated(): Promise<boolean> {
    if (await this.verifyCreateRequesIdExistsOnDevHub()) {
      const query = `${SELECT_PACKAGE_VERSION_DEPENDENCY} WHERE Id = '${this.resolvedPackageVersionCreateRequestId}'`;
      const result = await this.connection.tooling.query<{
        CalcTransitiveDependencies: boolean;
        DependencyGraphJson: string | null;
      }>(query);
      if (result.records?.length === 1) {
        const record = result.records[0];

        if (record.CalcTransitiveDependencies === true) {
          if (record.DependencyGraphJson != null) {
            return true;
          } else {
            throw messages.createError('invalidDependencyGraphError');
          }
        }
      }
    }

    return false;
  }
}

export class DependencyDotProducer {
  private dependencyGraphString: string;
  private verbose: boolean;
  private edgeDirection: 'root-first' | 'root-last';
  private resolvedPackageVersionId: string;
  private subscriberPackageVersionId: string;
  private connection: Connection;
  private dependencyGraphData!: DependencyGraphData;
  private selectedNodeIds: string[] = [];

  public constructor(
    connection: Connection,
    dependencyGraphString: string,
    verbose: boolean,
    edgeDirection: 'root-first' | 'root-last',
    resolvedPackageVersionId: string
  ) {
    this.verbose = verbose;
    this.edgeDirection = edgeDirection;
    this.resolvedPackageVersionId = resolvedPackageVersionId;
    this.connection = connection;
    this.dependencyGraphString = dependencyGraphString;
    this.subscriberPackageVersionId = VERSION_BEING_BUILT;
  }

  private static throwErrorOnInvalidRecord(record: Record<string, unknown>): void {
    if (!Object.values(record).every((value) => value !== null)) {
      throw messages.createError('invalidDependencyGraphError');
    }
  }

  public async init(): Promise<void> {
    const dependencyGraphJson = JSON.parse(this.dependencyGraphString) as {
      creator: string;
      nodes: Array<{ id: string }>;
      edges: Array<{ source: string; target: string }>;
    };

    this.dependencyGraphData = {
      creator: dependencyGraphJson.creator,
      nodes: await this.createDependencyGraphNodes(dependencyGraphJson.nodes),
      edges: this.createDependencyGraphEdges(dependencyGraphJson.edges),
    };

    this.selectedNodeIds = await this.addSelectedNodeIds();
  }

  public produce(): string {
    const dotLines: string[] = [];
    for (const node of this.dependencyGraphData.nodes) {
      dotLines.push(this.buildDotNode(node));
    }
    for (const edge of this.dependencyGraphData.edges) {
      dotLines.push(this.buildDotEdge(edge));
    }
    return `strict digraph G {${EOL}${dotLines.join(EOL)}${EOL}}`;
  }

  private async addSelectedNodeIds(): Promise<string[]> {
    const selectedNodes: string[] = [];
    if (this.subscriberPackageVersionId === VERSION_BEING_BUILT) {
      selectedNodes.push(this.subscriberPackageVersionId);
    } else if (this.subscriberPackageVersionId.startsWith('04t')) {
      selectedNodes.push(this.subscriberPackageVersionId);
      const query = `SELECT Dependencies FROM SubscriberPackageVersion WHERE Id = '${this.subscriberPackageVersionId}'`;
      try {
        const result = await this.connection.tooling.query<{
          Dependencies: { ids: Array<{ subscriberPackageVersionId: string }> } | null;
        }>(query);
        if (result.records?.length !== 1) {
          return selectedNodes;
        }

        const dependencies = result.records[0].Dependencies;
        if (!dependencies) {
          return selectedNodes;
        }

        if (dependencies.ids && Array.isArray(dependencies.ids)) {
          const dependencyIds = dependencies.ids
            .map((dep) => dep.subscriberPackageVersionId)
            .filter((id) => id && typeof id === 'string' && id.startsWith('04t'));
          selectedNodes.push(...dependencyIds);
        }
      } catch (error) {
        throw messages.createError('invalidPackageVersionIdError', [this.subscriberPackageVersionId]);
      }
    }

    return selectedNodes;
  }

  private async createDependencyGraphNodes(jsonNodes: Array<{ id: string }>): Promise<DependencyGraphNode[]> {
    const nodePromises = jsonNodes.map(async (node) => this.createSingleDependencyGraphNode(node.id));
    const resolvedNodes = await Promise.all(nodePromises);
    return resolvedNodes;
  }

  /**
   * Creates a single dependency graph node.
   * All nodes in the json are 04t... or VERSION_BEING_BUILT and requires different queries to create the node
   */
  private async createSingleDependencyGraphNode(nodeId: string): Promise<DependencyGraphNode> {
    const isVersionBeingCreatedNode = nodeId === VERSION_BEING_BUILT;
    const isSubscriberPackageVersionId = nodeId.startsWith('04t');
    if (!isVersionBeingCreatedNode && !isSubscriberPackageVersionId) {
      throw messages.createError('invalidDependencyGraphError');
    }
    if (isVersionBeingCreatedNode) {
      return this.createVersionBeingBuiltNode(nodeId);
    }
    return this.createNormalDependencyNode(nodeId);
  }

  private async createVersionBeingBuiltNode(nodeId: string): Promise<DependencyGraphNode> {
    let subscriberPackageVersionId = nodeId;
    let MajorVersion = 0;
    let MinorVersion = 0;
    let PatchVersion = 0;
    let BuildNumber = 0;
    const nodeQuery = `SELECT Package2Version.SubscriberPackageVersionId, Package2.Name, 
      Package2Version.MajorVersion, Package2Version.MinorVersion, 
      Package2Version.PatchVersion, Package2Version.BuildNumber 
      FROM Package2VersionCreateRequest WHERE Id = '${this.resolvedPackageVersionId}'`;
    const nodeResult = await this.connection.tooling.query<{
      Package2: {
        Name: string;
      };
      Package2Version: {
        SubscriberPackageVersionId: string;
        MajorVersion: number;
        MinorVersion: number;
        PatchVersion: number;
        BuildNumber: number;
      };
    }>(nodeQuery);
    if (nodeResult.records?.length !== 1) {
      throw messages.createError('invalidDependencyGraphError');
    }
    const record = nodeResult.records[0];
    if (!record.Package2?.Name) {
      throw messages.createError('invalidDependencyGraphError');
    }
    const packageName = record.Package2.Name;
    // sets the version number correctly and version id to 04t if it exists
    if (record.Package2Version?.SubscriberPackageVersionId) {
      DependencyDotProducer.throwErrorOnInvalidRecord(record.Package2Version);
      subscriberPackageVersionId = record.Package2Version.SubscriberPackageVersionId;
      this.subscriberPackageVersionId = subscriberPackageVersionId;
      MajorVersion = record.Package2Version.MajorVersion;
      MinorVersion = record.Package2Version.MinorVersion;
      PatchVersion = record.Package2Version.PatchVersion;
      BuildNumber = record.Package2Version.BuildNumber;
    }
    return {
      subscriberPackageVersionId,
      packageName,
      version: new VersionNumber(MajorVersion, MinorVersion, PatchVersion, BuildNumber),
    };
  }

  private async createNormalDependencyNode(nodeId: string): Promise<DependencyGraphNode> {
    const subscriberPackageVersionId = nodeId;
    const nodeQuery = `SELECT SubscriberPackageVersionId, Package2.Name, MajorVersion, MinorVersion, PatchVersion, BuildNumber 
      FROM Package2Version WHERE SubscriberPackageVersionId = '${nodeId}'`;
    const nodeResult = await this.connection.tooling.query<{
      SubscriberPackageVersionId: string;
      Package2: {
        Name: string;
      };
      MajorVersion: number;
      MinorVersion: number;
      PatchVersion: number;
      BuildNumber: number;
    }>(nodeQuery);
    if (nodeResult.records?.length !== 1) {
      throw messages.createError('invalidDependencyGraphError');
    }
    const record = nodeResult.records[0];
    DependencyDotProducer.throwErrorOnInvalidRecord(record);
    return {
      subscriberPackageVersionId,
      packageName: record.Package2.Name,
      version: new VersionNumber(record.MajorVersion, record.MinorVersion, record.PatchVersion, record.BuildNumber),
    };
  }

  private createDependencyGraphEdges(jsonEdges: Array<{ source: string; target: string }>): DependencyGraphEdge[] {
    const edges: DependencyGraphEdge[] = [];
    for (const edge of jsonEdges) {
      let source = edge.source;
      let target = edge.target;
      if (!source || !target) {
        throw messages.createError('invalidDependencyGraphError');
      }
      if (source === VERSION_BEING_BUILT) {
        source = this.subscriberPackageVersionId;
      }
      if (target === VERSION_BEING_BUILT) {
        target = this.subscriberPackageVersionId;
      }
      edges.push({ source, target });
    }
    return edges;
  }

  /**
   * Builds a DOT node with a label containing the package name and version
   *
   * @param node the node id and label
   */
  private buildDotNode(node: DependencyGraphNode): string {
    const nodeId = node.subscriberPackageVersionId;
    let label: string;
    // Include subscriber package version id in label based on verbose flag
    if (node.subscriberPackageVersionId === VERSION_BEING_BUILT) {
      label = `${node.packageName}@${VERSION_BEING_BUILT}`;
    } else {
      label = `${node.packageName}@${node.version.toString()}`;
    }

    if (this.verbose) {
      label += ` (${node.subscriberPackageVersionId})`;
    }

    const color = this.addColorToSelectedNode(node);
    return `\t node_${nodeId} [label="${label}"${color}]`;
  }

  private addColorToSelectedNode(node: DependencyGraphNode): string {
    if (this.selectedNodeIds.includes(node.subscriberPackageVersionId)) {
      return ' color="green"';
    }
    return '';
  }

  /**
   * Builds a DOT edge line of the form fromNode -> toNode
   *
   * @param edge the edge to build where the target node depends on the source node in the json
   */
  private buildDotEdge(edge: DependencyGraphEdge): string {
    const sourceNodeId = edge.source;
    const targetNodeId = edge.target;
    if (!sourceNodeId || !targetNodeId) {
      throw messages.createError('invalidDependencyGraphError');
    }
    // Handle edge direction based on the flag
    if (this.edgeDirection === 'root-last') {
      return `\t node_${sourceNodeId} -> node_${targetNodeId}`;
    }
    return `\t node_${targetNodeId} -> node_${sourceNodeId}`;
  }
}

/**
 * A class that represents a package dependency node.
 * Given a PackageRequestId (08c), PackageName, SubscriberPackageVersionId (04t), and version (MajorVersion.MinorVersion.PatchVersion.BuildNumber) it will build a node of the package dependency.
 */
export class PackageDependencyNode extends AsyncCreatable<DependencyGraphNode> {
  public readonly packageName: string;
  public readonly subscriberPackageVersionId: string;
  public readonly version: VersionNumber;

  public constructor(public options: DependencyGraphNode) {
    super(options);
    this.packageName = options.packageName;
    this.subscriberPackageVersionId = options.subscriberPackageVersionId;
    this.version = new VersionNumber(
      this.options.version.major,
      this.options.version.minor,
      this.options.version.patch,
      this.options.version.build
    );
  }

  public getVersion(): string {
    return this.version.toString();
  }

  // eslint-disable-next-line class-methods-use-this
  protected init(): Promise<void> {
    return Promise.resolve();
  }
}
