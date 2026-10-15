/**
 * @file CloudFormation gateway integration contract.
 * @module cloudformation/gateway
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file defines the future authenticated AWS integration boundary for template and stack metadata retrieval.
 */
/**
 * Port for a future authenticated AWS integration. Local file ingestion does not
 * depend on this interface and the delivered application never requests AWS credentials.
 */
export interface CloudFormationGateway {
  getTemplate(input: { readonly stackNameOrId: string; readonly region: string }): Promise<unknown>;
  describeStack(input: { readonly stackNameOrId: string; readonly region: string }): Promise<unknown>;
  listStackResources(input: { readonly stackNameOrId: string; readonly region: string }): Promise<unknown>;
  getStackPolicy(input: { readonly stackNameOrId: string; readonly region: string }): Promise<unknown>;
  describeChangeSet(input: { readonly changeSetNameOrId: string; readonly stackNameOrId?: string; readonly region: string }): Promise<unknown>;
  describeStackResourceDrifts(input: { readonly stackNameOrId: string; readonly region: string; readonly nextToken?: string }): Promise<unknown>;
  describeStackSet(input: { readonly stackSetNameOrId: string; readonly region: string }): Promise<unknown>;
  listStackInstances(input: { readonly stackSetNameOrId: string; readonly region: string; readonly nextToken?: string }): Promise<unknown>;
}
