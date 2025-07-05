/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { 
    defaultCustomPromptsWebsite, 
    defaultCustomPromptsCreative, 
    createDefaultCustomPromptsMath, 
    createDefaultCustomPromptsAgent,
    defaultCustomPromptsReact, // Added for React mode
    systemInstructionHtmlOutputOnly, // Though not directly used in index.tsx, it's good to be aware it's here if needed
    systemInstructionJsonOutputOnly, // Same as above
    systemInstructionTextOutputOnly   // Same as above
} from './prompts.js';
import mermaid from 'mermaid';


const API_KEY = process.env.API_KEY;

// Constants for retry logic
const MAX_RETRIES = 3; // Max number of retries for API errors
const INITIAL_DELAY_MS = 2000; // Initial delay in milliseconds
const BACKOFF_FACTOR = 2; // Factor by which delay increases

/**
 * Custom error class to signify that pipeline processing was intentionally
 * stopped by a user request.
 */
class PipelineStopRequestedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PipelineStopRequestedError";
    }
}

type ApplicationMode = 'website' | 'creative' | 'math' | 'agent' | 'react';

interface AgentGeneratedPrompts {
    iteration_type_description: string;
    expected_output_content_type: string; // e.g., "python", "text", "markdown"
    placeholders_guide: Record<string, string>;
    initial_generation: { system_instruction: string; user_prompt_template: string; };
    feature_implementation: { system_instruction: string; user_prompt_template: string; };
    refinement_and_suggestion: { system_instruction: string; user_prompt_template: string; }; // Expected to output JSON: { refined_content: string, suggestions: string[] }
    final_polish: { system_instruction: string; user_prompt_template: string; };
}

interface IterationData {
    iterationNumber: number; 
    title: string;
    // Website Mode Specific
    requestPromptHtml_InitialGenerate?: string; 
    requestPromptHtml_FeatureImplement?: string; 
    requestPromptHtml_BugFix?: string; 
    requestPromptFeatures_Suggest?: string; 
    generatedHtml?: string; 
    suggestedFeatures?: string[]; // Used by Website for general suggestions
    // Creative Writing Mode Specific
    requestPromptText_GenerateDraft?: string;
    requestPromptText_Critique?: string;
    requestPromptText_Revise?: string;
    requestPromptText_Polish?: string;
    generatedOrRevisedText?: string; 
    critiqueSuggestions?: string[];
    // Agent Mode Specific
    agentJudgeLLM_InitialRequest?: string; // Prompt to Judge LLM
    agentGeneratedPrompts?: AgentGeneratedPrompts; // Output from Judge LLM (stored in iter 0)
    requestPrompt_SysInstruction?: string; // Dynamically set system instruction for the current step
    requestPrompt_UserTemplate?: string; // Dynamically set user prompt template
    requestPrompt_Rendered?: string; // Actual rendered prompt sent to API
    generatedMainContent?: string; // Main output of an agent step (text, code, etc.)
    // For agent loop iterations that have two sub-steps (implement, then refine/suggest)
    requestPrompt_SubStep_SysInstruction?: string;
    requestPrompt_SubStep_UserTemplate?: string;
    requestPrompt_SubStep_Rendered?: string;
    generatedSubStep_Content?: string; 
    generatedSuggestions?: string[]; // For Agent mode's refine/suggest step output

    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string; 
    isDetailsOpen?: boolean; 
    retryAttempt?: number;
}

interface PipelineState {
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

// Math Mode Specific Interfaces
interface MathSubStrategyData {
    id: string; // e.g., "main1-sub1"
    subStrategyText: string;
    requestPromptSolutionAttempt?: string;
    solutionAttempt?: string;
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}
interface MathMainStrategyData {
    id: string; // e.g., "main1"
    strategyText: string;
    requestPromptSubStrategyGen?: string;
    subStrategies: MathSubStrategyData[];
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled'; // for sub-strategy generation
    error?: string; // error during sub-strategy generation for this main strategy
    isDetailsOpen?: boolean;
    retryAttempt?: number; // for sub-strategy generation step
}
interface MathPipelineState {
    id: string; // unique ID for this math problem instance
    problemText: string;
    problemImageBase64?: string | null; // Base64 encoded image
    problemImageMimeType?: string;
    requestPromptInitialStrategyGen?: string;
    initialStrategies: MathMainStrategyData[];
    status: 'idle' | 'processing' | 'retrying' | 'completed' | 'error' | 'stopping' | 'stopped' | 'cancelled'; // Overall status
    error?: string; // Overall error for the whole process
    isStopRequested?: boolean;
    activeTabId?: string; // e.g., "problem-details", "strategy-0", "strategy-1"
    retryAttempt?: number; // for initial strategy generation step
}


export interface CustomizablePromptsWebsite { // Export for prompts.ts
    sys_initialGen: string;
    user_initialGen: string; 
    sys_initialBugFix: string;
    user_initialBugFix: string; 
    sys_initialFeatureSuggest: string;
    user_initialFeatureSuggest: string; 
    sys_refineStabilizeImplement: string;
    user_refineStabilizeImplement: string; 
    sys_refineBugFix: string;
    user_refineBugFix: string; 
    sys_refineFeatureSuggest: string;
    user_refineFeatureSuggest: string; 
    sys_finalPolish: string;
    user_finalPolish: string; 
}

export interface CustomizablePromptsCreative { // Export for prompts.ts
    sys_creative_initialDraft: string;
    user_creative_initialDraft: string; // {{initialPremise}}
    sys_creative_initialCritique: string;
    user_creative_initialCritique: string; // {{currentDraft}}
    sys_creative_refine_revise: string;
    user_creative_refine_revise: string; // {{currentDraft}}, {{critiqueToImplementStr}}
    sys_creative_refine_critique: string;
    user_creative_refine_critique: string; // {{currentDraft}}
    sys_creative_final_polish: string;
    user_creative_final_polish: string; // {{currentDraft}}
}

export interface CustomizablePromptsMath { // Export for prompts.ts
    sys_math_initialStrategy: string;
    user_math_initialStrategy: string; // {{originalProblemText}} (+ image if provided)
    sys_math_subStrategy: string;
    user_math_subStrategy: string; // {{originalProblemText}}, {{currentMainStrategy}}, {{otherMainStrategiesStr}} (+ image)
    sys_math_solutionAttempt: string;
    user_math_solutionAttempt: string; // {{originalProblemText}}, {{currentSubStrategy}} (+ image)
}

export interface CustomizablePromptsAgent { // Export for prompts.ts
    sys_agent_judge_llm: string; // System instruction for the Judge LLM
    user_agent_judge_llm: string; // User prompt template for Judge LLM (e.g., "{{initialRequest}}", "{{NUM_AGENT_MAIN_REFINEMENT_LOOPS}}")
}


interface ExportedConfig {
    currentMode: ApplicationMode;
    initialIdea: string; // Also used for math problem text / agent request
    problemImageBase64?: string | null; // For math mode
    problemImageMimeType?: string; // For math mode
    selectedModel: string;
    selectedOriginalTemperatureIndices: number[]; // For website/creative/agent
    pipelinesState: PipelineState[]; // For website/creative/agent
    activeMathPipeline: MathPipelineState | null; // For math
    activeReactPipeline: ReactPipelineState | null; // Added for React mode
    activePipelineId: number | null; // For website/creative/agent
    activeMathProblemTabId?: string; // For math UI
    globalStatusText: string;
    globalStatusClass: string;
    customPromptsWebsite: CustomizablePromptsWebsite;
    customPromptsCreative: CustomizablePromptsCreative;
    customPromptsMath: CustomizablePromptsMath;
    customPromptsAgent: CustomizablePromptsAgent;
    customPromptsReact: CustomizablePromptsReact; // Added for React mode
    isCustomPromptsOpen?: boolean;
}

// React Mode Specific Interfaces
export interface ReactModeStage { // Exporting for potential use elsewhere, though primarily internal
    id: number; // 0-4 for the 5 worker agents
    title: string; // e.g., "Agent 1: UI Components" - defined by Orchestrator
    systemInstruction?: string; // Generated by Orchestrator for this worker agent
    userPrompt?: string; // Generated by Orchestrator for this worker agent (can be a template)
    renderedUserPrompt?: string; // If the userPrompt is a template
    generatedContent?: string; // Code output from this worker agent
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}

export interface ReactPipelineState { // Exporting for potential use elsewhere
    id: string; // Unique ID for this React mode process run
    userRequest: string;
    orchestratorSystemInstruction: string; // The system prompt used for the orchestrator
    orchestratorPlan?: string; // plan.txt generated by Orchestrator
    orchestratorRawOutput?: string; // Full raw output from orchestrator (for debugging/inspection)
    stages: ReactModeStage[]; // Array of 5 worker agent stages
    finalAppendedCode?: string; // Combined code from all worker agents
    status: 'idle' | 'orchestrating' | 'processing_workers' | 'completed' | 'error' | 'stopping' | 'stopped' | 'cancelled' | 'orchestrating_retrying';
    error?: string;
    isStopRequested?: boolean;
    activeTabId?: string; // To track which of the 5 worker agent tabs is active in UI, e.g., "worker-0", "worker-1"
    orchestratorRetryAttempt?: number;
}

export interface CustomizablePromptsReact { // Export for prompts.ts
    sys_orchestrator: string; // System instruction for the Orchestrator Agent
    user_orchestrator: string; // User prompt template for Orchestrator Agent {{user_request}}
}


const NUM_WEBSITE_REFINEMENT_ITERATIONS = 5; 
const NUM_CREATIVE_REFINEMENT_ITERATIONS = 3; 
export const NUM_AGENT_MAIN_REFINEMENT_LOOPS = 3; 
const TOTAL_STEPS_WEBSITE = 1 + NUM_WEBSITE_REFINEMENT_ITERATIONS + 1; 
const TOTAL_STEPS_CREATIVE = 1 + NUM_CREATIVE_REFINEMENT_ITERATIONS + 1;
// Agent steps: 1 (Judge) + 1 (Initial Gen) + 1 (Initial Refine/Suggest) + N (Loops) + 1 (Final Polish)
const TOTAL_STEPS_AGENT = 1 + 1 + 1 + NUM_AGENT_MAIN_REFINEMENT_LOOPS + 1;


export const NUM_INITIAL_STRATEGIES_MATH = 4; 
export const NUM_SUB_STRATEGIES_PER_MAIN_MATH = 4; 
const MATH_MODEL_NAME = "gemini-2.5-pro"; 
const MATH_FIXED_TEMPERATURE = 1.0; 


const temperatures = [0, 0.7, 1.0, 1.5, 2.0]; 

let pipelinesState: PipelineState[] = [];
let activeMathPipeline: MathPipelineState | null = null;
let activeReactPipeline: ReactPipelineState | null = null; // Added for React mode
let ai: GoogleGenAI | null = null;
let activePipelineId: number | null = null;
let isGenerating = false;
let currentMode: ApplicationMode = 'website';
let currentProblemImageBase64: string | null = null;
let currentProblemImageMimeType: string | null = null;
// This variable is no longer used for the modal state but can be kept for config export/import
let isCustomPromptsOpen = false;


let customPromptsWebsiteState: CustomizablePromptsWebsite = JSON.parse(JSON.stringify(defaultCustomPromptsWebsite));
let customPromptsCreativeState: CustomizablePromptsCreative = JSON.parse(JSON.stringify(defaultCustomPromptsCreative));
let customPromptsMathState: CustomizablePromptsMath = createDefaultCustomPromptsMath(NUM_INITIAL_STRATEGIES_MATH, NUM_SUB_STRATEGIES_PER_MAIN_MATH);
let customPromptsAgentState: CustomizablePromptsAgent = createDefaultCustomPromptsAgent(NUM_AGENT_MAIN_REFINEMENT_LOOPS);
let customPromptsReactState: CustomizablePromptsReact = JSON.parse(JSON.stringify(defaultCustomPromptsReact)); // Added for React mode


const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveApiKeyButton = document.getElementById('save-api-key-button') as HTMLButtonElement;
const clearApiKeyButton = document.getElementById('clear-api-key-button') as HTMLButtonElement;
const apiKeyStatusElement = document.getElementById('api-key-status') as HTMLParagraphElement;

const initialIdeaInput = document.getElementById('initial-idea') as HTMLTextAreaElement;
const initialIdeaLabel = document.getElementById('initial-idea-label') as HTMLLabelElement;
const mathProblemImageInputContainer = document.getElementById('math-problem-image-input-container') as HTMLElement;
const mathProblemImageInput = document.getElementById('math-problem-image-input') as HTMLInputElement;
const mathProblemImagePreview = document.getElementById('math-problem-image-preview') as HTMLImageElement;

const modelSelectionContainer = document.getElementById('model-selection-container') as HTMLElement;
const modelSelectElement = document.getElementById('model-select') as HTMLSelectElement;
const temperatureSelectionContainer = document.getElementById('temperature-selection-container') as HTMLElement;
const generateButton = document.getElementById('generate-button') as HTMLButtonElement;
const tabsNavContainer = document.getElementById('tabs-nav-container') as HTMLElement;
const pipelinesContentContainer = document.getElementById('pipelines-content-container') as HTMLElement;
const globalStatusDiv = document.getElementById('global-status') as HTMLElement;
const pipelineSelectorsContainer = document.getElementById('pipeline-selectors-container') as HTMLElement;
const appModeSelector = document.getElementById('app-mode-selector') as HTMLElement;

// Prompts containers inside the modal
const websitePromptsContainer = document.getElementById('website-prompts-container') as HTMLElement;
const creativePromptsContainer = document.getElementById('creative-prompts-container') as HTMLElement;
const mathPromptsContainer = document.getElementById('math-prompts-container') as HTMLElement;
const agentPromptsContainer = document.getElementById('agent-prompts-container') as HTMLElement;
const reactPromptsContainer = document.getElementById('react-prompts-container') as HTMLElement; // Added for React mode

// Custom Prompts Modal Elements
const promptsModalOverlay = document.getElementById('prompts-modal-overlay') as HTMLElement;
const promptsModalCloseButton = document.getElementById('prompts-modal-close-button') as HTMLButtonElement;
const customPromptsHeader = document.querySelector('.custom-prompts-header') as HTMLElement;


const exportConfigButton = document.getElementById('export-config-button') as HTMLButtonElement;
const importConfigInput = document.getElementById('import-config-input') as HTMLInputElement;
const importConfigLabel = document.getElementById('import-config-label') as HTMLLabelElement;

const customPromptTextareasWebsite: { [K in keyof CustomizablePromptsWebsite]: HTMLTextAreaElement | null } = {
    sys_initialGen: document.getElementById('sys-initial-gen') as HTMLTextAreaElement,
    user_initialGen: document.getElementById('user-initial-gen') as HTMLTextAreaElement,
    sys_initialBugFix: document.getElementById('sys-initial-bugfix') as HTMLTextAreaElement,
    user_initialBugFix: document.getElementById('user-initial-bugfix') as HTMLTextAreaElement,
    sys_initialFeatureSuggest: document.getElementById('sys-initial-features') as HTMLTextAreaElement,
    user_initialFeatureSuggest: document.getElementById('user-initial-features') as HTMLTextAreaElement,
    sys_refineStabilizeImplement: document.getElementById('sys-refine-implement') as HTMLTextAreaElement,
    user_refineStabilizeImplement: document.getElementById('user-refine-implement') as HTMLTextAreaElement,
    sys_refineBugFix: document.getElementById('sys-refine-bugfix') as HTMLTextAreaElement,
    user_refineBugFix: document.getElementById('user-refine-bugfix') as HTMLTextAreaElement,
    sys_refineFeatureSuggest: document.getElementById('sys-refine-features') as HTMLTextAreaElement,
    user_refineFeatureSuggest: document.getElementById('user-refine-features') as HTMLTextAreaElement,
    sys_finalPolish: document.getElementById('sys-final-polish') as HTMLTextAreaElement,
    user_finalPolish: document.getElementById('user-final-polish') as HTMLTextAreaElement,
};

const customPromptTextareasCreative: { [K in keyof CustomizablePromptsCreative]: HTMLTextAreaElement | null } = {
    sys_creative_initialDraft: document.getElementById('sys-creative-initial-draft') as HTMLTextAreaElement,
    user_creative_initialDraft: document.getElementById('user-creative-initial-draft') as HTMLTextAreaElement,
    sys_creative_initialCritique: document.getElementById('sys-creative-initial-critique') as HTMLTextAreaElement,
    user_creative_initialCritique: document.getElementById('user-creative-initial-critique') as HTMLTextAreaElement,
    sys_creative_refine_revise: document.getElementById('sys-creative-refine-revise') as HTMLTextAreaElement,
    user_creative_refine_revise: document.getElementById('user-creative-refine-revise') as HTMLTextAreaElement,
    sys_creative_refine_critique: document.getElementById('sys-creative-refine-critique') as HTMLTextAreaElement,
    user_creative_refine_critique: document.getElementById('user-creative-refine-critique') as HTMLTextAreaElement,
    sys_creative_final_polish: document.getElementById('sys-creative-final-polish') as HTMLTextAreaElement,
    user_creative_final_polish: document.getElementById('user-creative-final-polish') as HTMLTextAreaElement,
};

const customPromptTextareasMath: { [K in keyof CustomizablePromptsMath]: HTMLTextAreaElement | null } = {
    sys_math_initialStrategy: document.getElementById('sys-math-initial-strategy') as HTMLTextAreaElement,
    user_math_initialStrategy: document.getElementById('user-math-initial-strategy') as HTMLTextAreaElement,
    sys_math_subStrategy: document.getElementById('sys-math-sub-strategy') as HTMLTextAreaElement,
    user_math_subStrategy: document.getElementById('user-math-sub-strategy') as HTMLTextAreaElement,
    sys_math_solutionAttempt: document.getElementById('sys-math-solution-attempt') as HTMLTextAreaElement,
    user_math_solutionAttempt: document.getElementById('user-math-solution-attempt') as HTMLTextAreaElement,
};

const customPromptTextareasAgent: { [K in keyof CustomizablePromptsAgent]: HTMLTextAreaElement | null } = {
    sys_agent_judge_llm: document.getElementById('sys-agent-judge-llm') as HTMLTextAreaElement,
    user_agent_judge_llm: document.getElementById('user-agent-judge-llm') as HTMLTextAreaElement,
};

const customPromptTextareasReact: { [K in keyof CustomizablePromptsReact]: HTMLTextAreaElement | null } = { // Added for React mode
    sys_orchestrator: document.getElementById('sys-react-orchestrator') as HTMLTextAreaElement,
    user_orchestrator: document.getElementById('user-react-orchestrator') as HTMLTextAreaElement,
};

// SVG Icons
const fullscreenIconSvg = `
<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" aria-hidden="true">
  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
</svg>`;
const exitFullscreenIconSvg = `
<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" aria-hidden="true">
  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
</svg>`;


function initializeApiKey() {
    let userApiKey = localStorage.getItem('geminiApiKey');
    let keyToUse: string | undefined = undefined;
    let statusMessage = "";
    let isKeyAvailable = false;

    if (userApiKey) {
        keyToUse = userApiKey;
        statusMessage = "API Key loaded from Local Storage.";
        isKeyAvailable = true;
        if(apiKeyInput && !apiKeyInput.placeholder) apiKeyInput.placeholder = "Using key from Local Storage";
    } else if (API_KEY) { // process.env.API_KEY
        keyToUse = API_KEY;
        statusMessage = "API Key loaded from build configuration (environment variable).";
        isKeyAvailable = true;
         if(apiKeyInput) apiKeyInput.placeholder = "Using key from build config";
    } else {
        statusMessage = "Gemini API Key not set. Please enter your API key above and click 'Save Key'.";
        isKeyAvailable = false;
        if(apiKeyInput) apiKeyInput.placeholder = "Enter your API Key";
    }

    if (apiKeyStatusElement) {
        apiKeyStatusElement.textContent = statusMessage;
        apiKeyStatusElement.className = isKeyAvailable ? 'api-key-status-message status-ok' : 'api-key-status-message status-error';
    }

    if (generateButton) { // Ensure generate button exists
        generateButton.disabled = !isKeyAvailable || isGenerating; // Also consider isGenerating
    }


    if (keyToUse) {
        try {
            ai = new GoogleGenAI({ apiKey: keyToUse });
            if (generateButton) generateButton.disabled = isGenerating; // Re-evaluate generateButton based on isGenerating
            return true;
        } catch (e: any) {
            console.error("Failed to initialize GoogleGenAI with the provided key:", e);
            if (apiKeyStatusElement) {
                apiKeyStatusElement.textContent = `Error initializing API with key: ${e.message}. Please check the key.`;
                apiKeyStatusElement.className = 'api-key-status-message status-error';
            }
            if (generateButton) generateButton.disabled = true;
            ai = null; // Ensure AI client is null if initialization fails
            return false;
        }
    } else {
        // This case is already handled by setting generateButton.disabled = true
        // and the message in apiKeyStatusElement.
        ai = null; // Ensure AI client is null
        return false;
    }
}


function initializeCustomPromptTextareas() {
    // Website Prompts
    for (const key in customPromptTextareasWebsite) {
        const k = key as keyof CustomizablePromptsWebsite;
        const textarea = customPromptTextareasWebsite[k];
        if (textarea) {
            textarea.value = customPromptsWebsiteState[k];
            textarea.addEventListener('input', (e) => {
                customPromptsWebsiteState[k] = (e.target as HTMLTextAreaElement).value;
            });
        }
    }
    // Creative Prompts
    for (const key in customPromptTextareasCreative) {
        const k = key as keyof CustomizablePromptsCreative;
        const textarea = customPromptTextareasCreative[k];
        if (textarea) {
            textarea.value = customPromptsCreativeState[k];
            textarea.addEventListener('input', (e) => {
                customPromptsCreativeState[k] = (e.target as HTMLTextAreaElement).value;
            });
        }
    }
    // Math Prompts
    for (const key in customPromptTextareasMath) {
        const k = key as keyof CustomizablePromptsMath;
        const textarea = customPromptTextareasMath[k];
        if (textarea) {
            textarea.value = customPromptsMathState[k];
            textarea.addEventListener('input', (e) => {
                customPromptsMathState[k] = (e.target as HTMLTextAreaElement).value;
            });
        }
    }
    // Agent Prompts (for Judge LLM)
    for (const key in customPromptTextareasAgent) {
        const k = key as keyof CustomizablePromptsAgent;
        const textarea = customPromptTextareasAgent[k];
        if (textarea) {
            textarea.value = customPromptsAgentState[k];
            textarea.addEventListener('input', (e) => {
                customPromptsAgentState[k] = (e.target as HTMLTextAreaElement).value;
            });
        }
    }
    // React Prompts (for Orchestrator)
    for (const key in customPromptTextareasReact) {
        const k = key as keyof CustomizablePromptsReact;
        const textarea = customPromptTextareasReact[k];
        if (textarea) {
            textarea.value = customPromptsReactState[k];
            textarea.addEventListener('input', (e) => {
                customPromptsReactState[k] = (e.target as HTMLTextAreaElement).value;
            });
        }
    }
}

function updateCustomPromptTextareasFromState() {
     for (const key in customPromptTextareasWebsite) {
        const k = key as keyof CustomizablePromptsWebsite;
        const textarea = customPromptTextareasWebsite[k];
        if (textarea) textarea.value = customPromptsWebsiteState[k];
    }
    for (const key in customPromptTextareasCreative) {
        const k = key as keyof CustomizablePromptsCreative;
        const textarea = customPromptTextareasCreative[k];
        if (textarea) textarea.value = customPromptsCreativeState[k];
    }
    for (const key in customPromptTextareasMath) {
        const k = key as keyof CustomizablePromptsMath;
        const textarea = customPromptTextareasMath[k];
        if (textarea) textarea.value = customPromptsMathState[k];
    }
    for (const key in customPromptTextareasAgent) {
        const k = key as keyof CustomizablePromptsAgent;
        const textarea = customPromptTextareasAgent[k];
        if (textarea) textarea.value = customPromptsAgentState[k];
    }
    for (const key in customPromptTextareasReact) { // Added for React mode
        const k = key as keyof CustomizablePromptsReact;
        const textarea = customPromptTextareasReact[k];
        if (textarea) textarea.value = customPromptsReactState[k];
    }
}

function setPromptsModalVisible(visible: boolean) {
    if (promptsModalOverlay) {
        if (visible) {
            promptsModalOverlay.style.display = 'flex'; // Use flex to enable centering
            // Delay adding class to allow transition to run
            setTimeout(() => {
                promptsModalOverlay.classList.add('is-visible');
            }, 10); 
        } else {
            promptsModalOverlay.classList.remove('is-visible');
             // Listen for transition end to set display none, prevents abrupt disappearance
            promptsModalOverlay.addEventListener('transitionend', () => {
                if (!promptsModalOverlay.classList.contains('is-visible')) {
                    promptsModalOverlay.style.display = 'none';
                }
            }, { once: true });
        }
    }
}

function updateUIAfterModeChange() {
    // Hide all prompt containers initially
    if(websitePromptsContainer) websitePromptsContainer.style.display = 'none';
    if(creativePromptsContainer) creativePromptsContainer.style.display = 'none';
    if(mathPromptsContainer) mathPromptsContainer.style.display = 'none';
    if(agentPromptsContainer) agentPromptsContainer.style.display = 'none';
    if(reactPromptsContainer) reactPromptsContainer.style.display = 'none';

    // Default UI states
    if(mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'none';
    if(modelSelectionContainer) modelSelectionContainer.style.display = 'block';
    if(temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'block';

    // Update main input label based on mode
    const mainInputSummarySpan = document.querySelector('#section-main-input summary span');

    if (currentMode === 'website') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'HTML Idea:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., a personal blog about cooking, a portfolio...';
        if (generateButton) generateButton.textContent = 'Generate HTML';
        if (websitePromptsContainer) websitePromptsContainer.style.display = 'block';
        if (mainInputSummarySpan) mainInputSummarySpan.textContent = 'HTML Idea';
    } else if (currentMode === 'creative') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Writing Premise:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., a short story about a time traveler, a poem...';
        if (generateButton) generateButton.textContent = 'Refine Writing';
        if (creativePromptsContainer) creativePromptsContainer.style.display = 'block';
        if (mainInputSummarySpan) mainInputSummarySpan.textContent = 'Writing Premise';
    } else if (currentMode === 'math') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Math Problem:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "Solve for x: 2x + 5 = 11" or describe...';
        if (generateButton) generateButton.textContent = 'Solve Problem';
        if (mathPromptsContainer) mathPromptsContainer.style.display = 'block';
        if (mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'block';
        if (modelSelectionContainer) modelSelectionContainer.style.display = 'none';
        if (temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'none';
        if (mainInputSummarySpan) mainInputSummarySpan.textContent = 'Math Problem';
    } else if (currentMode === 'agent') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Your Request:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "Python snake game", "Analyze iPhone sales data"...';
        if (generateButton) generateButton.textContent = 'Start Agent Process';
        if (agentPromptsContainer) agentPromptsContainer.style.display = 'block';
        if (mainInputSummarySpan) mainInputSummarySpan.textContent = 'Agent Request';
    } else if (currentMode === 'react') { // Added for React mode
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'React App Request:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "A simple to-do list app with local storage persistence", "A weather dashboard using OpenWeatherMap API"...';
        if (generateButton) generateButton.textContent = 'Generate React App';
        if (reactPromptsContainer) reactPromptsContainer.style.display = 'block';
        // React mode uses standard model and temperature selection like website/creative/agent
        if (modelSelectionContainer) modelSelectionContainer.style.display = 'block';
        if (temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'block';
        if (mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'none';
        if (mainInputSummarySpan) mainInputSummarySpan.textContent = 'React App Request';
    }


    if (!isGenerating) {
        pipelinesState = [];
        activeMathPipeline = null;
        activeReactPipeline = null;
        renderPipelines(); 
        renderActiveMathPipeline(); 
        renderReactModePipeline();
    }
    updateControlsState();
     // If graph view is active, re-render it
    const viewToggleGraphButton = document.getElementById('view-toggle-graph') as HTMLButtonElement;
    if (viewToggleGraphButton && viewToggleGraphButton.classList.contains('active')) {
        renderGraphView();
    }
}


function renderPrompt(template: string, data: Record<string, string>): string {
    let rendered = template;
    for (const key in data) {
        rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), data[key] || '');
    }
    return rendered;
}


function renderPipelineSelectors() {
    if (!pipelineSelectorsContainer) return;
    pipelineSelectorsContainer.innerHTML = ''; // Clear existing
    temperatures.forEach((temp, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'pipeline-selector-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `pipeline-selector-${index}`;
        checkbox.value = temp.toString();
        checkbox.checked = true; // Default to checked
        checkbox.dataset.temperatureIndex = index.toString();


        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = `Variant (T: ${temp.toFixed(1)})`; // Changed label for more generic usage

        itemDiv.appendChild(checkbox);
        itemDiv.appendChild(label);
        pipelineSelectorsContainer.appendChild(itemDiv);

        checkbox.addEventListener('change', () => {
            updateControlsState();
        });
    });
    updateControlsState(); // Initial state
}

function getSelectedTemperatures(): { temp: number, originalIndex: number }[] {
    const selected: { temp: number, originalIndex: number }[] = [];
    if (pipelineSelectorsContainer) {
        const checkboxes = pipelineSelectorsContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
        checkboxes.forEach(checkbox => {
            const tempValue = parseFloat(checkbox.value);
            const originalIndex = parseInt(checkbox.dataset.temperatureIndex || "-1", 10);
            if (!isNaN(tempValue) && originalIndex !== -1) {
                selected.push({ temp: tempValue, originalIndex });
            }
        });
    }
    return selected;
}

function updateControlsState() {
    const anyPipelineRunningOrStopping = pipelinesState.some(p => p.status === 'running' || p.status === 'stopping');
    const mathPipelineRunningOrStopping = activeMathPipeline?.status === 'processing' || activeMathPipeline?.status === 'stopping';
    const reactPipelineRunningOrStopping = activeReactPipeline?.status === 'orchestrating' || activeReactPipeline?.status === 'processing_workers' || activeReactPipeline?.status === 'stopping'; // Added for React
    isGenerating = anyPipelineRunningOrStopping || mathPipelineRunningOrStopping || reactPipelineRunningOrStopping; // Added reactPipeline

    if (generateButton) {
        if (currentMode === 'math') {
             generateButton.disabled = isGenerating;
        } else if (currentMode === 'react') { // React mode doesn't use temperature variants from selectors for its main generation button
            generateButton.disabled = isGenerating;
        } else { // website, creative, agent
            const selectedTemps = getSelectedTemperatures();
            generateButton.disabled = selectedTemps.length === 0 || isGenerating;
        }
    }
    if (exportConfigButton) exportConfigButton.disabled = isGenerating;
    if (importConfigInput) importConfigInput.disabled = isGenerating;
    if (importConfigLabel) importConfigLabel.classList.toggle('disabled', isGenerating);
    if (initialIdeaInput) initialIdeaInput.disabled = isGenerating;
    if (mathProblemImageInput) mathProblemImageInput.disabled = isGenerating;
    
    if (modelSelectElement) modelSelectElement.disabled = isGenerating || currentMode === 'math'; // Math uses fixed model, React uses selected
    if (pipelineSelectorsContainer) {
        const disableSelectors = isGenerating || currentMode === 'math' || currentMode === 'react'; // React mode also disables these for now
        pipelineSelectorsContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb as HTMLInputElement).disabled = disableSelectors);
        const pipelineSelectLabel = document.getElementById('pipeline-select-heading');
        if (pipelineSelectLabel) {
             pipelineSelectLabel.textContent = (currentMode === 'math' || currentMode === 'react') ? `${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)} mode uses a fixed configuration for this step.` : 'Select Variants to Run (Temperature):';
             pipelineSelectLabel.style.color = disableSelectors ? 'var(--text-secondary-color)' : 'var(--text-color)';
             pipelineSelectLabel.style.opacity = disableSelectors ? '0.6' : '1';
        }

    }
     if (currentMode === 'math') {
        if(modelSelectElement) modelSelectElement.value = MATH_MODEL_NAME; // Force model for math
    }

    if (appModeSelector) {
        appModeSelector.querySelectorAll('input[type="radio"]').forEach(rb => (rb as HTMLInputElement).disabled = isGenerating);
    }

    const currentPromptTextareas = 
        currentMode === 'website' ? customPromptTextareasWebsite :
        currentMode === 'creative' ? customPromptTextareasCreative :
        currentMode === 'math' ? customPromptTextareasMath :
        currentMode === 'agent' ? customPromptTextareasAgent :
        currentMode === 'react' ? customPromptTextareasReact : null; // Added for React

    if (currentPromptTextareas) {
        for (const textarea of Object.values(currentPromptTextareas)) {
            if (textarea) { 
                textarea.disabled = isGenerating;
            }
        }
    }
    if (customPromptsHeader) {
        const customPromptsContainer = document.getElementById('custom-prompts-container');
        // The custom prompts section is now a <details> element itself.
        // We need to handle its 'disabled' state slightly differently if it's a details element.
        const customPromptsDetailsElement = document.getElementById('section-custom-prompts') as HTMLDetailsElement | null;
        if (customPromptsDetailsElement) {
            // Disabling a details element is tricky. We can disable its summary or add a class.
            // For now, let's rely on the global isGenerating checks for textareas inside.
            // The visual cue of the header itself might need to be handled too.
            const summary = customPromptsDetailsElement.querySelector('summary');
            if (summary) summary.style.pointerEvents = isGenerating ? 'none' : 'auto';
            customPromptsDetailsElement.classList.toggle('disabled-section', isGenerating);

        } else if (customPromptsContainer) { // Fallback for old structure if any part remains
             customPromptsContainer.classList.toggle('disabled-section', isGenerating);
        }
        // The customPromptsHeader (which is now a summary for the details element)
        // should have its pointer events managed if it's part of a details element.
        // If it's the summary of section-custom-prompts, its style.pointerEvents is handled above.
    }
}


