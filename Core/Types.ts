
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

export interface FileData {
    base64: string;
    mimeType: string;
    name: string;
    size: number;
}
