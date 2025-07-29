# invalidPackageVersionIdError

Can't display package dependencies. The package version ID %s you specified is invalid. Review the package version ID and then retry this command.

# transitiveDependenciesRequiredError

Can't display package dependencies. To display package dependencies, you must first add the calculateTransitiveDependencies parameter to the sfdx-project.json file, and set the value to "true". Next, create a new package version and then run this command using the 04t ID for the new package version.

# invalidDependencyGraphError

Can't display package dependencies. There's an issue generating the dependency graph. Before retrying this command, make sure you added the calculateTransitiveDependencies parameter to the sfdx-project.json file and set the value to "true". After setting the attribute and before retrying this command, you must create a new package version.
