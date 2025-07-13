/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Diff from 'diff';
import JSZip from 'jszip';
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
    status: 'idle' | 'orchestrating' | 'processing_workers' | 'completed' | 'error' | 'stopping' | 'stopped' | 'cancelled' | 'orchestrating_retrying' | 'failed';
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


const apiKeyStatusElement = document.getElementById('api-key-status') as HTMLParagraphElement;
const apiKeyFormContainer = document.getElementById('api-key-form-container') as HTMLElement;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveApiKeyButton = document.getElementById('save-api-key-button') as HTMLButtonElement;
const clearApiKeyButton = document.getElementById('clear-api-key-button') as HTMLButtonElement;
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

// Prompts containers (now inside the modal)
const websitePromptsContainer = document.getElementById('website-prompts-container') as HTMLElement;
const creativePromptsContainer = document.getElementById('creative-prompts-container') as HTMLElement;
const mathPromptsContainer = document.getElementById('math-prompts-container') as HTMLElement;
const agentPromptsContainer = document.getElementById('agent-prompts-container') as HTMLElement;
const reactPromptsContainer = document.getElementById('react-prompts-container') as HTMLElement; // Added for React mode

// Custom Prompts Modal Elements
const promptsModalOverlay = document.getElementById('prompts-modal-overlay') as HTMLElement;
const promptsModalCloseButton = document.getElementById('prompts-modal-close-button') as HTMLButtonElement;
const customizePromptsTrigger = document.getElementById('customize-prompts-trigger') as HTMLElement;

// Diff Modal Elements
const diffModalOverlay = document.getElementById('diff-modal-overlay') as HTMLElement;
const diffModalCloseButton = document.getElementById('diff-modal-close-button') as HTMLButtonElement;
const diffSourceLabel = document.getElementById('diff-source-label') as HTMLParagraphElement;
const diffTargetTreeContainer = document.getElementById('diff-target-tree') as HTMLElement;
const diffViewerPanel = document.getElementById('diff-viewer-panel') as HTMLElement;

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

const fullscreenIconSvg = `
<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" aria-hidden="true">
  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
</svg>`;
const exitFullscreenIconSvg = `
<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em" aria-hidden="true">
  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
</svg>`;


