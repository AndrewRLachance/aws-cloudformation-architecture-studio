import { describe, expect, it } from 'vitest';
import { containmentPolicy } from '../src/domain/containment';
import { getAbsolutePosition, reparentPosition, sortParentBeforeChild } from '../src/domain/coordinates';
import { findUnexpectedNodeOverlaps, minimumBoundarySize } from '../src/domain/editing';
import { createSeedDocument } from '../src/domain/seed';
import type { BoundaryNode, DiagramDocument } from '../src/domain/types';

function withNode(document: DiagramDocument, node: BoundaryNode): DiagramDocument {
  return { ...document, nodesById: { ...document.nodesById, [node.id]: node }, nodeOrder: [...document.nodeOrder, node.id] };
}

describe('physical containment policy', () => {
  const document = createSeedDocument();
  it.each([
    ['ou-production', 'org-acme'], ['account-prod', 'ou-production'], ['region-prod-use1', 'account-prod'], ['vpc-prod', 'region-prod-use1'], ['az-prod-a', 'vpc-prod'], ['subnet-app-a', 'az-prod-a'], ['ecs-service-a', 'subnet-app-a'], ['s3-assets', 'region-prod-use1'], ['iam-execution-role', 'account-prod'],
  ])('accepts %s inside %s', (nodeId, parentId) => expect(containmentPolicy.decide(document, nodeId, parentId).valid).toBe(true));

  it.each([
    ['iam-execution-role', 'subnet-app-a'], ['s3-assets', 'vpc-prod'], ['ddb-sessions', 'subnet-app-a'], ['vpc-prod', 'account-prod'], ['az-prod-a', 'subnet-app-a'], ['subnet-app-a', 'vpc-prod'], ['region-prod-use1', 'vpc-prod'],
  ])('rejects %s inside %s', (nodeId, parentId) => expect(containmentPolicy.decide(document, nodeId, parentId).valid).toBe(false));

  it('rejects cycles and self-parenting', () => {
    expect(containmentPolicy.decide(document, 'org-acme', 'subnet-app-a').reasonCode).toBe('CYCLE');
    expect(containmentPolicy.decide(document, 'vpc-prod', 'vpc-prod').reasonCode).toBe('SELF_PARENT');
  });

  it('rejects an Availability Zone mismatch', () => {
    const subnet = document.nodesById['subnet-app-a'] as BoundaryNode;
    const mismatch = { ...subnet, id: 'mismatch-subnet', availabilityZoneName: 'us-east-1c' };
    const next = withNode(document, mismatch);
    expect(containmentPolicy.decide(next, mismatch.id, 'az-prod-a').reasonCode).toBe('AZ_MISMATCH');
  });
});

describe('coordinates and ordering', () => {
  const document = createSeedDocument();
  it('computes absolute positions through the physical hierarchy', () => {
    const absolute = getAbsolutePosition(document, 'ecs-service-a');
    expect(absolute.x).toBeGreaterThan(900);
    expect(absolute.y).toBeGreaterThan(500);
  });
  it('preserves absolute position when converting to another parent', () => {
    const absolute = getAbsolutePosition(document, 'ecs-service-a');
    const relative = reparentPosition(document, 'ecs-service-a', 'subnet-app-b');
    const parent = getAbsolutePosition(document, 'subnet-app-b');
    expect(relative.x + parent.x).toBe(absolute.x);
    expect(relative.y + parent.y).toBe(absolute.y);
  });
  it('orders all parents before children', () => {
    const order = sortParentBeforeChild(document);
    expect(order.indexOf('org-acme')).toBeLessThan(order.indexOf('account-prod'));
    expect(order.indexOf('vpc-prod')).toBeLessThan(order.indexOf('subnet-app-a'));
    expect(order.indexOf('subnet-app-a')).toBeLessThan(order.indexOf('ecs-service-a'));
  });
  it('keeps the bundled architecture clear of cross-branch overlaps and boundary overflow', () => {
    expect(findUnexpectedNodeOverlaps(document)).toEqual([]);
    for (const node of Object.values(document.nodesById)) {
      if (node.kind !== 'boundary') continue;
      const minimum = minimumBoundarySize(document, node.id);
      expect(node.size.width, `${node.id} width`).toBeGreaterThanOrEqual(minimum.width);
      expect(node.size.height, `${node.id} height`).toBeGreaterThanOrEqual(minimum.height);
    }
  });
  it('keeps stack, StackSet, logical, governance and security associations independent from physical parent', () => {
    const node = document.nodesById['ecs-service-a'];
    expect(node?.physicalParentId).toBe('subnet-app-a');
    expect(node?.stackId).toBe('stack-app');
    expect(node?.logicalGroupIds).toContain('logical-application');
    expect(node?.securityGroupIds).toContain('sg-app');
    expect(document.stackInstancesById['stack-instance-prod']?.stackSetId).toBe('stackset-baseline');
  });
});
