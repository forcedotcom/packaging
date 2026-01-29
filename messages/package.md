# invalidPackageId

The id [%s] is invalid. It must start with "%s".

# defaultErrorMessage

Can't uninstall the package %s during uninstall request %s.

# action

Verify installed package ID and resolve errors, then try again.

# couldNotFindAliasForId

Could not find an alias for the ID %s.

# packageAliasNotFound

Package alias %s not found in project.

# packageNotFound

A package with id %s was not found.

# appAnalyticsEnabledApiPriorTo59Error

Enabling App Analytics is only possible with API version 59.0 or higher.

# sourcesDownloadDirectoryNotEmpty

Can't retrieve package version metadata. The specified directory isn't empty. Empty the directory, or create a new one and try again.

# sourcesDownloadDirectoryMustBeRelative

Can't retrieve package version metadata. The specified directory must be relative to your Salesforce DX project directory, and not an absolute path.

# developerUsePkgZipFieldUnavailable

Can't retrieve package metadata. To use this feature, you must first assign yourself the DownloadPackageVersionZips user permission. Then retry retrieving your package metadata.

# downloadDeveloperPackageZipHasNoData

Can't retrieve package metadata. Package metadata is only generated for converted 2GP package versions and versions created with the --dev-use-pkg-zip flag. To resolve, create a new package version and retry. For native 2GP packages, include the --dev-use-pkg-zip flag when creating the version. If your package is a 1GP, first convert it to 2GP.

# packagingNotEnabledOnOrg

Can't retrieve package metadata. The org you specified doesn't have the required second-generation packaging permission enabled. Enable this permission on your Dev Hub org, and try again.

# recommendedVersionIdApiPriorTo66Error

To enable Recommended Version, use API version 66.0 or higher.

# skipAncestorCheckRequiresRecommendedVersionIdError

The skip ancestor check requires a recommended version ID.

# noPackageVersionsForGivenPackage2FoundError

No package versions were found for the given Package 2 ID (0Ho). At least one released package version must exist.

# recommendedVersionNotAncestorOfPriorVersionError

The new recommended version is not a descendant of the previous recommended version. To bypass this check, use the --skip-ancestor-check CLI flag.

# invalidRecommendedVersionError

Provide a valid subscriber package version (04t) for the recommended version.

# unassociatedRecommendedVersionError

The provided recommended version isn't associated with this package.
