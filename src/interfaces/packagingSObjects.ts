/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export namespace PackagingSObjects {
  export type Package2 = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    SubscriberPackageId: string;
    Name: string;
    Description: string;
    NamespacePrefix: string;
    ContainerOptions: string;
    IsDeprecated: boolean;
    IsOrgDependent: boolean;
    ConvertedFromPackageId: string;
    PackageErrorUsername: string;
  };

  export type Package2Version = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    Package2Id: string;
    SubscriberPackageVersionId: string;
    Tag: string;
    Branch: string;
    AncestorId: string;
    ValidationSkipped: boolean;
    Name: string;
    Description: string;
    MajorVersion: number;
    MinorVersion: number;
    PatchVersion: number;
    BuildNumber: number;
    IsDeprecated: boolean;
    IsPasswordProtected: boolean;
    CodeCoverage: unknown;
    HasPassedCodeCoverageCheck: boolean;
    InstallKey: string;
    IsReleased: boolean;
    ConvertedFromVersionId: string;
    ReleaseVersion: number;
    BuildDurationInSeconds: number;
    HasMetadataRemoved: boolean;
  };

  export enum Package2VersionStatus {
    queued = 'Queued',
    inProgress = 'InProgress',
    success = 'Success',
    error = 'Error',
  }

  export type Package2VersionCreateRequest = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    Package2Id: string;
    Package2VersionId: string;
    Tag: string;
    Branch: string;
    Status: Package2VersionStatus;
    Instance: string;
    IsPasswordProtected: boolean;
    InstallKey: string;
    CalculateCodeCoverage: boolean;
    SkipValidation: boolean;
    IsConversionRequest: boolean;
    VersionInfo: string;
  };
  export type Package2VersionCreateRequestError = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    ParentRequestId: string;
    Message: string;
  };

  export type SubscriberPackage = {
    Id: string;
    Name: string;
    NamespacePrefix: string;
    Description: string;
    IsPackageValid: boolean;
  };

  export type SubscriberPackageVersion = {
    Id: string;
    SubscriberPackageId: string;
    Name: string;
    Description: string;
    PublisherName: string;
    MajorVersion: number;
    MinorVersion: number;
    PatchVersion: number;
    BuildNumber: number;
    ReleaseState: string;
    IsManaged: boolean;
    IsDeprecated: boolean;
    IsPasswordProtected: boolean;
    IsBeta: boolean;
    Package2ContainerOptions: string;
    IsSecurityReviewed: boolean;
    IsOrgDependent: boolean;
    AppExchangePackageName: string;
    AppExchangeDescription: string;
    AppExchangePublisherName: string;
    AppExchangeLogoUrl: string;
    ReleaseNotesUrl: string;
    PostInstallUrl: string;
    RemoteSiteSettings: unknown;
    CspTrustedSites: unknown;
    Profiles: unknown;
    Dependencies: unknown;
    InstallValidationStatus: string;
  };

  export type SubscriberPackageVersionUninstallRequest = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    SubscriberPackageVersionId: string;
    Status: string;
  };

  export type PackageVersionUninstallRequestError = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    SubscriberPackageVersionId: string;
    Status: string;
  };

  export type PackageInstallRequest = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    SubscriberPackageVersionKey: string;
    NameConflictResolution: string;
    SecurityType: string;
    PackageInstallSource: string;
    ProfileMappings: unknown;
    Password: string;
    EnableRss: boolean;
    UpgradeType: string;
    ApexCompileType: string;
    Status: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Errors: any[];
  };

  export type PackageUploadRequest = {
    Id: string;
    IsDeleted: boolean;
    CreatedDate: number;
    CreatedById: string;
    LastModifiedDate: number;
    LastModifiedById: string;
    SystemModstamp: number;
    MetadataPackageId: string;
    MetadataPackageVersionId: string;
    IsReleaseVersion: boolean;
    VersionName: string;
    Description: string;
    MajorVersion: number;
    MinorVersion: number;
    ReleaseNotesUrl: string;
    PostInstallUrl: string;
    Password: string;
    Status: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Errors: any[];
  };

  export type InstalledSubscriberPackageVersion = {
    Id: string;
    SubscriberPackageId: string;
    Name: string;
    Description: string;
    PublisherName: string;
    MajorVersion: number;
    MinorVersion: number;
    PatchVersion: number;
    BuildNumber: number;
    ReleaseState: string;
    IsManaged: boolean;
    IsDeprecated: boolean;
    IsPasswordProtected: boolean;
    IsBeta: boolean;
    Package2ContainerOptions: string;
    IsSecurityReviewed: boolean;
    IsOrgDependent: boolean;
    AppExchangePackageName: string;
    AppExchangeDescription: string;
    AppExchangePublisherName: string;
    AppExchangeLogoUrl: string;
    ReleaseNotesUrl: string;
    PostInstallUrl: string;
    RemoteSiteSettings: unknown;
    CspTrustedSites: unknown;
    Profiles: unknown;
    Dependencies: unknown;
    InstallValidationStatus: string;
  };

  export type InstalledSubscriberPackage = {
    Id: string;
    SubscriberPackageId: string;
    SubscriberPackageVersionId: string;
    MinPackageVersionId: string;
  };

  export type MetadataPackageVersion = {
    Id: string;
    MetadataPackageId: string;
    Name: string;
    ReleaseState: 'Beta' | 'Released';
    MajorVersion: number;
    MinorVersion: number;
    PatchVersion: number;
    BuildNumber: number;
    IsDeprecated: boolean;
  };
}
