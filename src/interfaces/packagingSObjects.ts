/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { PackageType } from './packagingInterfacesAndType';

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
    ContainerOptions: PackageType;
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
    initializing = 'Initializing',
    verifyingFeaturesAndSettings = 'VerifyingFeaturesAndSettings',
    verifyingDependencies = 'VerifyingDependencies',
    verifyingMetadata = 'VerifyingMetadata',
    finalizingPackageVersion = 'FinalizingPackageVersion',
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
  export type SubscriberPackageDestinationProfile = {
    description: string;
    displayName: string;
    name: string;
    noAccess: boolean;
    profileId: string;
    type: string;
  };
  export type SubscriberPackageSourceProfile = {
    label: string;
    value: string;
  };
  export type SubscriberPackageProfiles = {
    destinationProfiles: SubscriberPackageDestinationProfile[];
    sourceProfiles: SubscriberPackageSourceProfile[];
  };
  export type SubscriberPackageDependencies = {
    ids: string[];
  };

  export type SubscriberPackageRemoteSiteSetting = {
    secure: boolean;
    url: string;
  };

  export type SubscriberPackageRemoteSiteSettings = {
    settings: SubscriberPackageRemoteSiteSetting[];
  };

  export type SubscriberPackageCspTrustedSite = {
    endpointUrl: string;
  };

  export type SubscriberPackageCspTrustedSites = {
    settings: SubscriberPackageCspTrustedSite[];
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
    RemoteSiteSettings: SubscriberPackageRemoteSiteSettings;
    CspTrustedSites: SubscriberPackageCspTrustedSites;
    Profiles: SubscriberPackageProfiles;
    Dependencies: SubscriberPackageDependencies;
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

  export type SubscriberPackageInstallError = {
    message: string;
  };

  export type SubscriberPackageInstallErrors = {
    errors: SubscriberPackageInstallError[];
  };

  export type SubscriberPackageProfileMapping = {
    source: string;
    target: string;
  };

  export type SubscriberPackageProfileMappings = {
    profileMappings: SubscriberPackageProfileMapping[];
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
    NameConflictResolution: 'Block' | 'RenameMetadata';
    SecurityType: 'Custom' | 'Full' | 'None';
    PackageInstallSource: string;
    ProfileMappings: SubscriberPackageProfileMappings;
    Password: string;
    EnableRss: boolean;
    UpgradeType: 'delete-only' | 'deprecate-only' | 'mixed';
    ApexCompileType: 'all' | 'package';
    Status: 'Error' | 'InProgress' | 'Success' | 'Unknown';
    Errors: SubscriberPackageInstallErrors;
  };

  export type PackageInstallCreateRequest = Partial<
    Pick<
      PackagingSObjects.PackageInstallRequest,
      | 'ApexCompileType'
      | 'EnableRss'
      | 'NameConflictResolution'
      | 'PackageInstallSource'
      | 'Password'
      | 'SecurityType'
      | 'UpgradeType'
    >
  > &
    Pick<PackagingSObjects.PackageInstallRequest, 'SubscriberPackageVersionKey'>;

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
