# topicHelp

develop, install, and manage packages

# topicHelpLong

Use the package commands to develop, install, and manage packages.

# createdLastDaysDescription

created in the last specified number of days (starting at 00:00:00 of first day to now; 0 for today)

# createdLastDaysLongDescription

Filters the list based on the specified maximum number of days since the request was created (starting at 00:00:00 of first day to now; 0 for today).

# modifiedLastDaysDescription

list items modified in the specified last number of days (starting at 00:00:00 of first day to now; 0 for today)

# modifiedLastDaysLongDescription

Lists the items modified in the specified last number of days, starting at 00:00:00 of first day to now. Use 0 for today.

# invalidIdOrAlias

The %s: %s isn't defined in the sfdx-project.json. Add it to the packageDirectories section and add the alias to packageAliases with its %s ID.

# invalidDaysNumber

Provide a valid positive number for %s.

# invalidStatus

Invalid status '%s'. Please provide one of these statuses: %s

# packageNotEnabledAction

Packaging is not enabled on this org. Verify that you are authenticated to the desired org and try again. Otherwise, contact Salesforce Customer Support for more information.

# packageInstanceNotEnabled

Your org does not have permission to specify a build instance for your package version. Verify that you are authenticated to the desired org and try again. Otherwise, contact Salesforce Customer Support for more information.

# packageSourceOrgNotEnabled

Your Dev Hub does not have permission to specify a source org for your build org. Verify that you are authenticated to the correct Dev Hub and try again. Otherwise, contact Salesforce Customer Support for assistance.

# installStatus

Waiting for the package install request to complete. Status = %s

# errorMissingVersionNumber

The VersionNumber property must be specified.

# errorInvalidMajorMinorPatchNumber

VersionNumber parts major, minor or patch must be a number but the value found is [%s].

# errorInvalidVersionNumber

VersionNumber must be in the format major.minor.patch.build but the value found is [%s].

# errorInvalidBuildNumber

The provided VersionNumber '%s' is invalid. Provide an integer value or use the keyword '%s' for the build number.

# errorInvalidBuildNumberToken

The provided VersionNumber '%s' is invalid. Build number token must be a number or one of these tokens '%s'.

# errorInvalidBuildNumberForKeywords

The provided VersionNumber '%s' is invalid. Provide an integer value or use the keyword '%s' or '%s' for the build number.

# errorInvalidPatchNumber

The provided VersionNumber '%s' is not supported. Provide a patch number of 0.

# errorInvalidMajorMinorNumber

The provided VersionNumber '%s' is invalid. Provide an integer value for the %s number.

# errorInvalidAncestorVersionFormat

The ancestor versionNumber must be in the format major.minor.patch but the value found is [%s].

# errorNoMatchingMajorMinorForPatch

Can???t create patch version. The specified package ancestor [%s] either isn???t a promoted and released version, or can???t be found. Check the specified ancestor version, and then retry creating the patch version.

# errorNoMatchingAncestor

The ancestorId for ancestorVersion [%s] can't be found. Package ID [%s].

# errorAncestorNotReleased

The ancestor package version [%s] specified in the sfdx-project.json file hasn???t been promoted and released. Release the ancestor package version before specifying it as the ancestor in a new package or patch version.

# errorAncestorNotHighest

Can???t create package version. The ancestor version [%s] you specified isn???t the highest released package version. Set the ancestor version to %s, and try creating the package version again. You can also specify --skipancestorcheck to override the ancestry requirement.

# errorAncestorNoneNotAllowed

Can???t create package version because you didn???t specify a package ancestor. Set the ancestor version to %s, and try creating the package version. You can also specify --skipancestorcheck to override the ancestry requirement.

# errorAncestorIdVersionMismatch

Can???t create package version. The ancestorVersion listed in your sfdx-project.json file doesn???t map to this package. Ensure the ancestor ID is correct, or set the ID to ancestorID:HIGHEST to ensure the highest released package version is used as the ancestor. Then try creating the package version again.

# errorAncestorIdVersionHighestOrNoneMismatch

Can???t create package version. The ancestorId [%s] and ancestorVersion [%s] in your sfdx-project.json file don???t map to the same package version. Remove the incorrect entry, and try creating the package version again.

# errorpackageAncestorIdsKeyNotSupported

The package2AncestorIds key is no longer supported in a scratch org definition. Ancestors defined in sfdx-project.json will be included in the scratch org.

# errorInvalidIdNoMatchingVersionId

The %s %s is invalid, as a corresponding %s was not found

# errorIdTypeMismatch

ID type mismatch: an ID of type %s is required, but an ID of type %s was specified: %s

# updatedSfProject

sfdx-project.json has been updated.

# errorSfProjectFileWrite

sfdx-project.json could not be updated with the following entry for this package:
%s
Reason: %s

# invalidPackageTypeAction

Specify Unlocked or Managed for package type.

# invalidPackageTypeMessage

Invalid package type

# idNotFoundAction

It`s possible that this package was created on a different Dev Hub. Authenticate to the Dev Hub org that owns the package, and reference that Dev Hub when running the command.

# malformedPackageVersionIdAction

Use "sfdx force:package:version:list" to verify the 05i package version ID.

# malformedPackageVersionIdMessage

We can???t find this package version ID for this Dev Hub.

# malformedPackageIdAction

Use "sfdx force:package:list" to verify the 0Ho package version ID.

# malformedPackageIdMessage

We can???t find this package ID for this Dev Hub.

# notFoundMessage

The requested resource does not exist

# errorMoreThanOnePackage2WithSeed

Only one package in a Dev Hub is allowed per converted from first-generation package, but the following were found:
%s

# versionCreateFailedWithMultipleErrors

Multiple errors occurred:

# errorScriptsNotApplicableToUnlockedPackage

We can???t create the package version. This parameter is available only for second-generation managed packages. Create the package version without the postinstallscript or uninstallscript parameters.,

# errorAncestorNotApplicableToUnlockedPackage

Can???t create package version. Specifying an ancestor is available only for second-generation managed packages. Remove the ancestorId or ancestorVersion from your sfdx-project.json file, and then create the package version again.,

# itemDoesNotFitWithinMaxLength

When calculating the number of items to be included in query "%s", when formatted, was too long.
The item was (truncated): %s with a length of %s. The maximum length of items, when formatted is %s.

# unableToFindPackageWithId

Unable to find Package with Id: "%s"

# errorDuringSObjectCRUDOperation

An error occurred during CRUD operation %s on entity %s.
%s

# errorNoMatchingPackageDirectory

The %s value [%s], doesn???t match the %s value in any packageDirectories specified in sfdx-project.json.

# errorDirectoryIdMismatch

The %s value, [%s], and %s value, [%s], were both found in sfdx-project.json but don???t match. If you supply both values, they must match the path and package values in one of the packageDirectories.,

# tempFileLocation

The temp files are located at: %s.

# failedToCreatePVCRequest

Failed to create request %s: %s

# versionNumberNotFoundInDevHub

No version number was found in Dev Hub for package id %s and branch %s and version number %s that resolved to build number %s.

# noReleaseVersionFound

No released version was found in Dev Hub for package id %s and version number %s.

# noReleaseVersionFoundForBranch

No version number was found in Dev Hub for package id $s and branch %s and version number %s.

# packagingDirNotFoundInConfigFile

Config file %s does not contain a packaging directory for %s.

# unpackagedMDDirectoryDoesNotExist

Un-packaged metadata directory %s was specified but does not exist.

# directoryDoesNotExist

Directory %s does not exist.
