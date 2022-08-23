# errorPackageAndPackageIdCollision

You can’t have both "package" and "packageId" (deprecated) defined as dependencies in sfdx-project.json.

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

No version number was found in Dev Hub for package id $s and branch %s and version number %s.

# tempFileLocation

The temp files are located at: %s.

# signupDuplicateSettingsSpecified

You cannot use 'settings' and 'orgPreferences' in your scratch definition file, please specify one or the other.

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

# releaseNotesUrl

release notes URL

# postInstallUrl

post-install URL
