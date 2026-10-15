/**
 * @file CloudFormation-specification-aware resource property editor.
 * @module ui/inspector/CloudFormationPropertyEditor
 */
import { useEffect, useState } from 'react';
import type { AwsResourceNode, BoundaryNode } from '../../domain/types';
import {
  loadResourceSpecification,
  RESOURCE_SPECIFICATION_METADATA,
  validateResourceProperties,
  type CloudFormationResourceSpecification,
  type ResourcePropertySpecification,
} from '../../cloudformation/resourceSpec';
import { useDiagramStore } from '../../store/useDiagramStore';

type EditableResourceNode = AwsResourceNode | BoundaryNode;

function resourceData(node: EditableResourceNode): { type: string; properties: Readonly<Record<string, unknown>> } | undefined {
  if (node.kind === 'aws-resource') return { type: node.cloudFormationType, properties: node.properties };
  return node.cloudFormation;
}

function defaultValue(property: ResourcePropertySpecification): unknown {
  if (property.Type === 'List') return [];
  if (property.Type === 'Map' || property.Type) return {};
  if (property.PrimitiveType === 'Boolean') return false;
  if (['Integer','Long','Double'].includes(property.PrimitiveType ?? '')) return 0;
  if (property.PrimitiveType === 'Json') return {};
  return '';
}

function expectedType(property?: ResourcePropertySpecification): string {
  if (!property) return 'Unknown';
  if (property.Type === 'List') return `List<${property.PrimitiveItemType ?? property.ItemType ?? 'unknown'}>`;
  if (property.Type === 'Map') return `Map<${property.PrimitiveItemType ?? property.ItemType ?? 'unknown'}>`;
  return property.PrimitiveType ?? property.Type ?? 'Unknown';
}

