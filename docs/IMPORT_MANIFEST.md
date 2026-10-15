# Import manifest schema

The importer recognizes a JSON file whose filename contains `manifest`. Schema version 1 remains accepted unchanged; schema version 2 adds explicit deployment-metadata file associations.

## Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CloudFormation Architecture Studio Import Manifest",
  "type": "object",
  "required": ["schemaVersion", "templates"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "enum": [1, 2] },
    "templates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["filename"],
        "additionalProperties": false,
        "properties": {
          "filename": { "type": "string", "minLength": 1 },
          "stackId": { "type": "string" },
          "stackName": { "type": "string" },
          "accountId": { "type": "string" },
          "region": { "type": "string" },
          "parentStackId": { "type": "string" },
          "stackSetId": { "type": "string" },
          "exports": { "type": "array", "items": { "type": "string" } },
          "importConsumers": { "type": "array", "items": { "type": "string" } },
          "metadataFiles": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["filename", "kind"],
              "properties": {
                "filename": { "type": "string" },
                "kind": { "enum": ["stack-policy", "change-set", "termination-protection", "stack-drift", "resource-drifts"] }
              }
            }
          }
        }
      }
    }
  }
}
```

`metadataFiles` is valid only in schema version 2. Version 1 remains strict and unchanged.

## Example

```json
{
  "schemaVersion": 1,
  "templates": [
    {
      "filename": "network.yaml",
      "stackId": "arn:aws:cloudformation:us-east-1:111111111111:stack/network/abc",
      "stackName": "network",
      "accountId": "111111111111",
      "region": "us-east-1",
      "exports": ["SharedVpcId"]
    },
    {
      "filename": "application.yaml",
      "stackName": "application",
      "accountId": "222222222222",
      "region": "us-east-1",
      "importConsumers": ["SharedVpcId"]
    },
    {
      "filename": "child.yaml",
      "stackName": "child",
      "parentStackId": "arn:aws:cloudformation:us-east-1:222222222222:stack/parent/xyz"
    },
    {
      "filename": "baseline.yaml",
      "stackSetId": "arn:aws:cloudformation:us-east-1:111111111111:stackset/security-baseline:id"
    }
  ]
}
```

## Resolution precedence

1. Explicit manifest association.
2. AWS CLI metadata (`StackId`, `StackName`, ARNs, StackSet metadata).
3. User-supplied default name/account/Region from the import wizard.
4. Deterministic filename-derived identity.
5. Explicit unresolved account or Region with a warning.

Manifest validation is strict. An invalid manifest is not silently treated as authoritative metadata; template ingestion can continue with diagnostics and deterministic detection.

## Version 2 metadata example

```json
{
  "schemaVersion": 2,
  "templates": [
    {
      "filename": "application.yaml",
      "stackName": "application",
      "metadataFiles": [
        { "filename": "application-policy.json", "kind": "stack-policy" },
        { "filename": "application-drift.json", "kind": "resource-drifts" }
      ]
    }
  ]
}
```

## Generation manifest version 3

CloudFormation ZIP generation writes `generation-manifest.json` with schema version 3. It retains the version-2 fields for every generated stack, StackSet, nested deployment, desired target, and observed instance. It adds validation and round-trip report filenames, CDK cloud-assembly references, and deployment-metadata artifact paths.
