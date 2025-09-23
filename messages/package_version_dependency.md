# invalidPackageVersionIdError

Can't display package dependencies. The package version ID %s you specified is invalid. Review the package version ID and then retry this command.

# invalidDependencyGraphError

Can't display package dependencies. There's an issue generating the dependency graph. Before retrying this command, make sure you added the calculateTransitiveDependencies parameter to the sfdx-project.json file and set the value to "true". After setting the attribute and before retrying this command, you must create a new package version.

# noDependencyGraphJsonMustProvideVersion

Can't display package dependencies. This Package2VersionCreateRequest does not have CalcTransitiveDependencies set to true. To display package dependencies, either specify a package version id (starts with 04t or 05i) or create a new package version with the calculateTransitiveDependencies parameter in the sfdx-project.json file to "true".
