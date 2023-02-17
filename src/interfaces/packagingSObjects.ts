/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Nullable } from '@salesforce/ts-types';
import { CodeCoverage, CodeCoveragePercentages, PackageType } from './packagingInterfacesAndType';

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
    CodeCoverage: CodeCoverage;
    CodeCoveragePercentages: CodeCoveragePercentages;
    HasPassedCodeCoverageCheck: boolean;
    InstallKey: string;
    IsReleased: boolean;
    ConvertedFromVersionId: string;
    ReleaseVersion: number;
    BuildDurationInSeconds: number;
    HasMetadataRemoved: boolean;
    Language: string;
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
    Language: string;
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
    ids: Array<{ subscriberPackageVersionId: string }>;
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

  export type InstallValidationStatus =
    | 'NO_ERRORS_DETECTED'
    | 'BETA_INSTALL_INTO_PRODUCTION_ORG'
    | 'CANNOT_INSTALL_EARLIER_VERSION'
    | 'CANNOT_UPGRADE_BETA'
    | 'CANNOT_UPGRADE_UNMANAGED'
    | 'DEPRECATED_INSTALL_PACKAGE'
    | 'EXTENSIONS_ON_LOCAL_PACKAGES'
    | 'PACKAGE_NOT_INSTALLED'
    | 'PACKAGE_HAS_IN_DEV_EXTENSIONS'
    | 'INSTALL_INTO_DEV_ORG'
    | 'NO_ACCESS'
    | 'PACKAGING_DISABLED'
    | 'PACKAGING_NO_ACCESS'
    | 'PACKAGE_UNAVAILABLE'
    | 'UNINSTALL_IN_PROGRESS'
    | 'UNKNOWN_ERROR'
    | 'NAMESPACE_COLLISION';

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
    Package2ContainerOptions: PackageType;
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
    InstallValidationStatus: InstallValidationStatus;
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
    Status: 'Error' | 'InProgress' | 'Queued' | 'Success';
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

  export type Attributes = {
    type: string;
    url: string;
  };

  export type PackageInstallRequest = {
    attributes: Attributes;
    Id: string;
    IsDeleted: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
    SystemModstamp: string;
    SubscriberPackageVersionKey: string;
    NameConflictResolution: 'Block' | 'RenameMetadata';
    SecurityType: 'Custom' | 'Full' | 'None';
    PackageInstallSource: string;
    ProfileMappings: Nullable<SubscriberPackageProfileMappings>;
    Password: Nullable<string>;
    EnableRss: boolean;
    UpgradeType: Nullable<'delete-only' | 'deprecate-only' | 'mixed-mode'>;
    ApexCompileType: Nullable<'all' | 'package'>;
    SkipHandlers: string;
    Status: 'ERROR' | 'IN_PROGRESS' | 'SUCCESS' | 'UNKNOWN';
    Errors: Nullable<SubscriberPackageInstallErrors>;
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
