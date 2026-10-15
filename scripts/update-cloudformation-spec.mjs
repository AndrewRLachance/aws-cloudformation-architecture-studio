/* global URL, fetch, console */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const SOURCE_URL = 'https://d1uauaxba7bl26.cloudfront.net/latest/gzip/CloudFormationResourceSpecification.json';
const outputDirectory = new URL('../src/cloudformation/spec/', import.meta.url);

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Unable to download CloudFormation resource specification: ${response.status} ${response.statusText}`);
const text = await response.text();
const parsed = JSON.parse(text);
if (!parsed || typeof parsed !== 'object' || typeof parsed.ResourceSpecificationVersion !== 'string' || !parsed.ResourceTypes || !parsed.PropertyTypes) {
  throw new Error('Downloaded CloudFormation resource specification has an unexpected shape.');
}
const normalized = `${JSON.stringify(parsed)}\n`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('aws-us-east-1.json', outputDirectory), normalized);
await writeFile(new URL('metadata.json', outputDirectory), `${JSON.stringify({
  region: 'us-east-1',
  version: parsed.ResourceSpecificationVersion,
  source: SOURCE_URL,
  sha256: createHash('sha256').update(normalized).digest('hex'),
}, null, 2)}\n`);
console.log(`CloudFormation specification ${parsed.ResourceSpecificationVersion} written for us-east-1.`);