function initPipelines() { 
    const selectedModel = modelSelectElement.value;
    const selectedTempsWithOriginalIndices = getSelectedTemperatures();
    let totalSteps: number;
    let numRefinementIterations: number;

    switch (currentMode) {
        case 'website':
            totalSteps = TOTAL_STEPS_WEBSITE;
            numRefinementIterations = NUM_WEBSITE_REFINEMENT_ITERATIONS;
            break;
        case 'creative':
            totalSteps = TOTAL_STEPS_CREATIVE;
            numRefinementIterations = NUM_CREATIVE_REFINEMENT_ITERATIONS;
            break;
        case 'agent':
            totalSteps = TOTAL_STEPS_AGENT;
            numRefinementIterations = NUM_AGENT_MAIN_REFINEMENT_LOOPS; 
            break;
        default: 
            return;
    }


    pipelinesState = selectedTempsWithOriginalIndices.map(({ temp, originalIndex }, pipelineIndex) => {
        const iterations: IterationData[] = [];
        for (let i = 0; i < totalSteps; i++) {
            let title = '';
            if (currentMode === 'website') {
                if (i === 0) title = 'Initial Gen, Fix & Suggest';
                else if (i <= numRefinementIterations) title = `Refine ${i}: Stabilize, Implement, Fix & Suggest`;
                else title = 'Final Polish & Fix';
            } else if (currentMode === 'creative') {
                if (i === 0) title = 'Initial Draft & Critique';
                else if (i <= numRefinementIterations) title = `Refine ${i}: Revise & Critique`;
                else title = 'Final Polish';
            } else if (currentMode === 'agent') {
                if (i === 0) title = `Setup: Agent Prompt Design`;
                else if (i === 1) title = `Step ${i}: Initial Generation`; // Step is i (1-based for users)
                else if (i === 2) title = `Step ${i}: Initial Refinement & Suggestion`;
                else if (i < totalSteps -1) { // Iterations from 3 up to (but not including) the last one are loops
                     const loopNumber = i - 2; // Loop numbers are 1-based (i=3 is Loop 1)
                     title = `Step ${i}: Refinement Loop ${loopNumber} (Implement & Refine/Suggest)`;
                }
                else title = `Step ${i}: Final Polish`; // Last step is i
            }
            iterations.push({
                iterationNumber: i,
                title: title,
                status: 'pending',
                isDetailsOpen: i === 0, 
            });
        }
        return {
            id: pipelineIndex,
            originalTemperatureIndex: originalIndex,
            temperature: temp,
            modelName: selectedModel,
            iterations: iterations,
            status: 'idle',
            isStopRequested: false, 
        };
    });
    renderPipelines();
    if (pipelinesState.length > 0) {
        activateTab(pipelinesState[0].id);
    } else { 
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message" style="padding: 1rem; color: var(--text-secondary-color);">No variants selected to run.</p>';
        pipelinesContentContainer.innerHTML = '';
    }
    updateControlsState(); 
}


function activateTab(pipelineIdOrMathTabId: number | string) {
    if (currentMode === 'math' && activeMathPipeline) {
        activeMathPipeline.activeTabId = pipelineIdOrMathTabId as string;
        document.querySelectorAll('#tabs-nav-container .tab-button.math-mode-tab').forEach(btn => {
            btn.classList.toggle('active', btn.id === `math-tab-${pipelineIdOrMathTabId}`);
            btn.setAttribute('aria-selected', (btn.id === `math-tab-${pipelineIdOrMathTabId}`).toString());
        });
        document.querySelectorAll('.math-pipeline-content-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `math-content-${pipelineIdOrMathTabId}`);
        });
    } else if (currentMode === 'react' && activeReactPipeline) { // Added for React mode
        activeReactPipeline.activeTabId = pipelineIdOrMathTabId as string; // e.g., "worker-0"
        document.querySelectorAll('#tabs-nav-container .tab-button.react-mode-tab').forEach(btn => {
            const buttonReactTabId = btn.id.replace('react-pipeline-tab-', ''); // react-pipeline-tab-worker-0 -> worker-0
            btn.classList.toggle('active', buttonReactTabId === activeReactPipeline.activeTabId);
            btn.setAttribute('aria-selected', (buttonReactTabId === activeReactPipeline.activeTabId).toString());
        });
        document.querySelectorAll('.react-worker-content-pane').forEach(pane => {
            const paneReactTabId = pane.id.replace('react-worker-content-', ''); // react-worker-content-worker-0 -> worker-0
            pane.classList.toggle('active', paneReactTabId === activeReactPipeline.activeTabId);
        });
    } else if (currentMode !== 'math' && currentMode !== 'react') { // For website, creative, agent
        activePipelineId = pipelineIdOrMathTabId as number;
        pipelinesState.forEach(p => {
            if (p.tabButtonElement) {
                p.tabButtonElement.classList.toggle('active', p.id === activePipelineId);
                p.tabButtonElement.setAttribute('aria-selected', (p.id === activePipelineId).toString());
            }
            if (p.contentElement) {
                p.contentElement.classList.toggle('active', p.id === activePipelineId);
            }
        });
    }
}


function renderPipelines() { 
    if (currentMode === 'math' || currentMode === 'react') {
        tabsNavContainer.innerHTML = ''; 
        // Clear only standard pipeline content, not graph view or React-specific static panes
        document.querySelectorAll('.pipeline-content:not(#graph-view-container)').forEach(el => el.innerHTML = '');
        return;
    }
    tabsNavContainer.innerHTML = '';
    document.querySelectorAll('.pipeline-content:not(#graph-view-container)').forEach(el => el.remove()); // Remove old pipeline content

    if (pipelinesState.length === 0 && currentMode !== 'math' && currentMode !== 'react') {
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message" style="padding: 1rem; color: var(--text-secondary-color);">No variants selected. Please choose at least one variant or import a configuration.</p>';
        // Ensure pipelinesContentContainer is also cleared if it was used for these messages
        if (pipelinesContentContainer.querySelector('.no-pipelines-message')) {
            pipelinesContentContainer.innerHTML = ''; // Clear if it had the message
        }
        return;
    }

    pipelinesState.forEach(pipeline => {
        const tabButton = document.createElement('button');
        tabButton.className = `tab-button status-${pipeline.status}`;
        tabButton.textContent = `Variant ${pipeline.id + 1} (T: ${pipeline.temperature.toFixed(1)})`;
        tabButton.setAttribute('role', 'tab');
        tabButton.setAttribute('aria-controls', `pipeline-content-${pipeline.id}`);
        tabButton.setAttribute('id', `pipeline-tab-${pipeline.id}`);
        tabButton.addEventListener('click', () => activateTab(pipeline.id));
        tabsNavContainer.appendChild(tabButton);
        pipeline.tabButtonElement = tabButton;

        const pipelineContentDiv = document.createElement('div');
        pipelineContentDiv.className = 'pipeline-content'; // This will be hidden/shown by view toggle too
        pipelineContentDiv.setAttribute('id', `pipeline-content-${pipeline.id}`);
        pipelineContentDiv.setAttribute('role', 'tabpanel');
        pipelineContentDiv.setAttribute('aria-labelledby', `pipeline-tab-${pipeline.id}`);

        const pipelineType = currentMode === 'agent' ? "Agent Process" : "Pipeline";

        pipelineContentDiv.innerHTML = `
            <div class="pipeline-header">
                <h3 id="pipeline-heading-${pipeline.id}">${pipelineType} Variant ${pipeline.id + 1} (Temp: ${pipeline.temperature.toFixed(1)}, Model: ${pipeline.modelName})</h3>
                <div class="pipeline-header-controls">
                    <span class="pipeline-status status-${pipeline.status}" id="pipeline-status-text-${pipeline.id}">${pipeline.status}</span>
                    <button class="stop-pipeline-button button-base action-button" id="stop-pipeline-btn-${pipeline.id}" title="Stop this ${pipelineType.toLowerCase()}" aria-label="Stop this ${pipelineType.toLowerCase()}" style="display: none;">Stop</button>
                </div>
            </div>
            <ul class="iterations-list" id="iterations-list-${pipeline.id}">
                ${pipeline.iterations.map(iter => renderIteration(pipeline.id, iter)).join('')}
            </ul>
        `;
        pipelinesContentContainer.appendChild(pipelineContentDiv);
        pipeline.contentElement = pipelineContentDiv;

        const stopButton = pipelineContentDiv.querySelector<HTMLButtonElement>(`#stop-pipeline-btn-${pipeline.id}`);
        if (stopButton) {
            pipeline.stopButtonElement = stopButton;
            stopButton.addEventListener('click', () => {
                const currentPipeline = pipelinesState.find(p => p.id === pipeline.id);
                if (currentPipeline && currentPipeline.status === 'running') {
                    currentPipeline.isStopRequested = true;
                    updatePipelineStatusUI(pipeline.id, 'stopping');
                }
            });
        }
        updatePipelineStatusUI(pipeline.id, pipeline.status); 

        pipeline.iterations.forEach(iter => {
            const detailsElement = pipelineContentDiv.querySelector<HTMLDetailsElement>(`#iteration-${pipeline.id}-${iter.iterationNumber} details`);
            const summaryElement = detailsElement?.querySelector('summary');
            if (detailsElement && summaryElement) {
                if (iter.isDetailsOpen !== undefined) {
                   detailsElement.open = iter.isDetailsOpen;
                }
                summaryElement.addEventListener('click', (e) => {
                    setTimeout(() => { 
                        const iterToUpdate = pipelinesState.find(p => p.id === pipeline.id)?.iterations.find(it => it.iterationNumber === iter.iterationNumber);
                        if (iterToUpdate) {
                            iterToUpdate.isDetailsOpen = detailsElement.open;
                        }
                    }, 0);
                });
            }
            attachIterationActionButtons(pipeline.id, iter.iterationNumber);
        });
    });
     // Ensure correct display if list view is active
    const viewToggleListButton = document.getElementById('view-toggle-list') as HTMLButtonElement;
    if (viewToggleListButton && viewToggleListButton.classList.contains('active')) {
        if (activePipelineId !== null) {
            document.querySelectorAll('.pipeline-content').forEach(pc => {
                (pc as HTMLElement).style.display = pc.id === `pipeline-content-${activePipelineId}` ? 'block' : 'none';
            });
        }
    }
}

