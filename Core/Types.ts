
import type { CustomizablePromptsWebsite } from '../Refine/RefinePrompts';
import type { CustomizablePromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import type { CustomizablePromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import type { CustomizablePromptsContextual } from '../Contextual/ContextualPrompts';
import type {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkRedTeamData,
    DeepthinkPostQualityFilterData,
    DeepthinkMainStrategyData,
    DeepthinkStructuredSolutionPoolAgentData,
    DeepthinkPipelineState
} from '../Deepthink/DeepthinkCore';

export type {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkRedTeamData,
    DeepthinkPostQualityFilterData,
    DeepthinkMainStrategyData,
    DeepthinkStructuredSolutionPoolAgentData,
    DeepthinkPipelineState
};

/**
 * Custom error class to signify that pipeline processing was intentionally
 * stopped by a user request.
 */
export class PipelineStopRequestedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PipelineStopRequestedError";
    }
}

export type ApplicationMode = 'website' | 'deepthink' | 'agentic' | 'contextual' | 'adaptive-deepthink' | 'dynamic-compute';

export type EvolutionMode = 'off' | 'novelty' | 'quality';

export interface IterationData {
    iterationNumber: number;
    title: string;
    // Website Mode Specific
    requestPromptContent_InitialGenerate?: string;
    requestPromptContent_FeatureImplement?: string;
    requestPromptContent_BugFix?: string;
    requestPromptFeatures_Suggest?: string;
    generatedContent?: string;
    contentBeforeBugFix?: string; // Content state before bug-fix patches are applied
    suggestedFeaturesContent?: string; // Markdown content from feature suggestion agent

    // Removed diff-format patches - now using full content updates

    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}

export interface PipelineState {
    id: number;
    originalTemperatureIndex: number;
    temperature: number;
    modelName: string;
    iterations: IterationData[];
    status: 'idle' | 'running' | 'stopping' | 'stopped' | 'completed' | 'failed';
    tabButtonElement?: HTMLButtonElement;
    contentElement?: HTMLElement;
    stopButtonElement?: HTMLButtonElement;
    isStopRequested?: boolean;
}




export interface ExportedConfig {
    currentMode: ApplicationMode;
    currentEvolutionMode?: 'off' | 'novelty' | 'quality'; // Evolution convergence mode
    initialIdea: string;
    selectedModel: string;
    selectedOriginalTemperatureIndices: number[]; // For website
    pipelinesState: PipelineState[]; // For website
    activeDeepthinkPipeline?: DeepthinkPipelineState | null; // For deepthink
    activeAgenticState?: any | null; // For agentic mode
    activeContextualState?: any | null; // For contextual mode
    activeAdaptiveDeepthinkState?: any | null; // For adaptive deepthink mode
    activePipelineId: number | null; // For website
    activeDeepthinkProblemTabId?: string; // For deepthink UI
    globalStatusText: string;
    globalStatusClass: string;
    customPromptsWebsite: CustomizablePromptsWebsite;
    customPromptsDeepthinkState?: CustomizablePromptsDeepthink;
    customPromptsAgentic: { systemPrompt: string }; // Added for Agentic mode
    customPromptsAdaptiveDeepthink?: CustomizablePromptsAdaptiveDeepthink; // Added for Adaptive Deepthink mode
    customPromptsContextual?: CustomizablePromptsContextual; // Added for Contextual mode
    isCustomPromptsOpen?: boolean;
    // Model parameters for Deepthink modes
    modelParameters?: {
        temperature: number;
        topP: number;
        refinementStages: number;
        strategiesCount: number;
        subStrategiesCount: number;
        hypothesisCount: number;
        redTeamAggressiveness: string;
        refinementEnabled: boolean;
        skipSubStrategies: boolean;
        dissectedObservationsEnabled: boolean;
        iterativeCorrectionsEnabled: boolean;
        provideAllSolutionsToCorrectors: boolean;
    };
    // Solution pool versions for evolution view
    solutionPoolVersions?: Array<{ content: string; title: string; timestamp: number }> | null;
}