function initializeApiKey() {
    let statusMessage = "";
    let isKeyAvailable = false;
    let currentApiKey: string | null = null;

    // Hide form elements by default
    apiKeyFormContainer.style.display = 'none';
    saveApiKeyButton.style.display = 'none';
    clearApiKeyButton.style.display = 'none';
    apiKeyInput.style.display = 'none';

    const envKey = process.env.API_KEY;

    if (envKey) {
        statusMessage = "API Key loaded from environment.";
        isKeyAvailable = true;
        currentApiKey = envKey;
        apiKeyStatusElement.className = 'api-key-status-message status-badge status-ok';
    } else {
        apiKeyFormContainer.style.display = 'flex'; // Show the container for input/buttons
        const storedKey = localStorage.getItem('gemini-api-key');
        if (storedKey) {
            statusMessage = "Using API Key from local storage.";
            isKeyAvailable = true;
            currentApiKey = storedKey;
            apiKeyStatusElement.className = 'api-key-status-message status-badge status-ok';
            clearApiKeyButton.style.display = 'inline-flex'; // Show clear button
        } else {
            statusMessage = "API Key not found. Please provide one.";
            isKeyAvailable = false;
            apiKeyStatusElement.className = 'api-key-status-message status-badge status-error';
            apiKeyInput.style.display = 'block'; // Show input field
            saveApiKeyButton.style.display = 'inline-flex'; // Show save button
        }
    }

    if (apiKeyStatusElement) {
        apiKeyStatusElement.textContent = statusMessage;
    }

    if (isKeyAvailable && currentApiKey) {
        try {
            ai = new GoogleGenAI({ apiKey: currentApiKey });
            if (generateButton) generateButton.disabled = isGenerating;
            return true;
        } catch (e: any) {
            console.error("Failed to initialize GoogleGenAI:", e);
            if (apiKeyStatusElement) {
                apiKeyStatusElement.textContent = `API Init Error`;
                apiKeyStatusElement.className = 'api-key-status-message status-badge status-error';
                apiKeyStatusElement.title = `Error: ${e.message}`;
            }
            if (generateButton) generateButton.disabled = true;
            ai = null;
            return false;
        }
    } else {
        if (generateButton) generateButton.disabled = true;
        ai = null;
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

function initializePromptsModal() {
    const navContainer = document.getElementById('prompts-modal-nav');
    const contentContainer = document.getElementById('prompts-modal-content');
    if (!navContainer || !contentContainer) return;

    // Clear previous state
    navContainer.innerHTML = '';
    contentContainer.querySelectorAll('.prompts-mode-container').forEach(el => el.classList.remove('active'));
    contentContainer.querySelectorAll('.prompt-content-pane').forEach(el => el.classList.remove('active'));
    
    const activeModeContainer = document.getElementById(`${currentMode}-prompts-container`);
    if (!activeModeContainer) return;

    activeModeContainer.classList.add('active');
    const panes = activeModeContainer.querySelectorAll<HTMLElement>('.prompt-content-pane');
    
    panes.forEach((pane) => {
        const titleElement = pane.querySelector<HTMLHeadingElement>('.prompt-pane-title');
        const title = titleElement ? titleElement.textContent : 'Unnamed Section';
        const key = pane.dataset.promptKey;
        if (!key) return;

        const navItem = document.createElement('div');
        navItem.className = 'prompts-nav-item';
        navItem.textContent = title;
        navItem.dataset.targetPane = key;
        navContainer.appendChild(navItem);

        navItem.addEventListener('click', () => {
            // Deactivate all nav items and panes first
            navContainer.querySelectorAll('.prompts-nav-item').forEach(item => item.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));
            
            // Activate the clicked one
            navItem.classList.add('active');
            pane.classList.add('active');
        });
    });

    // Activate the first one by default
    const firstNavItem = navContainer.querySelector<HTMLElement>('.prompts-nav-item');
    if (firstNavItem) {
        firstNavItem.click();
    }
}


function setPromptsModalVisible(visible: boolean) {
    if (promptsModalOverlay) {
        if (visible) {
            initializePromptsModal(); // Re-initialize on open to reflect current mode
            promptsModalOverlay.style.display = 'flex';
            setTimeout(() => {
                promptsModalOverlay.classList.add('is-visible');
            }, 10);
        } else {
            promptsModalOverlay.classList.remove('is-visible');
            promptsModalOverlay.addEventListener('transitionend', () => {
                if (!promptsModalOverlay.classList.contains('is-visible')) {
                    promptsModalOverlay.style.display = 'none';
                }
            }, { once: true });
        }
    }
}

function updateUIAfterModeChange() {
    // Visibility of prompt containers is now handled by CSS classes and initializePromptsModal
    const allPromptContainers = document.querySelectorAll('.prompts-mode-container');
    allPromptContainers.forEach(container => container.classList.remove('active'));
    const activeContainer = document.getElementById(`${currentMode}-prompts-container`);
    if(activeContainer) activeContainer.classList.add('active');
    
    // Default UI states
    if(mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'none';
    if(modelSelectionContainer) modelSelectionContainer.style.display = 'flex';
    if(temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'block';

    if (currentMode === 'website') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'HTML Idea:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., a personal blog about cooking, a portfolio...';
        if (generateButton) generateButton.textContent = 'Generate HTML';
    } else if (currentMode === 'creative') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Writing Premise:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., a short story about a time traveler, a poem...';
        if (generateButton) generateButton.textContent = 'Refine Writing';
    } else if (currentMode === 'math') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Math Problem:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "Solve for x: 2x + 5 = 11" or describe...';
        if (generateButton) generateButton.textContent = 'Solve Problem';
        if (mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'flex';
        if (modelSelectionContainer) modelSelectionContainer.style.display = 'none';
        if (temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'none';
    } else if (currentMode === 'agent') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Your Request:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "Python snake game", "Analyze iPhone sales data"...';
        if (generateButton) generateButton.textContent = 'Start Agent Process';
    } else if (currentMode === 'react') { // Added for React mode
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'React App Request:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "A simple to-do list app with local storage persistence", "A weather dashboard using OpenWeatherMap API"...';
        if (generateButton) generateButton.textContent = 'Generate React App';
        // React mode uses standard model and temperature selection like website/creative/agent
        if (modelSelectionContainer) modelSelectionContainer.style.display = 'flex';
        if (temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'block';
        if (mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'none';
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

    const isApiKeyReady = !!ai;

    if (generateButton) {
        let disabled = isGenerating || !isApiKeyReady;
        if (!disabled) {
            if (currentMode === 'math') {
                // Enabled if not generating
            } else if (currentMode === 'react') {
                // Enabled if not generating
            } else { // website, creative, agent
                const selectedTemps = getSelectedTemperatures();
                disabled = selectedTemps.length === 0;
            }
        }
        generateButton.disabled = disabled;
    }
    
    if (exportConfigButton) exportConfigButton.disabled = isGenerating;
    if (importConfigInput) importConfigInput.disabled = isGenerating;
    if (importConfigLabel) importConfigLabel.classList.toggle('disabled', isGenerating);
    if (initialIdeaInput) initialIdeaInput.disabled = isGenerating;
    if (mathProblemImageInput) mathProblemImageInput.disabled = isGenerating;
    
    if (modelSelectElement) modelSelectElement.disabled = isGenerating || currentMode === 'math'; 
    if (pipelineSelectorsContainer) {
        const disableSelectors = isGenerating || currentMode === 'math' || currentMode === 'react';
        pipelineSelectorsContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb as HTMLInputElement).disabled = disableSelectors);
        const pipelineSelectHeading = document.getElementById('pipeline-select-heading');
        if (pipelineSelectHeading) {
            const parentSection = pipelineSelectHeading.closest('.sidebar-section-content');
            parentSection?.classList.toggle('disabled', disableSelectors);
        }
    }
    
    if (currentMode === 'math' && modelSelectElement) {
        modelSelectElement.value = MATH_MODEL_NAME;
    }

    if (appModeSelector) {
        appModeSelector.querySelectorAll('input[type="radio"]').forEach(rb => (rb as HTMLInputElement).disabled = isGenerating);
    }
    
    if (customizePromptsTrigger) {
        const parentSection = customizePromptsTrigger.closest('.sidebar-section');
        parentSection?.classList.toggle('disabled', isGenerating);
        customizePromptsTrigger.style.pointerEvents = isGenerating ? 'none' : 'auto';
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
                isDetailsOpen: true, // Always open with new design
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
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message">No variants selected to run.</p>';
        pipelinesContentContainer.innerHTML = '';
    }
    updateControlsState(); 
}


function activateTab(idToActivate: number | string) {
    if (currentMode === 'math' && activeMathPipeline) {
        activeMathPipeline.activeTabId = idToActivate as string;
        // Deactivate all math tabs and panes
        document.querySelectorAll('#tabs-nav-container .tab-button.math-mode-tab').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('#pipelines-content-container > .math-pipeline-content-pane').forEach(pane => pane.classList.remove('active'));
        // Activate the correct one
        const tabButton = document.getElementById(`math-tab-${idToActivate}`);
        const contentPane = document.getElementById(`math-content-${idToActivate}`);
        if (tabButton) tabButton.classList.add('active');
        if (contentPane) contentPane.classList.add('active');

    } else if (currentMode === 'react' && activeReactPipeline) {
        activeReactPipeline.activeTabId = idToActivate as string;
        document.querySelectorAll('#tabs-nav-container .tab-button.react-mode-tab').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('#pipelines-content-container > .react-worker-content-pane').forEach(pane => pane.classList.remove('active'));

        const tabButton = document.getElementById(`react-pipeline-tab-${idToActivate}`);
        const contentPane = document.getElementById(`react-worker-content-${idToActivate}`);
        if (tabButton) tabButton.classList.add('active');
        if (contentPane) contentPane.classList.add('active');

    } else if (currentMode !== 'math' && currentMode !== 'react') {
        activePipelineId = idToActivate as number;
        document.querySelectorAll('#tabs-nav-container .tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.id === `pipeline-tab-${activePipelineId}`);
            btn.setAttribute('aria-selected', (btn.id === `pipeline-tab-${activePipelineId}`).toString());
        });
        document.querySelectorAll('#pipelines-content-container > .pipeline-content').forEach(pane => {
            pane.classList.toggle('active', pane.id === `pipeline-content-${activePipelineId}`);
        });
    }
}


function renderPipelines() { 
    if (currentMode === 'math' || currentMode === 'react') { // React mode also has its own renderer
        tabsNavContainer.innerHTML = ''; 
        pipelinesContentContainer.innerHTML = '';
        return;
    }
    tabsNavContainer.innerHTML = '';
    pipelinesContentContainer.innerHTML = '';

    if (pipelinesState.length === 0) {
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message">No variants selected. Please choose at least one variant or import a configuration.</p>';
        pipelinesContentContainer.innerHTML = '';
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
        pipelineContentDiv.className = 'pipeline-content';
        pipelineContentDiv.setAttribute('id', `pipeline-content-${pipeline.id}`);
        pipelineContentDiv.setAttribute('role', 'tabpanel');
        pipelineContentDiv.setAttribute('aria-labelledby', `pipeline-tab-${pipeline.id}`);

        const pipelineType = currentMode === 'agent' ? "Agent Process" : "Pipeline";
        // Header is now inside each iteration card, so we just need the list.
        pipelineContentDiv.innerHTML = `
            <ul class="iterations-list" id="iterations-list-${pipeline.id}" style="list-style-type: none; padding: 0; display: flex; flex-direction: column; gap: 1.5rem;">
                ${pipeline.iterations.map(iter => renderIteration(pipeline.id, iter)).join('')}
            </ul>
        `;
        pipelinesContentContainer.appendChild(pipelineContentDiv);
        pipeline.contentElement = pipelineContentDiv;

        // Stop button is now part of the iteration card header during processing
        updatePipelineStatusUI(pipeline.id, pipeline.status); 

        pipeline.iterations.forEach(iter => {
            attachIterationActionButtons(pipeline.id, iter.iterationNumber);
        });
    });
}

function getEmptyStateMessage(status: IterationData['status'], contentType: string): string {
    switch (status) {
        case 'pending': return `${contentType} generation is pending.`;
        case 'processing':
        case 'retrying': return `Generating ${contentType}...`;
        case 'cancelled': return `${contentType} generation was cancelled by the user.`;
        case 'error': return `An error occurred while generating ${contentType}.`;
        default: return `No valid ${contentType} was generated.`;
    }
}

