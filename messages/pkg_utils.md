# errorNoSubscriberPackageRecord

No subscriber package was found for seed id: %s'

# errorDuringSObjectCRUDOperation

An error occurred during CRUD operation %s on entity %s.
%s

# errorInvalidPatchNumber

The provided VersionNumber '%s' is not supported. Provide a patch number of 0.

# errorInvalidAncestorVersionFormat

The ancestor versionNumber must be in the format major.minor.patch but the value found is [%s].

# errorNoMatchingMajorMinorForPatch

Can’t create patch version. The specified package ancestor [%s] either isn’t a promoted and released version, or can’t be found. Check the specified ancestor version, and then retry creating the patch version.

# errorNoMatchingAncestor

The ancestorId for ancestorVersion [%s] can't be found. Package ID [%s].

# errorAncestorNotReleased

The ancestor package version [%s] specified in the sfdx-project.json file hasn’t been promoted and released. Release the ancestor package version before specifying it as the ancestor in a new package or patch version.

# errorAncestorIdVersionMismatch

Can’t create package version. The ancestorVersion listed in your sfdx-project.json file doesn’t map to this package. Ensure the ancestor ID is correct, or set the ID to ancestorID:HIGHEST to ensure the highest released package version is used as the ancestor. Then try creating the package version again.

# errorAncestorIdVersionHighestOrNoneMismatch

Can’t create package version. The ancestorId [%s] and ancestorVersion [%s] in your sfdx-project.json file don’t map to the same package version. Remove the incorrect entry, and try creating the package version again.

# errorInvalidIdNoMatchingVersionId

The %s %s is invalid, as a corresponding %s was not found

# invalidPackageTypeAction

Specify Unlocked or Managed for package type.

# invalidPackageTypeMessage

Invalid package type

# idNotFoundAction

It`s possible that this package was created on a different Dev Hub. Authenticate to the Dev Hub org that owns the package, and reference that Dev Hub when running the command.

# malformedPackageVersionIdAction

Use "sfdx force:package:version:list" to verify the 05i package version ID.

# malformedPackageVersionIdMessage

We can’t find this package version ID for this Dev Hub.

# malformedPackageIdAction

Use "sfdx force:package:list" to verify the 0Ho package version ID.

# malformedPackageIdMessage

We can’t find this package ID for this Dev Hub.

# notFoundMessage

The requested resource does not exist

# errorMoreThanOnePackage2WithSeed

Only one package in a Dev Hub is allowed per converted from first-generation package, but the following were found:
%s

# versionCreateFailedWithMultipleErrors

Multiple errors occurred:

# itemDoesNotFitWithinMaxLength

When calculating the number of items to be included in query "%s", when formatted, was too long.
The item was (truncated): %s with a length of %s. The maximum length of items, when formatted is %s.

# packageNotEnabledAction

Packaging is not enabled on this org. Verify that you are authenticated to the desired org and try again. Otherwise, contact Salesforce Customer Support for more information.

# packageInstanceNotEnabled

Your org does not have permission to specify a build instance for your package version. Verify that you are authenticated to the desired org and try again. Otherwise, contact Salesforce Customer Support for more information.

# packageSourceOrgNotEnabled

Your Dev Hub does not have permission to specify a source org for your build org. Verify that you are authenticated to the correct Dev Hub and try again. Otherwise, contact Salesforce Customer Support for assistance.

# invalidIdOrAlias

The %s: %s isn't defined in the sfdx-project.json. Add it to the packageDirectories section and add the alias to packageAliases with its %s ID.
