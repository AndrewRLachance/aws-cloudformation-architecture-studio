/// <reference types="vite/client" />
/**
 * @file Vite and browser global type declarations.
 * @module vite-env
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file augments Vite client types and declares development and test globals on the browser window.
 */

/** Development and test-only globals exposed on the browser window. */
interface Window {
  __ARCHITECTURE_STUDIO_TEST_MAIN_THREAD_LAYOUT__?: boolean;
  __ARCHITECTURE_STUDIO__?: {
    getSnapshot(): {
      revision: number;
      undoCount: number;
      selectedNodeIds: readonly string[];
      nodes: Record<string, { x: number; y: number; parentId?: string }>;
      viewMode: string;
    };
  };
}
