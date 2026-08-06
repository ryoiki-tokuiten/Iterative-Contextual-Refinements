
import type {
    DeepthinkPipelineState
} from '../Deepthink/DeepthinkCore';

export type {
    DeepthinkPipelineState
};

export type ApplicationMode = 'deepthink' | 'contextual' | 'adaptive-deepthink';


export interface FileData {
    base64: string;
    mimeType: string;
    name: string;
    size: number;
}