function renderIteration(pipelineId: number, iter: IterationData): string {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return '';

    let displayStatusText: string = iter.status.charAt(0).toUpperCase() + iter.status.slice(1);
    if (iter.status === 'retrying' && iter.retryAttempt !== undefined) {
        displayStatusText = `Retrying (${iter.retryAttempt}/${MAX_RETRIES})...`;
    } else if (iter.status === 'error') displayStatusText = 'Error';
    else if (iter.status === 'cancelled') displayStatusText = 'Cancelled';

    let promptsHtml = '';
    if (currentMode === 'website') {
        if (iter.requestPromptHtml_InitialGenerate) promptsHtml += `<h6 class="prompt-title">Initial HTML Generation Prompt:</h6><pre>${escapeHtml(iter.requestPromptHtml_InitialGenerate)}</pre>`;
        if (iter.requestPromptHtml_FeatureImplement) promptsHtml += `<h6 class="prompt-title">Feature Implementation & Stabilization Prompt:</h6><pre>${escapeHtml(iter.requestPromptHtml_FeatureImplement)}</pre>`;
        if (iter.requestPromptHtml_BugFix) promptsHtml += `<h6 class="prompt-title">HTML Bug Fix/Polish & Completion Prompt:</h6><pre>${escapeHtml(iter.requestPromptHtml_BugFix)}</pre>`;
        if (iter.requestPromptFeatures_Suggest) promptsHtml += `<h6 class="prompt-title">Feature Suggestion Prompt:</h6><pre>${escapeHtml(iter.requestPromptFeatures_Suggest)}</pre>`;
    } else if (currentMode === 'creative') {
        if (iter.requestPromptText_GenerateDraft) promptsHtml += `<h6 class="prompt-title">Draft Generation Prompt:</h6><pre>${escapeHtml(iter.requestPromptText_GenerateDraft)}</pre>`;
        if (iter.requestPromptText_Critique) promptsHtml += `<h6 class="prompt-title">Critique Prompt:</h6><pre>${escapeHtml(iter.requestPromptText_Critique)}</pre>`;
        if (iter.requestPromptText_Revise) promptsHtml += `<h6 class="prompt-title">Revision Prompt:</h6><pre>${escapeHtml(iter.requestPromptText_Revise)}</pre>`;
        if (iter.requestPromptText_Polish) promptsHtml += `<h6 class="prompt-title">Polish Prompt:</h6><pre>${escapeHtml(iter.requestPromptText_Polish)}</pre>`;
    } else if (currentMode === 'agent') {
        if (iter.agentJudgeLLM_InitialRequest) promptsHtml += `<h6 class="prompt-title">Judge LLM - Initial Request to Design Prompts:</h6><pre>${escapeHtml(iter.agentJudgeLLM_InitialRequest)}</pre>`;
        if (iter.agentGeneratedPrompts && iter.iterationNumber === 0) {
             promptsHtml += `<h6 class="prompt-title">Judge LLM - Generated Prompt Design:</h6><pre>${escapeHtml(JSON.stringify(iter.agentGeneratedPrompts, null, 2))}</pre>`;
        }
        if (iter.requestPrompt_SysInstruction) promptsHtml += `<h6 class="prompt-title">System Instruction (Main Step):</h6><pre>${escapeHtml(iter.requestPrompt_SysInstruction)}</pre>`;
        if (iter.requestPrompt_UserTemplate) promptsHtml += `<h6 class="prompt-title">User Prompt Template (Main Step):</h6><pre>${escapeHtml(iter.requestPrompt_UserTemplate)}</pre>`;
        if (iter.requestPrompt_Rendered) promptsHtml += `<h6 class="prompt-title">Rendered User Prompt (Main Step - Sent to API):</h6><pre>${escapeHtml(iter.requestPrompt_Rendered)}</pre>`;
        
        if (iter.requestPrompt_SubStep_SysInstruction) promptsHtml += `<hr class="sub-divider"><h6 class="prompt-title">System Instruction (Loop Sub-Step - Refine/Suggest):</h6><pre>${escapeHtml(iter.requestPrompt_SubStep_SysInstruction)}</pre>`;
        if (iter.requestPrompt_SubStep_UserTemplate) promptsHtml += `<h6 class="prompt-title">User Prompt Template (Loop Sub-Step - Refine/Suggest):</h6><pre>${escapeHtml(iter.requestPrompt_SubStep_UserTemplate)}</pre>`;
        if (iter.requestPrompt_SubStep_Rendered) promptsHtml += `<h6 class="prompt-title">Rendered User Prompt (Loop Sub-Step - Refine/Suggest - Sent to API):</h6><pre>${escapeHtml(iter.requestPrompt_SubStep_Rendered)}</pre>`;
    }
    if (promptsHtml) {
        promptsHtml = `<div class="model-detail-section"><h5 class="model-section-title">Prompts</h5><div class="scrollable-content-area custom-scrollbar">${promptsHtml}</div></div>`;
    }

    let generatedOutputHtml = '';
    const outputContentType = (currentMode === 'agent' && iter.agentGeneratedPrompts) ? iter.agentGeneratedPrompts.expected_output_content_type : 
                              (currentMode === 'agent' && pipelinesState.find(p=>p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts) ? pipelinesState.find(p=>p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts?.expected_output_content_type : 'text';


    if (currentMode === 'website') {
        if (iter.generatedHtml || ['completed', 'error', 'retrying', 'processing', 'pending', 'cancelled'].includes(iter.status)) {
            const hasContent = !!iter.generatedHtml && !isEmptyOrPlaceholderHtml(iter.generatedHtml);
            const codeActionsHtml = hasContent ? `
                <div class="code-actions">
                    <button id="download-html-${pipelineId}-${iter.iterationNumber}" class="button" type="button">Download</button>
                    <button id="copy-html-${pipelineId}-${iter.iterationNumber}" class="button" type="button">Copy</button>
                    <button class="compare-output-button button" data-pipeline-id="${pipelineId}" data-iteration-number="${iter.iterationNumber}" data-content-type="html" type="button">Compare</button>
                </div>` : '';
            
            let htmlContent;
            if (hasContent) {
                htmlContent = `<pre id="html-code-${pipelineId}-${iter.iterationNumber}" class="language-html">${escapeHtml(iter.generatedHtml!)}</pre>`;
            } else {
                htmlContent = `<div class="empty-state-message">${getEmptyStateMessage(iter.status, 'HTML')}</div>`;
            }

             generatedOutputHtml = `
                <div class="code-block-wrapper">
                  <div class="scrollable-content-area custom-scrollbar">${htmlContent}</div>
                  ${codeActionsHtml}
                </div>
            `;
        }
    } else if (currentMode === 'creative' || currentMode === 'agent') {
        let mainContentToDisplay = iter.generatedOrRevisedText; // Creative
        let mainContentLabel = "Generated/Revised Text:";
        let subStepHtml = '';

        if (currentMode === 'agent') {
            mainContentToDisplay = iter.generatedMainContent;
            
            if (iter.iterationNumber === 0 && iter.agentGeneratedPrompts) {
                 mainContentToDisplay = "Dynamically designed prompts from Judge LLM are shown above in the 'Prompts' section. No direct content output for this setup step.";
                 mainContentLabel = "Setup Information:";
            } else if (iter.generatedSubStep_Content && iter.iterationNumber > 2 && iter.iterationNumber < TOTAL_STEPS_AGENT -1) {
                 subStepHtml = `<h6 class="model-section-title">Content After Suggestion Implementation (Loop Sub-Step):</h6><div class="code-block-wrapper"><div class="scrollable-content-area custom-scrollbar"><pre id="agent-substep-content-${pipelineId}-${iter.iterationNumber}" class="language-${outputContentType}">${iter.generatedSubStep_Content ? escapeHtml(iter.generatedSubStep_Content) : ''}</pre></div></div>`;
                 mainContentLabel = "Refined Content After Suggestions (Loop Main Step):";
            } else if (iter.iterationNumber === 1) { mainContentLabel = "Initial Generated Content:"; } 
            else if (iter.iterationNumber === 2) { mainContentLabel = "Refined Content (After Initial Suggestions):"; } 
            else if (iter.iterationNumber === TOTAL_STEPS_AGENT -1) { mainContentLabel = "Final Polished Content:"; } 
            else { mainContentLabel = "Generated/Refined Output:"; }
        }
        
        if (mainContentToDisplay || ['completed', 'error', 'retrying', 'processing', 'pending', 'cancelled'].includes(iter.status)) {
            const hasContent = !!mainContentToDisplay && !(currentMode === 'agent' && iter.iterationNumber === 0);
            const codeActionsHtml = hasContent ? `
              <div class="code-actions">
                  <button id="download-text-${pipelineId}-${iter.iterationNumber}" class="button" type="button">Download</button>
                  <button id="copy-text-${pipelineId}-${iter.iterationNumber}" class="button" type="button">Copy</button>
                  <button class="compare-output-button button" data-pipeline-id="${pipelineId}" data-iteration-number="${iter.iterationNumber}" data-content-type="text" type="button">Compare</button>
              </div>` : '';

            let contentBlock;
            if (hasContent) {
                contentBlock = `<pre id="text-block-${pipelineId}-${iter.iterationNumber}" class="language-${outputContentType}">${escapeHtml(mainContentToDisplay!)}</pre>`;
            } else {
                contentBlock = `<div class="empty-state-message">${getEmptyStateMessage(iter.status, 'output')}</div>`;
            }

            generatedOutputHtml += `
                ${subStepHtml}
                <h6 class="model-section-title">${mainContentLabel}</h6>
                <div class="code-block-wrapper">
                  <div class="scrollable-content-area custom-scrollbar">${contentBlock}</div>
                  ${codeActionsHtml}
                </div>`;
        }
    }
    if (generatedOutputHtml) {
        generatedOutputHtml = `<div class="model-detail-section">${generatedOutputHtml}</div>`;
    }

    let suggestionsHtml = '';
    const suggestionsToDisplay = currentMode === 'agent' ? iter.generatedSuggestions : iter.suggestedFeatures;
    const critiqueToDisplay = iter.critiqueSuggestions;

    if ((currentMode === 'website' || currentMode === 'agent') && suggestionsToDisplay && suggestionsToDisplay.length > 0) {
        const title = currentMode === 'website' ? "Suggested Next Steps (HTML Features):" : "Suggested Next Steps:";
        suggestionsHtml = `<h5 class="model-section-title">${title}</h5><ul class="suggestion-list">${suggestionsToDisplay.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
    } else if (currentMode === 'creative' && critiqueToDisplay && critiqueToDisplay.length > 0) {
        suggestionsHtml = `<h5 class="model-section-title">Critique & Suggestions:</h5><ul class="suggestion-list">${critiqueToDisplay.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
    }
    if(suggestionsHtml) {
        suggestionsHtml = `<div class="model-detail-section">${suggestionsHtml}</div>`;
    }


    let previewHtml = '';
    if (currentMode === 'website') {
        const isEmptyGenHtml = isEmptyOrPlaceholderHtml(iter.generatedHtml);
        const previewContainerId = `preview-container-${pipelineId}-${iter.iterationNumber}`;
        const fullscreenButtonId = `fullscreen-btn-${pipelineId}-${iter.iterationNumber}`;
        const hasContentForPreview = iter.generatedHtml && !isEmptyGenHtml;

        previewHtml = `
        <div class="model-detail-header" style="border-bottom: none; margin-bottom: 0.75rem; padding-bottom: 0;">
            <h5 class="model-section-title" style="border-bottom: none; margin-bottom: 0;">Live Preview</h5>
            <div class="model-card-actions">
                <button id="${fullscreenButtonId}" class="button fullscreen-toggle-button" type="button" ${!hasContentForPreview ? 'disabled' : ''} title="Toggle Fullscreen Preview" aria-label="Toggle Fullscreen Preview">
                    <span class="icon-fullscreen">${fullscreenIconSvg}</span>
                    <span class="icon-exit-fullscreen" style="display:none;">${exitFullscreenIconSvg}</span>
                </button>
            </div>
        </div>`;
        
        let previewContent;
        if (hasContentForPreview) {
            const iframeSandboxOptions = "allow-scripts allow-same-origin allow-forms allow-popups";
            previewContent = `<iframe id="preview-iframe-${pipelineId}-${iter.iterationNumber}" srcdoc="${escapeHtml(iter.generatedHtml!)}" sandbox="${iframeSandboxOptions}" title="HTML Preview for Iteration ${iter.iterationNumber} of Pipeline ${pipelineId+1}"></iframe>`;
        } else {
            const noPreviewMessage = getEmptyStateMessage(iter.status, 'HTML preview');
            previewContent = `<div class="empty-state-message">${noPreviewMessage}</div>`;
        }
        previewHtml += `<div id="${previewContainerId}" class="html-preview-container">${previewContent}</div>`;

    }
    if (previewHtml) {
        previewHtml = `<div class="model-detail-section">${previewHtml}</div>`;
    }

    return `
    <li id="iteration-${pipelineId}-${iter.iterationNumber}" class="model-detail-card">
        <div class="model-detail-header">
            <div class="model-title-area">
                <h4 class="model-title">${escapeHtml(iter.title)}</h4>
            </div>
            <div class="model-card-actions">
                <span class="status-badge status-${iter.status}">${displayStatusText}</span>
            </div>
        </div>
        <div class="iteration-details">
            ${iter.error ? `<div class="status-message error"><pre>${escapeHtml(iter.error)}</pre></div>` : ''}
            ${promptsHtml}
            ${generatedOutputHtml}
            ${suggestionsHtml}
            ${previewHtml}
        </div>
    </li>`;
}

async function copyToClipboard(text: string, buttonElement: HTMLButtonElement) {
    if (buttonElement.disabled) return; // Defensive check

    try {
        await navigator.clipboard.writeText(text);
        const originalText = buttonElement.textContent;
        buttonElement.textContent = 'Copied!';
        buttonElement.classList.add('copied');
        buttonElement.disabled = true; // Temporarily disable while showing "Copied!"
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.classList.remove('copied');
            buttonElement.disabled = false; // Re-enable the button
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        const originalText = buttonElement.textContent;
        buttonElement.textContent = 'Copy Failed';
        buttonElement.disabled = true; // Temporarily disable
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.disabled = false; // Re-enable even on fail
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
            downloadButton.onclick = () => {
                if (iter.generatedHtml) {
                    downloadFile(iter.generatedHtml, `website_pipeline-${pipelineId + 1}_iter-${iter.iterationNumber}_temp-${pipeline.temperature}.html`, 'text/html');
                }
            };
            downloadButton.disabled = !canDownloadOrCopyHtml;
        }

        const copyButton = document.querySelector<HTMLButtonElement>(`#copy-html-${pipelineId}-${iterationNumber}`);
        if (copyButton) {
            copyButton.dataset.hasContent = String(canDownloadOrCopyHtml);
            copyButton.onclick = () => {
                if (iter.generatedHtml) copyToClipboard(iter.generatedHtml, copyButton);
            };
            copyButton.disabled = !canDownloadOrCopyHtml;
        }

        const fullscreenButton = document.querySelector<HTMLButtonElement>(`#fullscreen-btn-${pipelineId}-${iterationNumber}`);
        const previewContainer = document.getElementById(`preview-container-${pipelineId}-${iterationNumber}`);
        if (fullscreenButton && previewContainer) {
            fullscreenButton.onclick = () => {
                if (!document.fullscreenElement) {
                    previewContainer.requestFullscreen().catch(err => console.error(`Error full-screen: ${err.message}`));
                } else if (document.exitFullscreen) document.exitFullscreen();
            };
            fullscreenButton.disabled = !canDownloadOrCopyHtml;
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
            downloadButton.onclick = () => {
                if (canDownloadOrCopyText && textContentForActions) {
                    downloadFile(textContentForActions, defaultFileName, contentType);
                }
            };
            downloadButton.disabled = !canDownloadOrCopyText;
        }

        const copyButton = document.querySelector<HTMLButtonElement>(`#copy-text-${pipelineId}-${iterationNumber}`);
        if (copyButton) {
            copyButton.dataset.hasContent = String(canDownloadOrCopyText);
            copyButton.onclick = () => {
                if (canDownloadOrCopyText && textContentForActions) copyToClipboard(textContentForActions, copyButton);
            };
            copyButton.disabled = !canDownloadOrCopyText;
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
        attachIterationActionButtons(pipelineId, iterationNumber);
    }
}


function updatePipelineStatusUI(pipelineId: number, status: PipelineState['status']) {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return;

    pipeline.status = status;

    const statusTextElement = document.getElementById(`pipeline-status-text-${pipelineId}`);
    if (statusTextElement) {
        statusTextElement.textContent = status;
        statusTextElement.className = `pipeline-status status-badge status-${status}`;
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

function downloadFile(content: string | Blob, fileName: string, contentType: string) {
    const a = document.createElement("a");
    const file = (content instanceof Blob) ? content : new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
}

async function createAndDownloadReactProjectZip() {
    if (!activeReactPipeline || !activeReactPipeline.finalAppendedCode) {
        alert("No React project code available to download.");
        return;
    }

    const zip = new JSZip();
    const finalCode = activeReactPipeline.finalAppendedCode;
    const fileMarkerRegex = /^\/\/\s*---\s*FILE:\s*(.*?)\s*---\s*$/gm;
    let match;
    let lastIndex = 0;
    const files: { path: string, content: string }[] = [];

    // First pass to find all file markers and their start indices
    const markers: { path: string, startIndex: number }[] = [];
    while ((match = fileMarkerRegex.exec(finalCode)) !== null) {
        markers.push({ path: match[1].trim(), startIndex: match.index + match[0].length });
    }

    // Second pass to extract content based on markers
    for (let i = 0; i < markers.length; i++) {
        const currentMarker = markers[i];
        const nextMarker = markers[i + 1];
        const contentEndIndex = nextMarker ? nextMarker.startIndex - (finalCode.substring(0, nextMarker.startIndex).match(/\/\/\s*---\s*FILE:\s*.*?\s*---\s*$/m)?.[0].length || 0) : finalCode.length;

        let content = finalCode.substring(currentMarker.startIndex, contentEndIndex).trim();

        // Remove the matched marker line from the *next* iteration's content start if it was captured
        if (nextMarker) {
            const nextMarkerLineInContentRegex = /^\/\/\s*---\s*FILE:\s*.*?\s*---\s*\n?/m;
            content = content.replace(nextMarkerLineInContentRegex, '');
        }

        files.push({ path: currentMarker.path, content: content.trimStart() }); // trimStart to remove leading newline after marker
    }

    if (files.length === 0 && finalCode.length > 0) {
        // If no markers found, but there is code, assume it's a single file (e.g. App.tsx or similar)
        // This is a fallback, the orchestrator should ensure markers are present.
        console.warn("No file markers found in the aggregated code. Assuming single file 'src/App.tsx'.");
        files.push({ path: "src/App.tsx", content: finalCode });
    }


    files.forEach(file => {
        // Ensure paths are relative and don't start with /
        const correctedPath = file.path.startsWith('/') ? file.path.substring(1) : file.path;
        zip.file(correctedPath, file.content);
    });

    try {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, `react-app-${activeReactPipeline.id}.zip`, 'application/zip');
    } catch (error) {
        console.error("Error generating React project zip:", error);
        alert("Failed to generate zip file. See console for details.");
    }
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
        activeReactPipeline: currentMode === 'react' ? JSON.parse(JSON.stringify(activeReactPipeline)) : null,
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
                // renderReactModePipeline(); // Will be called when implemented
                // if (activeReactPipeline && activeReactPipeline.activeTabId) {
                //    activateTab(activeReactPipeline.activeTabId); // This activateTab will need updates for React tabs
                // }
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
             pipelinesContentContainer.innerHTML = '';
        }
        return;
    }
    if (!activeMathPipeline) {
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message">Enter a math problem and click "Solve Problem".</p>';
        pipelinesContentContainer.innerHTML = '';
        return;
    }

    const mathProcess = activeMathPipeline;
    tabsNavContainer.innerHTML = ''; 
    pipelinesContentContainer.innerHTML = ''; 

    const problemTabButton = document.createElement('button');
    problemTabButton.className = 'tab-button math-mode-tab';
    problemTabButton.id = `math-tab-problem-details`;
    problemTabButton.textContent = 'Problem Details';
    problemTabButton.setAttribute('role', 'tab');
    problemTabButton.setAttribute('aria-controls', `math-content-problem-details`);
    problemTabButton.addEventListener('click', () => activateTab('problem-details'));
    tabsNavContainer.appendChild(problemTabButton);

    const problemContentPane = document.createElement('div');
    problemContentPane.id = `math-content-problem-details`;
    problemContentPane.className = 'math-pipeline-content-pane model-detail-card';
    problemContentPane.setAttribute('role', 'tabpanel');
    problemContentPane.setAttribute('aria-labelledby', `math-tab-problem-details`);
    let problemDetailsHtml = `
        <div class="math-problem-display">
            <h4 class="model-title">Original Problem</h4>
            <p class="problem-text">${escapeHtml(mathProcess.problemText)}</p>`;
    if (mathProcess.problemImageBase64 && mathProcess.problemImageMimeType) {
        problemDetailsHtml += `<img src="data:${mathProcess.problemImageMimeType};base64,${mathProcess.problemImageBase64}" alt="Uploaded Math Problem Image" class="problem-image-display">`;
    }
    if (mathProcess.requestPromptInitialStrategyGen) {
        problemDetailsHtml += `
            <div class="model-detail-section">
                <h5 class="model-section-title">Initial Strategy Generation User Prompt:</h5>
                <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(mathProcess.requestPromptInitialStrategyGen)}</pre></div>
            </div>`;
    }
     if (mathProcess.status === 'retrying' && mathProcess.retryAttempt !== undefined && mathProcess.initialStrategies.length === 0) { 
        problemDetailsHtml += `<p class="status-badge status-retrying">Retrying initial strategy generation (${mathProcess.retryAttempt}/${MAX_RETRIES})...</p>`;
    } else if (mathProcess.error && mathProcess.initialStrategies.length === 0) { 
        problemDetailsHtml += `<div class="status-message error"><pre>${escapeHtml(mathProcess.error)}</pre></div>`;
    }
    problemDetailsHtml += `</div>`;
    problemContentPane.innerHTML = problemDetailsHtml;
    pipelinesContentContainer.appendChild(problemContentPane);


    mathProcess.initialStrategies.forEach((mainStrategy, index) => {
        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button math-mode-tab';
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
        contentPane.className = 'math-pipeline-content-pane model-detail-card';
        contentPane.setAttribute('role', 'tabpanel');
        contentPane.setAttribute('aria-labelledby', `math-tab-strategy-${index}`);
        
        let contentHtml = `<div class="math-strategy-branch" id="math-branch-${mainStrategy.id}">
            <div class="model-detail-header">
                <div class="model-title-area">
                    <h4 class="model-title">Main Strategy ${index + 1}</h4>
                </div>
                <div class="model-card-actions">
                    <span class="status-badge status-${mainStrategy.status}" id="math-main-strat-status-${mainStrategy.id}">${mainStrategy.status}</span>
                </div>
            </div>
            <div class="math-strategy-details">
                <p class="strategy-text">${escapeHtml(mainStrategy.strategyText)}</p>`;
        if (mainStrategy.requestPromptSubStrategyGen) {
            contentHtml += `<div class="model-detail-section">
                    <h5 class="model-section-title">Sub-strategy Generation User Prompt:</h5>
                    <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(mainStrategy.requestPromptSubStrategyGen)}</pre></div>
                </div>`;
        }
        if (mainStrategy.status === 'retrying' && mainStrategy.retryAttempt !== undefined) {
             contentHtml += `<p class="status-badge status-retrying">Retrying sub-strategy generation (${mainStrategy.retryAttempt}/${MAX_RETRIES})...</p>`;
        } else if (mainStrategy.error) {
             contentHtml += `<div class="status-message error"><pre>${escapeHtml(mainStrategy.error)}</pre></div>`;
        }
        contentHtml += `</div>`; // Close main strategy details
        
        if (mainStrategy.subStrategies.length > 0) {
            contentHtml += `<ul class="math-sub-strategies-list" style="list-style-type: none; padding: 0;">`;
            mainStrategy.subStrategies.forEach((subStrategy, subIndex) => {
                 let solutionContent;
                 if (subStrategy.solutionAttempt) {
                     solutionContent = `<pre id="math-solution-${subStrategy.id}">${escapeHtml(subStrategy.solutionAttempt)}</pre>`;
                 } else {
                     solutionContent = `<div class="empty-state-message">${getEmptyStateMessage(subStrategy.status, 'solution')}</div>`;
                 }

                contentHtml += `
                    <li class="math-sub-strategy-item model-detail-section" id="math-sub-item-${subStrategy.id}">
                        <h5 class="model-section-title">Sub-Strategy ${index + 1}.${subIndex + 1} <span class="status-badge status-${subStrategy.status}" id="math-sub-strat-status-${subStrategy.id}">${subStrategy.status}</span></h5>
                        <div class="math-sub-strategy-details">
                            <p class="sub-strategy-text">${escapeHtml(subStrategy.subStrategyText)}</p>`;
                if (subStrategy.requestPromptSolutionAttempt) {
                     contentHtml += `<div class="model-detail-section">
                            <h6 class="prompt-title">Solution Attempt User Prompt:</h6>
                            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(subStrategy.requestPromptSolutionAttempt)}</pre></div>
                        </div>`;
                }
                if (subStrategy.status === 'retrying' && subStrategy.retryAttempt !== undefined) {
                    contentHtml += `<p class="status-badge status-retrying">Retrying solution attempt (${subStrategy.retryAttempt}/${MAX_RETRIES})...</p>`;
                } else if (subStrategy.solutionAttempt || ['pending', 'processing', 'retrying', 'cancelled', 'error'].includes(subStrategy.status)) {
                    contentHtml += `<div class="model-detail-section">
                            <h6 class="prompt-title">Solution Attempt:</h6>
                             <div class="code-block-wrapper">
                                <div class="scrollable-content-area custom-scrollbar">${solutionContent}</div>
                                ${subStrategy.solutionAttempt ? `
                                <div class="code-actions">
                                    <button class="button download-math-solution-btn" data-sub-strategy-id="${subStrategy.id}" title="Download Solution">Download</button>
                                    <button class="button copy-math-solution-btn" data-sub-strategy-id="${subStrategy.id}" title="Copy Solution">Copy</button>
                                </div>` : ''}
                            </div>
                        </div>`;
                }
                 if (subStrategy.error && subStrategy.status === 'error') {
                     contentHtml += `<div class="status-message error"><pre>${escapeHtml(subStrategy.error)}</pre></div>`;
                 }
                contentHtml += `</div></li>`; // Close sub-strategy item
            });
            contentHtml += `</ul>`; // Close sub-strategies list
        } else if (mainStrategy.status === 'completed' && mainStrategy.subStrategies.length === 0) {
             contentHtml += `<p class="no-details-message">No sub-strategies were generated for this main strategy.</p>`;
        }
        
        contentHtml += `</div>`; // Close math-strategy-branch
        contentPane.innerHTML = contentHtml;
        pipelinesContentContainer.appendChild(contentPane);

        // Attach listeners for copy buttons
        contentPane.querySelectorAll('.copy-math-solution-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const subStrategyId = (e.currentTarget as HTMLElement).dataset.subStrategyId;
                const solutionText = mathProcess.initialStrategies.flatMap(ms => ms.subStrategies).find(ss => ss.id === subStrategyId)?.solutionAttempt;
                if (solutionText) {
                    copyToClipboard(solutionText, e.currentTarget as HTMLButtonElement);
                }
            });
        });

        // Attach listeners for download buttons
        contentPane.querySelectorAll('.download-math-solution-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const subStrategyId = (e.currentTarget as HTMLElement).dataset.subStrategyId;
                const subStrategy = mathProcess.initialStrategies.flatMap(ms => ms.subStrategies).find(ss => ss.id === subStrategyId);
                if (subStrategy?.solutionAttempt) {
                    downloadFile(subStrategy.solutionAttempt, `math_solution_${subStrategy.id}.txt`, 'text/plain');
                }
            });
        });
    });

    if (mathProcess.activeTabId) {
        activateTab(mathProcess.activeTabId);
    } else {
        activateTab('problem-details'); // Default to problem details
    }
    updateControlsState();
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
        if (currentMode !== 'react' && tabsNavContainer && pipelinesContentContainer) { // Clear if not in react mode but called
            tabsNavContainer.innerHTML = '';
            pipelinesContentContainer.innerHTML = '';
        }
        return;
    }

    if (!activeReactPipeline) {
        tabsNavContainer.innerHTML = '<p class="no-pipelines-message">Enter a React App Request and click "Generate React App".</p>';
        pipelinesContentContainer.innerHTML = '';
        return;
    }

    const pipeline = activeReactPipeline;
    
    tabsNavContainer.innerHTML = ''; 
    pipelinesContentContainer.innerHTML = '';

    const orchestratorPane = document.createElement('div');
    orchestratorPane.className = 'react-orchestrator-pane model-detail-card';
    let orchestratorHtml = `
        <div class="model-detail-header">
             <div class="model-title-area">
                <h4 class="model-title">React App Orchestration</h4>
             </div>
             <div class="model-card-actions">
                <span class="status-badge status-${pipeline.status}" id="react-orchestrator-status-text">${pipeline.status.replace('_', ' ')}</span>
                <button class="button pipeline-remove-button" id="stop-react-pipeline-btn" title="Stop React App Generation" aria-label="Stop React App Generation" style="display: ${pipeline.status === 'orchestrating' || pipeline.status === 'processing_workers' ? 'inline-flex' : 'none'};">
                    ${pipeline.status === 'stopping' ? 'Stopping...' : 'Stop'}
                </button>
            </div>
        </div>
        <div class="model-detail-section">
            <h5 class="model-section-title">User Request & Orchestrator Config</h5>
            <p><strong>User Request:</strong> ${escapeHtml(pipeline.userRequest)}</p>
            <h6 class="prompt-title">Orchestrator System Instruction:</h6>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(pipeline.orchestratorSystemInstruction)}</pre></div>
        </div>
    `;
    if (pipeline.orchestratorPlan) {
        orchestratorHtml += `
        <div class="model-detail-section">
            <h5 class="model-section-title">Orchestrator's Plan (plan.txt)</h5>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(pipeline.orchestratorPlan)}</pre></div>
        </div>`;
    }
    if (pipeline.orchestratorRawOutput) {
         orchestratorHtml += `
        <div class="model-detail-section">
            <h5 class="model-section-title">Orchestrator Raw Output (for debugging)</h5>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(pipeline.orchestratorRawOutput)}</pre></div>
        </div>`;
    }
     if (pipeline.error && (pipeline.status === 'failed' || pipeline.status === 'error' && pipeline.stages.every(s => s.status === 'pending'))) {
        orchestratorHtml += `<div class="status-message error"><pre>${escapeHtml(pipeline.error)}</pre></div>`;
    }
    orchestratorPane.innerHTML = orchestratorHtml;
    pipelinesContentContainer.appendChild(orchestratorPane);

    const stopReactButton = document.getElementById('stop-react-pipeline-btn');
    if (stopReactButton) {
        stopReactButton.onclick = () => {
            if (activeReactPipeline && (activeReactPipeline.status === 'orchestrating' || activeReactPipeline.status === 'processing_workers')) {
                activeReactPipeline.isStopRequested = true;
                activeReactPipeline.status = 'stopping';
                renderReactModePipeline();
            }
        };
        (stopReactButton as HTMLButtonElement).disabled = pipeline.status === 'stopping' || pipeline.status === 'stopped' || pipeline.status === 'failed' || pipeline.status === 'completed';
    }


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
        workerContentPane.className = 'react-worker-content-pane model-detail-card';
        workerContentPane.setAttribute('role', 'tabpanel');
        workerContentPane.setAttribute('aria-labelledby', tabButton.id);

        let displayStatusText = stage.status.charAt(0).toUpperCase() + stage.status.slice(1);
        if (stage.status === 'retrying' && stage.retryAttempt !== undefined) {
            displayStatusText = `Retrying (${stage.retryAttempt}/${MAX_RETRIES})...`;
        }

        let workerDetailsHtml = `
            <div class="model-detail-header">
                <div class="model-title-area">
                    <h4 class="model-title">${escapeHtml(stage.title)}</h4>
                </div>
                <div class="model-card-actions">
                    <span class="status-badge status-${stage.status}">${displayStatusText}</span>
                </div>
            </div>`;
        if (stage.error) {
            workerDetailsHtml += `<div class="status-message error"><pre>${escapeHtml(stage.error)}</pre></div>`;
        }
        workerDetailsHtml += `<div class="model-detail-section">
            <h5 class="model-section-title">Prompts for ${escapeHtml(stage.title)}</h5>
            <h6 class="prompt-title">System Instruction:</h6>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(stage.systemInstruction || "Not available.")}</pre></div>
            <h6 class="prompt-title" style="margin-top: 1rem;">Rendered User Prompt:</h6>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(stage.renderedUserPrompt || stage.userPrompt || "Not available.")}</pre></div>
        </div>`;
        
        const hasContent = !!stage.generatedContent;
        let contentBlock;
        if (hasContent) {
            contentBlock = `<pre id="react-worker-${stage.id}-code-block">${escapeHtml(stage.generatedContent!)}</pre>`;
        } else {
            contentBlock = `<div class="empty-state-message">${getEmptyStateMessage(stage.status, 'code')}</div>`;
        }

        if (hasContent || ['pending', 'processing', 'retrying', 'error', 'cancelled'].includes(stage.status)) {
            workerDetailsHtml += `
            <div class="model-detail-section">
                <h5 class="model-section-title">Generated Code/Content</h5>
                <div class="code-block-wrapper">
                    <div class="scrollable-content-area custom-scrollbar">${contentBlock}</div>
                    ${hasContent ? `
                     <div class="code-actions">
                        <button class="button download-react-worker-code-btn" data-worker-id="${stage.id}" title="Download Code Snippet">Download</button>
                        <button class="button copy-react-worker-code-btn" data-worker-id="${stage.id}" title="Copy Code Snippet">Copy</button>
                     </div>` : ''}
                </div>
            </div>`;
        }
        workerContentPane.innerHTML = workerDetailsHtml;
        pipelinesContentContainer.appendChild(workerContentPane);

        const copyBtn = workerContentPane.querySelector('.copy-react-worker-code-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                const workerId = parseInt((e.currentTarget as HTMLElement).dataset.workerId || "-1", 10);
                const contentToCopy = activeReactPipeline?.stages.find(s => s.id === workerId)?.generatedContent;
                if (contentToCopy) {
                    copyToClipboard(contentToCopy, e.currentTarget as HTMLButtonElement);
                }
            });
        }
        
        const downloadBtn = workerContentPane.querySelector('.download-react-worker-code-btn');
        if(downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                 const workerId = parseInt((e.currentTarget as HTMLElement).dataset.workerId || "-1", 10);
                 const stage = activeReactPipeline?.stages.find(s => s.id === workerId);
                 if (stage?.generatedContent) {
                     const safeTitle = stage.title.replace(/[\s&/\\?#]+/g, '_').toLowerCase();
                     downloadFile(stage.generatedContent, `react_worker_${stage.id}_${safeTitle}.txt`, 'text/plain');
                 }
            });
        }
    });

    if (pipeline.finalAppendedCode) {
        const finalOutputPane = document.createElement('div');
        finalOutputPane.className = 'react-final-output-pane model-detail-card';
        finalOutputPane.innerHTML = `
            <div class="model-detail-header">
                <h4 class="model-title">Final Aggregated Application Code</h4>
                <div class="model-card-actions">
                    <button id="download-react-runnable-project" class="button" type="button">Download Project (.zip)</button>
                </div>
            </div>
            <p>The following is a concatenation of outputs from successful worker agents. File markers (e.g., // --- FILE: src/App.tsx ---) should indicate intended file paths.</p>
            <div class="scrollable-content-area custom-scrollbar"><pre id="react-final-appended-code">${escapeHtml(pipeline.finalAppendedCode)}</pre></div>
        `;
        pipelinesContentContainer.appendChild(finalOutputPane);

        const downloadRunnableProjectButton = document.getElementById('download-react-runnable-project');
        if (downloadRunnableProjectButton && pipeline.finalAppendedCode) {
            downloadRunnableProjectButton.addEventListener('click', createAndDownloadReactProjectZip);
        }
    }

    if (pipeline.activeTabId) {
        activateTab(pipeline.activeTabId);
    } else if (pipeline.stages.length > 0) {
        activateTab(`worker-${pipeline.stages[0].id}`);
    }
    updateControlsState();
}


