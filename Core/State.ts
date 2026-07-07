
import { ApplicationMode, DeepthinkPipelineState, FileData } from './Types';
import { createDefaultCustomPromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import { createDefaultCustomPromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import { createDefaultCustomPromptsContextual } from '../Contextual/ContextualPrompts';

class GlobalStateManager {
    currentMode: ApplicationMode = 'deepthink';
    activeDeepthinkPipeline: DeepthinkPipelineState | null = null;
    isGenerating: boolean = false;
    /** Files injected into the model's initial context. `currentProblemImages`
     * remains as a compatibility alias for older Deepthink integrations. */
    directContextFiles: FileData[] = [];
    filesystemContextFiles: FileData[] = [];

    get currentProblemImages() {
        return this.directContextFiles;
    }

    set currentProblemImages(files: FileData[]) {
        this.directContextFiles = files;
    }
    isCustomPromptsOpen: boolean = false;

    // Mode running states
    isContextualRunning: boolean = false;
    isAdaptiveDeepthinkRunning: boolean = false;

    // Contextual sandbox tool environment toggle. Kept under the existing field
    // name so imported configs and UI wiring remain backward compatible.
    geminiCodeExecutionEnabled: boolean = false;

    // Gemini Thinking Level
    thinkingLevel: 'low' | 'medium' | 'high' | 'minimal' = 'high';

    customPromptsDeepthinkState = createDefaultCustomPromptsDeepthink();
    customPromptsAdaptiveDeepthinkState = createDefaultCustomPromptsAdaptiveDeepthink();
    customPromptsContextualState = createDefaultCustomPromptsContextual();
}

export const globalState = new GlobalStateManager();
