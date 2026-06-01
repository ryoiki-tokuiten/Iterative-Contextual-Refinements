
import { ApplicationMode, DeepthinkPipelineState } from './Types';
import { createDefaultCustomPromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import { createDefaultCustomPromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import { createDefaultCustomPromptsContextual } from '../Contextual/ContextualPrompts';
import { AGENTIC_SYSTEM_PROMPT } from '../Agentic/AgenticModePrompt';
import { createDefaultCustomPromptsDCA } from '../Deepthink/DCA/DCAPrompts';

class GlobalStateManager {
    currentMode: ApplicationMode = 'deepthink';
    activeDeepthinkPipeline: DeepthinkPipelineState | null = null;
    isGenerating: boolean = false;
    currentProblemImages: Array<{ base64: string, mimeType: string }> = [];
    isCustomPromptsOpen: boolean = false;

    // Mode running states
    isAgenticRunning: boolean = false;
    isContextualRunning: boolean = false;
    isAdaptiveDeepthinkRunning: boolean = false;
    isDCARunning: boolean = false;

    // Gemini Code Execution (only for Contextual mode with Gemini provider)
    geminiCodeExecutionEnabled: boolean = false;

    // Gemini Thinking Level
    thinkingLevel: 'low' | 'medium' | 'high' | 'minimal' = 'high';

    customPromptsDeepthinkState = createDefaultCustomPromptsDeepthink();
    customPromptsAgenticState = { systemPrompt: AGENTIC_SYSTEM_PROMPT };
    customPromptsAdaptiveDeepthinkState = createDefaultCustomPromptsAdaptiveDeepthink();
    customPromptsContextualState = createDefaultCustomPromptsContextual();
    customPromptsDCAState = createDefaultCustomPromptsDCA();
}

export const globalState = new GlobalStateManager();