function renderIteration(pipelineId: number, iter: IterationData): string {
    let displayStatusText: string = iter.status.charAt(0).toUpperCase() + iter.status.slice(1);
    if (iter.status === 'retrying' && iter.retryAttempt !== undefined) {
        displayStatusText = `Retrying (${iter.retryAttempt}/${MAX_RETRIES})...`;
    } else if (iter.status === 'error') displayStatusText = 'Error';
    else if (iter.status === 'cancelled') displayStatusText = 'Cancelled';

    let promptsHtml = '';
    if (currentMode === 'website') {
        if (iter.requestPromptHtml_InitialGenerate) promptsHtml += `<h4 class="prompt-title prompt-title-initial-gen">Initial HTML Generation Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptHtml_InitialGenerate)}</pre>`;
        if (iter.requestPromptHtml_FeatureImplement) promptsHtml += `<h4 class="prompt-title prompt-title-feature-implement">Feature Implementation & Stabilization Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptHtml_FeatureImplement)}</pre>`;
        if (iter.requestPromptHtml_BugFix) promptsHtml += `<h4 class="prompt-title prompt-title-bug-fix">HTML Bug Fix/Polish & Completion Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptHtml_BugFix)}</pre>`;
        if (iter.requestPromptFeatures_Suggest) promptsHtml += `<h4 class="prompt-title prompt-title-feature-suggest">Feature Suggestion Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptFeatures_Suggest)}</pre>`;
    } else if (currentMode === 'creative') {
        if (iter.requestPromptText_GenerateDraft) promptsHtml += `<h4 class="prompt-title prompt-title-draft-gen">Draft Generation Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptText_GenerateDraft)}</pre>`;
        if (iter.requestPromptText_Critique) promptsHtml += `<h4 class="prompt-title prompt-title-critique">Critique Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptText_Critique)}</pre>`;
        if (iter.requestPromptText_Revise) promptsHtml += `<h4 class="prompt-title prompt-title-revise">Revision Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptText_Revise)}</pre>`;
        if (iter.requestPromptText_Polish) promptsHtml += `<h4 class="prompt-title prompt-title-polish">Polish Prompt:</h4><pre class="prompt-block">${escapeHtml(iter.requestPromptText_Polish)}</pre>`;
    } else if (currentMode === 'agent') {
        if (iter.agentJudgeLLM_InitialRequest) promptsHtml += `<h4 class="prompt-title prompt-title-agent-judge">Judge LLM - Initial Request to Design Prompts:</h4><pre class="prompt-block">${escapeHtml(iter.agentJudgeLLM_InitialRequest)}</pre>`;
        if (iter.agentGeneratedPrompts && iter.iterationNumber === 0) { // Only show full JSON in setup iteration
             promptsHtml += `<h4 class="prompt-title prompt-title-agent-generated">Judge LLM - Generated Prompt Design:</h4><pre class="code-block language-json">${escapeHtml(JSON.stringify(iter.agentGeneratedPrompts, null, 2))}</pre>`;
        }
        if (iter.requestPrompt_SysInstruction) promptsHtml += `<h4 class="prompt-title prompt-title-agent-sys">System Instruction (Main Step):</h4><pre class="prompt-block">${escapeHtml(iter.requestPrompt_SysInstruction)}</pre>`;
        if (iter.requestPrompt_UserTemplate) promptsHtml += `<h4 class="prompt-title prompt-title-agent-user">User Prompt Template (Main Step):</h4><pre class="prompt-block">${escapeHtml(iter.requestPrompt_UserTemplate)}</pre>`;
        if (iter.requestPrompt_Rendered) promptsHtml += `<h4 class="prompt-title prompt-title-agent-rendered">Rendered User Prompt (Main Step - Sent to API):</h4><pre class="prompt-block">${escapeHtml(iter.requestPrompt_Rendered)}</pre>`;
        
        // For loop iterations (Implement + Refine/Suggest), show sub-step prompts if they exist
        // The main prompts above will be for the "Implement" part of the loop.
        // The sub-step prompts will be for the "Refine/Suggest" part of the loop.
        if (iter.requestPrompt_SubStep_SysInstruction) promptsHtml += `<hr class="sub-divider"><h4 class="prompt-title prompt-title-agent-sys">System Instruction (Loop Sub-Step - Refine/Suggest):</h4><pre class="prompt-block">${escapeHtml(iter.requestPrompt_SubStep_SysInstruction)}</pre>`;
        if (iter.requestPrompt_SubStep_UserTemplate) promptsHtml += `<h4 class="prompt-title prompt-title-agent-user">User Prompt Template (Loop Sub-Step - Refine/Suggest):</h4><pre class="prompt-block">${escapeHtml(iter.requestPrompt_SubStep_UserTemplate)}</pre>`;
        if (iter.requestPrompt_SubStep_Rendered) promptsHtml += `<h4 class="prompt-title prompt-title-agent-rendered">Rendered User Prompt (Loop Sub-Step - Refine/Suggest - Sent to API):</h4><pre class="prompt-block">${escapeHtml(iter.requestPrompt_SubStep_Rendered)}</pre>`;
    }

    let generatedOutputHtml = '';
    const outputContentType = (currentMode === 'agent' && iter.agentGeneratedPrompts) ? iter.agentGeneratedPrompts.expected_output_content_type : 
                              (currentMode === 'agent' && pipelinesState.find(p=>p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts) ? pipelinesState.find(p=>p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts?.expected_output_content_type : 'text';


    if (currentMode === 'website') {
        if (iter.generatedHtml || ['completed', 'error', 'retrying', 'processing', 'cancelled'].includes(iter.status)) {
            generatedOutputHtml = `
                <h4>Generated HTML Code (Stabilized/Polished):</h4>
                <pre id="html-code-${pipelineId}-${iter.iterationNumber}" class="code-block language-html">${iter.generatedHtml ? escapeHtml(iter.generatedHtml) : (iter.status === 'cancelled' ? '<!-- HTML generation cancelled. -->' : '<!-- No valid HTML was generated or an error occurred. -->')}</pre>
                <button id="download-html-${pipelineId}-${iter.iterationNumber}" class="download-html-button button-base action-button" type="button" ${!iter.generatedHtml ? 'disabled' : ''}>Download HTML</button>
                <button id="copy-html-${pipelineId}-${iter.iterationNumber}" class="copy-html-button button-base action-button" type="button" ${!iter.generatedHtml ? 'disabled' : ''}>Copy HTML</button>
            `;
        } else if (iter.status === 'pending') {
             generatedOutputHtml = '<p>No HTML generated for this iteration yet.</p>';
        }
    } else if (currentMode === 'creative' || currentMode === 'agent') {
        let mainContentToDisplay = iter.generatedOrRevisedText; // Creative
        let mainContentLabel = "Generated/Revised Text:";

        if (currentMode === 'agent') {
            mainContentToDisplay = iter.generatedMainContent;
            
            if (iter.iterationNumber === 0 && iter.agentGeneratedPrompts) { // Judge LLM prompt design
                 mainContentToDisplay = "Dynamically designed prompts from Judge LLM are shown above in the 'Prompts' section. No direct content output for this setup step.";
                 mainContentLabel = "Setup Information:";
            } else if (iter.generatedSubStep_Content && iter.iterationNumber > 2 && iter.iterationNumber < TOTAL_STEPS_AGENT -1) { // Agent loop: Implement (sub-step) then Refine/Suggest (main content)
                 // iter.generatedSubStep_Content is the output of the "Implement" part of the loop
                 // iter.generatedMainContent is the output of the "Refine/Suggest" part of the loop
                 generatedOutputHtml += `
                    <h4>Content After Suggestion Implementation (Loop Sub-Step):</h4>
                    <pre id="agent-substep-content-${pipelineId}-${iter.iterationNumber}" class="text-block generated-text-block language-${outputContentType}">${iter.generatedSubStep_Content ? escapeHtml(iter.generatedSubStep_Content) : 'No content from implementation sub-step.'}</pre>
                    <hr class="sub-divider">`;
                 mainContentLabel = "Refined Content After Suggestions (Loop Main Step):";
            } else if (iter.iterationNumber === 1) { // Initial Generation
                mainContentLabel = "Initial Generated Content:";
            } else if (iter.iterationNumber === 2) { // Initial Refine/Suggest
                mainContentLabel = "Refined Content (After Initial Suggestions):";
            } else if (iter.iterationNumber === TOTAL_STEPS_AGENT -1) { // Final Polish
                mainContentLabel = "Final Polished Content:";
            } else {
                 mainContentLabel = "Generated/Refined Output:";
            }
        }
        
        if (mainContentToDisplay || ['completed', 'error', 'retrying', 'processing', 'cancelled'].includes(iter.status)) {
             generatedOutputHtml += `
                <h4>${mainContentLabel}</h4>
                <pre id="text-block-${pipelineId}-${iter.iterationNumber}" class="text-block generated-text-block language-${outputContentType}">${mainContentToDisplay ? escapeHtml(mainContentToDisplay) : (iter.status === 'cancelled' ? 'Generation cancelled.' : 'No output was generated or an error occurred.')}</pre>`;
            // Only add download/copy buttons if there's actual content to download/copy (not for iter 0 message)
            if (mainContentToDisplay && !(currentMode ==='agent' && iter.iterationNumber === 0)) {
                generatedOutputHtml += `
                <button id="download-text-${pipelineId}-${iter.iterationNumber}" class="download-text-button button-base action-button" type="button" ${!mainContentToDisplay ? 'disabled' : ''}>Download Output</button>
                <button id="copy-text-${pipelineId}-${iter.iterationNumber}" class="copy-text-button button-base action-button" type="button" ${!mainContentToDisplay ? 'disabled' : ''}>Copy Output</button>
                `;
            }
        } else if (iter.status === 'pending') {
            generatedOutputHtml = `<p>No output generated for this iteration yet.</p>`;
        }
    }

    let suggestionsHtml = '';
    const suggestionsToDisplay = currentMode === 'agent' ? iter.generatedSuggestions : iter.suggestedFeatures;
    const critiqueToDisplay = iter.critiqueSuggestions;

    if ((currentMode === 'website' || currentMode === 'agent') && suggestionsToDisplay && suggestionsToDisplay.length > 0) {
        const title = currentMode === 'website' ? "Suggested Next Steps (HTML Features):" : "Suggested Next Steps:";
        suggestionsHtml = `<h4>${title}</h4><ul class="feature-list">${suggestionsToDisplay.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
    } else if (currentMode === 'creative' && critiqueToDisplay && critiqueToDisplay.length > 0) {
        suggestionsHtml = `<h4>Critique & Suggestions:</h4><ul class="critique-list">${critiqueToDisplay.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
    } else if (iter.status === 'cancelled' && (currentMode !== 'agent' || iter.iterationNumber > 0)) { // Don't show for agent iter 0 cancelled
        suggestionsHtml = (currentMode === 'website' || currentMode === 'agent') ? '<h4>Suggested Next Steps:</h4><p>Cancelled by user.</p>' : '<h4>Critique & Suggestions:</h4><p>Cancelled by user.</p>';
    }


    let previewHtml = '';
    if (currentMode === 'website') {
        const noPreviewMessage = iter.status === 'cancelled' ? "Preview not available: Pipeline execution was cancelled." : "Preview not available: HTML generation pending, failed, or content is not valid HTML.";
        const isEmptyGenHtml = !iter.generatedHtml || iter.generatedHtml.trim() === '' || iter.generatedHtml.includes('<!-- No HTML generated yet') || iter.generatedHtml.includes('<!-- No valid HTML was generated') || iter.generatedHtml.includes('<!-- HTML generation cancelled. -->');
        const previewContainerId = `preview-container-${pipelineId}-${iter.iterationNumber}`;
        const fullscreenButtonId = `fullscreen-btn-${pipelineId}-${iter.iterationNumber}`;

        if (isEmptyGenHtml && (['pending', 'processing', 'retrying', 'error', 'cancelled'].includes(iter.status))) {
            previewHtml = `<div class="preview-header"><h4>Live Preview:</h4><button id="${fullscreenButtonId}" class="fullscreen-toggle-button button-base action-button" title="Toggle Fullscreen Preview" aria-label="Toggle Fullscreen Preview" disabled><span class="icon-fullscreen">${fullscreenIconSvg}</span><span class="icon-exit-fullscreen" style="display:none;">${exitFullscreenIconSvg}</span></button></div><div id="${previewContainerId}" class="html-preview-container no-preview-message-container"><p class="no-preview-message">${noPreviewMessage}</p></div>`;
        } else if (iter.generatedHtml && !isEmptyGenHtml) {
            const iframeSandboxOptions = "allow-scripts allow-same-origin allow-forms allow-popups";
            previewHtml = `<div class="preview-header"><h4>Live Preview:</h4><button id="${fullscreenButtonId}" class="fullscreen-toggle-button button-base action-button" title="Toggle Fullscreen Preview" aria-label="Toggle Fullscreen Preview"><span class="icon-fullscreen">${fullscreenIconSvg}</span><span class="icon-exit-fullscreen" style="display:none;">${exitFullscreenIconSvg}</span></button></div><div id="${previewContainerId}" class="html-preview-container"><iframe id="preview-iframe-${pipelineId}-${iter.iterationNumber}" srcdoc="${escapeHtml(iter.generatedHtml)}" sandbox="${iframeSandboxOptions}" title="HTML Preview for Iteration ${iter.iterationNumber} of Pipeline ${pipelineId+1}"></iframe></div>`;
        } else if (['pending', 'processing', 'retrying', 'error', 'completed', 'cancelled'].includes(iter.status)) {
            previewHtml = `<div class="preview-header"><h4>Live Preview:</h4><button id="${fullscreenButtonId}" class="fullscreen-toggle-button button-base action-button" title="Toggle Fullscreen Preview" aria-label="Toggle Fullscreen Preview" disabled><span class="icon-fullscreen">${fullscreenIconSvg}</span><span class="icon-exit-fullscreen" style="display:none;">${exitFullscreenIconSvg}</span></button></div><div id="${previewContainerId}" class="html-preview-container no-preview-message-container"><p class="no-preview-message">${noPreviewMessage}</p></div>`;
        }
    }

    return `
    <li id="iteration-${pipelineId}-${iter.iterationNumber}" class="iteration-item" data-iteration-number="${iter.iterationNumber}">
        <details ${iter.isDetailsOpen ? 'open' : ''}>
            <summary>
                <span class="iteration-title">${escapeHtml(iter.title)}</span>
                <span class="iteration-status status-${iter.status}" id="iter-status-text-${pipelineId}-${iter.iterationNumber}">${displayStatusText}</span>
            </summary>
            <div class="iteration-details" id="iter-details-${pipelineId}-${iter.iterationNumber}">
                ${iter.error ? `<div class="error-message"><strong>Error:</strong> <pre>${escapeHtml(iter.error)}</pre></div>` : ''}
                ${(promptsHtml.length > 0) ? `<div class="iteration-detail-group" aria-label="Prompts Section">${promptsHtml}</div>` : ''}
                ${(promptsHtml.length > 0 && (generatedOutputHtml.length > 0 || suggestionsHtml.length > 0 || previewHtml.length > 0)) ? '<hr class="sub-divider">' : ''}
                ${(generatedOutputHtml.length > 0) ? `<div class="iteration-detail-group" aria-label="Generated Output Section">${generatedOutputHtml}</div>` : ''}
                ${(generatedOutputHtml.length > 0 && (suggestionsHtml.length > 0 || previewHtml.length > 0)) ? '<hr class="sub-divider">' : ''}
                ${(suggestionsHtml.length > 0) ? `<div class="iteration-detail-group" aria-label="Suggestions Section">${suggestionsHtml}</div>` : ''}
                ${(suggestionsHtml.length > 0 && previewHtml.length > 0) ? '<hr class="sub-divider">' : ''}
                ${(previewHtml.length > 0) ? `<div class="iteration-detail-group" aria-label="Preview Section">${previewHtml}</div>` : ''}
                ${ !(promptsHtml.length > 0 || generatedOutputHtml.length > 0 || suggestionsHtml.length > 0 || previewHtml.length > 0 || iter.error) ? '<p class="no-details-message">No details available for this iteration yet.</p>' : ''}
            </div>
        </details>
    </li>`;
}

async function copyToClipboard(text: string, buttonElement: HTMLButtonElement) {
    try {
        await navigator.clipboard.writeText(text);
        const originalText = buttonElement.textContent;
        buttonElement.textContent = 'Copied!';
        buttonElement.classList.add('copied');
        buttonElement.disabled = true;
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.classList.remove('copied');
            // Re-enable based on data attribute set during button creation
            buttonElement.disabled = buttonElement.dataset.hasContent !== 'true';
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        const originalText = buttonElement.textContent;
        buttonElement.textContent = 'Copy Failed';
        setTimeout(() => {
            buttonElement.textContent = originalText;
             // Re-enable based on data attribute, even on fail, if content technically exists
            buttonElement.disabled = buttonElement.dataset.hasContent !== 'true';
        }, 2000);
    }
}

function attachIterationActionButtons(pipelineId: number, iterationNumber: number) {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return;
    const iter = pipeline.iterations.find(it => it.iterationNumber === iterationNumber);
    if (!iter) return;

    if (currentMode === 'website') {
        const canDownloadOrCopyHtml = !!iter.generatedHtml && !isEmptyOrPlaceholderHtml(iter.generatedHtml);

        const downloadButton = document.querySelector<HTMLButtonElement>(`#download-html-${pipelineId}-${iterationNumber}`);
        if (downloadButton) {
            const newDownloadButton = downloadButton.cloneNode(true) as HTMLButtonElement;
            downloadButton.parentNode?.replaceChild(newDownloadButton, downloadButton);
            newDownloadButton.addEventListener('click', () => {
                if (iter.generatedHtml) { // Guard again, though canDownloadOrCopyHtml covers it
                    downloadFile(iter.generatedHtml, `website_pipeline-${pipelineId + 1}_iter-${iter.iterationNumber}_temp-${pipeline.temperature}.html`, 'text/html');
                }
            });
            newDownloadButton.disabled = !canDownloadOrCopyHtml;
        }

        const copyButton = document.querySelector<HTMLButtonElement>(`#copy-html-${pipelineId}-${iterationNumber}`);
        if (copyButton) {
            const newCopyButton = copyButton.cloneNode(true) as HTMLButtonElement;
            copyButton.parentNode?.replaceChild(newCopyButton, copyButton);
            newCopyButton.dataset.hasContent = String(canDownloadOrCopyHtml);
            newCopyButton.addEventListener('click', () => {
                if (iter.generatedHtml) copyToClipboard(iter.generatedHtml, newCopyButton);
            });
            newCopyButton.disabled = !canDownloadOrCopyHtml;
        }

        const fullscreenButton = document.querySelector<HTMLButtonElement>(`#fullscreen-btn-${pipelineId}-${iterationNumber}`);
        const previewContainer = document.getElementById(`preview-container-${pipelineId}-${iterationNumber}`);
        if (fullscreenButton && previewContainer) {
            const newFullscreenButton = fullscreenButton.cloneNode(true) as HTMLButtonElement;
            fullscreenButton.parentNode?.replaceChild(newFullscreenButton, fullscreenButton);
            newFullscreenButton.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    previewContainer.requestFullscreen().catch(err => console.error(`Error full-screen: ${err.message}`));
                } else if (document.exitFullscreen) document.exitFullscreen();
            });
            newFullscreenButton.disabled = !canDownloadOrCopyHtml;
        }
    } else if (currentMode === 'creative' || currentMode === 'agent') {
        const textContentForActions = currentMode === 'creative' ? iter.generatedOrRevisedText : iter.generatedMainContent;
        const isAgentSetupStep = currentMode === 'agent' && iter.iterationNumber === 0;
        const canDownloadOrCopyText = !!textContentForActions && !isAgentSetupStep;

        const defaultFileName = currentMode === 'creative' ? 
            `creative_pipeline-${pipelineId + 1}_iter-${iter.iterationNumber}_temp-${pipeline.temperature}.txt` : 
            `agent_output_variant-${pipelineId + 1}_step-${iter.iterationNumber}_temp-${pipeline.temperature}.txt`;
        const contentType = 'text/plain';
        
        const downloadButton = document.querySelector<HTMLButtonElement>(`#download-text-${pipelineId}-${iterationNumber}`);
        if (downloadButton) {
            const newDownloadButton = downloadButton.cloneNode(true) as HTMLButtonElement;
            downloadButton.parentNode?.replaceChild(newDownloadButton, downloadButton);
            newDownloadButton.addEventListener('click', () => {
                if (canDownloadOrCopyText && textContentForActions) {
                    downloadFile(textContentForActions, defaultFileName, contentType);
                }
            });
            newDownloadButton.disabled = !canDownloadOrCopyText;
            newDownloadButton.style.display = isAgentSetupStep ? 'none' : 'inline-flex';
        }

        const copyButton = document.querySelector<HTMLButtonElement>(`#copy-text-${pipelineId}-${iterationNumber}`);
        if (copyButton) {
            const newCopyButton = copyButton.cloneNode(true) as HTMLButtonElement;
            copyButton.parentNode?.replaceChild(newCopyButton, copyButton);
            newCopyButton.dataset.hasContent = String(canDownloadOrCopyText);
            newCopyButton.addEventListener('click', () => {
                if (canDownloadOrCopyText && textContentForActions) copyToClipboard(textContentForActions, newCopyButton);
            });
            newCopyButton.disabled = !canDownloadOrCopyText;
            newCopyButton.style.display = isAgentSetupStep ? 'none' : 'inline-flex';
        }
    }
}

