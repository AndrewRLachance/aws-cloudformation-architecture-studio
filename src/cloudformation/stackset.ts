/**
 * @file StackSet target and operation-preference validation.
 * @module cloudformation/stackset
 */
import type { StackSetOperationPreferences, StackSetTargetGroup } from '../domain/types';

export interface StackSetValidationIssue {
  readonly path: string;
  readonly message: string;
}

const ACCOUNT_ID = /^[0-9]{12}$/;
const OU_ID = /^(ou-[a-z0-9]{4,32}-[a-z0-9]{8,32}|r-[a-z0-9]{4,32})$/;
const REGION = /^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$/;

/** Validates desired target groups independently from observed StackSet instances. */
export function validateStackSetTargets(
  permissionModel: string | undefined,
  targetGroups: readonly StackSetTargetGroup[],
  preferences?: StackSetOperationPreferences,
): StackSetValidationIssue[] {
  const issues: StackSetValidationIssue[] = [];
  const fingerprints = new Set<string>();
  const concreteTargets = new Set<string>();
  targetGroups.forEach((target, index) => {
    const path = `targetGroups[${index}]`;
    if (new Set(target.accounts).size !== target.accounts.length) issues.push({ path: `${path}.accounts`, message: 'Account IDs must be unique within a target group.' });
    if (new Set(target.organizationalUnitIds).size !== target.organizationalUnitIds.length) issues.push({ path: `${path}.organizationalUnitIds`, message: 'Organization roots and OU IDs must be unique within a target group.' });
    if (new Set(target.regions).size !== target.regions.length) issues.push({ path: `${path}.regions`, message: 'Regions must be unique within a target group.' });
    target.accounts.forEach((account, accountIndex) => { if (!ACCOUNT_ID.test(account)) issues.push({ path: `${path}.accounts[${accountIndex}]`, message: 'Account IDs must contain exactly 12 digits.' }); });
    target.organizationalUnitIds.forEach((ou, ouIndex) => { if (!OU_ID.test(ou)) issues.push({ path: `${path}.organizationalUnitIds[${ouIndex}]`, message: 'OU IDs must be an ou-… identifier or an organization root r-… identifier.' }); });
    if (target.regions.length === 0) issues.push({ path: `${path}.regions`, message: 'At least one Region is required.' });
    target.regions.forEach((region, regionIndex) => { if (!REGION.test(region)) issues.push({ path: `${path}.regions[${regionIndex}]`, message: 'Use a valid AWS Region identifier.' }); });
    if (permissionModel === 'SELF_MANAGED') {
      if (target.accounts.length === 0) issues.push({ path: `${path}.accounts`, message: 'Self-managed StackSets require target accounts.' });
      if (target.organizationalUnitIds.length > 0) issues.push({ path: `${path}.organizationalUnitIds`, message: 'Self-managed StackSets cannot target organizational units.' });
      if (target.accountFilterType && target.accountFilterType !== 'NONE') issues.push({ path: `${path}.accountFilterType`, message: 'Account filters apply only when service-managed targets combine accounts and organizational units.' });
    }
    if (permissionModel === 'SERVICE_MANAGED' && target.organizationalUnitIds.length === 0) issues.push({ path: `${path}.organizationalUnitIds`, message: 'Service-managed StackSets require an organization root or organizational unit.' });
    if (target.accounts.length > 0 && target.organizationalUnitIds.length > 0 && (!target.accountFilterType || target.accountFilterType === 'NONE')) issues.push({ path: `${path}.accountFilterType`, message: 'Choose UNION, INTERSECTION, or DIFFERENCE when accounts and OUs are combined.' });
    if (target.accounts.length === 0 && target.accountFilterType && target.accountFilterType !== 'NONE') issues.push({ path: `${path}.accountFilterType`, message: 'INTERSECTION, DIFFERENCE, and UNION require one or more account IDs.' });
    const fingerprint = JSON.stringify([target.accounts.slice().sort(), target.organizationalUnitIds.slice().sort(), target.regions.slice().sort()]);
    if (fingerprints.has(fingerprint)) issues.push({ path, message: 'This target group duplicates another target group.' });
    fingerprints.add(fingerprint);
    for (const account of target.accounts) for (const region of target.regions) {
      const key = `account:${account}:${region}`;
      if (concreteTargets.has(key)) issues.push({ path, message: `Account ${account} in ${region} is targeted more than once.` });
      concreteTargets.add(key);
    }
    for (const ou of target.organizationalUnitIds) for (const region of target.regions) {
      const key = `ou:${ou}:${region}`;
      if (concreteTargets.has(key)) issues.push({ path, message: `${ou} in ${region} is targeted more than once.` });
      concreteTargets.add(key);
    }
  });
  if (preferences) {
    if (preferences.failureToleranceCount !== undefined && preferences.failureTolerancePercentage !== undefined) issues.push({ path: 'operationPreferences', message: 'Specify failure tolerance as a count or percentage, not both.' });
    if (preferences.maxConcurrentCount !== undefined && preferences.maxConcurrentPercentage !== undefined) issues.push({ path: 'operationPreferences', message: 'Specify maximum concurrency as a count or percentage, not both.' });
    if (preferences.failureToleranceCount !== undefined && (!Number.isInteger(preferences.failureToleranceCount) || preferences.failureToleranceCount < 0)) issues.push({ path: 'operationPreferences.failureToleranceCount', message: 'Failure tolerance count must be a non-negative integer.' });
    if (preferences.maxConcurrentCount !== undefined && (!Number.isInteger(preferences.maxConcurrentCount) || preferences.maxConcurrentCount < 1)) issues.push({ path: 'operationPreferences.maxConcurrentCount', message: 'Maximum concurrent count must be a positive integer.' });
    for (const [name, value] of [['failureTolerancePercentage', preferences.failureTolerancePercentage], ['maxConcurrentPercentage', preferences.maxConcurrentPercentage]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 100)) issues.push({ path: `operationPreferences.${name}`, message: `${name} must be an integer between 0 and 100.` });
    }
    if (preferences.concurrencyMode !== 'SOFT_FAILURE_TOLERANCE' && preferences.failureToleranceCount !== undefined && preferences.maxConcurrentCount !== undefined && preferences.maxConcurrentCount > preferences.failureToleranceCount + 1) issues.push({ path: 'operationPreferences.maxConcurrentCount', message: 'Strict maximum concurrency can be at most failure tolerance plus one.' });
    if (preferences.regionOrder) {
      if (new Set(preferences.regionOrder).size !== preferences.regionOrder.length) issues.push({ path: 'operationPreferences.regionOrder', message: 'Region order cannot contain duplicates.' });
      const targetRegions = new Set(targetGroups.flatMap((target) => target.regions));
      preferences.regionOrder.forEach((region, index) => {
        if (!targetRegions.has(region)) issues.push({ path: `operationPreferences.regionOrder[${index}]`, message: 'Region order may contain only Regions present in a target group.' });
      });
    }
  }
  return issues;
}
