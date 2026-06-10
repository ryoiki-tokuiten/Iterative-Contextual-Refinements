
import type { CustomizablePromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import type { CustomizablePromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import type { CustomizablePromptsContextual } from '../Contextual/ContextualPrompts';
import type {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
    DeepthinkPostQualityFilterData,
    DeepthinkMainStrategyData,
    DeepthinkStructuredSolutionPoolAgentData,
    DeepthinkPipelineState
} from '../Deepthink/DeepthinkCore';

export type {
    DeepthinkSolutionCritiqueData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
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

export type ApplicationMode = 'deepthink' | 'agentic' | 'contextual' | 'adaptive-deepthink' | 'dynamic-compute';


export interface IterationData {
    iterationNumber: number;
    title: string;
    generatedContent?: string;
    contentBeforeBugFix?: string; // Content state before bug-fix patches are applied

    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}

export interface ExportedConfig {
    currentMode: ApplicationMode;
    initialIdea: string;
    selectedModel: string;
    activeDeepthinkPipeline?: DeepthinkPipelineState | null; // For deepthink
    activeAgenticState?: any | null; // For agentic mode
    activeContextualState?: any | null; // For contextual mode
    activeAdaptiveDeepthinkState?: any | null; // For adaptive deepthink mode
    activeDeepthinkProblemTabId?: string; // For deepthink UI
    globalStatusText: string;
    globalStatusClass: string;
    customPromptsDeepthinkState?: CustomizablePromptsDeepthink;
    customPromptsAgentic: { systemPrompt: string }; // Added for Agentic mode
    customPromptsAdaptiveDeepthink?: CustomizablePromptsAdaptiveDeepthink; // Added for Adaptive Deepthink mode
    customPromptsContextual?: CustomizablePromptsContextual; // Added for Contextual mode
    isCustomPromptsOpen?: boolean;
    // Model parameters for Deepthink modes
    modelParameters?: {
        temperature: number;
        topP: number;
        strategiesCount: number;
        subStrategiesCount: number;
        textPlaceholder?: string;
        hypothesisCount: number;
        pqfAggressiveness: string;
        refinementEnabled: boolean;
        skipSubStrategies: boolean;
        dissectedObservationsEnabled: boolean;
        evolvingDfsEnabled: boolean;
        evolvingDfsDepth: number;
        provideAllSolutionsToCorrectors: boolean;
    };
    // Solution pool versions for evolution view
    solutionPoolVersions?: Array<{ content: string; title: string; timestamp: number }> | null;
}