function isEmptyOrPlaceholderHtml(html?: string): boolean {
    return !html || html.trim() === '' || html.includes('<!-- No HTML generated yet') || html.includes('<!-- No valid HTML was generated') || html.includes('<!-- HTML generation cancelled. -->');
}


function updateIterationUI(pipelineId: number, iterationNumber: number) {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return;
    const iter = pipeline.iterations.find(it => it.iterationNumber === iterationNumber);
    if (!iter) return;

    const iterationElement = document.getElementById(`iteration-${pipelineId}-${iterationNumber}`);
    if (!iterationElement) return;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = renderIteration(pipelineId, iter);
    const newContentFirstChild = tempDiv.firstElementChild;

    if (newContentFirstChild) {
        iterationElement.replaceWith(newContentFirstChild);
        const newDetailsElement = newContentFirstChild.querySelector<HTMLDetailsElement>('details');
        if (newDetailsElement) {
            const summaryElement = newDetailsElement.querySelector('summary');
            if (summaryElement) {
                if (iter.isDetailsOpen !== undefined) newDetailsElement.open = iter.isDetailsOpen;
                summaryElement.addEventListener('click', (e) => {
                     setTimeout(() => { 
                        const iterToUpdate = pipelinesState.find(p => p.id === pipelineId)?.iterations.find(it => it.iterationNumber === iter.iterationNumber);
                        if (iterToUpdate) iterToUpdate.isDetailsOpen = newDetailsElement.open;
                    }, 0);
                });
            }
        }
        attachIterationActionButtons(pipelineId, iterationNumber);
    }
    // If graph view is active, re-render it
    const viewToggleGraphButton = document.getElementById('view-toggle-graph') as HTMLButtonElement;
    if (viewToggleGraphButton && viewToggleGraphButton.classList.contains('active')) {
        renderGraphView();
    }
}


function updatePipelineStatusUI(pipelineId: number, status: PipelineState['status']) {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return;

    pipeline.status = status;

    const statusTextElement = document.getElementById(`pipeline-status-text-${pipelineId}`);
    if (statusTextElement) {
        statusTextElement.textContent = status;
        statusTextElement.className = `pipeline-status status-${status}`;
    }
    if (pipeline.tabButtonElement) {
        pipeline.tabButtonElement.className = `tab-button status-${status}`;
        if (pipeline.id === activePipelineId) pipeline.tabButtonElement.classList.add('active');
    }
    if (pipeline.stopButtonElement) {
        if (status === 'running') {
            pipeline.stopButtonElement.style.display = 'inline-flex';
            pipeline.stopButtonElement.textContent = 'Stop';
            pipeline.stopButtonElement.disabled = false;
        } else if (status === 'stopping') {
            pipeline.stopButtonElement.style.display = 'inline-flex';
            pipeline.stopButtonElement.textContent = 'Stopping...';
            pipeline.stopButtonElement.disabled = true;
        } else { 
            pipeline.stopButtonElement.style.display = 'none';
            pipeline.stopButtonElement.textContent = 'Stop';
            pipeline.stopButtonElement.disabled = true; 
        }
    }
    updateControlsState(); 
    // If graph view is active, re-render it
    const viewToggleGraphButton = document.getElementById('view-toggle-graph') as HTMLButtonElement;
    if (viewToggleGraphButton && viewToggleGraphButton.classList.contains('active')) {
        renderGraphView();
    }
}

async function callGemini(promptOrParts: string | Part[], temperature: number, modelToUse: string, systemInstruction?: string, isJsonOutput: boolean = false): Promise<GenerateContentResponse> {
    if (!ai) throw new Error("Gemini API client not initialized.");
    
    const contents: Part[] = typeof promptOrParts === 'string' ? [{ text: promptOrParts }] : promptOrParts;
    const config: any = { temperature };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (isJsonOutput) config.responseMimeType = "application/json";

    const response = await ai.models.generateContent({ model: modelToUse, contents: { parts: contents }, config: config });
    return response;
}

function cleanHtmlOutput(rawHtml: string): string {
    if (typeof rawHtml !== 'string') return '';
    let textToClean = rawHtml.trim(); // Already trimmed by cleanOutputByType before calling this
    
    // Fence removal for HTML is handled by cleanOutputByType now,
    // so textToClean here is already de-fenced.

    // Try to find the start of the HTML document
    const lowerText = textToClean.toLowerCase();
    let startIndex = lowerText.indexOf('<!doctype');
    if (startIndex === -1) {
        startIndex = lowerText.indexOf('<html');
    }

    if (startIndex !== -1) {
        // Try to find the end of the HTML document
        const endIndex = textToClean.lastIndexOf('</html>');
        if (endIndex !== -1 && endIndex + '</html>'.length > startIndex) {
            return textToClean.substring(startIndex, endIndex + '</html>'.length).trim();
        } else {
            const potentialDoc = textToClean.substring(startIndex).trim();
            const isNearBeginning = startIndex < 20 || textToClean.substring(0, startIndex).trim().length < 10;
            if (isNearBeginning && potentialDoc.length > 100 && (potentialDoc.toLowerCase().includes("<body") || potentialDoc.toLowerCase().includes("<head") || potentialDoc.toLowerCase().includes("<div"))) {
                 console.warn(`cleanHtmlOutput: HTML document started but '</html>' tag was missing. Returning potentially truncated document starting with '${potentialDoc.substring(0,30)}...'.`);
                return potentialDoc;
            }
             console.warn(`cleanHtmlOutput: HTML document started but '</html>' tag was missing. Conditions for truncated HTML not met. Falling through to return original de-fenced and trimmed text.`);
        }
    }
    
    // If no clear HTML structure (<!doctype or <html) is found, return the de-fenced, trimmed text.
    // This handles cases where LLM might provide an HTML snippet.
    // It's up to the caller to validate if this is truly renderable.
    // console.warn(`cleanHtmlOutput: Content not identified as a full HTML document. Returning de-fenced and trimmed input. Original (first 200): "${textToClean.substring(0,200) + (textToClean.length > 200 ? "..." : "")}"`);
    return textToClean;
}


function cleanTextOutput(rawText: string): string {
    if (typeof rawText !== 'string') return '';
    return rawText.trim(); // Already handled by cleanOutputByType
}

function cleanOutputByType(rawOutput: string, type: string = 'text'): string {
    if (typeof rawOutput !== 'string') return '';
    let textToClean = rawOutput.trim();
    
    // Universal fence removal. This regex is broad and captures content within various fences.
    // It tries to match ```<lang> ... ``` or just ``` ... ```.
    // The (\w*)? part matches an optional language specifier (e.g., json, html, python).
    // The [\s\S]*? part captures any character including newlines, non-greedily.
    const fenceRegex = /^```(\w*)?\s*\n?([\s\S]*?)\n?\s*```$/s;
    const fenceMatch = textToClean.match(fenceRegex);

    if (fenceMatch && fenceMatch[2]) { // fenceMatch[2] is the content inside the fence
        textToClean = fenceMatch[2].trim();
    }
    // After potential fence removal, trim again.
    // This is crucial for JSON.parse and general cleanliness.
    textToClean = textToClean.trim();

    if (type === 'html') {
        // cleanHtmlOutput has specific logic to extract valid HTML structure,
        // potentially discarding preamble/postamble even if no fences were present initially,
        // or if fences were already stripped.
        return cleanHtmlOutput(textToClean); // textToClean here is already fence-stripped and trimmed
    }
    
    // For 'json', 'text', 'markdown', 'python', etc., after the above fence removal and trimming,
    // return the result. The caller is responsible for further processing like JSON.parse().
    // This simplified approach for 'json' ensures that if the LLM includes preamble/postamble
    // outside of fences (despite responseMimeType: "application/json"), JSON.parse will
    // operate on that malformed string and fail correctly, rather than this function
    // trying to guess and potentially mis-extracting a non-JSON fragment.
    return textToClean; 
}


function generateFallbackFeaturesFromString(text: string): string[] {
    const listItemsRegex = /(?:^\s*[-*+]|\d+\.)\s+(.*)/gm;
    let matches;
    const features: string[] = [];
    if (typeof text === 'string') { 
        while ((matches = listItemsRegex.exec(text)) !== null) {
            features.push(matches[1].trim());
            if (features.length >= 2) break;
        }
    }
    if (features.length > 0) return features.slice(0, 2);
    console.warn("generateFallbackFeaturesFromString: Could not extract 2 features from string, using generic fallbacks.");
    return ["Add a clear call to action", "Improve visual hierarchy"].slice(0, 2);
}

function generateFallbackCritiqueFromString(text: string, count: number = 3): string[] {
    const listItemsRegex = /(?:^\s*[-*+]|\d+\.)\s+(.*)/gm;
    let matches;
    const critique: string[] = [];
     if (typeof text === 'string') { 
        while ((matches = listItemsRegex.exec(text)) !== null) {
            critique.push(matches[1].trim());
            if (critique.length >= count) break;
        }
    }
    if (critique.length > 0) return critique.slice(0, count);
    console.warn(`generateFallbackCritiqueFromString: Could not extract ${count} critique points. Using generic fallbacks.`);
    const fallbacks = ["Consider developing the main character's motivation further.", "Explore adding more sensory details to the descriptions.", "Check the pacing of the current section; it might be too fast or too slow."];
    return fallbacks.slice(0, count);
}

function generateFallbackMathStrategies(text: string, count: number): string[] {
    const listItemsRegex = /(?:^\s*[-*+]|\d+\.)\s+(.*)/gm;
    let matches;
    const strategies: string[] = [];
    if (typeof text === 'string') {
        while ((matches = listItemsRegex.exec(text)) !== null) {
            strategies.push(matches[1].trim());
            if (strategies.length >= count) break;
        }
    }
    if (strategies.length > 0 && strategies.length <= count) return strategies;
    if (strategies.length > count) return strategies.slice(0, count);

    console.warn(`generateFallbackMathStrategies: Could not extract ${count} strategies. Using generic fallbacks.`);
    const fallbacks = [
        "Try to simplify the problem statement or break it into smaller parts.",
        "Identify relevant formulas or theorems.",
        "Work backwards from a potential solution.",
        "Look for patterns or symmetries."
    ];
    return fallbacks.slice(0, count);
}


function parseJsonSuggestions(rawJsonString: string, suggestionKey: 'features' | 'suggestions' | 'strategies' | 'sub_strategies' = 'features', expectedCount: number = 2): string[] {
    if (typeof rawJsonString !== 'string' || !rawJsonString.trim()) {
        console.warn(`parseJsonSuggestions: Input string is empty or not a string. Using fallback for ${suggestionKey}.`);
        if (suggestionKey === 'features') return generateFallbackFeaturesFromString('');
        if (suggestionKey === 'strategies' || suggestionKey === 'sub_strategies') return generateFallbackMathStrategies('', expectedCount);
        return generateFallbackCritiqueFromString('', expectedCount);
    }

    const cleanedJsonString = cleanOutputByType(rawJsonString, 'json');
    
    try {
        const parsed = JSON.parse(cleanedJsonString);
        let items: string[] = [];

        // Standard case: {"suggestionKey": ["item1", "item2"]}
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed[suggestionKey]) && parsed[suggestionKey].every((f: any) => typeof f === 'string')) {
            items = parsed[suggestionKey];
        } 
        // Handles cases where the JSON is just an array of strings: ["item1", "item2"]
        else if (Array.isArray(parsed) && parsed.every((item: any) => typeof item === 'string')) {
            items = parsed;
        } 
        // Fallback for less structured JSON: if the primary key is different but it contains an array of strings
        else if (typeof parsed === 'object' && parsed !== null) {
            for (const key in parsed) {
                if (Array.isArray(parsed[key]) && parsed[key].every((s:any) => typeof s === 'string')) {
                    items = parsed[key];
                    console.warn(`parseJsonSuggestions: Used fallback key "${key}" for suggestions as primary key "${suggestionKey}" was not found or malformed. Parsed object had keys: ${Object.keys(parsed).join(', ')}`);
                    break;
                }
            }
        }
        
        if (items.length > 0) {
             if (items.length < expectedCount) {
                console.warn(`parseJsonSuggestions: Parsed ${items.length} ${suggestionKey}, expected ${expectedCount}. Padding with fallbacks.`);
                 const fallbacks = (suggestionKey === 'features') ? generateFallbackFeaturesFromString('') : 
                                  (suggestionKey === 'strategies' || suggestionKey === 'sub_strategies') ? generateFallbackMathStrategies('', expectedCount - items.length) :
                                  generateFallbackCritiqueFromString('', expectedCount - items.length);
                return items.concat(fallbacks.slice(0, expectedCount - items.length));
            }
            return items.slice(0, expectedCount); // Ensure we don't return more than expected
        }

        // If no items found via expected structures, attempt generic string list extraction from original raw string
        console.warn(`parseJsonSuggestions: Parsed JSON for ${suggestionKey} is not in the expected format or empty. Attempting string fallback from original content. Parsed object:`, parsed, "Cleaned string for parsing:", cleanedJsonString, "Original string (first 300 chars):", rawJsonString.substring(0,300));
        if (suggestionKey === 'features') return generateFallbackFeaturesFromString(rawJsonString);
        if (suggestionKey === 'strategies' || suggestionKey === 'sub_strategies') return generateFallbackMathStrategies(rawJsonString, expectedCount);
        return generateFallbackCritiqueFromString(rawJsonString, expectedCount);

    } catch (e) {
        console.error(`parseJsonSuggestions: Failed to parse JSON for ${suggestionKey}:`, e, "Cleaned string for parsing:", cleanedJsonString, "Original string (first 300 chars):", rawJsonString.substring(0,300));
        // Fallback to extracting from the original raw string if JSON parsing fails completely
        if (suggestionKey === 'features') return generateFallbackFeaturesFromString(rawJsonString);
        if (suggestionKey === 'strategies' || suggestionKey === 'sub_strategies') return generateFallbackMathStrategies(rawJsonString, expectedCount);
        return generateFallbackCritiqueFromString(rawJsonString, expectedCount);
    }
}


