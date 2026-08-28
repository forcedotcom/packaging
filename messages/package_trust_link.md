# invalidVerifiedOrgId

The Verified Org ID %s isn't valid. Specify a valid organization ID (starts with 00D and is 15 or 18 characters) for the Verified Partner Business Org and retry the command.

# trustLinkAlreadyExists

This org already has a trust link to Verified Org %s with status '%s'. An org can have only one trust link at a time; delete the existing trust link before requesting a new one.

# apiVersionTooLow

Package link requires API version %s or later.

# missingOrgId

Unable to determine the target org ID from the current connection.

# invalidStatus

The status %s is invalid. Valid values are: pending, approved, declined, revoked.

# exactlyOneApproveSelector

Specify exactly one trust link selector: a request ID or an authoring org ID.

# invalidTrustLinkRequestId

The trust link request ID %s isn't valid. Specify a valid 15- or 18-character Salesforce ID and retry the command.

# invalidAuthoringOrgId

The Authoring Org ID %s isn't valid. Specify a valid organization ID (starts with 00D and is 15 or 18 characters) and retry the command.

# pendingTrustLinkNotFound

No pending trust link request matching %s was found for this Verified Org. Run "sf package trust link list --status pending" to review pending requests.

# trustLinkNotFound

This org has no trust link to remove; it's already in the Not Linked state.
