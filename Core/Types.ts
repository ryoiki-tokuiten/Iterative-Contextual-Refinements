
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

export type ApplicationMode = 'deepthink' | 'contextual' | 'adaptive-deepthink';


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
    activeContextualState?: any | null; // For contextual mode
    activeAdaptiveDeepthinkState?: any | null; // For adaptive deepthink mode
    activeDeepthinkProblemTabId?: string; // For deepthink UI
    globalStatusText: string;
    globalStatusClass: string;
    customPromptsDeepthinkState?: CustomizablePromptsDeepthink;
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
        isolateBranches?: boolean;
        disableSolutionPool?: boolean;
        provideAllSolutionsToCorrectors: boolean;
    };
    // Solution pool versions for evolution view
    solutionPoolVersions?: Array<{ content: string; title: string; timestamp: number }> | null;
}

export interface FileData {
    base64: string;
    mimeType: string;
    name: string;
    size: number;
}