async function runPipeline(pipelineId: number, initialRequest: string) {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return;

    pipeline.isStopRequested = false; 
    updatePipelineStatusUI(pipelineId, 'running');
    
    let currentHtmlContent = ""; 
    let currentTextContent = ""; 
    let currentSuggestions: string[] = []; 
    let currentAgentContent = ""; // For Agent mode's primary content
    let agentGeneratedPrompts: AgentGeneratedPrompts | undefined = undefined;


    const totalPipelineSteps = 
        currentMode === 'website' ? TOTAL_STEPS_WEBSITE :
        currentMode === 'creative' ? TOTAL_STEPS_CREATIVE :
        currentMode === 'agent' ? TOTAL_STEPS_AGENT : 0;
    const numMainRefinementLoops =
        currentMode === 'website' ? NUM_WEBSITE_REFINEMENT_ITERATIONS :
        currentMode === 'creative' ? NUM_CREATIVE_REFINEMENT_ITERATIONS :
        currentMode === 'agent' ? NUM_AGENT_MAIN_REFINEMENT_LOOPS : 0;

    for (let i = 0; i < totalPipelineSteps; i++) {
        const iteration = pipeline.iterations[i];
        if (pipeline.isStopRequested) {
            iteration.status = 'cancelled';
            iteration.error = 'Process execution was stopped by the user.';
            updateIterationUI(pipelineId, i);
            for (let j = i + 1; j < pipeline.iterations.length; j++) {
                pipeline.iterations[j].status = 'cancelled';
                pipeline.iterations[j].error = 'Process execution was stopped by the user.';
                updateIterationUI(pipelineId, j);
            }
            updatePipelineStatusUI(pipelineId, 'stopped');
            return; 
        }

        // Reset prompts and outputs for current iteration (except agentGeneratedPrompts for iter 0)
        iteration.requestPromptHtml_InitialGenerate = iteration.requestPromptHtml_FeatureImplement = iteration.requestPromptHtml_BugFix = iteration.requestPromptFeatures_Suggest = undefined;
        iteration.requestPromptText_GenerateDraft = iteration.requestPromptText_Critique = iteration.requestPromptText_Revise = iteration.requestPromptText_Polish = undefined;
        iteration.requestPrompt_SysInstruction = iteration.requestPrompt_UserTemplate = iteration.requestPrompt_Rendered = undefined;
        iteration.requestPrompt_SubStep_SysInstruction = iteration.requestPrompt_SubStep_UserTemplate = iteration.requestPrompt_SubStep_Rendered = undefined;
        iteration.generatedSubStep_Content = undefined;
        iteration.error = undefined;
        // Don't clear iteration.agentGeneratedPrompts if it's already set (for iter 0)
        // Don't clear iteration.generatedMainContent or iteration.generatedSuggestions if they are inputs to next step

        try {
            const makeApiCall = async (userPrompt: string, systemInstruction: string, isJson: boolean, stepDesc: string): Promise<string> => {
                if (!pipeline) throw new Error("Pipeline context lost");
                if (pipeline.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${stepDesc}`);
                let responseText = "";
                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    if (pipeline.isStopRequested) throw new PipelineStopRequestedError(`Stop requested during retry for: ${stepDesc}`);
                    iteration.retryAttempt = attempt;
                    iteration.status = attempt > 0 ? 'retrying' : 'processing';
                    updateIterationUI(pipelineId, i);
                    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt)));
                    
                    try {
                        const apiResponse = await callGemini(userPrompt, pipeline.temperature, pipeline.modelName, systemInstruction, isJson);
                        responseText = apiResponse.text;
                        iteration.status = 'processing'; 
                        updateIterationUI(pipelineId, i);
                        return responseText;
                    } catch (e: any) {
                        console.warn(`Pipeline ${pipelineId}, Iter ${i} (${stepDesc}), Attempt ${attempt + 1} failed: ${e.message}`);
                        iteration.error = `Attempt ${attempt + 1} for ${stepDesc} failed: ${e.message || 'Unknown API error'}`;
                        if (e.details) iteration.error += `\nDetails: ${JSON.stringify(e.details)}`;
                        if (e.status) iteration.error += `\nStatus: ${e.status}`;
                        updateIterationUI(pipelineId, i);
                        if (attempt === MAX_RETRIES) {
                            iteration.error = `Failed ${stepDesc} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                            throw e; 
                        }
                    }
                }
                throw new Error(`API call for ${stepDesc} failed all retries.`);
            };

            if (currentMode === 'website') {
                let rawHtmlAfterGenOrImpl = "";
                const placeholderRawHtml = '<!-- No HTML provided by previous step. Please generate foundational structure based on the original idea. -->';
                const placeholderCurrentHtml = "<!-- No significant HTML content available. Base suggestions on the original idea or propose foundational elements. -->";

                if (i === 0) { 
                    const userPromptInitialGen = renderPrompt(customPromptsWebsiteState.user_initialGen, { initialIdea: initialRequest });
                    iteration.requestPromptHtml_InitialGenerate = userPromptInitialGen;
                    rawHtmlAfterGenOrImpl = cleanHtmlOutput(await makeApiCall(userPromptInitialGen, customPromptsWebsiteState.sys_initialGen, false, "Initial HTML Generation"));

                    const userPromptInitialBugFix = renderPrompt(customPromptsWebsiteState.user_initialBugFix, { initialIdea: initialRequest, rawHtml: rawHtmlAfterGenOrImpl || placeholderRawHtml });
                    iteration.requestPromptHtml_BugFix = userPromptInitialBugFix;
                    iteration.generatedHtml = cleanHtmlOutput(await makeApiCall(userPromptInitialBugFix, customPromptsWebsiteState.sys_initialBugFix, false, "Initial HTML Bug Fix"));
                    currentHtmlContent = iteration.generatedHtml || "";

                    const userPromptInitialFeatures = renderPrompt(customPromptsWebsiteState.user_initialFeatureSuggest, { initialIdea: initialRequest, currentHtml: currentHtmlContent || placeholderCurrentHtml });
                    iteration.requestPromptFeatures_Suggest = userPromptInitialFeatures;
                    const featuresJsonString = await makeApiCall(userPromptInitialFeatures, customPromptsWebsiteState.sys_initialFeatureSuggest, true, "Initial Feature Suggestion");
                    iteration.suggestedFeatures = parseJsonSuggestions(featuresJsonString, 'features', 2);
                    currentSuggestions = iteration.suggestedFeatures;
                } else if (i <= numMainRefinementLoops) { 
                    const featuresToImplementStr = currentSuggestions.join('; ');
                    const userPromptRefineImplement = renderPrompt(customPromptsWebsiteState.user_refineStabilizeImplement, { currentHtml: currentHtmlContent || placeholderRawHtml, featuresToImplementStr });
                    iteration.requestPromptHtml_FeatureImplement = userPromptRefineImplement;
                    rawHtmlAfterGenOrImpl = cleanHtmlOutput(await makeApiCall(userPromptRefineImplement, customPromptsWebsiteState.sys_refineStabilizeImplement, false, `Stabilization & Feature Impl (Iter ${i})`));

                    const userPromptRefineBugFix = renderPrompt(customPromptsWebsiteState.user_refineBugFix, { rawHtml: rawHtmlAfterGenOrImpl || placeholderRawHtml });
                    iteration.requestPromptHtml_BugFix = userPromptRefineBugFix;
                    iteration.generatedHtml = cleanHtmlOutput(await makeApiCall(userPromptRefineBugFix, customPromptsWebsiteState.sys_refineBugFix, false, `Bug Fix & Completion (Iter ${i})`));
                    currentHtmlContent = iteration.generatedHtml || "";

                    const userPromptRefineFeatures = renderPrompt(customPromptsWebsiteState.user_refineFeatureSuggest, { initialIdea: initialRequest, currentHtml: currentHtmlContent || placeholderCurrentHtml });
                    iteration.requestPromptFeatures_Suggest = userPromptRefineFeatures;
                    const featuresJsonString = await makeApiCall(userPromptRefineFeatures, customPromptsWebsiteState.sys_refineFeatureSuggest, true, `Feature Suggestion (Iter ${i})`);
                    iteration.suggestedFeatures = parseJsonSuggestions(featuresJsonString, 'features', 2);
                    currentSuggestions = iteration.suggestedFeatures;
                } else { 
                    const userPromptFinalPolish = renderPrompt(customPromptsWebsiteState.user_finalPolish, { currentHtml: currentHtmlContent || placeholderRawHtml });
                    iteration.requestPromptHtml_BugFix = userPromptFinalPolish; // Re-using bugfix field for UI display of final polish prompt
                    iteration.generatedHtml = cleanHtmlOutput(await makeApiCall(userPromptFinalPolish, customPromptsWebsiteState.sys_finalPolish, false, "Final Polish"));
                    currentHtmlContent = iteration.generatedHtml || "";
                    iteration.suggestedFeatures = [];
                }
            } else if (currentMode === 'creative') {
                const placeholderDraft = "The story began on a dark and stormy night... (Placeholder: previous step provided no content)";
                if (i === 0) { 
                    const userPromptInitialDraft = renderPrompt(customPromptsCreativeState.user_creative_initialDraft, { initialPremise: initialRequest });
                    iteration.requestPromptText_GenerateDraft = userPromptInitialDraft;
                    iteration.generatedOrRevisedText = cleanTextOutput(await makeApiCall(userPromptInitialDraft, customPromptsCreativeState.sys_creative_initialDraft, false, "Initial Draft Generation"));
                    currentTextContent = iteration.generatedOrRevisedText || "";

                    const userPromptInitialCritique = renderPrompt(customPromptsCreativeState.user_creative_initialCritique, { currentDraft: currentTextContent || placeholderDraft });
                    iteration.requestPromptText_Critique = userPromptInitialCritique;
                    const critiqueJsonString = await makeApiCall(userPromptInitialCritique, customPromptsCreativeState.sys_creative_initialCritique, true, "Initial Critique");
                    iteration.critiqueSuggestions = parseJsonSuggestions(critiqueJsonString, 'suggestions', 3);
                    currentSuggestions = iteration.critiqueSuggestions;
                } else if (i <= numMainRefinementLoops) { 
                    const critiqueToImplementStr = currentSuggestions.map(s => `- ${s}`).join('\n');
                    const userPromptRevise = renderPrompt(customPromptsCreativeState.user_creative_refine_revise, { currentDraft: currentTextContent || placeholderDraft, critiqueToImplementStr });
                    iteration.requestPromptText_Revise = userPromptRevise;
                    iteration.generatedOrRevisedText = cleanTextOutput(await makeApiCall(userPromptRevise, customPromptsCreativeState.sys_creative_refine_revise, false, `Draft Revision (Iter ${i})`));
                    currentTextContent = iteration.generatedOrRevisedText || "";

                    const userPromptNewCritique = renderPrompt(customPromptsCreativeState.user_creative_refine_critique, { currentDraft: currentTextContent || placeholderDraft });
                    iteration.requestPromptText_Critique = userPromptNewCritique;
                    const critiqueJsonString = await makeApiCall(userPromptNewCritique, customPromptsCreativeState.sys_creative_refine_critique, true, `New Critique (Iter ${i})`);
                    iteration.critiqueSuggestions = parseJsonSuggestions(critiqueJsonString, 'suggestions', 3);
                    currentSuggestions = iteration.critiqueSuggestions;
                } else { 
                    const userPromptFinalPolish = renderPrompt(customPromptsCreativeState.user_creative_final_polish, { currentDraft: currentTextContent || placeholderDraft });
                    iteration.requestPromptText_Polish = userPromptFinalPolish;
                    iteration.generatedOrRevisedText = cleanTextOutput(await makeApiCall(userPromptFinalPolish, customPromptsCreativeState.sys_creative_final_polish, false, "Final Polish"));
                    currentTextContent = iteration.generatedOrRevisedText || "";
                    iteration.critiqueSuggestions = [];
                }
            } else if (currentMode === 'agent') {
                const placeholderContent = "<!-- No content available from previous step. Generate based on initial request or refine context. -->";
                 // Ensure agentGeneratedPrompts is fetched from iteration 0 if not already set (for current pipeline)
                if (!agentGeneratedPrompts && pipeline.iterations[0]?.agentGeneratedPrompts) {
                    agentGeneratedPrompts = pipeline.iterations[0].agentGeneratedPrompts;
                }

                if (i === 0) { // Judge LLM to get prompts
                    const userPromptJudge = renderPrompt(customPromptsAgentState.user_agent_judge_llm, { initialRequest: initialRequest, NUM_AGENT_MAIN_REFINEMENT_LOOPS: String(NUM_AGENT_MAIN_REFINEMENT_LOOPS) });
                    iteration.agentJudgeLLM_InitialRequest = userPromptJudge;
                    const judgeLlmResponseString = await makeApiCall(userPromptJudge, customPromptsAgentState.sys_agent_judge_llm, true, "Agent Prompt Design (Judge LLM)");
                    try {
                        const jsonStrToParse = cleanOutputByType(judgeLlmResponseString, 'json');
                        agentGeneratedPrompts = JSON.parse(jsonStrToParse) as AgentGeneratedPrompts;
                        iteration.agentGeneratedPrompts = agentGeneratedPrompts; // Store in iteration 0
                        if (!agentGeneratedPrompts ||
                            !agentGeneratedPrompts.initial_generation?.system_instruction || 
                            !agentGeneratedPrompts.initial_generation?.user_prompt_template ||
                            !agentGeneratedPrompts.refinement_and_suggestion?.system_instruction ||
                            !agentGeneratedPrompts.refinement_and_suggestion?.user_prompt_template ||
                            !agentGeneratedPrompts.feature_implementation?.system_instruction ||
                            !agentGeneratedPrompts.feature_implementation?.user_prompt_template ||
                            !agentGeneratedPrompts.final_polish?.system_instruction ||
                            !agentGeneratedPrompts.final_polish?.user_prompt_template ||
                            !agentGeneratedPrompts.expected_output_content_type ||
                            !agentGeneratedPrompts.iteration_type_description ||
                            !agentGeneratedPrompts.placeholders_guide
                            ) {
                             throw new Error("Judge LLM output is missing critical fields for prompt design, content type, description, or placeholders guide. The received structure is incomplete.");
                        }
                    } catch (e: any) {
                        console.error("Failed to parse Judge LLM response:", e, "Cleaned response for parsing:", cleanOutputByType(judgeLlmResponseString, 'json'), "Raw response (first 500 chars):", judgeLlmResponseString.substring(0,500));
                        throw new Error(`Failed to parse or validate prompt design from Judge LLM: ${e.message}. Ensure Judge LLM provides all required fields. Raw response (truncated): ${judgeLlmResponseString.substring(0,500)}`);
                    }
                } else if (agentGeneratedPrompts) { // Subsequent steps using Judge LLM's prompts
                    const outputType = agentGeneratedPrompts.expected_output_content_type || 'text';
                    if (i === 1) { // Initial Generation
                        iteration.requestPrompt_SysInstruction = agentGeneratedPrompts.initial_generation.system_instruction;
                        iteration.requestPrompt_UserTemplate = agentGeneratedPrompts.initial_generation.user_prompt_template;
                        iteration.requestPrompt_Rendered = renderPrompt(iteration.requestPrompt_UserTemplate, { initialRequest });
                        const rawInitialContent = await makeApiCall(iteration.requestPrompt_Rendered, iteration.requestPrompt_SysInstruction, false, "Agent Initial Generation");
                        iteration.generatedMainContent = cleanOutputByType(rawInitialContent, outputType);
                        currentAgentContent = iteration.generatedMainContent || "";
                    } else if (i === 2) { // Initial Refinement & Suggestion
                        iteration.requestPrompt_SysInstruction = agentGeneratedPrompts.refinement_and_suggestion.system_instruction;
                        iteration.requestPrompt_UserTemplate = agentGeneratedPrompts.refinement_and_suggestion.user_prompt_template;
                        iteration.requestPrompt_Rendered = renderPrompt(iteration.requestPrompt_UserTemplate, { initialRequest, currentContent: currentAgentContent || placeholderContent });
                        const refineSuggestJsonResponseString = await makeApiCall(iteration.requestPrompt_Rendered, iteration.requestPrompt_SysInstruction, true, "Agent Initial Refine & Suggest");
                        const refineSuggestJson = cleanOutputByType(refineSuggestJsonResponseString, 'json');
                        try {
                            const parsedRefine = JSON.parse(refineSuggestJson); 
                            iteration.generatedMainContent = cleanOutputByType(parsedRefine.refined_content || "", outputType);
                            iteration.generatedSuggestions = Array.isArray(parsedRefine.suggestions) ? parsedRefine.suggestions.slice(0,2) : generateFallbackFeaturesFromString(''); // Default to 2 suggestions
                        } catch (e: any) {
                             console.error("Failed to parse JSON from Refinement & Suggestion LLM:", e, "Raw JSON string:", refineSuggestJson, "Original response:", refineSuggestJsonResponseString);
                             iteration.generatedMainContent = cleanOutputByType(currentAgentContent || placeholderContent, outputType); // Fallback to current content if parsing fails
                             iteration.generatedSuggestions = generateFallbackFeaturesFromString(refineSuggestJsonResponseString); // Try to extract from raw string
                             iteration.error = `Error parsing Refinement & Suggestion output: ${e.message}. Output was: ${refineSuggestJson.substring(0, 200)}`;
                        }
                        currentAgentContent = iteration.generatedMainContent || "";
                        currentSuggestions = iteration.generatedSuggestions || [];
                    } else if (i < totalPipelineSteps - 1) { // Refinement Loops (loop_num starts at 1 for user, which is i-2)
                        // Sub-Step A: Feature Implementation
                        iteration.requestPrompt_SysInstruction = agentGeneratedPrompts.feature_implementation.system_instruction;
                        iteration.requestPrompt_UserTemplate = agentGeneratedPrompts.feature_implementation.user_prompt_template;
                        iteration.requestPrompt_Rendered = renderPrompt(iteration.requestPrompt_UserTemplate, { initialRequest, currentContent: currentAgentContent || placeholderContent, suggestionsToImplementStr: currentSuggestions.join('; ') });
                        const rawImplementedContent = await makeApiCall(iteration.requestPrompt_Rendered, iteration.requestPrompt_SysInstruction, false, `Agent Loop ${i-2} - Implement`);
                        const implementedContent = cleanOutputByType(rawImplementedContent, outputType);
                        iteration.generatedSubStep_Content = implementedContent;

                        // Sub-Step B: Refine Implemented & Suggest Next
                        iteration.requestPrompt_SubStep_SysInstruction = agentGeneratedPrompts.refinement_and_suggestion.system_instruction; // Re-use
                        iteration.requestPrompt_SubStep_UserTemplate = agentGeneratedPrompts.refinement_and_suggestion.user_prompt_template; // Re-use
                        iteration.requestPrompt_SubStep_Rendered = renderPrompt(iteration.requestPrompt_SubStep_UserTemplate, { initialRequest, currentContent: implementedContent || placeholderContent }); 
                        const refineSuggestLoopJsonResponseString = await makeApiCall(iteration.requestPrompt_SubStep_Rendered, iteration.requestPrompt_SubStep_SysInstruction, true, `Agent Loop ${i-2} - Refine & Suggest`);
                        const refineSuggestLoopJson = cleanOutputByType(refineSuggestLoopJsonResponseString, 'json');
                         try {
                            const parsedRefineLoop = JSON.parse(refineSuggestLoopJson);
                            iteration.generatedMainContent = cleanOutputByType(parsedRefineLoop.refined_content || "", outputType);
                            iteration.generatedSuggestions = Array.isArray(parsedRefineLoop.suggestions) ? parsedRefineLoop.suggestions.slice(0,2) : generateFallbackFeaturesFromString('');
                        } catch (e: any) {
                            console.error("Failed to parse JSON from Loop Refinement & Suggestion LLM:", e, "Raw JSON string:", refineSuggestLoopJson, "Original response:", refineSuggestLoopJsonResponseString);
                            iteration.generatedMainContent = cleanOutputByType(implementedContent || placeholderContent, outputType); // Fallback
                            iteration.generatedSuggestions = generateFallbackFeaturesFromString(refineSuggestLoopJsonResponseString);
                            iteration.error = `Error parsing Loop Refinement & Suggestion output: ${e.message}. Output was: ${refineSuggestLoopJson.substring(0, 200)}`;
                        }
                        currentAgentContent = iteration.generatedMainContent || "";
                        currentSuggestions = iteration.generatedSuggestions || [];
                    } else { // Final Polish
                        iteration.requestPrompt_SysInstruction = agentGeneratedPrompts.final_polish.system_instruction;
                        iteration.requestPrompt_UserTemplate = agentGeneratedPrompts.final_polish.user_prompt_template;
                        iteration.requestPrompt_Rendered = renderPrompt(iteration.requestPrompt_UserTemplate, { initialRequest, currentContent: currentAgentContent || placeholderContent });
                        const rawFinalContent = await makeApiCall(iteration.requestPrompt_Rendered, iteration.requestPrompt_SysInstruction, false, "Agent Final Polish");
                        iteration.generatedMainContent = cleanOutputByType(rawFinalContent, outputType);
                        currentAgentContent = iteration.generatedMainContent || "";
                        iteration.generatedSuggestions = [];
                    }
                } else if (i > 0 && !agentGeneratedPrompts) {
                    throw new Error("Agent prompts not generated or found from setup step (i=0). Cannot proceed with agent iteration.");
                }

            }
            // If an error occurred within a try-catch inside the agent logic (e.g. JSON parse error),
            // it would set iteration.error. We should check that before setting status to 'completed'.
            if (!iteration.error) {
                iteration.status = 'completed';
            } else {
                iteration.status = 'error'; // Keep error status if already set
            }
        } catch (error: any) {
            if (error instanceof PipelineStopRequestedError) {
                iteration.status = 'cancelled';
                iteration.error = 'Process execution was stopped by the user.'; 
                updatePipelineStatusUI(pipelineId, 'stopped');
            } else {
                if (!iteration.error) iteration.error = error.message || 'An unknown operational error occurred.';
                iteration.status = 'error';
                updatePipelineStatusUI(pipelineId, 'failed');
            }
            updateIterationUI(pipelineId, i); 
            for (let j = i + 1; j < pipeline.iterations.length; j++) {
                if (pipeline.iterations[j].status !== 'cancelled') { 
                    pipeline.iterations[j].status = 'cancelled';
                    pipeline.iterations[j].error = (error instanceof PipelineStopRequestedError) ? 'Process stopped by user.' : 'Halted due to prior error.';
                    updateIterationUI(pipelineId, j);
                }
            }
            return; 
        }
        updateIterationUI(pipelineId, i); 
    }

    if (pipeline && !pipeline.isStopRequested && pipeline.status !== 'failed') {
        updatePipelineStatusUI(pipelineId, 'completed');
    } else if (pipeline && pipeline.status === 'failed') {
        // Status already set to failed, do nothing more here for global status.
    }
}


function escapeHtml(unsafe: string): string {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function downloadFile(content: string, fileName: string, contentType: string) {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
}

function handleGlobalFullscreenChange() {
    const isCurrentlyFullscreen = !!document.fullscreenElement;
    document.querySelectorAll('.fullscreen-toggle-button').forEach(button => {
        const btn = button as HTMLButtonElement;
        const iconFullscreen = btn.querySelector('.icon-fullscreen') as HTMLElement;
        const iconExitFullscreen = btn.querySelector('.icon-exit-fullscreen') as HTMLElement;
        const previewContainerId = btn.id.replace('fullscreen-btn-', 'preview-container-');
        const associatedPreviewContainer = document.getElementById(previewContainerId);

        if (isCurrentlyFullscreen && document.fullscreenElement === associatedPreviewContainer) {
            if (iconFullscreen) iconFullscreen.style.display = 'none';
            if (iconExitFullscreen) iconExitFullscreen.style.display = 'inline-block';
            btn.title = "Exit Fullscreen Preview";
            btn.setAttribute('aria-label', "Exit Fullscreen Preview");
        } else {
            if (iconFullscreen) iconFullscreen.style.display = 'inline-block';
            if (iconExitFullscreen) iconExitFullscreen.style.display = 'none';
            btn.title = "Toggle Fullscreen Preview";
            btn.setAttribute('aria-label', "Toggle Fullscreen Preview");
        }
    });
}
document.addEventListener('fullscreenchange', handleGlobalFullscreenChange);

function exportConfiguration() {
    if (isGenerating) { 
        alert("Cannot export configuration while generation is in progress.");
        return;
    }
    const selectedOriginalIndices: number[] = [];
    if (currentMode !== 'math') { // Website, Creative, Agent
        pipelineSelectorsContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').forEach(checkbox => {
            selectedOriginalIndices.push(parseInt(checkbox.dataset.temperatureIndex || "-1", 10));
        });
    }

    const config: ExportedConfig = {
        currentMode: currentMode,
        initialIdea: initialIdeaInput.value,
        problemImageBase64: currentMode === 'math' ? currentProblemImageBase64 : undefined,
        problemImageMimeType: currentMode === 'math' ? currentProblemImageMimeType : undefined,
        selectedModel: modelSelectElement.value,
        selectedOriginalTemperatureIndices: selectedOriginalIndices,
        pipelinesState: JSON.parse(JSON.stringify(pipelinesState.map(p => {
            const { tabButtonElement, contentElement, stopButtonElement, ...rest } = p; 
            return rest;
        }))),
        activeMathPipeline: currentMode === 'math' ? JSON.parse(JSON.stringify(activeMathPipeline)) : null,
        activeReactPipeline: currentMode === 'react' ? JSON.parse(JSON.stringify(activeReactPipeline)) : null, // Added for React
        activePipelineId: (currentMode !== 'math' && currentMode !== 'react') ? activePipelineId : null,
        activeMathProblemTabId: (currentMode === 'math' && activeMathPipeline) ? activeMathPipeline.activeTabId : undefined,
        // activeReactProblemTabId: (currentMode === 'react' && activeReactPipeline) ? activeReactPipeline.activeTabId : undefined, // For React worker tabs
        globalStatusText: "Ready.",
        globalStatusClass: "status-idle",
        customPromptsWebsite: customPromptsWebsiteState,
        customPromptsCreative: customPromptsCreativeState,
        customPromptsMath: customPromptsMathState,
        customPromptsAgent: customPromptsAgentState,
        customPromptsReact: customPromptsReactState, // Added for React
        isCustomPromptsOpen: isCustomPromptsOpen,
    };
    const configJson = JSON.stringify(config, null, 2);
    downloadFile(configJson, `iterative_studio_config_${currentMode}.json`, 'application/json');
}

