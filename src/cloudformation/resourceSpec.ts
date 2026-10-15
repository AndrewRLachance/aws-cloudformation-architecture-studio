/**
 * @file Lazy offline CloudFormation resource specification access and validation.
 * @module cloudformation/resourceSpec
 */
import metadata from './spec/metadata.json';

export interface ResourcePropertySpecification {
  readonly Documentation?: string;
  readonly DuplicatesAllowed?: boolean;
  readonly ItemType?: string;
  readonly PrimitiveItemType?: PrimitiveType;
  readonly PrimitiveType?: PrimitiveType;
  readonly Required?: boolean;
  readonly Type?: string;
  readonly UpdateType?: 'Mutable' | 'Immutable' | 'Conditional';
}

export type PrimitiveType = 'String' | 'Long' | 'Integer' | 'Double' | 'Boolean' | 'Timestamp' | 'Json';

export interface ResourceTypeSpecification {
  readonly Documentation?: string;
  readonly Properties?: Readonly<Record<string, ResourcePropertySpecification>>;
  readonly Attributes?: Readonly<Record<string, ResourcePropertySpecification>>;
}

export interface CloudFormationResourceSpecification {
  readonly ResourceSpecificationVersion: string;
  readonly ResourceTypes: Readonly<Record<string, ResourceTypeSpecification>>;
  readonly PropertyTypes: Readonly<Record<string, ResourceTypeSpecification>>;
}

export interface PropertyValidationIssue {
  readonly severity: 'warning' | 'error';
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export const RESOURCE_SPECIFICATION_METADATA = metadata;
let specificationPromise: Promise<CloudFormationResourceSpecification> | undefined;

/** Loads the pinned specification only when the property editor is opened. */
export function loadResourceSpecification(): Promise<CloudFormationResourceSpecification> {
  specificationPromise ??= Promise.all([import('./spec/aws-us-east-1.json'), import('./spec/sam')]).then(([module, sam]) => {
    const base = module.default as CloudFormationResourceSpecification;
    return { ...base, ResourceTypes: { ...base.ResourceTypes, ...sam.SAM_RESOURCE_SPECIFICATION.ResourceTypes }, PropertyTypes: { ...base.PropertyTypes, ...sam.SAM_RESOURCE_SPECIFICATION.PropertyTypes } };
  });
  return specificationPromise;
}

/** Recognizes intrinsic objects, which may replace any typed CloudFormation value. */
function isIntrinsic(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => key === 'Ref' || key === 'Condition' || key.startsWith('Fn::'));
}

function primitiveMatches(value: unknown, primitive: PrimitiveType): boolean {
  if (isIntrinsic(value)) return true;
  if (primitive === 'Json') return true;
  if (primitive === 'String' || primitive === 'Timestamp') return typeof value === 'string';
  if (primitive === 'Boolean') return typeof value === 'boolean';
  if (primitive === 'Integer' || primitive === 'Long') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === 'number' && Number.isFinite(value);
}

function propertyType(specification: CloudFormationResourceSpecification, resourceType: string, type: string): ResourceTypeSpecification | undefined {
  return specification.PropertyTypes[`${resourceType}.${type}`] ?? specification.PropertyTypes[type];
}

function validateObject(
  specification: CloudFormationResourceSpecification,
  resourceType: string,
  properties: Readonly<Record<string, ResourcePropertySpecification>>,
  value: Readonly<Record<string, unknown>>,
  path: string,
  issues: PropertyValidationIssue[],
): void {
  for (const [name, property] of Object.entries(properties)) {
    if (property.Required && !(name in value)) issues.push({ severity: 'error', path: `${path}.${name}`, code: 'REQUIRED_PROPERTY', message: `${name} is required.` });
  }
  for (const [name, entry] of Object.entries(value)) {
    const property = properties[name];
    const entryPath = `${path}.${name}`;
    if (!property) {
      issues.push({ severity: 'warning', path: entryPath, code: 'UNKNOWN_PROPERTY', message: `${name} is not present in the bundled ${resourceType} specification.` });
      continue;
    }
    validateValue(specification, resourceType, property, entry, entryPath, issues);
  }
}

function validateValue(
  specification: CloudFormationResourceSpecification,
  resourceType: string,
  property: ResourcePropertySpecification,
  value: unknown,
  path: string,
  issues: PropertyValidationIssue[],
): void {
  if (isIntrinsic(value)) return;
  if (property.PrimitiveType) {
    if (!primitiveMatches(value, property.PrimitiveType)) issues.push({ severity: 'error', path, code: 'PROPERTY_TYPE', message: `${path} must be ${property.PrimitiveType}.` });
    return;
  }
  if (property.Type === 'List') {
    if (!Array.isArray(value)) {
      issues.push({ severity: 'error', path, code: 'PROPERTY_TYPE', message: `${path} must be a list.` });
      return;
    }
    value.forEach((item, index) => {
      if (property.PrimitiveItemType && !primitiveMatches(item, property.PrimitiveItemType)) issues.push({ severity: 'error', path: `${path}[${index}]`, code: 'PROPERTY_TYPE', message: `${path}[${index}] must be ${property.PrimitiveItemType}.` });
      else if (property.ItemType && !isIntrinsic(item)) {
        const nested = propertyType(specification, resourceType, property.ItemType);
        if (!nested?.Properties || typeof item !== 'object' || item === null || Array.isArray(item)) issues.push({ severity: 'error', path: `${path}[${index}]`, code: 'PROPERTY_TYPE', message: `${path}[${index}] must be ${property.ItemType}.` });
        else validateObject(specification, resourceType, nested.Properties, item as Record<string, unknown>, `${path}[${index}]`, issues);
      }
    });
    return;
  }
  if (property.Type === 'Map') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ severity: 'error', path, code: 'PROPERTY_TYPE', message: `${path} must be a map.` });
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (property.PrimitiveItemType && !primitiveMatches(item, property.PrimitiveItemType)) issues.push({ severity: 'error', path: `${path}.${key}`, code: 'PROPERTY_TYPE', message: `${path}.${key} must be ${property.PrimitiveItemType}.` });
      else if (property.ItemType && !isIntrinsic(item)) {
        const nested = propertyType(specification, resourceType, property.ItemType);
        if (!nested?.Properties || typeof item !== 'object' || item === null || Array.isArray(item)) issues.push({ severity: 'error', path: `${path}.${key}`, code: 'PROPERTY_TYPE', message: `${path}.${key} must be ${property.ItemType}.` });
        else validateObject(specification, resourceType, nested.Properties, item as Record<string, unknown>, `${path}.${key}`, issues);
      }
    }
    return;
  }
  if (property.Type) {
    const nested = propertyType(specification, resourceType, property.Type);
    if (!nested?.Properties || typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ severity: 'error', path, code: 'PROPERTY_TYPE', message: `${path} must be ${property.Type}.` });
      return;
    }
    validateObject(specification, resourceType, nested.Properties, value as Record<string, unknown>, path, issues);
  }
}

/** Validates one resource property object without rejecting custom resource types. */
export function validateResourceProperties(
  specification: CloudFormationResourceSpecification,
  resourceType: string,
  properties: Readonly<Record<string, unknown>>,
): PropertyValidationIssue[] {
  const resource = specification.ResourceTypes[resourceType];
  if (!resource) return [{ severity: 'warning', path: 'Properties', code: 'UNKNOWN_RESOURCE_TYPE', message: `${resourceType} is not present in the bundled specification; values will be preserved.` }];
  const issues: PropertyValidationIssue[] = [];
  validateObject(specification, resourceType, resource.Properties ?? {}, properties, 'Properties', issues);
  return issues;
}