/** Renders typed top-level controls with raw JSON fallback and offline validation. */
export function CloudFormationPropertyEditor({ node }: { readonly node: EditableResourceNode }) {
  const updateNode = useDiagramStore((state) => state.updateNode);
  const initial = resourceData(node);
  const [specification, setSpecification] = useState<CloudFormationResourceSpecification>();
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<'structured' | 'raw'>('structured');
  const [properties, setProperties] = useState<Record<string, unknown>>(() => ({ ...(initial?.properties ?? {}) }));
  const [raw, setRaw] = useState(() => JSON.stringify(initial?.properties ?? {}, null, 2));
  const [syntaxError, setSyntaxError] = useState('');
  const [propertyToAdd, setPropertyToAdd] = useState('');
  useEffect(() => { void loadResourceSpecification().then(setSpecification, (error: unknown) => setLoadError(error instanceof Error ? error.message : String(error))); }, []);
  useEffect(() => { const data = resourceData(node); setProperties({ ...(data?.properties ?? {}) }); setRaw(JSON.stringify(data?.properties ?? {}, null, 2)); setSyntaxError(''); }, [node]);
  const type = initial?.type ?? node.sourceResourceType ?? '';
  const resource = specification?.ResourceTypes[type];
  const definitions = resource?.Properties ?? {};
  const validation = specification ? validateResourceProperties(specification, type, properties) : [];
  const remaining = Object.keys(definitions).filter((name) => !(name in properties)).sort();
  const setValue = (name: string, value: unknown): void => {
    const next = { ...properties, [name]: value }; setProperties(next); setRaw(JSON.stringify(next, null, 2));
  };
  const parseStructured = (name: string, value: string): void => {
    try { setValue(name, JSON.parse(value) as unknown); setSyntaxError(''); }
    catch (error) { setSyntaxError(error instanceof Error ? error.message : String(error)); }
  };
  const parseRaw = (value: string): void => {
    setRaw(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Properties must be a JSON object.');
      setProperties(parsed as Record<string, unknown>); setSyntaxError('');
    } catch (error) { setSyntaxError(error instanceof Error ? error.message : String(error)); }
  };
  const apply = (): void => {
    if (syntaxError || validation.some((issue) => issue.severity === 'error')) return;
    if (node.kind === 'aws-resource') updateNode(node.id, { properties }, 'edit-resource-properties');
    else if (node.cloudFormation) updateNode(node.id, { cloudFormation: { ...node.cloudFormation, properties } }, 'edit-boundary-resource-properties');
  };
  if (!initial) return null;
  if (node.sourceProjection) return <section className="cloudformation-property-editor"><div className="property-editor-heading"><strong>Analysis-only Fn::ForEach projection</strong></div><p className="form-note">This resource is derived from {node.sourceProjection.sourcePath}. Edit the authored loop in the source template; projected properties are read-only.</p></section>;
  return <section className="cloudformation-property-editor">
    <div className="property-editor-heading"><div><strong>CloudFormation properties</strong><small>{type} · offline spec {RESOURCE_SPECIFICATION_METADATA.version}</small>{resource?.Documentation && <a href={resource.Documentation.replace('http://', 'https://')} target="_blank" rel="noreferrer">AWS resource docs</a>}</div><div className="segmented"><button type="button" className={mode === 'structured' ? 'is-active' : ''} onClick={() => setMode('structured')}>Fields</button><button type="button" className={mode === 'raw' ? 'is-active' : ''} onClick={() => setMode('raw')}>Raw JSON</button></div></div>
    {!specification && !loadError && <p className="form-note" role="status">Loading bundled CloudFormation specification…</p>}
    {loadError && <p className="error-note">Unable to load offline specification: {loadError}</p>}
    {mode === 'structured' ? <div className="structured-properties">
      <div className="add-property"><label>Add known property<select value={propertyToAdd} onChange={(event) => setPropertyToAdd(event.target.value)}><option value="">Select property</option>{remaining.map((name) => <option key={name} value={name}>{name}{definitions[name]?.Required ? ' (required)' : ''}</option>)}</select></label><button type="button" disabled={!propertyToAdd} onClick={() => { const definition = definitions[propertyToAdd]; if (definition) setValue(propertyToAdd, defaultValue(definition)); setPropertyToAdd(''); }}>Add</button></div>
      {Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => {
        const definition = definitions[name]; const primitive = definition?.PrimitiveType;
        return <fieldset className="property-field" key={name}><legend>{name}</legend><div className="property-badges"><span>{expectedType(definition)}</span>{definition?.Required && <span>Required</span>}{definition?.UpdateType && <span>{definition.UpdateType}</span>}{definition?.Documentation && <a href={definition.Documentation.replace('http://', 'https://')} target="_blank" rel="noreferrer">AWS docs</a>}</div>
          {primitive === 'Boolean' && typeof value === 'boolean' ? <select value={String(value)} onChange={(event) => setValue(name, event.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select>
            : ['Integer','Long','Double'].includes(primitive ?? '') && typeof value === 'number' ? <input type="number" value={value} step={primitive === 'Double' ? 'any' : '1'} onChange={(event) => setValue(name, Number(event.target.value))} />
            : (primitive === 'String' || primitive === 'Timestamp') && typeof value === 'string' ? <input value={value} onChange={(event) => setValue(name, event.target.value)} />
            : <textarea className="json-editor compact-json" value={JSON.stringify(value, null, 2)} onChange={(event) => parseStructured(name, event.target.value)} spellCheck={false} />}
          <button type="button" className="danger-link" onClick={() => { const next = { ...properties }; delete next[name]; setProperties(next); setRaw(JSON.stringify(next, null, 2)); }}>Remove</button>
        </fieldset>;
      })}
    </div> : <label>Properties JSON<textarea className="json-editor" value={raw} onChange={(event) => parseRaw(event.target.value)} spellCheck={false} /></label>}
    {syntaxError && <p className="error-note" role="alert">{syntaxError}</p>}
    {validation.length > 0 && <ul className="diagnostic-list">{validation.map((issue) => <li key={`${issue.code}-${issue.path}`} className={`severity-${issue.severity}`}><strong>{issue.code}</strong><span>{issue.path}</span><p>{issue.message}</p></li>)}</ul>}
    <button type="button" className="primary-button" onClick={apply} disabled={!specification || Boolean(syntaxError) || validation.some((issue) => issue.severity === 'error')}>Apply properties</button>
  </section>;
}