function handleImportConfiguration(event: Event) {
    if (isGenerating) {
        alert("Cannot import configuration while generation is in progress.");
        return;
    }
    const fileInputTarget = event.target as HTMLInputElement;
    if (!fileInputTarget.files || fileInputTarget.files.length === 0) return;
    const file = fileInputTarget.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const result = e.target?.result as string;
            const importedConfig = JSON.parse(result) as ExportedConfig;

            const criticalFields: { key: keyof ExportedConfig; type: string }[] = [
                { key: 'currentMode', type: 'string' },
                { key: 'initialIdea', type: 'string' },
                { key: 'selectedModel', type: 'string' },
                { key: 'customPromptsWebsite', type: 'object' },
                { key: 'customPromptsCreative', type: 'object' },
                { key: 'customPromptsMath', type: 'object' },
                { key: 'customPromptsAgent', type: 'object' },
                { key: 'customPromptsReact', type: 'object' }, // Added for React
            ];

            if (!importedConfig) {
                throw new Error("Invalid configuration: Root object is missing or not valid JSON.");
            }

            for (const field of criticalFields) {
                if (!(field.key in importedConfig) || typeof importedConfig[field.key] !== field.type) {
                     // Allow customPrompts to be potentially undefined if not present, will use defaults
                    if (field.type === 'object' && importedConfig[field.key] === undefined) {
                        console.warn(`Configuration field '${field.key}' is missing, will use defaults.`);
                    } else {
                        throw new Error(`Invalid configuration: Missing or malformed critical field '${field.key}'. Expected type '${field.type}', got '${typeof importedConfig[field.key]}'.`);
                    }
                }
            }

            currentMode = importedConfig.currentMode;
            (document.querySelector(`input[name="appMode"][value="${currentMode}"]`) as HTMLInputElement).checked = true;
            
            initialIdeaInput.value = importedConfig.initialIdea;
            if (currentMode === 'math') {
                currentProblemImageBase64 = importedConfig.problemImageBase64 || null;
                currentProblemImageMimeType = importedConfig.problemImageMimeType || null;
                if (currentProblemImageBase64 && mathProblemImagePreview) {
                    mathProblemImagePreview.src = `data:${currentProblemImageMimeType};base64,${currentProblemImageBase64}`;
                    mathProblemImagePreview.style.display = 'block';
                } else if (mathProblemImagePreview) {
                    mathProblemImagePreview.style.display = 'none';
                    mathProblemImagePreview.src = '#';
                }
            } else {
                currentProblemImageBase64 = null;
                currentProblemImageMimeType = null;
                 if (mathProblemImagePreview) {
                    mathProblemImagePreview.style.display = 'none';
                    mathProblemImagePreview.src = '#';
                }
            }
            updateUIAfterModeChange(); 

            modelSelectElement.value = importedConfig.selectedModel || (currentMode === 'math' ? MATH_MODEL_NAME : modelSelectElement.options[0].value);

            activeMathPipeline = null; // Reset other mode states
            pipelinesState = [];
            activeReactPipeline = null;

            if (currentMode === 'website' || currentMode === 'creative' || currentMode === 'agent') {
                 const allCheckboxes = pipelineSelectorsContainer.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
                allCheckboxes.forEach(cb => cb.checked = false);
                (importedConfig.selectedOriginalTemperatureIndices || []).forEach(originalIndex => {
                    const checkboxToSelect = pipelineSelectorsContainer.querySelector<HTMLInputElement>(`input[data-temperature-index="${originalIndex}"]`);
                    if (checkboxToSelect) checkboxToSelect.checked = true;
                });

                pipelinesState = (importedConfig.pipelinesState || []).map(p => ({
                    ...p,
                    tabButtonElement: undefined, contentElement: undefined, stopButtonElement: undefined, 
                    isStopRequested: false, 
                    status: (p.status === 'running' || p.status === 'stopping') ? 'idle' : p.status,
                }));
                activePipelineId = importedConfig.activePipelineId;
                renderPipelines();
                if (activePipelineId !== null && pipelinesState.some(p => p.id === activePipelineId)) activateTab(activePipelineId);
                else if (pipelinesState.length > 0) activateTab(pipelinesState[0].id);

            } else if (currentMode === 'math') {
                activeMathPipeline = importedConfig.activeMathPipeline ? {
                    ...importedConfig.activeMathPipeline,
                    isStopRequested: false,
                    status: (importedConfig.activeMathPipeline.status === 'processing' || importedConfig.activeMathPipeline.status === 'stopping') ? 'idle' : importedConfig.activeMathPipeline.status,
                    activeTabId: importedConfig.activeMathProblemTabId || 'problem-details',
                } : null;
                activePipelineId = null;
                renderActiveMathPipeline();
                if (activeMathPipeline && activeMathPipeline.activeTabId) {
                    activateTab(activeMathPipeline.activeTabId);
                }
            } else if (currentMode === 'react') { // Added for React
                activeReactPipeline = importedConfig.activeReactPipeline ? {
                    ...importedConfig.activeReactPipeline,
                    isStopRequested: false,
                    status: (importedConfig.activeReactPipeline.status === 'orchestrating' || importedConfig.activeReactPipeline.status === 'processing_workers' || importedConfig.activeReactPipeline.status === 'stopping') ? 'idle' : importedConfig.activeReactPipeline.status,
                    // activeTabId will be handled by renderReactModePipeline based on its own state
                } : null;
                activePipelineId = null;
                renderReactModePipeline();
                if (activeReactPipeline && activeReactPipeline.activeTabId) {
                   activateTab(activeReactPipeline.activeTabId);
                }
            }


            customPromptsWebsiteState = importedConfig.customPromptsWebsite ? JSON.parse(JSON.stringify(importedConfig.customPromptsWebsite)) : JSON.parse(JSON.stringify(defaultCustomPromptsWebsite));
            customPromptsCreativeState = importedConfig.customPromptsCreative ? JSON.parse(JSON.stringify(importedConfig.customPromptsCreative)) : JSON.parse(JSON.stringify(defaultCustomPromptsCreative));
            
            const importedMathPrompts = importedConfig.customPromptsMath || createDefaultCustomPromptsMath(NUM_INITIAL_STRATEGIES_MATH, NUM_SUB_STRATEGIES_PER_MAIN_MATH);
            customPromptsMathState = JSON.parse(JSON.stringify(importedMathPrompts));

            const importedAgentPrompts = importedConfig.customPromptsAgent || createDefaultCustomPromptsAgent(NUM_AGENT_MAIN_REFINEMENT_LOOPS);
            customPromptsAgentState = JSON.parse(JSON.stringify(importedAgentPrompts));

            const importedReactPrompts = importedConfig.customPromptsReact || defaultCustomPromptsReact; // Using defaultCustomPromptsReact directly
            customPromptsReactState = JSON.parse(JSON.stringify(importedReactPrompts));
            
            updateCustomPromptTextareasFromState();
            
            // Note: The prompts modal doesn't have a persistent open/closed state in the new design. It's always closed on load.
            // const importedOpenState = importedConfig.isCustomPromptsOpen === undefined ? false : importedConfig.isCustomPromptsOpen;
            // setPromptsModalVisible(importedOpenState);
            
            updateControlsState();
        } catch (error: any) {
            console.error("Error importing configuration:", error);
        } finally {
            if (fileInputTarget) fileInputTarget.value = '';
        }
    };
    reader.onerror = () => {
        if (fileInputTarget) fileInputTarget.value = '';
    };
    reader.readAsText(file);
}

// ---------- MATH MODE SPECIFIC FUNCTIONS ----------

async function startMathSolvingProcess(problemText: string, imageBase64?: string | null, imageMimeType?: string | null) {
    if (!ai) {
        return;
    }
    isGenerating = true;
    updateControlsState();

    activeMathPipeline = {
        id: `math-process-${Date.now()}`,
        problemText: problemText,
        problemImageBase64: imageBase64,
        problemImageMimeType: imageMimeType,
        initialStrategies: [],
        status: 'processing',
        isStopRequested: false,
        activeTabId: 'problem-details'
    };
    renderActiveMathPipeline(); 

    const currentProcess = activeMathPipeline; 

    const makeMathApiCall = async (
        parts: Part[],
        systemInstruction: string,
        isJson: boolean,
        stepDescription: string,
        targetStatusField: MathMainStrategyData | MathSubStrategyData | MathPipelineState,
        retryAttemptField: 'retryAttempt'
    ): Promise<string> => {
        if (!currentProcess || currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${stepDescription}`);
        let responseText = "";

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested during retry for: ${stepDescription}`);
            
            targetStatusField[retryAttemptField] = attempt;
            targetStatusField.status = attempt > 0 ? 'retrying' : 'processing';
            renderActiveMathPipeline(); 

            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt)));
            
            try {
                const apiResponse = await callGemini(parts, MATH_FIXED_TEMPERATURE, MATH_MODEL_NAME, systemInstruction, isJson);
                responseText = apiResponse.text;
                targetStatusField.status = 'processing'; 
                renderActiveMathPipeline();
                return responseText;
            } catch (e: any) {
                console.warn(`Math Solver (${stepDescription}), Attempt ${attempt + 1} failed: ${e.message}`);
                targetStatusField.error = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
                if (e.details) targetStatusField.error += `\nDetails: ${JSON.stringify(e.details)}`;
                if (e.status) targetStatusField.error += `\nStatus: ${e.status}`;
                renderActiveMathPipeline();
                if (attempt === MAX_RETRIES) {
                    targetStatusField.error = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                    throw e; 
                }
            }
        }
        throw new Error(`API call for ${stepDescription} failed all retries.`);
    };

    try {
        const initialUserPrompt = renderPrompt(customPromptsMathState.user_math_initialStrategy, { originalProblemText: problemText });
        const initialPromptParts: Part[] = [{ text: initialUserPrompt }];
        if (imageBase64 && imageMimeType) {
            initialPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } }); 
        }
        currentProcess.requestPromptInitialStrategyGen = initialUserPrompt + (imageBase64 ? "\n[Image Provided]" : ""); 
        
        const initialStrategiesJsonString = await makeMathApiCall(
            initialPromptParts, 
            customPromptsMathState.sys_math_initialStrategy, 
            true, 
            "Initial Strategy Generation",
            currentProcess,
            'retryAttempt'
        );

        const parsedInitialStrategies = parseJsonSuggestions(initialStrategiesJsonString, 'strategies', NUM_INITIAL_STRATEGIES_MATH);
        currentProcess.initialStrategies = parsedInitialStrategies.map((stratText, i) => ({
            id: `main${i}`,
            strategyText: stratText,
            subStrategies: [],
            status: 'pending',
            isDetailsOpen: true, 
        }));
        currentProcess.status = 'processing'; 
        renderActiveMathPipeline();

        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped after initial strategies.");

        await Promise.allSettled(currentProcess.initialStrategies.map(async (mainStrategy, mainIndex) => {
            if (currentProcess.isStopRequested) {
                mainStrategy.status = 'cancelled';
                mainStrategy.error = "Process stopped by user.";
                return;
            }
            try {
                mainStrategy.status = 'processing';
                renderActiveMathPipeline();

                const otherMainStrategies = currentProcess.initialStrategies
                    .filter((_, idx) => idx !== mainIndex)
                    .map(s => s.strategyText);
                const subStrategyUserPrompt = renderPrompt(customPromptsMathState.user_math_subStrategy, {
                    originalProblemText: problemText,
                    currentMainStrategy: mainStrategy.strategyText,
                    otherMainStrategiesStr: otherMainStrategies.join('; ') || "None"
                });
                const subStrategyPromptParts: Part[] = [{ text: subStrategyUserPrompt }];
                 if (imageBase64 && imageMimeType) {
                    subStrategyPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
                }
                mainStrategy.requestPromptSubStrategyGen = subStrategyUserPrompt + (imageBase64 ? "\n[Image Provided]" : "");

                const subStrategiesJsonString = await makeMathApiCall(
                    subStrategyPromptParts,
                    customPromptsMathState.sys_math_subStrategy,
                    true,
                    `Sub-strategy Gen for Main Strategy ${mainIndex + 1}`,
                    mainStrategy,
                    'retryAttempt'
                );
                const parsedSubStrategies = parseJsonSuggestions(subStrategiesJsonString, 'sub_strategies', NUM_SUB_STRATEGIES_PER_MAIN_MATH);
                mainStrategy.subStrategies = parsedSubStrategies.map((subText, j) => ({
                    id: `main${mainIndex}-sub${j}`,
                    subStrategyText: subText,
                    status: 'pending',
                    isDetailsOpen: true, 
                }));
                mainStrategy.status = 'completed'; 
            } catch (e: any) {
                mainStrategy.status = 'error';
                if (!mainStrategy.error) mainStrategy.error = e.message || "Failed to generate sub-strategies for this branch.";
                 console.error(`Error in sub-strategy gen for MS ${mainIndex + 1}:`, e);
            } finally {
                renderActiveMathPipeline();
            }
        }));

        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped after sub-strategies.");

        const solutionPromises: Promise<void>[] = [];
        currentProcess.initialStrategies.forEach((mainStrategy, mainIndex) => {
            mainStrategy.subStrategies.forEach(async (subStrategy, subIndex) => {
                 if (currentProcess.isStopRequested) {
                    subStrategy.status = 'cancelled';
                    subStrategy.error = "Process stopped by user.";
                    return;
                }
                solutionPromises.push((async () => {
                    try {
                        subStrategy.status = 'processing';
                        renderActiveMathPipeline();

                        const solutionUserPrompt = renderPrompt(customPromptsMathState.user_math_solutionAttempt, {
                            originalProblemText: problemText,
                            currentSubStrategy: subStrategy.subStrategyText
                        });
                        const solutionPromptParts: Part[] = [{ text: solutionUserPrompt }];
                        if (imageBase64 && imageMimeType) {
                           solutionPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
                        }
                        subStrategy.requestPromptSolutionAttempt = solutionUserPrompt + (imageBase64 ? "\n[Image Provided]" : "");
                        
                        const rawSolutionAttempt = await makeMathApiCall( 
                            solutionPromptParts,
                            customPromptsMathState.sys_math_solutionAttempt,
                            false, 
                            `Solution Attempt for MS ${mainIndex + 1}, Sub ${subIndex + 1}`,
                            subStrategy,
                            'retryAttempt'
                        );
                        subStrategy.solutionAttempt = cleanTextOutput(rawSolutionAttempt);
                        subStrategy.status = 'completed';
                    } catch (e: any) {
                        subStrategy.status = 'error';
                        if(!subStrategy.error) subStrategy.error = e.message || "Failed to attempt solution for this sub-strategy.";
                        console.error(`Error in solution for MS ${mainIndex+1}, Sub ${subIndex+1}:`, e);
                    } finally {
                        renderActiveMathPipeline();
                    }
                })());
            });
        });
        await Promise.allSettled(solutionPromises);
        
        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during solution attempts.");

        currentProcess.status = 'completed';

    } catch (error: any) {
        if (currentProcess) {
            if (error instanceof PipelineStopRequestedError) {
                currentProcess.status = 'stopped';
                currentProcess.error = error.message;
            } else {
                currentProcess.status = 'error';
                currentProcess.error = error.message || "An unknown error occurred in math solver.";
            }
        }
        console.error("Error in Math Solver process:", error);
    } finally {
        if (currentProcess && currentProcess.status !== 'processing' && currentProcess.status !== 'stopping') {
            isGenerating = false;
            updateControlsState();
            renderActiveMathPipeline(); 
        }
    }
}

function renderActiveMathPipeline() {
    if (currentMode !== 'math' || !pipelinesContentContainer || !tabsNavContainer) {
        if (currentMode !== 'math') { 
             tabsNavContainer.innerHTML = '';
             // Clear only math-specific content, not graph-view or other mode's content
             document.querySelectorAll('.math-pipeline-content-pane').forEach(el => el.remove());
        }
        return;
    }
    if (!activeMathPipeline) {
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message" style="padding: 1rem; color: var(--text-secondary-color);">Enter a math problem and click "Solve Problem".</p>';
        document.querySelectorAll('.math-pipeline-content-pane').forEach(el => el.remove());
        return;
    }

    const mathProcess = activeMathPipeline;
    tabsNavContainer.innerHTML = ''; 
    document.querySelectorAll('.math-pipeline-content-pane').forEach(el => el.remove()); // Clear previous math panes

    const problemTabButton = document.createElement('button');
    problemTabButton.className = 'tab-button math-mode-tab'; // Added math-mode-tab
    problemTabButton.id = `math-tab-problem-details`;
    problemTabButton.textContent = 'Problem Details';
    problemTabButton.setAttribute('role', 'tab');
    problemTabButton.setAttribute('aria-controls', `math-content-problem-details`);
    problemTabButton.addEventListener('click', () => activateTab('problem-details'));
    tabsNavContainer.appendChild(problemTabButton);

    const problemContentPane = document.createElement('div');
    problemContentPane.id = `math-content-problem-details`;
    problemContentPane.className = 'math-pipeline-content-pane';
    problemContentPane.setAttribute('role', 'tabpanel');
    problemContentPane.setAttribute('aria-labelledby', `math-tab-problem-details`);
    let problemDetailsHtml = `
        <div class="math-problem-display">
            <h3>Original Problem</h3>
            <p class="problem-text">${escapeHtml(mathProcess.problemText)}</p>`;
    if (mathProcess.problemImageBase64 && mathProcess.problemImageMimeType) {
        problemDetailsHtml += `<img src="data:${mathProcess.problemImageMimeType};base64,${mathProcess.problemImageBase64}" alt="Uploaded Math Problem Image" class="problem-image-display">`;
    }
    if (mathProcess.requestPromptInitialStrategyGen) {
        problemDetailsHtml += `
            <div class="math-detail-group">
                <h4 class="prompt-title prompt-title-math-initial-strategy">Initial Strategy Generation User Prompt:</h4>
                <pre class="prompt-block">${escapeHtml(mathProcess.requestPromptInitialStrategyGen)}</pre>
            </div>`;
    }
     if (mathProcess.status === 'retrying' && mathProcess.retryAttempt !== undefined && mathProcess.initialStrategies.length === 0) { 
        problemDetailsHtml += `<p class="iteration-status status-retrying">Retrying initial strategy generation (${mathProcess.retryAttempt}/${MAX_RETRIES})...</p>`;
    } else if (mathProcess.error && mathProcess.initialStrategies.length === 0) { 
        problemDetailsHtml += `<div class="error-message"><strong>Error during initial strategy generation:</strong> <pre>${escapeHtml(mathProcess.error)}</pre></div>`;
    }
    problemDetailsHtml += `</div>`;
    problemContentPane.innerHTML = problemDetailsHtml;
    pipelinesContentContainer.appendChild(problemContentPane);


    mathProcess.initialStrategies.forEach((mainStrategy, index) => {
        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button math-mode-tab'; // Added math-mode-tab
        tabButton.id = `math-tab-strategy-${index}`;
        tabButton.textContent = `Strategy ${index + 1}`;
        if (mainStrategy.status === 'error') tabButton.classList.add('status-math-error');
        else if (mainStrategy.status === 'processing' || mainStrategy.status === 'retrying') tabButton.classList.add('status-math-processing');
        else if (mainStrategy.subStrategies.every(s => s.status === 'completed')) tabButton.classList.add('status-math-completed');

        tabButton.setAttribute('role', 'tab');
        tabButton.setAttribute('aria-controls', `math-content-strategy-${index}`);
        tabButton.addEventListener('click', () => activateTab(`strategy-${index}`));
        tabsNavContainer.appendChild(tabButton);

        const contentPane = document.createElement('div');
        contentPane.id = `math-content-strategy-${index}`;
        contentPane.className = 'math-pipeline-content-pane';
        contentPane.setAttribute('role', 'tabpanel');
        contentPane.setAttribute('aria-labelledby', `math-tab-strategy-${index}`);
        
        let contentHtml = `<div class="math-strategy-branch" id="math-branch-${mainStrategy.id}">
            <details ${mainStrategy.isDetailsOpen ? 'open' : ''}>
                <summary>
                    <span class="math-strategy-title">Main Strategy ${index + 1}:</span>
                    <span class="math-step-status status-${mainStrategy.status}" id="math-main-strat-status-${mainStrategy.id}">${mainStrategy.status}</span>
                </summary>
                <div class="math-strategy-details">
                    <p class="strategy-text">${escapeHtml(mainStrategy.strategyText)}</p>`;
        if (mainStrategy.requestPromptSubStrategyGen) {
            contentHtml += `
                <div class="math-detail-group">
                    <h4 class="prompt-title prompt-title-math-sub-strategy">Sub-strategy Generation User Prompt:</h4>
                    <pre class="prompt-block">${escapeHtml(mainStrategy.requestPromptSubStrategyGen)}</pre>
                </div>`;
        }
        if (mainStrategy.status === 'retrying' && mainStrategy.retryAttempt !== undefined) {
             contentHtml += `<p class="iteration-status status-retrying">Retrying sub-strategy generation (${mainStrategy.retryAttempt}/${MAX_RETRIES})...</p>`;
        } else if (mainStrategy.error) {
             contentHtml += `<div class="error-message"><strong>Error during sub-strategy generation:</strong> <pre>${escapeHtml(mainStrategy.error)}</pre></div>`;
        }
        contentHtml += `</div></details>`; // Close main strategy details
        
        if (mainStrategy.subStrategies.length > 0) {
            contentHtml += `<ul class="math-sub-strategies-list">`;
            mainStrategy.subStrategies.forEach((subStrategy, subIndex) => {
                contentHtml += `
                    <li class="math-sub-strategy-item" id="math-sub-item-${subStrategy.id}">
                        <details ${subStrategy.isDetailsOpen ? 'open' : ''}>
                            <summary>
                                <span class="math-sub-strategy-title">Sub-Strategy ${index + 1}.${subIndex + 1}:</span>
                                <span class="math-step-status status-${subStrategy.status}" id="math-sub-strat-status-${subStrategy.id}">${subStrategy.status}</span>
                            </summary>
                            <div class="math-sub-strategy-details">
                                <p class="sub-strategy-text">${escapeHtml(subStrategy.subStrategyText)}</p>`;
                if (subStrategy.requestPromptSolutionAttempt) {
                     contentHtml += `
                        <div class="math-detail-group">
                            <h4 class="prompt-title prompt-title-math-solution">Solution Attempt User Prompt:</h4>
                            <pre class="prompt-block">${escapeHtml(subStrategy.requestPromptSolutionAttempt)}</pre>
                        </div>`;
                }
                if (subStrategy.status === 'retrying' && subStrategy.retryAttempt !== undefined) {
                    contentHtml += `<p class="iteration-status status-retrying">Retrying solution attempt (${subStrategy.retryAttempt}/${MAX_RETRIES})...</p>`;
                } else if (subStrategy.solutionAttempt) {
                    contentHtml += `
                        <div class="math-detail-group">
                            <h4>Solution Attempt:</h4>
                            <pre class="text-block solution-attempt-block">${escapeHtml(subStrategy.solutionAttempt)}</pre>
                        </div>`;
                } else if (subStrategy.status === 'error' && subStrategy.error) {
                     contentHtml += `<div class="error-message"><strong>Error in solution attempt:</strong> <pre>${escapeHtml(subStrategy.error)}</pre></div>`;
                } else if (subStrategy.status === 'pending') {
                     contentHtml += `<p>Solution attempt pending...</p>`
                } else if (subStrategy.status === 'processing') {
                     contentHtml += `<p>Solution attempt in progress...</p>`
                } else if (subStrategy.status === 'cancelled') {
                    contentHtml += `<p>Solution attempt cancelled.</p>`
                }


                contentHtml += `</div></details></li>`; // Close sub-strategy item
            });
            contentHtml += `</ul>`; // Close sub-strategies list
        } else if (mainStrategy.status === 'completed' && mainStrategy.subStrategies.length === 0) {
             contentHtml += `<p>No sub-strategies were generated for this main strategy.</p>`;
        }
        
        contentHtml += `</div>`; // Close math-strategy-branch
        contentPane.innerHTML = contentHtml;
        pipelinesContentContainer.appendChild(contentPane);

        // Attach event listeners for details toggling (persistence)
        const mainStrategyDetails = contentPane.querySelector<HTMLDetailsElement>(`#math-branch-${mainStrategy.id} > details`);
        if (mainStrategyDetails) {
            mainStrategyDetails.addEventListener('toggle', () => {
                const ms = activeMathPipeline?.initialStrategies.find(s => s.id === mainStrategy.id);
                if (ms) ms.isDetailsOpen = mainStrategyDetails.open;
            });
        }
        mainStrategy.subStrategies.forEach(subS => {
            const subStrategyDetails = contentPane.querySelector<HTMLDetailsElement>(`#math-sub-item-${subS.id} details`);
            if (subStrategyDetails) {
                subStrategyDetails.addEventListener('toggle', () => {
                   const ms = activeMathPipeline?.initialStrategies.find(s => s.id === mainStrategy.id);
                   const ss = ms?.subStrategies.find(s_ => s_.id === subS.id);
                   if (ss) ss.isDetailsOpen = subStrategyDetails.open;
                });
            }
        });
    });

    if (mathProcess.activeTabId) {
        activateTab(mathProcess.activeTabId);
    } else {
        activateTab('problem-details'); // Default to problem details
    }
    updateControlsState();
     // If graph view is active, re-render it
    const viewToggleGraphButton = document.getElementById('view-toggle-graph') as HTMLButtonElement;
    if (viewToggleGraphButton && viewToggleGraphButton.classList.contains('active')) {
        renderGraphView();
    }
}

