import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCloudFormationTemplate } from '../src/cloudformation/parser';
import { analyzeIntrinsicReferences } from '../src/cloudformation/dependency';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

describe('CloudFormation parser', () => {
  it('parses JSON and preserves template sections', async () => {
    const parsed = await parseCloudFormationTemplate({ name: 'raw-template.json', text: fixture('raw-template.json') });
    expect(parsed.record?.originalFormat).toBe('json');
    expect(Object.keys(parsed.record?.resources ?? {})).toEqual(['Bucket', 'Function', 'Role']);
    expect(parsed.record?.sourceLocations['Resources.Bucket']?.line).toBeGreaterThan(0);
    expect(parsed.record?.outputs).toHaveProperty('BucketName');
  });

  it('canonicalizes every required YAML short-form intrinsic tag', async () => {
    const parsed = await parseCloudFormationTemplate({ name: 'raw-template.yaml', text: fixture('raw-template.yaml') });
    expect(parsed.record).toBeDefined();
    const canonical = JSON.stringify(parsed.record?.canonicalAst);
    for (const name of ['Ref','Fn::GetAtt','Fn::Sub','Fn::Join','Fn::Select','Fn::Split','Fn::FindInMap','Fn::ImportValue','Fn::GetAZs','Fn::If','Fn::Equals','Fn::And','Fn::Or','Fn::Not','Fn::Base64','Fn::Cidr','Fn::Transform','Condition']) expect(canonical).toContain(`"${name}"`);
    expect(canonical).toContain('Fn::ForEach::Buckets');
    expect(parsed.record?.unsupportedFeatureDiagnostics.map((item) => item.code)).toContain('LANGUAGE_EXTENSIONS_ANALYZED');
  });

  it('extracts nested Ref, GetAtt, Sub, ImportValue, DependsOn and property-aware relationships', async () => {
    const json = await parseCloudFormationTemplate({ name: 'raw-template.json', text: fixture('raw-template.json') });
    const yaml = await parseCloudFormationTemplate({ name: 'raw-template.yaml', text: fixture('raw-template.yaml') });
    const refs = [...analyzeIntrinsicReferences(json.record!), ...analyzeIntrinsicReferences(yaml.record!)];
    expect(refs.some((item) => item.intrinsic === 'DependsOn' && item.relationshipType === 'depends-on')).toBe(true);
    expect(refs.some((item) => item.intrinsic === 'Fn::GetAtt')).toBe(true);
    expect(refs.some((item) => item.intrinsic === 'Fn::Sub')).toBe(true);
    expect(refs.some((item) => item.intrinsic === 'Fn::ImportValue' && item.external)).toBe(true);
    expect(refs.some((item) => item.propertyPath.includes('VpcId') && item.relationshipType === 'associated-with')).toBe(true);
  });

  it('parses AWS get-template envelopes', async () => {
    const parsed = await parseCloudFormationTemplate({ name: 'get-template.json', text: fixture('get-template.json') });
    expect(parsed.record?.resources).toHaveProperty('Table');
  });

  it('returns file-specific line diagnostics for malformed YAML', async () => {
    const parsed = await parseCloudFormationTemplate({ name: 'malformed.yaml', text: fixture('malformed.yaml') });
    expect(parsed.record).toBeUndefined();
    expect(parsed.diagnostics[0]).toMatchObject({ filename: 'malformed.yaml', severity: 'error', blocking: true });
    expect(parsed.diagnostics[0]?.line).toBeGreaterThan(0);
  });

  it('rejects invalid template shapes and malformed JSON', async () => {
    const shape = await parseCloudFormationTemplate({ name: 'shape.json', text: '{"Description":"none"}' });
    const malformed = await parseCloudFormationTemplate({ name: 'broken.json', text: '{"Resources":' });
    expect(shape.diagnostics.some((item) => item.code === 'MISSING_RESOURCES')).toBe(true);
    expect(malformed.diagnostics.some((item) => item.code === 'MALFORMED_JSON')).toBe(true);
  });
});
