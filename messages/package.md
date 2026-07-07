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

# packageVersionNotFound

Can't retrieve package metadata. We can't find the package version %s. Verify that the 04t ID is correct and that the package version exists.

# packageVersionNotInDevHub

Can't retrieve package metadata. Package version %s isn't accessible from this Dev Hub org. You can only retrieve package metadata from the Dev Hub that created the package version. Verify that you specified the correct target Dev Hub.

# downloadDeveloperPackageZipHasNoDataNative2GP

Can't retrieve package metadata. The developer package zip for this native 2GP package version is unretrievable. To resolve, create a new package version with the --generate-pkg-zip flag. Then retry retrieving your package metadata.

# downloadDeveloperPackageZipHasNoDataConverted2GP

Can't retrieve package metadata. The developer package zip for this converted 2GP package version is unretrievable. To resolve, retry conversion to produce a new converted package version. Then retry retrieving your package metadata.

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