// ----- END MATH MODE SPECIFIC FUNCTIONS -----

// ---------- REACT MODE SPECIFIC FUNCTIONS ----------

async function startReactModeProcess(userRequest: string) {
    if (!ai) {
        return;
    }
    isGenerating = true;
    updateControlsState();

    const orchestratorSysPrompt = customPromptsReactState.sys_orchestrator;
    const orchestratorUserPrompt = renderPrompt(customPromptsReactState.user_orchestrator, { user_request: userRequest });

    activeReactPipeline = {
        id: `react-process-${Date.now()}`,
        userRequest: userRequest,
        orchestratorSystemInstruction: orchestratorSysPrompt,
        stages: Array(5).fill(null).map((_, i) => ({ // Initialize 5 stages
            id: i,
            title: `Worker Agent ${i + 1}`, // Placeholder title
            status: 'pending',
            isDetailsOpen: i === 0, // Open first by default
        })),
        status: 'orchestrating',
        isStopRequested: false,
        activeTabId: 'worker-0', // Default to first worker tab
    };
    renderReactModePipeline(); 

    try {
        activeReactPipeline.orchestratorRetryAttempt = 0;

        let orchestratorResponseText = "";
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (activeReactPipeline.isStopRequested) throw new PipelineStopRequestedError("React Orchestration stopped by user.");
            activeReactPipeline.orchestratorRetryAttempt = attempt;
            activeReactPipeline.status = attempt > 0 ? 'orchestrating_retrying' : 'orchestrating'; // More specific status
            if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt)));
            }
            renderReactModePipeline(); // Update UI to show retrying or initial processing state

            try {
                const selectedModel = modelSelectElement.value || "gemini-2.5-pro"; // Fallback if not selected

                const apiResponse = await callGemini(orchestratorUserPrompt, 1.0, selectedModel, orchestratorSysPrompt, true); // Expecting JSON output
                orchestratorResponseText = apiResponse.text;
                break;
            } catch (e: any) {
                console.warn(`React Orchestrator, Attempt ${attempt + 1} failed: ${e.message}`);
                activeReactPipeline.error = `Orchestrator Attempt ${attempt + 1} failed: ${e.message || 'Unknown API error'}`;
                if (attempt === MAX_RETRIES) {
                    throw e; // Rethrow after max retries
                }
            }
        }

        activeReactPipeline.orchestratorRawOutput = orchestratorResponseText;
        const orchestratorJson = cleanOutputByType(orchestratorResponseText, 'json');

        try {
            const parsedOrchestratorOutput = JSON.parse(orchestratorJson);
            if (!parsedOrchestratorOutput.plan_txt || !Array.isArray(parsedOrchestratorOutput.worker_agents_prompts) || parsedOrchestratorOutput.worker_agents_prompts.length !== 5) {
                throw new Error("Orchestrator output is missing plan_txt or worker_agents_prompts (must be an array of 5).");
            }

            activeReactPipeline.orchestratorPlan = parsedOrchestratorOutput.plan_txt;

            parsedOrchestratorOutput.worker_agents_prompts.forEach((agentPromptData: any, index: number) => {
                if (index < 5 && activeReactPipeline && activeReactPipeline.stages[index]) {
                    const stage = activeReactPipeline.stages[index];
                    stage.title = agentPromptData.title || `Worker Agent ${index + 1}`;
                    stage.systemInstruction = agentPromptData.system_instruction;
                    stage.userPrompt = agentPromptData.user_prompt_template;
                }
            });

            activeReactPipeline.status = 'processing_workers'; // Next status
            renderReactModePipeline();

            // Kick off worker agents in parallel
            await runReactWorkerAgents();

        } catch (parseError: any) {
            console.error("Failed to parse Orchestrator JSON response:", parseError, "Cleaned JSON string:", orchestratorJson, "Raw response:", orchestratorResponseText);
            activeReactPipeline.error = `Failed to parse Orchestrator JSON: ${parseError.message}. Check console for details.`;
            throw new Error(`Orchestrator output parsing error: ${parseError.message}`);
        }

    } catch (error: any) {
        if (activeReactPipeline) {
            if (error instanceof PipelineStopRequestedError) {
                activeReactPipeline.status = 'stopped';
                activeReactPipeline.error = error.message;
            } else {
                activeReactPipeline.status = 'failed';
                if(!activeReactPipeline.error) activeReactPipeline.error = error.message || "An unknown error occurred in React Orchestrator.";
            }
        }
        console.error("Error in React Mode Orchestration process:", error);
    } finally {
        if (activeReactPipeline && activeReactPipeline.status !== 'processing_workers' && activeReactPipeline.status !== 'orchestrating' && activeReactPipeline.status !== 'orchestrating_retrying' && activeReactPipeline.status !== 'stopping') {
            isGenerating = false;
        }
        updateControlsState();
        renderReactModePipeline();
    }
}

function renderReactModePipeline() {
    if (currentMode !== 'react' || !tabsNavContainer || !pipelinesContentContainer) {
        if (currentMode !== 'react' && tabsNavContainer && pipelinesContentContainer) {
            tabsNavContainer.innerHTML = '';
             // Clear only react-specific content
            document.querySelectorAll('.react-orchestrator-pane, .react-worker-content-pane, .react-final-output-pane').forEach(el => el.remove());
        }
        return;
    }

    if (!activeReactPipeline) {
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message" style="padding: 1rem; color: var(--text-secondary-color);">Enter a React App Request and click "Generate React App".</p>';
        document.querySelectorAll('.react-orchestrator-pane, .react-worker-content-pane, .react-final-output-pane').forEach(el => el.remove());
        return;
    }

    const pipeline = activeReactPipeline;
    const scrollPositions: { [id: string]: { top: number, left: number } } = {};
    document.querySelectorAll('.react-details-section details[open], .code-block, .prompt-block, .react-final-output-pane pre').forEach(el => {
        scrollPositions[el.id || (el.parentElement?.id + '-child-' + Array.from(el.parentElement?.children || []).indexOf(el))] = { top: el.scrollTop, left: el.scrollLeft };
    });

    tabsNavContainer.innerHTML = '';
    // Clear only react worker panes, keep orchestrator and final output if they exist and should be shown
    document.querySelectorAll('.react-worker-content-pane').forEach(el => el.remove());


    let orchestratorPane = document.querySelector('.react-orchestrator-pane') as HTMLElement;
    if (!orchestratorPane) {
        orchestratorPane = document.createElement('div');
        orchestratorPane.className = 'react-orchestrator-pane';
        // Prepend it to pipelinesContentContainer so it appears above tabs/worker panes
        pipelinesContentContainer.prepend(orchestratorPane);
    }

    let orchestratorHtml = `
        <div class="pipeline-header">
             <h3>React App Orchestration</h3>
             <div class="pipeline-header-controls">
                <span class="pipeline-status status-${pipeline.status}" id="react-orchestrator-status-text">${pipeline.status.replace('_', ' ')}</span>
                <button class="stop-pipeline-button button-base action-button" id="stop-react-pipeline-btn" title="Stop React App Generation" aria-label="Stop React App Generation" style="display: ${pipeline.status === 'orchestrating' || pipeline.status === 'orchestrating_retrying' || pipeline.status === 'processing_workers' ? 'inline-flex' : 'none'};">
                    ${pipeline.status === 'stopping' ? 'Stopping...' : 'Stop'}
                </button>
            </div>
        </div>
        <details class="react-details-section" id="react-orchestrator-req-details" ${pipeline.userRequest ? 'open' : ''}>
            <summary>User Request & Orchestrator Config</summary>
            <div class="detail-content">
                <p><strong>User Request:</strong> ${escapeHtml(pipeline.userRequest)}</p>
                <h4 class="prompt-title">Orchestrator System Instruction:</h4>
                <pre class="prompt-block" id="react-orchestrator-sys-prompt-display">${escapeHtml(pipeline.orchestratorSystemInstruction)}</pre>
            </div>
        </details>
    `;
    if (pipeline.orchestratorPlan) {
        orchestratorHtml += `
        <details class="react-details-section" id="react-orchestrator-plan-details" open>
            <summary>Orchestrator's Plan (plan.txt)</summary>
            <div class="detail-content">
                <pre class="code-block language-text" id="react-plan-display">${escapeHtml(pipeline.orchestratorPlan)}</pre>
            </div>
        </details>`;
    }
    if (pipeline.orchestratorRawOutput) {
         orchestratorHtml += `
        <details class="react-details-section" id="react-orchestrator-raw-details">
            <summary>Orchestrator Raw Output (for debugging)</summary>
            <div class="detail-content">
                <pre class="code-block language-json" id="react-orchestrator-raw-display">${escapeHtml(pipeline.orchestratorRawOutput)}</pre>
            </div>
        </details>`;
    }
     if (pipeline.error && (pipeline.status === 'failed' || pipeline.status === 'error' && pipeline.stages.every(s => s.status === 'pending'))) {
        orchestratorHtml += `<div class="error-message"><strong>Orchestration Error:</strong> <pre>${escapeHtml(pipeline.error)}</pre></div>`;
    }
    orchestratorPane.innerHTML = orchestratorHtml;

    const stopReactButton = document.getElementById('stop-react-pipeline-btn');
    if (stopReactButton) {
        const newStopButton = stopReactButton.cloneNode(true) as HTMLButtonElement; // Clone to remove old listeners
        stopReactButton.parentNode?.replaceChild(newStopButton, stopReactButton);
        newStopButton.onclick = () => {
            if (activeReactPipeline && (activeReactPipeline.status === 'orchestrating' || activeReactPipeline.status === 'orchestrating_retrying' || activeReactPipeline.status === 'processing_workers')) {
                activeReactPipeline.isStopRequested = true;
                activeReactPipeline.status = 'stopping';
                renderReactModePipeline();
            }
        };
        newStopButton.disabled = pipeline.status === 'stopping' || pipeline.status === 'stopped' || pipeline.status === 'failed' || pipeline.status === 'completed';
    }


    // Worker Agent Tabs & Panes
    pipeline.stages.forEach(stage => {
        const tabButtonId = `react-pipeline-tab-worker-${stage.id}`;
        const contentPaneId = `react-worker-content-worker-${stage.id}`;

        const tabButton = document.createElement('button');
        tabButton.id = tabButtonId;
        tabButton.className = `tab-button react-mode-tab status-${stage.status}`;
        tabButton.textContent = stage.title || `Agent ${stage.id + 1}`;
        tabButton.setAttribute('role', 'tab');
        tabButton.setAttribute('aria-controls', contentPaneId);
        tabButton.addEventListener('click', () => activateTab(`worker-${stage.id}`));
        tabsNavContainer.appendChild(tabButton);

        const workerContentPane = document.createElement('div');
        workerContentPane.id = contentPaneId;
        workerContentPane.className = 'react-worker-content-pane pipeline-content'; // pipeline-content for general styling, react-worker-content-pane for specific
        workerContentPane.setAttribute('role', 'tabpanel');
        workerContentPane.setAttribute('aria-labelledby', tabButton.id);

        let displayStatusText = stage.status.charAt(0).toUpperCase() + stage.status.slice(1);
        if (stage.status === 'retrying' && stage.retryAttempt !== undefined) {
            displayStatusText = `Retrying (${stage.retryAttempt}/${MAX_RETRIES})...`;
        }

        let workerDetailsHtml = `
            <div class="pipeline-header">
                <h4>${escapeHtml(stage.title)}</h4>
                <span class="iteration-status status-${stage.status}">${displayStatusText}</span>
            </div>`;
        if (stage.error) {
            workerDetailsHtml += `<div class="error-message"><strong>Error:</strong> <pre>${escapeHtml(stage.error)}</pre></div>`;
        }
        workerDetailsHtml += `<details class="react-details-section" id="react-worker-${stage.id}-prompts-details" ${stage.isDetailsOpen ? 'open' : ''}>
            <summary>Prompts for ${escapeHtml(stage.title)}</summary>
            <div class="detail-content">
                <h5 class="prompt-title">System Instruction:</h5>
                <pre class="prompt-block" id="react-worker-${stage.id}-sys-prompt">${escapeHtml(stage.systemInstruction || "Not available.")}</pre>
                <h5 class="prompt-title">Rendered User Prompt:</h5>
                <pre class="prompt-block" id="react-worker-${stage.id}-user-prompt">${escapeHtml(stage.renderedUserPrompt || stage.userPrompt || "Not available.")}</pre>
            </div>
        </details>`;

        if (stage.generatedContent) {
            workerDetailsHtml += `
            <details class="react-details-section" id="react-worker-${stage.id}-code-details" open>
                <summary>Generated Code/Content</summary>
                <div class="detail-content">
                    <pre class="code-block language-javascript" id="react-worker-${stage.id}-code-block">${escapeHtml(stage.generatedContent)}</pre>
                     <button class="button-base action-button copy-react-worker-code-btn" data-worker-id="${stage.id}">Copy Code</button>
                </div>
            </details>`;
        } else if (stage.status === 'completed' && !stage.generatedContent) {
             workerDetailsHtml += `<p>Agent completed but generated no content.</p>`;
        }
        workerContentPane.innerHTML = workerDetailsHtml;
        // Insert worker panes after the orchestrator pane and before the final output pane (if it exists)
        const finalOutputPaneExisting = pipelinesContentContainer.querySelector('.react-final-output-pane');
        if (finalOutputPaneExisting) {
            pipelinesContentContainer.insertBefore(workerContentPane, finalOutputPaneExisting);
        } else {
            pipelinesContentContainer.appendChild(workerContentPane);
        }


        const promptsDetailsElement = workerContentPane.querySelector<HTMLDetailsElement>(`#react-worker-${stage.id}-prompts-details`);
        if (promptsDetailsElement) {
            promptsDetailsElement.addEventListener('toggle', () => {
                const stageToUpdate = activeReactPipeline?.stages.find(s => s.id === stage.id);
                if (stageToUpdate) stageToUpdate.isDetailsOpen = promptsDetailsElement.open;
            });
        }

        const copyBtn = workerContentPane.querySelector('.copy-react-worker-code-btn');
        if (copyBtn) {
            const newCopyBtn = copyBtn.cloneNode(true) as HTMLButtonElement;
            copyBtn.parentNode?.replaceChild(newCopyBtn, copyBtn);
            newCopyBtn.addEventListener('click', (e) => {
                const workerId = parseInt((e.target as HTMLElement).dataset.workerId || "-1", 10);
                const contentToCopy = activeReactPipeline?.stages.find(s => s.id === workerId)?.generatedContent;
                if (contentToCopy) {
                    copyToClipboard(contentToCopy, e.target as HTMLButtonElement);
                }
            });
        }
    });

    let finalOutputPane = document.querySelector('.react-final-output-pane') as HTMLElement | null;
    if (pipeline.finalAppendedCode) {
        if (!finalOutputPane) {
            finalOutputPane = document.createElement('div');
            finalOutputPane.className = 'react-final-output-pane';
            pipelinesContentContainer.appendChild(finalOutputPane);
        }
        finalOutputPane.innerHTML = `
            <h3>Final Aggregated Application Code</h3>
            <p>The following is a concatenation of outputs from successful worker agents. File markers (e.g., // --- FILE: src/App.tsx ---) should indicate intended file paths.</p>
            <pre id="react-final-appended-code" class="code-block language-javascript">${escapeHtml(pipeline.finalAppendedCode)}</pre>
            <button id="download-react-app-code" class="button-base action-button" type="button">Download Full App Code</button>
        `;

        const downloadAppButton = finalOutputPane.querySelector('#download-react-app-code');
        if (downloadAppButton && pipeline.finalAppendedCode) {
            const newDownloadAppButton = downloadAppButton.cloneNode(true) as HTMLButtonElement;
            downloadAppButton.parentNode?.replaceChild(newDownloadAppButton, downloadAppButton);
            newDownloadAppButton.addEventListener('click', () => {
                 if (activeReactPipeline?.finalAppendedCode) {
                    downloadFile(activeReactPipeline.finalAppendedCode, `react_app_${pipeline.id}.txt`, 'text/plain');
                 }
            });
        }
        finalOutputPane.style.display = 'block';
    } else if (finalOutputPane) {
        finalOutputPane.style.display = 'none'; // Hide if no final code
    }


    for (const id in scrollPositions) {
        const element = document.getElementById(id);
        if (element) {
            element.scrollTop = scrollPositions[id].top;
            element.scrollLeft = scrollPositions[id].left;
        }
    }

    if (pipeline.activeTabId) {
        activateTab(pipeline.activeTabId);
    } else if (pipeline.stages.length > 0) {
        activateTab(`worker-${pipeline.stages[0].id}`);
    }
    updateControlsState();
    // If graph view is active, re-render it
    const viewToggleGraphButton = document.getElementById('view-toggle-graph') as HTMLButtonElement;
    if (viewToggleGraphButton && viewToggleGraphButton.classList.contains('active')) {
        renderGraphView();
    }
}


async function runReactWorkerAgents() {
    if (!activeReactPipeline || activeReactPipeline.status !== 'processing_workers') {
        console.error("RunReactWorkerAgents called in an invalid state.");
        return;
    }
    renderReactModePipeline();

    const workerPromises = activeReactPipeline.stages.map(async (stage) => {
        if (!activeReactPipeline || activeReactPipeline.isStopRequested) {
            stage.status = 'cancelled';
            stage.error = "Process stopped by user.";
            renderReactModePipeline();
            return stage;
        }
        if (!stage.systemInstruction || !stage.userPrompt) {
            stage.status = 'error';
            stage.error = "Missing system instruction or user prompt template from Orchestrator.";
            console.error(`Worker Agent ${stage.id} missing prompts.`);
            renderReactModePipeline();
            return stage;
        }

        stage.status = 'processing';
        stage.retryAttempt = 0;
        renderReactModePipeline();

        stage.renderedUserPrompt = renderPrompt(stage.userPrompt, {
            plan_txt: activeReactPipeline.orchestratorPlan || "",
            user_request: activeReactPipeline.userRequest || ""
        });

        let stageResponseText = "";
        try {
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                if (!activeReactPipeline || activeReactPipeline.isStopRequested) {
                    throw new PipelineStopRequestedError(`Worker Agent ${stage.id} execution stopped by user.`);
                }
                stage.retryAttempt = attempt;
                stage.status = attempt > 0 ? 'retrying' : 'processing';
                
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt)));
                }
                renderReactModePipeline();

                try {
                    const selectedModel = modelSelectElement.value || "gemini-2.5-pro";
                    const workerTemp = 0.7;

                    const apiResponse = await callGemini(stage.renderedUserPrompt, workerTemp, selectedModel, stage.systemInstruction, false);
                    stageResponseText = apiResponse.text;
                    stage.generatedContent = cleanOutputByType(stageResponseText, 'text');
                    stage.status = 'completed';
                    stage.error = undefined;
                    renderReactModePipeline();
                    break;
                } catch (e: any) {
                    console.warn(`Worker Agent ${stage.id}, Attempt ${attempt + 1} failed: ${e.message}`);
                    stage.error = `Attempt ${attempt + 1} failed: ${e.message || 'Unknown API error'}`;
                    if (attempt === MAX_RETRIES) {
                        renderReactModePipeline();
                        throw e;
                    }
                }
            }
        } catch (error: any) {
            console.error(`Worker Agent ${stage.id} failed all retries:`, error);
            stage.status = 'error';
            if (!stage.error) stage.error = error.message || `Worker Agent ${stage.id} failed.`;
            if (error instanceof PipelineStopRequestedError) {
                 stage.status = 'cancelled';
                 stage.error = error.message;
            }
        }
        renderReactModePipeline();
        return stage;
    });

    await Promise.allSettled(workerPromises);

    if (activeReactPipeline) {
        const anyAgentFailed = activeReactPipeline.stages.some(s => s.status === 'error');
        const allCancelled = activeReactPipeline.stages.every(s => s.status === 'cancelled');

        if (activeReactPipeline.isStopRequested || allCancelled) {
            activeReactPipeline.status = 'stopped';
        } else if (anyAgentFailed) {
            activeReactPipeline.status = 'failed';
        } else {
            activeReactPipeline.status = 'completed';
            aggregateReactOutputs();
        }
    }

    isGenerating = false;
    updateControlsState();
    renderReactModePipeline();
}

function aggregateReactOutputs() {
    if (!activeReactPipeline || activeReactPipeline.status !== 'completed') {
        console.warn("aggregateReactOutputs called when pipeline not completed or pipeline doesn't exist.");
        if (activeReactPipeline) activeReactPipeline.finalAppendedCode = "Error: Could not aggregate outputs due to pipeline status.";
        return;
    }

    let combinedCode = `/* --- React Application Code --- */\n/* Generated by Gemini Iterative Studio */\n/* User Request: ${activeReactPipeline.userRequest} */\n\n`;
    combinedCode += `/* --- Orchestrator Plan (plan.txt) --- */\n/*\n${activeReactPipeline.orchestratorPlan || "No plan generated."}\n*/\n\n`;

    activeReactPipeline.stages.forEach(stage => {
        if (stage.status === 'completed' && stage.generatedContent) {
            combinedCode += `/* --- Code from Agent ${stage.id + 1}: ${stage.title} --- */\n`;
            combinedCode += `${stage.generatedContent.trim()}\n\n`;
        } else if (stage.status === 'error') {
            combinedCode += `/* --- Agent ${stage.id + 1}: ${stage.title} - FAILED --- */\n`;
            combinedCode += `/* Error: ${stage.error || "Unknown error"} */\n\n`;
        } else if (stage.status === 'cancelled') {
            combinedCode += `/* --- Agent ${stage.id + 1}: ${stage.title} - CANCELLED --- */\n\n`;
        }
    });
    activeReactPipeline.finalAppendedCode = combinedCode;
    console.log("Final appended code generated:", activeReactPipeline.finalAppendedCode.substring(0, 1000) + "...");
}

