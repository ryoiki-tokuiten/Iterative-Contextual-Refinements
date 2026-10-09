/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth.
 *
 * Deepthink Module Public API
 */

export * from './core/types';
export * from './core/formulas';
export * from './core/loopController';
export * from './core/contextBuilders';
export * from './core/harnessNotes';
export * from './core/agentRegistry';
export * from './core/gitRepository';
export * from './core/sharedWorkspace';
export * from './core/pipelineOrchestrator';
export * from './prompts';

// Re-export runtime UI & orchestration exports
export {
  initializeDeepthinkModule,
  getActiveDeepthinkPipeline,
  setActiveDeepthinkPipelineForImport,
  renderActiveDeepthinkPipeline,
  createDeepthinkTabContent,
  getVisibleDeepthinkTabs,
} from './ui/Deepthink';
