
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


export interface FileData {
    base64: string;
    mimeType: string;
    name: string;
    size: number;
}