// ----- END REACT MODE SPECIFIC FUNCTIONS -----

// ---------- GRAPH VISUALIZATION FUNCTIONS ----------
function getMermaidNodeStyle(status: string): string {
    const statusMap: { [key: string]: string } = {
        idle: 'idle', pending: 'pending', running: 'running', processing: 'running',
        retrying: 'retrying', orchestrating: 'orchestrating', orchestrating_retrying: 'orchestrating_retrying',
        processing_workers: 'processing_workers', completed: 'completed', math_completed: 'completed',
        error: 'error', math_error: 'error', failed: 'error', stopping: 'stopping',
        stopped: 'stopped', cancelled: 'cancelled',
    };
    return statusMap[status] || 'default';
}

function generateWebsiteGraph(pipeline: PipelineState): string {
    let mermaidStr = `subgraph "Variant ${pipeline.id + 1} (T: ${pipeline.temperature.toFixed(1)}) - ${pipeline.status}"\n`;
    pipeline.iterations.forEach((iter, index) => {
        const nodeId = `P${pipeline.id}_Iter${index}`;
        const nodeLabel = `${iter.iterationNumber + 1}. ${iter.title.replace(/"/g, '#quot;').replace(/\(/g, '#lpar;').replace(/\)/g, '#rpar;')}`;
        mermaidStr += `    ${nodeId}["${nodeLabel}"]:::${getMermaidNodeStyle(iter.status)};\n`;
        if (index > 0) {
            mermaidStr += `    P${pipeline.id}_Iter${index - 1} --> ${nodeId};\n`;
        }
    });
    mermaidStr += `end\n`;
    return mermaidStr;
}

function generateCreativeGraph(pipeline: PipelineState): string { return generateWebsiteGraph(pipeline); }
function generateAgentGraph(pipeline: PipelineState): string { return generateWebsiteGraph(pipeline); }

function generateMathGraph(): string {
    if (!activeMathPipeline) return '    Empty["No Math Problem Active"];\n';
    let mermaidStr = '';
    const problemNodeId = `MathProblem_${activeMathPipeline.id.replace(/-/g, '')}`;
    const problemTitle = activeMathPipeline.problemText.substring(0, 50).replace(/"/g, '#quot;').replace(/\(/g, '#lpar;').replace(/\)/g, '#rpar;');

    mermaidStr += `subgraph "Math Problem: ${problemTitle}..."\n`;
    mermaidStr += `    ${problemNodeId}["Problem (${activeMathPipeline.status})"]:::${getMermaidNodeStyle(activeMathPipeline.status)};\n`;
    activeMathPipeline.initialStrategies.forEach((mainStrategy, msIndex) => {
        const msNodeId = `${problemNodeId}_MS${msIndex}`;
        const msTitle = mainStrategy.strategyText.substring(0, 30).replace(/"/g, '#quot;').replace(/\(/g, '#lpar;').replace(/\)/g, '#rpar;');
        mermaidStr += `    ${msNodeId}["MS ${msIndex + 1}: ${msTitle}.. (${mainStrategy.status})"]:::${getMermaidNodeStyle(mainStrategy.status)};\n`;
        mermaidStr += `    ${problemNodeId} --> ${msNodeId};\n`;
        mainStrategy.subStrategies.forEach((subStrategy, ssIndex) => {
            const ssNodeId = `${msNodeId}_SS${ssIndex}`;
            const ssTitle = subStrategy.subStrategyText.substring(0, 25).replace(/"/g, '#quot;').replace(/\(/g, '#lpar;').replace(/\)/g, '#rpar;');
            mermaidStr += `    ${ssNodeId}["Sub ${msIndex + 1}.${ssIndex + 1}: ${ssTitle}.. (${subStrategy.status})"]:::${getMermaidNodeStyle(subStrategy.status)};\n`;
            mermaidStr += `    ${msNodeId} --> ${ssNodeId};\n`;
            if (subStrategy.solutionAttempt || ['processing', 'retrying', 'error', 'completed', 'cancelled'].includes(subStrategy.status)) {
                const solNodeId = `${ssNodeId}_Sol`;
                mermaidStr += `    ${solNodeId}{"Solution Attempt (${subStrategy.status})"}:::${getMermaidNodeStyle(subStrategy.status)};\n`;
                mermaidStr += `    ${ssNodeId} --> ${solNodeId};\n`;
            }
        });
    });
    mermaidStr += `end\n`;
    return mermaidStr;
}

function generateReactGraph(): string {
    if (!activeReactPipeline) return '    Empty["No React Process Active"];\n';
    let mermaidStr = '';
    const orchestratorNodeId = `ReactOrchestrator_${activeReactPipeline.id.replace(/-/g, '')}`;
    const finalOutputNodeId = `ReactFinalOutput_${activeReactPipeline.id.replace(/-/g, '')}`;
    mermaidStr += `subgraph "React App Generation - ${activeReactPipeline.userRequest.substring(0,30).replace(/"/g, '#quot;') }..."\n`;
    mermaidStr += `    direction TD;\n`;
    mermaidStr += `    ${orchestratorNodeId}["Orchestrator (${activeReactPipeline.status.replace('_', ' ')})"]:::${getMermaidNodeStyle(activeReactPipeline.status)};\n`;
    activeReactPipeline.stages.forEach((stage, index) => {
        const workerNodeId = `${orchestratorNodeId}_Worker${index}`;
        const workerTitle = stage.title.replace(/"/g, '#quot;').replace(/\(/g, '#lpar;').replace(/\)/g, '#rpar;');
        mermaidStr += `    ${workerNodeId}["${workerTitle} (${stage.status})"]:::${getMermaidNodeStyle(stage.status)};\n`;
        mermaidStr += `    ${orchestratorNodeId} -->|"Task ${index + 1}"| ${workerNodeId};\n`;
        if (activeReactPipeline?.status === 'completed' && stage.status === 'completed') {
            mermaidStr += `    ${workerNodeId} --> ${finalOutputNodeId};\n`;
        }
    });
    if (activeReactPipeline?.status === 'completed') {
        mermaidStr += `    ${finalOutputNodeId}["Aggregated Output"]:::completed;\n`;
    }
    mermaidStr += `end\n`;
    return mermaidStr;
}

function generateGraphDefinition(): string {
    let fullMermaidStr = 'graph TD;\n';
    fullMermaidStr += '    classDef default fill:var(--secondary-surface-bg),stroke:var(--border-primary),color:var(--text-color);\n';
    fullMermaidStr += '    classDef running fill:color-mix(in srgb, var(--accent-tertiary) 15%, transparent),stroke:var(--accent-tertiary),color:var(--accent-tertiary);\n';
    fullMermaidStr += '    classDef completed fill:color-mix(in srgb, var(--accent-secondary) 15%, transparent),stroke:var(--accent-secondary),color:var(--accent-secondary);\n';
    fullMermaidStr += '    classDef error fill:color-mix(in srgb, var(--accent-error) 15%, transparent),stroke:var(--accent-error),color:var(--accent-error);\n';
    fullMermaidStr += '    classDef pending fill:color-mix(in srgb, var(--accent-primary) 10%, transparent),stroke:var(--accent-primary),color:var(--accent-primary);\n';
    fullMermaidStr += '    classDef idle class pending;\n';
    fullMermaidStr += '    classDef retrying class running;\n';
    fullMermaidStr += '    classDef orchestrating class running;\n';
    fullMermaidStr += '    classDef orchestrating_retrying class running;\n';
    fullMermaidStr += '    classDef processing_workers class running;\n';
    fullMermaidStr += '    classDef stopping fill:color-mix(in srgb, var(--accent-stopping) 12%, transparent),stroke:var(--accent-stopping),color:var(--accent-stopping);\n';
    fullMermaidStr += '    classDef stopped fill:color-mix(in srgb, var(--text-secondary-color) 10%, transparent),stroke:var(--text-secondary-color),color:var(--text-secondary-color);\n';
    fullMermaidStr += '    classDef cancelled class stopped;\n';

    let contentGenerated = false;
    switch (currentMode) {
        case 'website': case 'creative': case 'agent':
            if (pipelinesState.length > 0) {
                pipelinesState.forEach(pipeline => {
                    if (pipeline.status !== 'idle' || pipeline.iterations.some(it => it.status !== 'pending')) {
                        fullMermaidStr += (currentMode === 'website' ? generateWebsiteGraph(pipeline) : currentMode === 'creative' ? generateCreativeGraph(pipeline) : generateAgentGraph(pipeline));
                        contentGenerated = true;
                    }
                });
                if (!contentGenerated && pipelinesState.length > 0) fullMermaidStr += '    Empty["No active generation pipelines."];\n';
                else if (!contentGenerated) fullMermaidStr += '    Empty["No pipelines defined."];\n';

            } else fullMermaidStr += '    Empty["No pipelines defined."];\n';
            break;
        case 'math':
            if (activeMathPipeline) { fullMermaidStr += generateMathGraph(); contentGenerated = true; }
            else fullMermaidStr += '    Empty["No Math Problem Active."];\n';
            break;
        case 'react':
            if (activeReactPipeline) { fullMermaidStr += generateReactGraph(); contentGenerated = true; }
            else fullMermaidStr += '    Empty["No React Process Active."];\n';
            break;
        default: fullMermaidStr += '    Empty["Graph not available for this mode."];\n';
    }
    return fullMermaidStr;
}

async function renderGraphView() {
    const graphContainer = document.getElementById('graph-view-container');
    if (!graphContainer || graphContainer.style.display === 'none') return;
    const definition = generateGraphDefinition();
    let mermaidPreElement = graphContainer.querySelector<HTMLPreElement>('pre.mermaid');
    if (!mermaidPreElement) {
        graphContainer.innerHTML = '';
        mermaidPreElement = document.createElement('pre');
        mermaidPreElement.className = 'mermaid';
        graphContainer.appendChild(mermaidPreElement);
    }
    mermaidPreElement.innerHTML = escapeHtml(definition); // Use innerHTML for Mermaid to parse entities correctly.
    try {
        mermaidPreElement.removeAttribute('data-processed'); // Force re-render
        await mermaid.run({ nodes: [mermaidPreElement] });
    } catch (e: any) {
        console.error("Error rendering Mermaid graph:", e);
        graphContainer.innerHTML = `<div class="error-message">Error rendering graph: ${e.message}<pre>${escapeHtml(definition)}</pre></div>`;
    }
}
// ----- END GRAPH VISUALIZATION FUNCTIONS -----


function initializeUI() {
    if (!initializeApiKey()) {
        // API key init failure handling is inside initializeApiKey()
    }

    if (saveApiKeyButton && apiKeyInput && apiKeyStatusElement) {
        saveApiKeyButton.addEventListener('click', () => {
            const newApiKey = apiKeyInput.value.trim();
            if (newApiKey) {
                localStorage.setItem('geminiApiKey', newApiKey);
                apiKeyInput.value = '';
                apiKeyStatusElement.textContent = "API Key saved to Local Storage. Initializing...";
                apiKeyStatusElement.className = 'api-key-status-message status-processing';
                if(initializeApiKey()){
                    apiKeyStatusElement.textContent = "API Key saved and client initialized.";
                    apiKeyStatusElement.className = 'api-key-status-message status-ok';
                }
            } else {
                apiKeyStatusElement.textContent = "Please enter an API Key to save.";
                apiKeyStatusElement.className = 'api-key-status-message status-error';
            }
        });
    }

    if (clearApiKeyButton && apiKeyInput && apiKeyStatusElement) {
        clearApiKeyButton.addEventListener('click', () => {
            localStorage.removeItem('geminiApiKey');
            apiKeyInput.value = '';
            apiKeyInput.placeholder = 'Enter your API Key';
            ai = null;
            apiKeyStatusElement.textContent = "API Key cleared from Local Storage. Enter a new key to use the API.";
            apiKeyStatusElement.className = 'api-key-status-message status-error';
            if (generateButton) generateButton.disabled = true;
            initializeApiKey();
        });
    }

    renderPipelineSelectors();
    initializeCustomPromptTextareas();
    // updateUIAfterModeChange(); // Called later in DOMContentLoaded

    if (generateButton) {
        generateButton.addEventListener('click', async () => {
            if (!ai) {
                alert("API Key is not configured or failed to initialize. Please set your API Key.");
                initializeApiKey();
                return;
            }
            const initialIdea = initialIdeaInput.value.trim();
            if (!initialIdea) {
                alert("Please enter an idea, premise, math problem, or request.");
                return;
            }
            // Reset graph view to list view before starting generation
            const viewToggleListButton = document.getElementById('view-toggle-list') as HTMLButtonElement;
            if (viewToggleListButton && !viewToggleListButton.classList.contains('active')) {
                 viewToggleListButton.click(); // Switch to list view
            }


            if (currentMode === 'math') {
                await startMathSolvingProcess(initialIdea, currentProblemImageBase64, currentProblemImageMimeType);
            } else if (currentMode === 'react') {
                await startReactModeProcess(initialIdea);
            } else {
                initPipelines();
                if (pipelinesState.length === 0) {
                    alert("Please select at least one variant (temperature) to run.");
                    return;
                }
                const runningPromises = pipelinesState.map(p => runPipeline(p.id, initialIdea));
                try {
                    await Promise.allSettled(runningPromises);
                } finally {
                    isGenerating = false;
                    updateControlsState();
                }
            }
        });
    }

    if (appModeSelector) {
        appModeSelector.querySelectorAll('input[name="appMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                currentMode = (e.target as HTMLInputElement).value as ApplicationMode;
                updateUIAfterModeChange();
            });
        });
    }

    if (mathProblemImageInput && mathProblemImagePreview) {
        mathProblemImageInput.addEventListener('change', (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentProblemImageBase64 = (e.target?.result as string).split(',')[1];
                    currentProblemImageMimeType = file.type;
                    mathProblemImagePreview.src = e.target?.result as string;
                    mathProblemImagePreview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            } else {
                currentProblemImageBase64 = null;
                currentProblemImageMimeType = null;
                mathProblemImagePreview.src = '#';
                mathProblemImagePreview.style.display = 'none';
            }
        });
    }
    
    if (customPromptsHeader) {
        customPromptsHeader.addEventListener('click', () => setPromptsModalVisible(true));
    }
    if (promptsModalCloseButton) {
        promptsModalCloseButton.addEventListener('click', () => setPromptsModalVisible(false));
    }
    if (promptsModalOverlay) {
        promptsModalOverlay.addEventListener('click', (e) => {
            if (e.target === promptsModalOverlay) {
                setPromptsModalVisible(false);
            }
        });
    }

    if (exportConfigButton) {
        exportConfigButton.addEventListener('click', exportConfiguration);
    }
    if (importConfigInput) {
        importConfigInput.addEventListener('change', handleImportConfiguration);
    }

    // Initialize Mermaid.js
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
            background: 'var(--primary-surface-bg)',
            primaryColor: 'var(--secondary-surface-bg)',
            primaryTextColor: 'var(--text-color)',
            primaryBorderColor: 'var(--border-primary)',
            lineColor: 'var(--text-secondary-color)',
            textColor: 'var(--text-secondary-color)',
        }
    });

    // View Toggle Logic
    const viewToggleListButton = document.getElementById('view-toggle-list') as HTMLButtonElement;
    const viewToggleGraphButton = document.getElementById('view-toggle-graph') as HTMLButtonElement;
    const graphViewContainer = document.getElementById('graph-view-container') as HTMLElement;

    if (viewToggleListButton && viewToggleGraphButton && graphViewContainer && pipelinesContentContainer) {
        viewToggleListButton.addEventListener('click', () => {
            graphViewContainer.style.display = 'none';
            // Show list view elements based on current mode and active states
            document.querySelectorAll('#pipelines-content-container > :not(#graph-view-container)').forEach(el => {
                const htmlEl = el as HTMLElement;
                let shouldDisplay = false;
                if (currentMode === 'math' && activeMathPipeline && activeMathPipeline.activeTabId) {
                    const mathProblemPane = document.getElementById(`math-content-problem-details`);
                    if (mathProblemPane) mathProblemPane.style.display = activeMathPipeline.activeTabId === 'problem-details' ? 'block' : 'none';

                    activeMathPipeline.initialStrategies.forEach((_, index) => {
                        const strategyPane = document.getElementById(`math-content-strategy-${index}`);
                        if (strategyPane) strategyPane.style.display = activeMathPipeline.activeTabId === `strategy-${index}` ? 'block' : 'none';
                    });
                     // The above logic should correctly set display for active math panes.
                    // This additional check is to ensure other non-active math panes are hidden.
                    if(htmlEl.classList.contains('math-pipeline-content-pane') && htmlEl.classList.contains('active')) {
                        // This should already be handled by activateTab and specific display logic above.
                    } else if (htmlEl.classList.contains('math-pipeline-content-pane')) {
                        htmlEl.style.display = 'none';
                    }


                } else if (currentMode === 'react' && activeReactPipeline) {
                    const orchestratorPane = pipelinesContentContainer.querySelector('.react-orchestrator-pane') as HTMLElement;
                    if (orchestratorPane) orchestratorPane.style.display = 'block';
                    const finalOutputPane = pipelinesContentContainer.querySelector('.react-final-output-pane') as HTMLElement;
                    if (finalOutputPane && activeReactPipeline.finalAppendedCode) finalOutputPane.style.display = 'block';
                    else if (finalOutputPane) finalOutputPane.style.display = 'none';

                    document.querySelectorAll('.react-worker-content-pane').forEach(p => (p as HTMLElement).style.display = 'none');
                    if (activeReactPipeline.activeTabId) {
                        const activeReactWorkerPane = document.getElementById(`react-worker-content-${activeReactPipeline.activeTabId}`);
                        if (activeReactWorkerPane) activeReactWorkerPane.style.display = 'block';
                    }

                } else if (['website', 'creative', 'agent'].includes(currentMode) && activePipelineId !== null) {
                     document.querySelectorAll('.pipeline-content').forEach(p => (p as HTMLElement).style.display = 'none');
                    const activeContentPane = document.getElementById(`pipeline-content-${activePipelineId}`);
                    if (activeContentPane) activeContentPane.style.display = 'block';
                }

                // Fallback for elements not covered or to ensure non-active elements are hidden
                if (el.id !== 'graph-view-container') {
                    if (currentMode === 'react') {
                        if (!el.classList.contains('react-orchestrator-pane') &&
                            !el.classList.contains('react-final-output-pane') &&
                            !(el.classList.contains('react-worker-content-pane') && el.classList.contains('active'))) {
                            (el as HTMLElement).style.display = 'none';
                        }
                    } else if (currentMode === 'math') {
                         if (!(el.classList.contains('math-pipeline-content-pane') && el.classList.contains('active'))) {
                             (el as HTMLElement).style.display = 'none';
                         }
                    } else if (['website', 'creative', 'agent'].includes(currentMode)){
                         if (!(el.classList.contains('pipeline-content') && el.classList.contains('active'))) {
                             (el as HTMLElement).style.display = 'none';
                         }
                    }
                }


            });
            viewToggleListButton.classList.add('active');
            viewToggleGraphButton.classList.remove('active');
        });

        viewToggleGraphButton.addEventListener('click', async () => {
            Array.from(pipelinesContentContainer.children).forEach(child => {
                if (child.id !== 'graph-view-container') {
                    (child as HTMLElement).style.display = 'none';
                }
            });
            graphViewContainer.style.display = 'block';
            viewToggleGraphButton.classList.add('active');
            viewToggleListButton.classList.remove('active');
            await renderGraphView();
        });
    }

    updateControlsState();
}

function initializeSidebarStatePersistence() {
    const sidebar = document.getElementById('controls-sidebar');
    if (!sidebar) return;

    const detailsElements = sidebar.querySelectorAll<HTMLDetailsElement>('details.input-group');
    const storageKey = 'sidebarSectionState';

    // Load state on startup
    try {
        const savedState = JSON.parse(localStorage.getItem(storageKey) || '{}');
        detailsElements.forEach(el => {
            if (el.id && savedState[el.id] !== undefined) {
                el.open = savedState[el.id];
            }
        });
    } catch (e) {
        console.error("Could not load sidebar state:", e);
    }

    // Save state on toggle
    detailsElements.forEach(el => {
        el.addEventListener('toggle', () => {
            if (!el.id) return;
            try {
                const currentState = JSON.parse(localStorage.getItem(storageKey) || '{}');
                currentState[el.id] = el.open;
                localStorage.setItem(storageKey, JSON.stringify(currentState));
            } catch (e) {
                console.error("Could not save sidebar state:", e);
            }
        });
    });
}


document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    initializeSidebarStatePersistence();

    const appModeRadios = document.querySelectorAll('input[name="appMode"]');
    let modeIsAlreadySet = false;
    appModeRadios.forEach(radio => {
        if ((radio as HTMLInputElement).checked) {
            currentMode = (radio as HTMLInputElement).value as ApplicationMode;
            modeIsAlreadySet = true;
        }
    });

    if (!modeIsAlreadySet && appModeRadios.length > 0) {
         const firstModeRadio = appModeRadios[0] as HTMLInputElement;
         if (firstModeRadio) {
            firstModeRadio.checked = true;
            currentMode = firstModeRadio.value as ApplicationMode;
         }
    }
    updateUIAfterModeChange();

    const preloader = document.getElementById('preloader');
    const sidebar = document.getElementById('controls-sidebar');
    const mainContent = document.getElementById('main-content');

    if (preloader) {
        preloader.classList.add('hidden');
        setTimeout(() => {
            if (sidebar) sidebar.classList.add('is-visible');
            if (mainContent) mainContent.classList.add('is-visible');
        }, 150);
    } else {
        if (sidebar) sidebar.classList.add('is-visible');
        if (mainContent) mainContent.classList.add('is-visible');
    }
});