async function runReactWorkerAgents() {
    if (!activeReactPipeline || activeReactPipeline.status !== 'processing_workers') {
        console.error("RunReactWorkerAgents called in an invalid state.");
        return;
    }
    renderReactModePipeline(); // Update UI to show workers starting

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
                    const workerTemp = 0.7; // Moderate temperature for workers

                    const apiResponse = await callGemini(stage.renderedUserPrompt, workerTemp, selectedModel, stage.systemInstruction, false);
                    stageResponseText = apiResponse.text;
                    stage.generatedContent = cleanOutputByType(stageResponseText, 'text'); // Assuming text/code output
                    stage.status = 'completed';
                    stage.error = undefined;
                    renderReactModePipeline();
                    break; // Exit retry loop on success
                } catch (e: any) {
                    console.warn(`Worker Agent ${stage.id}, Attempt ${attempt + 1} failed: ${e.message}`);
                    stage.error = `Attempt ${attempt + 1} failed: ${e.message || 'Unknown API error'}`;
                    if (attempt === MAX_RETRIES) {
                        renderReactModePipeline();
                        throw e; // Rethrow after final attempt fails
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


function initializeUI() {
    initializeApiKey();

    renderPipelineSelectors();
    initializeCustomPromptTextareas();
    updateUIAfterModeChange(); // Called early to set up initial UI based on default mode

    if (generateButton) {
        generateButton.addEventListener('click', async () => {
            if (!ai) { // Double check if API client is not initialized
                alert("API Key is not configured. Please ensure the process.env.API_KEY is set or provide one manually.");
                initializeApiKey(); // Try to re-initialize
                return;
            }
            const initialIdea = initialIdeaInput.value.trim();
            if (!initialIdea) {
                alert("Please enter an idea, premise, math problem, or request.");
                return;
            }

            if (currentMode === 'math') {
                await startMathSolvingProcess(initialIdea, currentProblemImageBase64, currentProblemImageMimeType);
            } else if (currentMode === 'react') {
                await startReactModeProcess(initialIdea);
            } else { // Website, Creative, Agent modes
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
                    currentProblemImageBase64 = (e.target?.result as string).split(',')[1]; // Get base64 part
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

    if (exportConfigButton) {
        exportConfigButton.addEventListener('click', exportConfiguration);
    }
    if (importConfigInput) {
        importConfigInput.addEventListener('change', handleImportConfiguration);
    }

    // Prompts Modal Listeners
    if (customizePromptsTrigger) {
        customizePromptsTrigger.addEventListener('click', () => setPromptsModalVisible(true));
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

    // Diff Modal Listeners
    if (diffModalCloseButton) {
        diffModalCloseButton.addEventListener('click', closeDiffModal);
    }
    if (diffModalOverlay) {
        diffModalOverlay.addEventListener('click', (e) => {
            if (e.target === diffModalOverlay) {
                closeDiffModal();
            }
        });
    }
    // Event delegation for dynamically created "Compare" buttons
    if (pipelinesContentContainer) {
        pipelinesContentContainer.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('compare-output-button')) {
                const pipelineId = parseInt(target.dataset.pipelineId || "-1", 10);
                const iterationNumber = parseInt(target.dataset.iterationNumber || "-1", 10);
                const contentType = target.dataset.contentType as ('html' | 'text');
                if (pipelineId !== -1 && iterationNumber !== -1 && (contentType === 'html' || contentType === 'text')) {
                    openDiffModal(pipelineId, iterationNumber, contentType);
                }
            }
        });
    }

    // API Key Listeners
    saveApiKeyButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('gemini-api-key', key);
            apiKeyInput.value = ''; // Clear input after save
            initializeApiKey(); // Re-initialize
            updateControlsState(); // Update button states
        } else {
            alert("Please enter a valid API Key.");
        }
    });

    clearApiKeyButton.addEventListener('click', () => {
        localStorage.removeItem('gemini-api-key');
        initializeApiKey(); // Re-initialize
        updateControlsState(); // Update button states
    });

    updateControlsState();
}

// ---------- DIFF MODAL FUNCTIONS ----------

let diffSourceData: { pipelineId: number, iterationNumber: number, contentType: 'html' | 'text', content: string, title: string } | null = null;

function renderDiff(sourceText: string, targetText: string) {
    if (!diffViewerPanel) return;
    const differences = Diff.diffLines(sourceText, targetText, { newlineIsToken: true });
    let html = '<div class="diff-view">';
    differences.forEach(part => {
        const colorClass = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-neutral';
        html += `<span class="${colorClass}">${escapeHtml(part.value)}</span>`;
    });
    html += '</div>';
    diffViewerPanel.innerHTML = html;
}

function populateDiffTargetTree() {
    if (!diffTargetTreeContainer || !diffSourceData) return;
    diffTargetTreeContainer.innerHTML = ''; // Clear previous tree

    pipelinesState.forEach(pipeline => {
        const pipelineTitle = document.createElement('h5');
        pipelineTitle.textContent = `Variant ${pipeline.id + 1} (T: ${pipeline.temperature.toFixed(1)})`;
        diffTargetTreeContainer.appendChild(pipelineTitle);

        pipeline.iterations.forEach(iter => {
            const isSource = pipeline.id === diffSourceData!.pipelineId && iter.iterationNumber === diffSourceData!.iterationNumber;
            let targetContent: string | undefined = undefined;
            if (diffSourceData!.contentType === 'html') {
                targetContent = iter.generatedHtml;
            } else { // text
                targetContent = iter.generatedOrRevisedText || iter.generatedMainContent;
            }

            const itemDiv = document.createElement('div');
            itemDiv.className = 'tree-item';
            itemDiv.textContent = iter.title;
            if (isSource || !targetContent) {
                itemDiv.classList.add('disabled');
                if (isSource) itemDiv.textContent += ' (Source A)';
                else itemDiv.textContent += ' (No content)';
            } else {
                itemDiv.addEventListener('click', () => {
                    if (targetContent) { // Should always be true if not disabled
                        renderDiff(diffSourceData!.content, targetContent);
                        // Optionally highlight selected target
                        diffTargetTreeContainer.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
                        itemDiv.classList.add('selected');
                    }
                });
            }
            diffTargetTreeContainer.appendChild(itemDiv);
        });
    });
}


function openDiffModal(pipelineId: number, iterationNumber: number, contentType: 'html' | 'text') {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return;
    const iteration = pipeline.iterations.find(iter => iter.iterationNumber === iterationNumber);
    if (!iteration) return;

    let content: string | undefined;
    if (contentType === 'html') {
        content = iteration.generatedHtml;
    } else { // text
        content = iteration.generatedOrRevisedText || iteration.generatedMainContent;
    }

    if (!content) {
        alert("Source content is not available for comparison.");
        return;
    }

    diffSourceData = { pipelineId, iterationNumber, contentType, content, title: iteration.title };

    if (diffSourceLabel) diffSourceLabel.textContent = `Variant ${pipelineId + 1} - ${iteration.title}`;
    if (diffViewerPanel) diffViewerPanel.innerHTML = '<div class="diff-no-selection"><p>Select a target (B) from the list to view differences.</p></div>'; // Reset viewer

    populateDiffTargetTree();
    if (diffModalOverlay) {
        diffModalOverlay.style.display = 'flex';
        setTimeout(() => diffModalOverlay.classList.add('is-visible'), 10);
    }
}

function closeDiffModal() {
    if (diffModalOverlay) {
        diffModalOverlay.classList.remove('is-visible');
        diffModalOverlay.addEventListener('transitionend', () => {
            if (!diffModalOverlay.classList.contains('is-visible')) {
                diffModalOverlay.style.display = 'none';
            }
        }, { once: true });
    }
    diffSourceData = null; // Clear source data when closing
}

// ---------- END DIFF MODAL FUNCTIONS ----------

document.addEventListener('DOMContentLoaded', () => {
    initializeUI();

    // Default to first mode if none specifically checked (e.g. after import or on fresh load)
    const appModeRadios = document.querySelectorAll('input[name="appMode"]');
    let modeIsAlreadySet = false;
    appModeRadios.forEach(radio => {
        if ((radio as HTMLInputElement).checked) {
            currentMode = (radio as HTMLInputElement).value as ApplicationMode; // Ensure currentMode reflects HTML state
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
    }
});
