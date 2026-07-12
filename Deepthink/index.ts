/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Deepthink - Main exports
 */

// Export all agents for reuse
export {
    generateStrategiesAgent,
    strategiesProximityAgent,
    generateHypothesesAgent,
    hypothesesProximityAgent,
    testHypothesesAgent,
    executeStrategiesAgent,
    solutionCritiqueAgent,
    correctedSolutionsAgent,
    selectBestSolutionAgent,
} from './DeepthinkAgents';

export type {
    AgentExecutionContext,
    AgentResponse
} from './DeepthinkAgents';

// Export prompts
export {
    createDefaultCustomPromptsDeepthink,
} from './DeepthinkPrompts';

export type {
    CustomizablePromptsDeepthink,
} from './DeepthinkPrompts';

// Export types and interfaces
export type {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkPostQualityFilterData,
    DeepthinkMainStrategyData,
    DeepthinkPipelineState
} from './Deepthink';

// Export main functions
export {
    initializeDeepthinkModule,
    activateDeepthinkStrategyTab,
    openDeepthinkSolutionModal,
    closeSolutionModal,
    startDeepthinkAnalysisProcess,
    getActiveDeepthinkPipeline,
    setActiveDeepthinkPipelineForImport,
    renderActiveDeepthinkPipeline
} from './Deepthink';

// Export config panel
export {
    renderDeepthinkConfigPanel
} from './DeepthinkConfigPanel';
