/**
 * @file Palette drag payload types.
 * @module ui/palette/types
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file defines serializable palette payloads and the custom MIME type used by drag-and-drop.
 */
import type { AwsResourceType, BoundaryType, ControlType } from '../../domain/types';

/** Serializable payload placed on drag events from the palette. */
export type PalettePayload =
  | { readonly category: 'boundary'; readonly name: string; readonly boundaryType: BoundaryType }
  | { readonly category: 'resource'; readonly name: string; readonly resourceType: AwsResourceType; readonly cloudFormationType: string }
  | { readonly category: 'control'; readonly name: string; readonly controlType: ControlType }
  | { readonly category: 'deployment'; readonly name: string; readonly deploymentType: 'stack' | 'stackset' | 'nested-stack' }
  | { readonly category: 'logical'; readonly name: string }
  | { readonly category: 'external-reference'; readonly name: string }
  | { readonly category: 'text'; readonly name: string }
  | { readonly category: 'legend'; readonly name: string };

/** Custom MIME type used for palette drag-and-drop payloads. */
export const PALETTE_MIME = 'application/x-aws-architecture-palette';
