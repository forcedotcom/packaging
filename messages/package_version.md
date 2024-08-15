# errorInvalidIdNoMatchingVersionId

The %s %s is invalid, as a corresponding %s was not found

# errorInvalidPackageVersionId

The provided alias or ID: [%s] could not be resolved to a valid package version ID (05i) or subscriber package version ID (04t).

# errorInvalidPackageVersionIdNoProject

The provided alias or ID: [%s] could not be resolved to a valid package version ID (05i) or subscriber package version ID (04t).

# errorInvalidPackageVersionIdNoProject.actions

If you are using a package alias, make sure you are inside your sfdx project and it's defined in the `packageDirectories` section in `sfdx-project.json`

# packageAliasNotFound

The provided package ID: [%s] could not be resolved to an alias.

# createResultIdCannotBeEmpty

The package version create result ID must be defined when checking for completion.

# errorNoSubscriberPackageVersionId

Could not fetch the subscriber package version ID (04t).

# maxPackage2VersionRecords

The maximum result size (2000) was reached when querying the Package2Version SObject. This means there could be more records that were not returned by the query. If all records are required you may have to break the query into multiple requests filtered by date, then aggregate the results.

# errors.RequiresProject

This method expects an sfdx project to be available to write the new package version data in it.
Make sure to pass `options.project` when instantiating `PackageVersion`.
https://forcedotcom.github.io/packaging/classes/package_packageVersion.PackageVersion.html#constructor
