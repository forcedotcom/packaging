# errorPackageAndPackageIdCollision

You can’t have both "package" and "packageId" (deprecated) defined as dependencies in sfdx-project.json.

# errorPackageOrPackageIdMissing

You must provide either "package" or "packageId" (deprecated) defined as dependencies in sfdx-project.json.

# errorDependencyPair

Dependency must specify either a subscriberPackageVersionId or both packageId and versionNumber: %s

# errorNoIdInHub

No package ID was found in Dev Hub for package ID: %s.

# versionNumberNotFoundInDevHub

No version number was found in Dev Hub for package id %s and branch %s and version number %s that resolved to build number %s.

# buildNumberResolvedForLatest

Dependency on package %s was resolved to version number %s, branch %s, %s.

# buildNumberResolvedForReleased

Dependency on package %s was resolved to the released version number %s, %s.

# noReleaseVersionFound

No released version was found in Dev Hub for package id %s and version number %s.

# noReleaseVersionFoundForBranch

No version number was found in Dev Hub for package id %s and branch %s and version number %s.

# tempFileLocation

The temp files are located at: %s.

# signupDuplicateSettingsSpecified

You cannot use 'settings' and 'orgPreferences' in your scratch definition file, please specify one or the other.

# errorReadingDefintionFile

There was an error while reading or parsing the provided scratch definition file: %s

# seedMDDirectoryDoesNotExist

Seed metadata directory %s was specified but does not exist.

# unpackagedMDDirectoryDoesNotExist

Un-packaged metadata directory %s was specified but does not exist.

# errorEmptyPackageDirs

sfdx-project.json must contain a packageDirectories entry for a package. You can run the force:package:create command to auto-populate such an entry.

# failedToCreatePVCRequest

Failed to create request %s: %s

# errorScriptsNotApplicableToUnlockedPackage

We can’t create the package version. This parameter is available only for second-generation managed packages. Create the package version without the postinstallscript or uninstallscript parameters.

# errorAncestorNotApplicableToUnlockedPackage

Can’t create package version. Specifying an ancestor is available only for second-generation managed packages. Remove the ancestorId or ancestorVersion from your sfdx-project.json file, and then create the package version again.

# defaultVersionName

versionName is blank in sfdx-project.json, so it will be set to this default value based on the versionNumber: %s

# malformedUrl

The %s value "%s" from the command line or sfdx-project.json is not in the correct format for a URL. It must be a valid URL in the format "http://salesforce.com". More information: https://nodejs.org/api/url.html#url_url_strings_and_url_objects

# versionCreateFailedWithMultipleErrors

Multiple errors occurred:

# invalidDaysNumber

Provide a valid positive number for %s. %d

# errorAncestorNoneNotAllowed

Can’t create package version because you didn’t specify a package ancestor. Set the ancestor version to %s, and try creating the package version. You can also specify --skipancestorcheck to override the ancestry requirement.

# errorAncestorNotHighest

Can’t create package version. The ancestor version [%s] you specified isn’t the highest released package version. Set the ancestor version to %s, and try creating the package version again. You can also specify --skipancestorcheck to override the ancestry requirement.

# errorInvalidBuildNumberForKeywords

The provided VersionNumber '%s' is invalid. Provide an integer value or use the keyword '%s' or '%s' for the build number.

# errorInvalidBuildNumber

The provided VersionNumber '%s' is invalid. Provide an integer value or use the keyword '%s' for the build number.

# errorNoSubscriberPackageRecord

No subscriber package was found for seed id: %s

# errorMoreThanOnePackage2WithSeed

Only one package in a Dev Hub is allowed per converted from first-generation package, but the following were found:
%s

# errorMissingPackageIdOrPath

You must specify either a package ID or a package path to create a new package version.

# errorMissingPackage

The package "%s" isn’t defined in the sfdx-project.json file. Add it to the packageDirectories section and add the alias to packageAliases with its 0Ho ID.

# errorCouldNotFindPackageUsingPath

Could not find a package in sfdx-project.json file using "path" %s. Add it to the packageDirectories section and add the alias to packageAliases with its 0Ho ID.

# errorCouldNotFindPackageDir

Couldn't find a package directory for package using %s %s. Add it to the packageDirectories section and add the alias to packageAliases with its 0Ho ID.

# noSourceInRootDirectory

No matching source was found within the package root directory: %s

# packageXmlDoesNotContainPackage

While preparing package version create request, the calculated package.xml for the package does not contain a <Package> element.

# packageXmlDoesNotContainPackageTypes

While preparing package version create request, the calculated package.xml for the package does not contain a <Package><types> element.

# errorInvalidPatchNumber

Patch version node for version, %s, must be 0 for a Locked package.

# errorAncestorIdVersionHighestOrNoneMismatch

Both ancestorId (%s) and ancestorVersion (%s) specified, HIGHEST and/or NONE are used, the values disagree

# errorInvalidAncestorVersionFormat

The given ancestorVersion (%s) is not in the correct format

# errorNoMatchingAncestor

No matching ancestor found for the given ancestorVersion (%s) in package %s

# errorAncestorNotReleased

The given ancestor version (%s) has not been released

# errorAncestorIdVersionMismatch

No matching ancestor version (%s) found for the given ancestorId (%s)

# errorNoMatchingMajorMinorForPatch

No matching major.minor version found for the given patch version (%s)

# errorInvalidPackageId

The provided package ID '%s' is invalid.

# packageIdCannotBeUndefined

The package ID must be defined.

# deploydirCannotBeUndefined

The deploy directory must be defined. Supplied options: %s

# packagePathCannotBeUndefined

The package path must be defined.

# errorMissingPackagePath

The package path is missing. Supplied options: %s

# versionNumberRequired

The version number is required and was not found in the options or in package json descriptor.

# missingConnection

A connection is required.

# IdUnavailableWhenQueued

Request is queued. ID unavailable.

# IdUnavailableWhenInProgress

Request is in progress. ID unavailable.

# IdUnavailableWhenError

ID Unavailable
