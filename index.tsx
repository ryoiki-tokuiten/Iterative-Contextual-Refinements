/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Diff from 'diff';
import JSZip from 'jszip';
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
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
    generatedRawHtml?: string; // Raw output from Request 1 (before bug fixing)
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

    // New fields for self-improvement and refinement
    requestPromptSelfImprovement?: string;
    refinedSolution?: string;
    selfImprovementStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    selfImprovementError?: string;
    selfImprovementRetryAttempt?: number;

    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}

// New interfaces for Hypothesis Explorer
interface MathHypothesisData {
    id: string; // e.g., "hyp1", "hyp2", "hyp3"
    hypothesisText: string;

    // Prover agent data
    proverRequestPrompt?: string;
    proverAttempt?: string;
    proverStatus: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    proverError?: string;
    proverRetryAttempt?: number;

    // Disprover agent data
    disproverRequestPrompt?: string;
    disproverAttempt?: string;
    disproverStatus: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    disproverError?: string;
    disproverRetryAttempt?: number;

    // Final status determination
    finalStatus: 'pending' | 'proven' | 'refuted' | 'unresolved' | 'contradiction';
    isDetailsOpen?: boolean;
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

    // New fields for judging sub-strategies
    judgedBestSubStrategyId?: string;
    judgedBestSolution?: string; // The full text of the best solution with reasoning.
    judgingRequestPrompt?: string;
    judgingResponseText?: string; // The raw response from the judge
    judgingStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    judgingError?: string;
    judgingRetryAttempt?: number;
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
    activeTabId?: string; // e.g., "problem-details", "strategic-solver", "hypothesis-explorer", "final-result"
    activeStrategyTab?: number;
    retryAttempt?: number; // for initial strategy generation step

    // New fields for Hypothesis Explorer (Track B)
    requestPromptHypothesisGen?: string;
    hypotheses: MathHypothesisData[];
    hypothesisGenStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    hypothesisGenError?: string;
    hypothesisGenRetryAttempt?: number;

    // Knowledge packet synthesized from hypothesis exploration
    knowledgePacket?: string;

    // Synchronization flags
    strategicSolverComplete?: boolean; // Track A completion
    hypothesisExplorerComplete?: boolean; // Track B completion

    // New fields for final judging
    finalJudgedBestStrategyId?: string;
    finalJudgedBestSolution?: string;
    finalJudgingRequestPrompt?: string;
    finalJudgingResponseText?: string;
    finalJudgingStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    finalJudgingError?: string;
    finalJudgingRetryAttempt?: number;
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
    user_math_solutionAttempt: string; // {{originalProblemText}}, {{currentSubStrategy}}, {{knowledgePacket}} (+ image)

    // New prompts for self-improvement and refinement
    sys_math_selfImprovement: string;
    user_math_selfImprovement: string; // {{originalProblemText}}, {{currentSubStrategy}}, {{solutionAttempt}}, {{knowledgePacket}} (+ image)

    // New prompts for hypothesis exploration
    sys_math_hypothesisGeneration: string;
    user_math_hypothesisGeneration: string; // {{originalProblemText}} (+ image)
    sys_math_prover: string;
    user_math_prover: string; // {{originalProblemText}}, {{hypothesis}} (+ image)
    sys_math_disprover: string;
    user_math_disprover: string; // {{originalProblemText}}, {{hypothesis}} (+ image)
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


const NUM_WEBSITE_REFINEMENT_ITERATIONS = 3;
const NUM_CREATIVE_REFINEMENT_ITERATIONS = 3;
export const NUM_AGENT_MAIN_REFINEMENT_LOOPS = 3;
const TOTAL_STEPS_WEBSITE = 1 + NUM_WEBSITE_REFINEMENT_ITERATIONS + 1;
const TOTAL_STEPS_CREATIVE = 1 + NUM_CREATIVE_REFINEMENT_ITERATIONS + 1;
// Agent steps: 1 (Judge) + 1 (Initial Gen) + 1 (Initial Refine/Suggest) + N (Loops) + 1 (Final Polish)
const TOTAL_STEPS_AGENT = 1 + 1 + 1 + NUM_AGENT_MAIN_REFINEMENT_LOOPS + 1;


export const NUM_INITIAL_STRATEGIES_MATH = 3;
export const NUM_SUB_STRATEGIES_PER_MAIN_MATH = 3;
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
    sys_math_selfImprovement: document.getElementById('sys-math-self-improvement') as HTMLTextAreaElement,
    user_math_selfImprovement: document.getElementById('user-math-self-improvement') as HTMLTextAreaElement,
    sys_math_hypothesisGeneration: document.getElementById('sys-math-hypothesis-generation') as HTMLTextAreaElement,
    user_math_hypothesisGeneration: document.getElementById('user-math-hypothesis-generation') as HTMLTextAreaElement,
    sys_math_prover: document.getElementById('sys-math-prover') as HTMLTextAreaElement,
    user_math_prover: document.getElementById('user-math-prover') as HTMLTextAreaElement,
    sys_math_disprover: document.getElementById('sys-math-disprover') as HTMLTextAreaElement,
    user_math_disprover: document.getElementById('user-math-disprover') as HTMLTextAreaElement,
};

const customPromptTextareasAgent: { [K in keyof CustomizablePromptsAgent]: HTMLTextAreaElement | null } = {
    sys_agent_judge_llm: document.getElementById('sys-agent-judge-llm') as HTMLTextAreaElement,
    user_agent_judge_llm: document.getElementById('user-agent-judge-llm') as HTMLTextAreaElement,
};

const customPromptTextareasReact: { [K in keyof CustomizablePromptsReact]: HTMLTextAreaElement | null } = { // Added for React mode
    sys_orchestrator: document.getElementById('sys-react-orchestrator') as HTMLTextAreaElement,
    user_orchestrator: document.getElementById('user-react-orchestrator') as HTMLTextAreaElement,
};

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

const promptNavStructure = {
    website: [
        { groupTitle: "1. Initial Generation & Analysis", prompts: ["initial-gen", "initial-bugfix", "initial-features"] },
        { groupTitle: "2. Refinement Cycle", prompts: ["refine-implement", "refine-bugfix", "refine-features"] },
        { groupTitle: "3. Final Polish", prompts: ["final-polish"] }
    ],
    creative: [
        { groupTitle: "1. Drafting & Critique", prompts: ["creative-initial-draft", "creative-initial-critique"] },
        { groupTitle: "2. Revision Cycle", prompts: ["creative-refine-revise", "creative-refine-critique"] },
        { groupTitle: "3. Final Polish", prompts: ["creative-final-polish"] }
    ],
    math: [
        { groupTitle: "1. Strategic Solver", prompts: ["math-initial-strategy", "math-sub-strategy", "math-solution-attempt", "math-self-improvement"] },
        { groupTitle: "2. Hypothesis Explorer", prompts: ["math-hypothesis-generation", "math-prover", "math-disprover"] }
    ],
    agent: [
        { groupTitle: "Agent Configuration", prompts: ["agent-judge-llm"] }
    ],
    react: [
        { groupTitle: "Orchestrator Agent", prompts: ["react-orchestrator"] }
    ]
};

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

    // Display current mode at the top of nav
    const modeTitle = document.createElement('h4');
    modeTitle.className = 'prompts-nav-mode-title';
    modeTitle.textContent = `${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)} Mode Prompts`;
    navContainer.appendChild(modeTitle);

    const navStructure = promptNavStructure[currentMode as keyof typeof promptNavStructure];
    if (!navStructure) return;

    let firstNavItem: HTMLElement | null = null;

    navStructure.forEach(group => {
        const groupTitleEl = document.createElement('h5');
        groupTitleEl.className = 'prompts-nav-group-title';
        groupTitleEl.textContent = group.groupTitle;
        navContainer.appendChild(groupTitleEl);

        group.prompts.forEach(promptKey => {
            const pane = activeModeContainer.querySelector<HTMLElement>(`.prompt-content-pane[data-prompt-key="${promptKey}"]`);
            if (!pane) return;

            const titleElement = pane.querySelector<HTMLHeadingElement>('.prompt-pane-title');
            const title = titleElement ? titleElement.textContent : 'Unnamed Section';

            const navItem = document.createElement('div');
            navItem.className = 'prompts-nav-item';
            navItem.textContent = title;
            navItem.dataset.targetPane = promptKey;
            navContainer.appendChild(navItem);

            if (!firstNavItem) {
                firstNavItem = navItem;
            }

            navItem.addEventListener('click', () => {
                // Deactivate all nav items and panes first
                navContainer.querySelectorAll('.prompts-nav-item').forEach(item => item.classList.remove('active'));
                activeModeContainer.querySelectorAll('.prompt-content-pane').forEach(p => p.classList.remove('active'));

                // Activate the clicked one
                navItem.classList.add('active');
                pane.classList.add('active');
            });
        });
    });

    // Activate the first one by default
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
    if (activeContainer) activeContainer.classList.add('active');

    // Default UI states
    if (mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'none';
    if (modelSelectionContainer) modelSelectionContainer.style.display = 'flex';
    if (temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'block';

    const generateButtonText = generateButton?.querySelector('.button-text');

    if (currentMode === 'website') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'HTML Idea:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., a personal blog about cooking, a portfolio...';
        if (generateButtonText) generateButtonText.textContent = 'Generate HTML';
    } else if (currentMode === 'creative') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Writing Premise:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., a short story about a time traveler, a poem...';
        if (generateButtonText) generateButtonText.textContent = 'Refine Writing';
    } else if (currentMode === 'math') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Math Problem:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "Solve for x: 2x + 5 = 11" or describe...';
        if (generateButtonText) generateButtonText.textContent = 'Solve Problem';
        if (mathProblemImageInputContainer) mathProblemImageInputContainer.style.display = 'flex';
        if (modelSelectionContainer) modelSelectionContainer.style.display = 'none';
        if (temperatureSelectionContainer) temperatureSelectionContainer.style.display = 'none';
    } else if (currentMode === 'agent') {
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'Your Request:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "Python snake game", "Analyze iPhone sales data"...';
        if (generateButtonText) generateButtonText.textContent = 'Start Agent Process';
    } else if (currentMode === 'react') { // Added for React mode
        if (initialIdeaLabel) initialIdeaLabel.textContent = 'React App Request:';
        if (initialIdeaInput) initialIdeaInput.placeholder = 'E.g., "A simple to-do list app with local storage persistence", "A weather dashboard using OpenWeatherMap API"...';
        if (generateButtonText) generateButtonText.textContent = 'Generate React App';
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
                else if (i < totalSteps - 1) { // Iterations from 3 up to (but not including) the last one are loops
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
        document.querySelectorAll('#pipelines-content-container > .pipeline-content').forEach(pane => pane.classList.remove('active'));
        // Activate the correct one
        const tabButton = document.getElementById(`math-tab-${idToActivate}`);
        const contentPane = document.getElementById(`pipeline-content-${idToActivate}`);
        if (tabButton) tabButton.classList.add('active');
        if (contentPane) contentPane.classList.add('active');

        if (idToActivate === 'strategic-solver' && activeMathPipeline.initialStrategies.length > 0) {
            activateStrategyTab(activeMathPipeline.activeStrategyTab ?? 0);
        }

    } else if (currentMode === 'react' && activeReactPipeline) {
        activeReactPipeline.activeTabId = idToActivate as string;
        document.querySelectorAll('#tabs-nav-container .tab-button.react-mode-tab').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('#pipelines-content-container > .pipeline-content').forEach(pane => pane.classList.remove('active'));

        const tabButton = document.getElementById(`react-tab-${idToActivate}`);
        const contentPane = document.getElementById(`pipeline-content-${idToActivate}`);
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
        pipelineContentDiv.innerHTML = `
            <ul class="iterations-list" id="iterations-list-${pipeline.id}">
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

function renderMarkdown(content: string | undefined): string {
    if (typeof content !== 'string') return '';
    // Use DOMPurify to prevent XSS attacks after rendering markdown.
    // marked.parse is synchronous since the highlighter is synchronous.
    return DOMPurify.sanitize(marked.parse(content));
}

function renderIteration(pipelineId: number, iter: IterationData): string {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    if (!pipeline) return '';

    let displayStatusText: string = iter.status.charAt(0).toUpperCase() + iter.status.slice(1);
    if (iter.status === 'retrying' && iter.retryAttempt !== undefined) {
        displayStatusText = `Retrying (${iter.retryAttempt}/${MAX_RETRIES})...`;
    } else if (iter.status === 'error') displayStatusText = 'Error';
    else if (iter.status === 'cancelled') displayStatusText = 'Cancelled';

    let promptsContent = '';
    if (currentMode === 'website') {
        if (iter.requestPromptHtml_InitialGenerate) promptsContent += `<h6 class="prompt-title">Initial HTML Generation Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptHtml_InitialGenerate)}</div>`;
        if (iter.requestPromptHtml_FeatureImplement) promptsContent += `<h6 class="prompt-title">Feature Implementation & Stabilization Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptHtml_FeatureImplement)}</div>`;
        if (iter.requestPromptHtml_BugFix) promptsContent += `<h6 class="prompt-title">HTML Bug Fix/Polish & Completion Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptHtml_BugFix)}</div>`;
        if (iter.requestPromptFeatures_Suggest) promptsContent += `<h6 class="prompt-title">Feature Suggestion Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptFeatures_Suggest)}</div>`;
    } else if (currentMode === 'creative') {
        if (iter.requestPromptText_GenerateDraft) promptsContent += `<h6 class="prompt-title">Draft Generation Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptText_GenerateDraft)}</div>`;
        if (iter.requestPromptText_Critique) promptsContent += `<h6 class="prompt-title">Critique Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptText_Critique)}</div>`;
        if (iter.requestPromptText_Revise) promptsContent += `<h6 class="prompt-title">Revision Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptText_Revise)}</div>`;
        if (iter.requestPromptText_Polish) promptsContent += `<h6 class="prompt-title">Polish Prompt:</h6><div class="markdown-content">${renderMarkdown(iter.requestPromptText_Polish)}</div>`;
    } else if (currentMode === 'agent') {
        if (iter.agentJudgeLLM_InitialRequest) promptsContent += `<h6 class="prompt-title">Judge LLM - Initial Request to Design Prompts:</h6><div class="markdown-content">${renderMarkdown(iter.agentJudgeLLM_InitialRequest)}</div>`;
        if (iter.agentGeneratedPrompts && iter.iterationNumber === 0) {
            promptsContent += `<h6 class="prompt-title">Judge LLM - Generated Prompt Design:</h6><pre>${escapeHtml(JSON.stringify(iter.agentGeneratedPrompts, null, 2))}</pre>`;
        }
        if (iter.requestPrompt_SysInstruction) promptsContent += `<h6 class="prompt-title">System Instruction (Main Step):</h6><div class="markdown-content">${renderMarkdown(iter.requestPrompt_SysInstruction)}</div>`;
        if (iter.requestPrompt_UserTemplate) promptsContent += `<h6 class="prompt-title">User Prompt Template (Main Step):</h6><div class="markdown-content">${renderMarkdown(iter.requestPrompt_UserTemplate)}</div>`;
        if (iter.requestPrompt_Rendered) promptsContent += `<h6 class="prompt-title">Rendered User Prompt (Main Step - Sent to API):</h6><div class="markdown-content">${renderMarkdown(iter.requestPrompt_Rendered)}</div>`;

        if (iter.requestPrompt_SubStep_SysInstruction) promptsContent += `<hr class="sub-divider"><h6 class="prompt-title">System Instruction (Loop Sub-Step - Refine/Suggest):</h6><div class="markdown-content">${renderMarkdown(iter.requestPrompt_SubStep_SysInstruction)}</div>`;
        if (iter.requestPrompt_SubStep_UserTemplate) promptsContent += `<h6 class="prompt-title">User Prompt Template (Loop Sub-Step - Refine/Suggest):</h6><div class="markdown-content">${renderMarkdown(iter.requestPrompt_SubStep_UserTemplate)}</div>`;
        if (iter.requestPrompt_SubStep_Rendered) promptsContent += `<h6 class="prompt-title">Rendered User Prompt (Loop Sub-Step - Refine/Suggest - Sent to API):</h6><div class="markdown-content">${renderMarkdown(iter.requestPrompt_SubStep_Rendered)}</div>`;
    }
    const promptsHtml = promptsContent ? `
        <details class="model-detail-section collapsible-section">
            <summary class="model-section-title">Prompts Used</summary>
            <div class="scrollable-content-area custom-scrollbar">${promptsContent}</div>
        </details>
    ` : '';

    let generatedOutputHtml = '';
    const outputContentType = (currentMode === 'agent' && iter.agentGeneratedPrompts) ? iter.agentGeneratedPrompts.expected_output_content_type :
        (currentMode === 'agent' && pipelinesState.find(p => p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts) ? pipelinesState.find(p => p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts?.expected_output_content_type : 'text';


    if (currentMode === 'website') {
        if (iter.generatedHtml || ['completed', 'error', 'retrying', 'processing', 'pending', 'cancelled'].includes(iter.status)) {
            const hasContent = !!iter.generatedHtml && !isEmptyOrPlaceholderHtml(iter.generatedHtml);
            let htmlContent;
            if (hasContent) {
                const contentToRender = `\`\`\`html\n${iter.generatedHtml!}\n\`\`\``;
                htmlContent = renderMarkdown(contentToRender);
            } else {
                htmlContent = `<div class="empty-state-message">${getEmptyStateMessage(iter.status, 'HTML')}</div>`;
            }

            generatedOutputHtml = `
                <div class="model-detail-section">
                    <div class="code-block-header">
                        <span class="model-section-title">Generated HTML</span>
                        <div class="code-actions">
                             <button class="compare-output-button button" data-pipeline-id="${pipelineId}" data-iteration-number="${iter.iterationNumber}" data-content-type="html" type="button" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">compare_arrows</span><span class="button-text">Compare</span></button>
                             <button id="copy-html-${pipelineId}-${iter.iterationNumber}" class="button" type="button" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">content_copy</span><span class="button-text">Copy</span></button>
                             <button id="download-html-${pipelineId}-${iter.iterationNumber}" class="button" type="button" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">download</span><span class="button-text">Download</span></button>
                        </div>
                    </div>
                    <div class="code-block-wrapper scrollable-content-area custom-scrollbar">${htmlContent}</div>
                </div>`;
        }
    } else if (currentMode === 'creative' || currentMode === 'agent') {
        let mainContentToDisplay = iter.generatedOrRevisedText; // Creative
        let mainContentLabel = "Generated/Revised Text";
        let subStepHtml = '';
        const agentContentType = (currentMode === 'agent' && iter.agentGeneratedPrompts) ? iter.agentGeneratedPrompts.expected_output_content_type :
            (currentMode === 'agent' && pipelinesState.find(p => p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts) ? pipelinesState.find(p => p.id === pipelineId)?.iterations[0]?.agentGeneratedPrompts?.expected_output_content_type : 'markdown';


        if (currentMode === 'agent') {
            mainContentToDisplay = iter.generatedMainContent;
            if (iter.iterationNumber === 0 && iter.agentGeneratedPrompts) {
                mainContentToDisplay = "Dynamically designed prompts from Judge LLM are shown in the 'Prompts' section. No direct content output for this setup step.";
                mainContentLabel = "Setup Information";
            } else if (iter.generatedSubStep_Content && iter.iterationNumber > 2 && iter.iterationNumber < TOTAL_STEPS_AGENT - 1) {
                let subStepContentToRender = iter.generatedSubStep_Content || '';
                if (agentContentType !== 'markdown' && agentContentType !== 'text/markdown' && agentContentType !== 'text' && agentContentType !== 'text/plain') {
                    subStepContentToRender = `\`\`\`${agentContentType}\n${iter.generatedSubStep_Content}\n\`\`\``;
                }
                subStepHtml = `<div class="model-detail-section">
                     <div class="code-block-header">
                         <span class="model-section-title">Content After Suggestion Implementation (Sub-Step)</span>
                     </div>
                     <div class="code-block-wrapper scrollable-content-area custom-scrollbar"><div id="agent-substep-content-${pipelineId}-${iter.iterationNumber}" class="markdown-content">${renderMarkdown(subStepContentToRender)}</div></div>
                 </div>`;
                mainContentLabel = "Refined Content After Suggestions";
            } else if (iter.iterationNumber === 1) { mainContentLabel = "Initial Generated Content"; }
            else if (iter.iterationNumber === 2) { mainContentLabel = "Refined Content (After Initial Suggestions)"; }
            else if (iter.iterationNumber === TOTAL_STEPS_AGENT - 1) { mainContentLabel = "Final Polished Content"; }
            else { mainContentLabel = "Generated/Refined Output"; }
        }

        if (mainContentToDisplay || ['completed', 'error', 'retrying', 'processing', 'pending', 'cancelled'].includes(iter.status)) {
            const hasContent = !!mainContentToDisplay && !(currentMode === 'agent' && iter.iterationNumber === 0);
            let contentBlock;
            if (hasContent) {
                let contentToRender = mainContentToDisplay!;
                if (currentMode === 'agent' && agentContentType !== 'markdown' && agentContentType !== 'text/markdown' && agentContentType !== 'text' && agentContentType !== 'text/plain') {
                    contentToRender = `\`\`\`${agentContentType}\n${mainContentToDisplay}\n\`\`\``;
                }
                contentBlock = `<div id="text-block-${pipelineId}-${iter.iterationNumber}" class="markdown-content">${renderMarkdown(contentToRender)}</div>`;
            } else {
                contentBlock = `<div class="empty-state-message">${getEmptyStateMessage(iter.status, 'output')}</div>`;
            }

            generatedOutputHtml += `
                ${subStepHtml}
                <div class="model-detail-section">
                    <div class="code-block-header">
                        <span class="model-section-title">${mainContentLabel}</span>
                        <div class="code-actions">
                            <button class="compare-output-button button" data-pipeline-id="${pipelineId}" data-iteration-number="${iter.iterationNumber}" data-content-type="text" type="button" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">compare_arrows</span><span class="button-text">Compare</span></button>
                            <button id="copy-text-${pipelineId}-${iter.iterationNumber}" class="button" type="button" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">content_copy</span><span class="button-text">Copy</span></button>
                            <button id="download-text-${pipelineId}-${iter.iterationNumber}" class="button" type="button" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">download</span><span class="button-text">Download</span></button>
                        </div>
                    </div>
                    <div class="code-block-wrapper scrollable-content-area custom-scrollbar">${contentBlock}</div>
                </div>`;
        }
    }

    let suggestionsHtml = '';
    const suggestionsToDisplay = currentMode === 'agent' ? iter.generatedSuggestions : iter.suggestedFeatures;
    const critiqueToDisplay = iter.critiqueSuggestions;

    if ((currentMode === 'website' || currentMode === 'agent') && suggestionsToDisplay && suggestionsToDisplay.length > 0) {
        const title = currentMode === 'website' ? "Suggested Next Steps" : "Suggested Next Steps";
        suggestionsHtml = `<div class="model-detail-section">
            <h5 class="model-section-title">${title}</h5>
            <ul class="suggestion-list">${suggestionsToDisplay.map(f => `<li><p>${escapeHtml(f)}</p></li>`).join('')}</ul>
        </div>`;
    } else if (currentMode === 'creative' && critiqueToDisplay && critiqueToDisplay.length > 0) {
        suggestionsHtml = `<div class="model-detail-section">
            <h5 class="model-section-title">Critique & Suggestions</h5>
            <ul class="suggestion-list">${critiqueToDisplay.map(s => `<li><p>${escapeHtml(s)}</p></li>`).join('')}</ul>
        </div>`;
    }

    let previewHtml = '';
    if (currentMode === 'website') {
        const isEmptyGenHtml = isEmptyOrPlaceholderHtml(iter.generatedHtml);
        const previewContainerId = `preview-container-${pipelineId}-${iter.iterationNumber}`;
        const fullscreenButtonId = `fullscreen-btn-${pipelineId}-${iter.iterationNumber}`;
        const hasContentForPreview = iter.generatedHtml && !isEmptyGenHtml;
        let previewContent;
        if (hasContentForPreview) {
            const iframeSandboxOptions = "allow-scripts allow-same-origin allow-forms allow-popups";
            previewContent = `<iframe id="preview-iframe-${pipelineId}-${iter.iterationNumber}" srcdoc="${escapeHtml(iter.generatedHtml!)}" sandbox="${iframeSandboxOptions}" title="HTML Preview for Iteration ${iter.iterationNumber} of Pipeline ${pipelineId + 1}"></iframe>`;
        } else {
            const noPreviewMessage = getEmptyStateMessage(iter.status, 'HTML preview');
            previewContent = `<div class="empty-state-message">${noPreviewMessage}</div>`;
        }

        previewHtml = `
        <div class="model-detail-section preview-section">
            <div class="model-section-header">
                <h5 class="model-section-title">Live Preview</h5>
                <button id="${fullscreenButtonId}" class="button button-icon" type="button" ${!hasContentForPreview ? 'disabled' : ''} title="Toggle Fullscreen Preview" aria-label="Toggle Fullscreen Preview">
                    <span class="icon-fullscreen material-symbols-outlined">fullscreen</span>
                    <span class="icon-exit-fullscreen material-symbols-outlined" style="display:none;">fullscreen_exit</span>
                </button>
            </div>
            <div id="${previewContainerId}" class="html-preview-container">${previewContent}</div>
        </div>`;
    }

    const gridLayoutClass = currentMode === 'website' ? 'iteration-grid-website' : 'iteration-grid-standard';

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
        <div class="iteration-details ${gridLayoutClass}">
            <div class="info-column">
                ${iter.error ? `<div class="status-message error"><pre>${escapeHtml(iter.error)}</pre></div>` : ''}
                ${generatedOutputHtml}
                ${suggestionsHtml}
                ${currentMode === 'website' || (typeof outputContentType === 'string' && outputContentType.toLowerCase().includes('html')) ? '' : promptsHtml}
            </div>
            ${previewHtml ? `<div class="preview-column">${previewHtml}</div>` : ''}
        </div>
    </li>`;
}

async function copyToClipboard(text: string, buttonElement: HTMLButtonElement) {
    if (buttonElement.disabled) return;

    const buttonTextElement = buttonElement.querySelector<HTMLSpanElement>('.button-text');
    if (!buttonTextElement) {
        console.error("Button is missing required '.button-text' span for status updates.", buttonElement);
        return;
    }

    const originalText = buttonTextElement.textContent;
    buttonElement.disabled = true;

    try {
        await navigator.clipboard.writeText(text);
        buttonTextElement.textContent = 'Copied!';
        buttonElement.classList.add('copied');
        setTimeout(() => {
            buttonTextElement.textContent = originalText;
            buttonElement.classList.remove('copied');
            buttonElement.disabled = false;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
        buttonTextElement.textContent = 'Copy Failed';
        buttonElement.classList.add('copy-failed');
        setTimeout(() => {
            buttonTextElement.textContent = originalText;
            buttonElement.classList.remove('copy-failed');
            buttonElement.disabled = false;
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
            const textEl = pipeline.stopButtonElement.querySelector('.button-text');
            if (textEl) textEl.textContent = 'Stop';
            pipeline.stopButtonElement.disabled = false;
        } else if (status === 'stopping') {
            pipeline.stopButtonElement.style.display = 'inline-flex';
            const textEl = pipeline.stopButtonElement.querySelector('.button-text');
            if (textEl) textEl.textContent = 'Stopping...';
            pipeline.stopButtonElement.disabled = true;
        } else {
            pipeline.stopButtonElement.style.display = 'none';
            const textEl = pipeline.stopButtonElement.querySelector('.button-text');
            if (textEl) textEl.textContent = 'Stop';
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
                console.warn(`cleanHtmlOutput: HTML document started but '</html>' tag was missing. Returning potentially truncated document starting with '${potentialDoc.substring(0, 30)}...'.`);
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

// ---------- HTML PATCHING (Website mode) ----------

type HtmlPatchOperation = {
    operation: 'replace' | 'insert_after' | 'insert_before' | 'delete';
    search_block: string;
    replace_with?: string;
    new_content?: string;
};

function escapeRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleWhitespaceRegex(block: string): RegExp {
    // Escape regex chars, then normalize any run of whitespace in the block to match any whitespace run in the source
    const escaped = escapeRegExp(block).replace(/\s+/g, '\\s+');
    // Use multiline to make ^ and $ behave per line where relevant; avoid global to ensure single replacement
    return new RegExp(escaped, 'm');
}

function countOccurrences(haystack: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while (true) {
        idx = haystack.indexOf(needle, idx);
        if (idx === -1) break;
        count++;
        idx += Math.max(1, needle.length);
    }
    return count;
}

function replaceOnceExact(haystack: string, needle: string, replacement: string): { result: string, applied: boolean, multiple: boolean } {
    const occurrences = countOccurrences(haystack, needle);
    if (occurrences === 0) return { result: haystack, applied: false, multiple: false };
    const idx = haystack.indexOf(needle);
    const result = haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
    return { result, applied: true, multiple: occurrences > 1 };
}

function applyPatches(currentHtml: string, patches: HtmlPatchOperation[]): string {
    let modifiedHtml = currentHtml ?? '';
    if (!Array.isArray(patches) || patches.length === 0) return modifiedHtml;

    for (const rawPatch of patches) {
        if (!rawPatch || typeof rawPatch !== 'object') {
            console.warn('applyPatches: Skipping invalid patch (not an object):', rawPatch);
            continue;
        }

        const op = String((rawPatch as any).operation || '').toLowerCase() as HtmlPatchOperation['operation'];
        const searchBlock = (rawPatch as any).search_block ?? '';
        const replaceWith = (rawPatch as any).replace_with ?? '';
        const newContent = (rawPatch as any).new_content ?? '';

        if (!op || !searchBlock || typeof searchBlock !== 'string') {
            console.warn('applyPatches: Skipping patch with missing/invalid operation or search_block:', rawPatch);
            continue;
        }

        try {
            if (op === 'replace') {
                // Try exact once
                let { result, applied, multiple } = replaceOnceExact(modifiedHtml, searchBlock, replaceWith);
                if (!applied) {
                    // Fallback to flexible whitespace matching
                    const regex = buildFlexibleWhitespaceRegex(searchBlock);
                    if (regex.test(modifiedHtml)) {
                        result = modifiedHtml.replace(regex, replaceWith);
                        applied = true;
                        // We cannot easily detect multiplicity with non-global regex; good enough to warn for exact case only
                    }
                }
                if (!applied) {
                    console.warn('applyPatches: replace - search_block not found. Patch skipped. block (first 120 chars):', searchBlock.substring(0, 120));
                } else if (multiple) {
                    console.warn('applyPatches: replace - multiple matches found. Only first occurrence was replaced. block (first 120 chars):', searchBlock.substring(0, 120));
                }
                modifiedHtml = result;
            } else if (op === 'insert_after') {
                // Exact: insert after the matched block (first occurrence)
                let { result, applied, multiple } = replaceOnceExact(modifiedHtml, searchBlock, searchBlock + newContent);
                if (!applied) {
                    const regex = buildFlexibleWhitespaceRegex(searchBlock);
                    if (regex.test(modifiedHtml)) {
                        result = modifiedHtml.replace(regex, (m) => m + newContent);
                        applied = true;
                    }
                }
                if (!applied) {
                    console.warn('applyPatches: insert_after - search_block not found. Patch skipped. block (first 120 chars):', searchBlock.substring(0, 120));
                } else if (multiple) {
                    console.warn('applyPatches: insert_after - multiple matches found. Only first occurrence was used. block (first 120 chars):', searchBlock.substring(0, 120));
                }
                modifiedHtml = result;
            } else if (op === 'insert_before') {
                // Exact: insert before the matched block (first occurrence)
                let { result, applied, multiple } = replaceOnceExact(modifiedHtml, searchBlock, newContent + searchBlock);
                if (!applied) {
                    const regex = buildFlexibleWhitespaceRegex(searchBlock);
                    if (regex.test(modifiedHtml)) {
                        result = modifiedHtml.replace(regex, (m) => newContent + m);
                        applied = true;
                    }
                }
                if (!applied) {
                    console.warn('applyPatches: insert_before - search_block not found. Patch skipped. block (first 120 chars):', searchBlock.substring(0, 120));
                } else if (multiple) {
                    console.warn('applyPatches: insert_before - multiple matches found. Only first occurrence was used. block (first 120 chars):', searchBlock.substring(0, 120));
                }
                modifiedHtml = result;
            } else if (op === 'delete') {
                // Exact delete
                let { result, applied, multiple } = replaceOnceExact(modifiedHtml, searchBlock, '');
                if (!applied) {
                    const regex = buildFlexibleWhitespaceRegex(searchBlock);
                    if (regex.test(modifiedHtml)) {
                        result = modifiedHtml.replace(regex, '');
                        applied = true;
                    }
                }
                if (!applied) {
                    console.warn('applyPatches: delete - search_block not found. Patch skipped. block (first 120 chars):', searchBlock.substring(0, 120));
                } else if (multiple) {
                    console.warn('applyPatches: delete - multiple matches found. Only first occurrence was deleted. block (first 120 chars):', searchBlock.substring(0, 120));
                }
                modifiedHtml = result;
            } else {
                console.warn('applyPatches: Unsupported operation. Skipping.', op, rawPatch);
            }
        } catch (e) {
            console.warn('applyPatches: Error applying patch. Skipping this patch.', e, rawPatch);
        }
    }
    return modifiedHtml;
}

function parseHtmlPatchesFromJson(rawJsonString: string): HtmlPatchOperation[] | null {
    const cleaned = cleanOutputByType(rawJsonString, 'json');
    try {
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) return null;
        const normalized: HtmlPatchOperation[] = [];
        for (const item of parsed) {
            if (!item || typeof item !== 'object') continue;
            const op = String((item as any).operation || '').toLowerCase();
            const searchBlock = (item as any).search_block;
            const replaceWith = (item as any).replace_with;
            const newContent = (item as any).new_content;
            if (!op || typeof searchBlock !== 'string') continue;
            if (op === 'replace' && typeof replaceWith !== 'string') continue;
            if ((op === 'insert_after' || op === 'insert_before') && typeof newContent !== 'string') continue;
            if (op !== 'replace' && op !== 'insert_after' && op !== 'insert_before' && op !== 'delete') continue;
            normalized.push({ operation: op as any, search_block: searchBlock, replace_with: replaceWith, new_content: newContent });
        }
        return normalized;
    } catch (e) {
        console.warn('parseHtmlPatchesFromJson: Failed to parse JSON patches. Raw (first 300 chars):', rawJsonString.substring(0, 300), e);
        return null;
    }
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
                if (Array.isArray(parsed[key]) && parsed[key].every((s: any) => typeof s === 'string')) {
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
        console.warn(`parseJsonSuggestions: Parsed JSON for ${suggestionKey} is not in the expected format or empty. Attempting string fallback from original content. Parsed object:`, parsed, "Cleaned string for parsing:", cleanedJsonString, "Original string (first 300 chars):", rawJsonString.substring(0, 300));
        if (suggestionKey === 'features') return generateFallbackFeaturesFromString(rawJsonString);
        if (suggestionKey === 'strategies' || suggestionKey === 'sub_strategies') return generateFallbackMathStrategies(rawJsonString, expectedCount);
        return generateFallbackCritiqueFromString(rawJsonString, expectedCount);

    } catch (e) {
        console.error(`parseJsonSuggestions: Failed to parse JSON for ${suggestionKey}:`, e, "Cleaned string for parsing:", cleanedJsonString, "Original string (first 300 chars):", rawJsonString.substring(0, 300));
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
        iteration.generatedRawHtml = undefined; // Clear raw HTML output
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
                    iteration.generatedRawHtml = rawHtmlAfterGenOrImpl; // Store raw output from Request 1

                    const userPromptInitialBugFix = renderPrompt(customPromptsWebsiteState.user_initialBugFix, { initialIdea: initialRequest, rawHtml: rawHtmlAfterGenOrImpl || placeholderRawHtml });
                    iteration.requestPromptHtml_BugFix = userPromptInitialBugFix;
                    {
                        const bugfixResponse = await makeApiCall(userPromptInitialBugFix, customPromptsWebsiteState.sys_initialBugFix, true, "Initial HTML Bug Fix (JSON Patches)");
                        const patches = parseHtmlPatchesFromJson(bugfixResponse);
                        if (patches && patches.length > 0) {
                            const patched = applyPatches(rawHtmlAfterGenOrImpl || "", patches);
                            iteration.generatedHtml = cleanHtmlOutput(patched);
                        } else {
                            // Fallback: treat response as full HTML if JSON invalid or empty
                            const fallbackHtml = cleanOutputByType(bugfixResponse, 'html');
                            iteration.generatedHtml = fallbackHtml && fallbackHtml.length > 0 ? cleanHtmlOutput(fallbackHtml) : (rawHtmlAfterGenOrImpl || "");
                        }
                    }
                    currentHtmlContent = iteration.generatedHtml || "";

                    const userPromptInitialFeatures = renderPrompt(customPromptsWebsiteState.user_initialFeatureSuggest, { initialIdea: initialRequest, currentHtml: currentHtmlContent || placeholderCurrentHtml });
                    iteration.requestPromptFeatures_Suggest = userPromptInitialFeatures;
                    // Always use Gemini-2.5-Flash for feature suggestions
                    const featuresJsonString = await callGemini(userPromptInitialFeatures, pipeline.temperature, "gemini-2.5-flash", customPromptsWebsiteState.sys_initialFeatureSuggest, true).then(response => response.text);
                    iteration.suggestedFeatures = parseJsonSuggestions(featuresJsonString, 'features', 2);
                    currentSuggestions = iteration.suggestedFeatures;
                } else if (i <= numMainRefinementLoops) {
                    const featuresToImplementStr = currentSuggestions.join('; ');
                    const userPromptRefineImplement = renderPrompt(customPromptsWebsiteState.user_refineStabilizeImplement, { currentHtml: currentHtmlContent || placeholderRawHtml, featuresToImplementStr });
                    iteration.requestPromptHtml_FeatureImplement = userPromptRefineImplement;
                    rawHtmlAfterGenOrImpl = cleanHtmlOutput(await makeApiCall(userPromptRefineImplement, customPromptsWebsiteState.sys_refineStabilizeImplement, false, `Stabilization & Feature Impl (Iter ${i})`));
                    iteration.generatedRawHtml = rawHtmlAfterGenOrImpl; // Store raw output from Request 1

                    const userPromptRefineBugFix = renderPrompt(customPromptsWebsiteState.user_refineBugFix, { rawHtml: rawHtmlAfterGenOrImpl || placeholderRawHtml });
                    iteration.requestPromptHtml_BugFix = userPromptRefineBugFix;
                    {
                        const bugfixResponse = await makeApiCall(userPromptRefineBugFix, customPromptsWebsiteState.sys_refineBugFix, true, `Bug Fix & Completion (Iter ${i}) - JSON Patches`);
                        const patches = parseHtmlPatchesFromJson(bugfixResponse);
                        if (patches && patches.length > 0) {
                            const patched = applyPatches(rawHtmlAfterGenOrImpl || "", patches);
                            iteration.generatedHtml = cleanHtmlOutput(patched);
                        } else {
                            // Fallback: treat response as full HTML if JSON invalid or empty
                            const fallbackHtml = cleanOutputByType(bugfixResponse, 'html');
                            iteration.generatedHtml = fallbackHtml && fallbackHtml.length > 0 ? cleanHtmlOutput(fallbackHtml) : (rawHtmlAfterGenOrImpl || "");
                        }
                    }
                    currentHtmlContent = iteration.generatedHtml || "";

                    const userPromptRefineFeatures = renderPrompt(customPromptsWebsiteState.user_refineFeatureSuggest, { initialIdea: initialRequest, currentHtml: currentHtmlContent || placeholderCurrentHtml });
                    iteration.requestPromptFeatures_Suggest = userPromptRefineFeatures;
                    // Always use Gemini-2.5-Flash for feature suggestions
                    const featuresJsonString = await callGemini(userPromptRefineFeatures, pipeline.temperature, "gemini-2.5-flash", customPromptsWebsiteState.sys_refineFeatureSuggest, true).then(response => response.text);
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
                        console.error("Failed to parse Judge LLM response:", e, "Cleaned response for parsing:", cleanOutputByType(judgeLlmResponseString, 'json'), "Raw response (first 500 chars):", judgeLlmResponseString.substring(0, 500));
                        throw new Error(`Failed to parse or validate prompt design from Judge LLM: ${e.message}. Ensure Judge LLM provides all required fields. Raw response (truncated): ${judgeLlmResponseString.substring(0, 500)}`);
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
                            iteration.generatedSuggestions = Array.isArray(parsedRefine.suggestions) ? parsedRefine.suggestions.slice(0, 2) : generateFallbackFeaturesFromString(''); // Default to 2 suggestions
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
                        const rawImplementedContent = await makeApiCall(iteration.requestPrompt_Rendered, iteration.requestPrompt_SysInstruction, false, `Agent Loop ${i - 2} - Implement`);
                        const implementedContent = cleanOutputByType(rawImplementedContent, outputType);
                        iteration.generatedSubStep_Content = implementedContent;

                        // Sub-Step B: Refine Implemented & Suggest Next
                        iteration.requestPrompt_SubStep_SysInstruction = agentGeneratedPrompts.refinement_and_suggestion.system_instruction; // Re-use
                        iteration.requestPrompt_SubStep_UserTemplate = agentGeneratedPrompts.refinement_and_suggestion.user_prompt_template; // Re-use
                        iteration.requestPrompt_SubStep_Rendered = renderPrompt(iteration.requestPrompt_SubStep_UserTemplate, { initialRequest, currentContent: implementedContent || placeholderContent });
                        const refineSuggestLoopJsonResponseString = await makeApiCall(iteration.requestPrompt_SubStep_Rendered, iteration.requestPrompt_SubStep_SysInstruction, true, `Agent Loop ${i - 2} - Refine & Suggest`);
                        const refineSuggestLoopJson = cleanOutputByType(refineSuggestLoopJsonResponseString, 'json');
                        try {
                            const parsedRefineLoop = JSON.parse(refineSuggestLoopJson);
                            iteration.generatedMainContent = cleanOutputByType(parsedRefineLoop.refined_content || "", outputType);
                            iteration.generatedSuggestions = Array.isArray(parsedRefineLoop.suggestions) ? parsedRefineLoop.suggestions.slice(0, 2) : generateFallbackFeaturesFromString('');
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
    const fileMarkerRegex = /^\/\/\s*---\s*FILE:\s*(.*?)\s*---\s*$/m;
    const files: { path: string, content: string }[] = [];

    // Split the code by the file marker. This is a robust way to parse the aggregated string.
    const parts = finalCode.split(fileMarkerRegex);

    if (parts.length > 1) {
        // The first part is any text before the first marker. We start from the first captured path.
        // We iterate in pairs: path (at odd indices), then content (at even indices).
        for (let i = 1; i < parts.length; i += 2) {
            const path = parts[i].trim();
            const content = (parts[i + 1] || '').trim(); // Get the content for this path.
            if (path && content) { // Ensure both path and content are not empty
                files.push({ path, content });
            }
        }
    }


    if (files.length === 0 && finalCode.length > 0) {
        // Fallback for cases where no markers are present in the output.
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
        hypotheses: [],
        status: 'processing',
        isStopRequested: false,
        activeTabId: 'problem-details',
        activeStrategyTab: 0,
        strategicSolverComplete: false,
        hypothesisExplorerComplete: false,
        knowledgePacket: ''
    };
    renderActiveMathPipeline();

    const currentProcess = activeMathPipeline;

    const makeMathApiCall = async (
        parts: Part[],
        systemInstruction: string,
        isJson: boolean,
        stepDescription: string,
        targetStatusField: MathMainStrategyData | MathSubStrategyData | MathPipelineState | MathHypothesisData,
        retryAttemptField: 'retryAttempt' | 'selfImprovementRetryAttempt' | 'proverRetryAttempt' | 'disproverRetryAttempt' | 'hypothesisGenRetryAttempt'
    ): Promise<string> => {
        if (!currentProcess || currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${stepDescription}`);
        let responseText = "";

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested during retry for: ${stepDescription}`);

            targetStatusField[retryAttemptField] = attempt;

            // Set appropriate status based on the field type
            if ('selfImprovementStatus' in targetStatusField && retryAttemptField === 'selfImprovementRetryAttempt') {
                targetStatusField.selfImprovementStatus = attempt > 0 ? 'retrying' : 'processing';
            } else if ('proverStatus' in targetStatusField && retryAttemptField === 'proverRetryAttempt') {
                targetStatusField.proverStatus = attempt > 0 ? 'retrying' : 'processing';
            } else if ('disproverStatus' in targetStatusField && retryAttemptField === 'disproverRetryAttempt') {
                targetStatusField.disproverStatus = attempt > 0 ? 'retrying' : 'processing';
            } else if ('hypothesisGenStatus' in targetStatusField && retryAttemptField === 'hypothesisGenRetryAttempt') {
                targetStatusField.hypothesisGenStatus = attempt > 0 ? 'retrying' : 'processing';
            } else {
                targetStatusField.status = attempt > 0 ? 'retrying' : 'processing';
            }

            renderActiveMathPipeline();

            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt)));

            try {
                const apiResponse = await callGemini(parts, MATH_FIXED_TEMPERATURE, MATH_MODEL_NAME, systemInstruction, isJson);
                responseText = apiResponse.text;

                // Reset status to processing after successful call
                if ('selfImprovementStatus' in targetStatusField && retryAttemptField === 'selfImprovementRetryAttempt') {
                    targetStatusField.selfImprovementStatus = 'processing';
                } else if ('proverStatus' in targetStatusField && retryAttemptField === 'proverRetryAttempt') {
                    targetStatusField.proverStatus = 'processing';
                } else if ('disproverStatus' in targetStatusField && retryAttemptField === 'disproverRetryAttempt') {
                    targetStatusField.disproverStatus = 'processing';
                } else if ('hypothesisGenStatus' in targetStatusField && retryAttemptField === 'hypothesisGenRetryAttempt') {
                    targetStatusField.hypothesisGenStatus = 'processing';
                } else {
                    targetStatusField.status = 'processing';
                }

                renderActiveMathPipeline();
                return responseText;
            } catch (e: any) {
                console.warn(`Math Solver (${stepDescription}), Attempt ${attempt + 1} failed: ${e.message}`);

                // Set appropriate error field
                if ('selfImprovementError' in targetStatusField && retryAttemptField === 'selfImprovementRetryAttempt') {
                    targetStatusField.selfImprovementError = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
                } else if ('proverError' in targetStatusField && retryAttemptField === 'proverRetryAttempt') {
                    targetStatusField.proverError = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
                } else if ('disproverError' in targetStatusField && retryAttemptField === 'disproverRetryAttempt') {
                    targetStatusField.disproverError = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
                } else if ('hypothesisGenError' in targetStatusField && retryAttemptField === 'hypothesisGenRetryAttempt') {
                    targetStatusField.hypothesisGenError = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
                } else {
                    targetStatusField.error = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
                }

                renderActiveMathPipeline();
                if (attempt === MAX_RETRIES) {
                    if ('selfImprovementError' in targetStatusField && retryAttemptField === 'selfImprovementRetryAttempt') {
                        targetStatusField.selfImprovementError = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                    } else if ('proverError' in targetStatusField && retryAttemptField === 'proverRetryAttempt') {
                        targetStatusField.proverError = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                    } else if ('disproverError' in targetStatusField && retryAttemptField === 'disproverRetryAttempt') {
                        targetStatusField.disproverError = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                    } else if ('hypothesisGenError' in targetStatusField && retryAttemptField === 'hypothesisGenRetryAttempt') {
                        targetStatusField.hypothesisGenError = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                    } else {
                        targetStatusField.error = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                    }
                    throw e;
                }
            }
        }
        throw new Error(`API call for ${stepDescription} failed all retries.`);
    };

    try {
        // Phase 1: Parallel Generation (The "Race")
        // Track A (Strategic Solver) and Track B (Hypothesis Explorer) begin simultaneously

        const trackAPromise = (async () => {
            // Track A: Strategic Solver
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
            renderActiveMathPipeline();

            if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped after initial strategies.");

            // Generate sub-strategies for each main strategy
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
                        selfImprovementStatus: 'pending'
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

            currentProcess.strategicSolverComplete = true;
            renderActiveMathPipeline();
        })();

        const trackBPromise = (async () => {
            // Track B: Hypothesis Explorer
            const hypothesisUserPrompt = renderPrompt(customPromptsMathState.user_math_hypothesisGeneration, { originalProblemText: problemText });
            const hypothesisPromptParts: Part[] = [{ text: hypothesisUserPrompt }];
            if (imageBase64 && imageMimeType) {
                hypothesisPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
            }
            currentProcess.requestPromptHypothesisGen = hypothesisUserPrompt + (imageBase64 ? "\n[Image Provided]" : "");

            currentProcess.hypothesisGenStatus = 'processing';
            renderActiveMathPipeline();

            const hypothesesJsonString = await makeMathApiCall(
                hypothesisPromptParts,
                customPromptsMathState.sys_math_hypothesisGeneration,
                true,
                "Hypothesis Generation",
                currentProcess,
                'hypothesisGenRetryAttempt'
            );

            const parsedHypotheses = parseJsonSuggestions(hypothesesJsonString, 'hypotheses', 3);
            currentProcess.hypotheses = parsedHypotheses.map((hypText, i) => ({
                id: `hyp${i}`,
                hypothesisText: hypText,
                proverStatus: 'pending',
                disproverStatus: 'pending',
                finalStatus: 'pending',
                isDetailsOpen: true
            }));
            currentProcess.hypothesisGenStatus = 'completed';
            renderActiveMathPipeline();

            if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped after hypothesis generation.");

            // Parallel Proof & Refutation for each hypothesis
            await Promise.allSettled(currentProcess.hypotheses.map(async (hypothesis) => {
                if (currentProcess.isStopRequested) {
                    hypothesis.proverStatus = 'cancelled';
                    hypothesis.disproverStatus = 'cancelled';
                    hypothesis.finalStatus = 'pending';
                    return;
                }

                // Run prover and disprover in parallel
                const proverPromise = (async () => {
                    try {
                        const proverUserPrompt = renderPrompt(customPromptsMathState.user_math_prover, {
                            originalProblemText: problemText,
                            hypothesis: hypothesis.hypothesisText
                        });
                        const proverPromptParts: Part[] = [{ text: proverUserPrompt }];
                        if (imageBase64 && imageMimeType) {
                            proverPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
                        }
                        hypothesis.proverRequestPrompt = proverUserPrompt + (imageBase64 ? "\n[Image Provided]" : "");

                        const proverResponse = await makeMathApiCall(
                            proverPromptParts,
                            customPromptsMathState.sys_math_prover,
                            false,
                            `Prover for ${hypothesis.id}`,
                            hypothesis,
                            'proverRetryAttempt'
                        );
                        hypothesis.proverAttempt = cleanTextOutput(proverResponse);
                        hypothesis.proverStatus = 'completed';
                    } catch (e: any) {
                        hypothesis.proverStatus = 'error';
                        if (!hypothesis.proverError) hypothesis.proverError = e.message || "Failed to run prover.";
                        console.error(`Error in prover for ${hypothesis.id}:`, e);
                    }
                })();

                const disproverPromise = (async () => {
                    try {
                        const disproverUserPrompt = renderPrompt(customPromptsMathState.user_math_disprover, {
                            originalProblemText: problemText,
                            hypothesis: hypothesis.hypothesisText
                        });
                        const disproverPromptParts: Part[] = [{ text: disproverUserPrompt }];
                        if (imageBase64 && imageMimeType) {
                            disproverPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
                        }
                        hypothesis.disproverRequestPrompt = disproverUserPrompt + (imageBase64 ? "\n[Image Provided]" : "");

                        const disproverResponse = await makeMathApiCall(
                            disproverPromptParts,
                            customPromptsMathState.sys_math_disprover,
                            false,
                            `Disprover for ${hypothesis.id}`,
                            hypothesis,
                            'disproverRetryAttempt'
                        );
                        hypothesis.disproverAttempt = cleanTextOutput(disproverResponse);
                        hypothesis.disproverStatus = 'completed';
                    } catch (e: any) {
                        hypothesis.disproverStatus = 'error';
                        if (!hypothesis.disproverError) hypothesis.disproverError = e.message || "Failed to run disprover.";
                        console.error(`Error in disprover for ${hypothesis.id}:`, e);
                    }
                })();

                await Promise.allSettled([proverPromise, disproverPromise]);

                // Determine final status based on prover/disprover outcomes
                if (hypothesis.proverStatus === 'completed' && hypothesis.disproverStatus === 'completed') {
                    // Both completed - need to analyze results
                    const proverSuccessful = hypothesis.proverAttempt && !hypothesis.proverAttempt.toLowerCase().includes('cannot') && !hypothesis.proverAttempt.toLowerCase().includes('unable to prove');
                    const disproverSuccessful = hypothesis.disproverAttempt && (hypothesis.disproverAttempt.toLowerCase().includes('counterexample') || hypothesis.disproverAttempt.toLowerCase().includes('false'));

                    if (proverSuccessful && disproverSuccessful) {
                        hypothesis.finalStatus = 'contradiction';
                    } else if (proverSuccessful && !disproverSuccessful) {
                        hypothesis.finalStatus = 'proven';
                    } else if (!proverSuccessful && disproverSuccessful) {
                        hypothesis.finalStatus = 'refuted';
                    } else {
                        hypothesis.finalStatus = 'unresolved';
                    }
                } else if (hypothesis.proverStatus === 'completed' && hypothesis.disproverStatus === 'error') {
                    const proverSuccessful = hypothesis.proverAttempt && !hypothesis.proverAttempt.toLowerCase().includes('cannot') && !hypothesis.proverAttempt.toLowerCase().includes('unable to prove');
                    hypothesis.finalStatus = proverSuccessful ? 'proven' : 'unresolved';
                } else if (hypothesis.proverStatus === 'error' && hypothesis.disproverStatus === 'completed') {
                    const disproverSuccessful = hypothesis.disproverAttempt && (hypothesis.disproverAttempt.toLowerCase().includes('counterexample') || hypothesis.disproverAttempt.toLowerCase().includes('false'));
                    hypothesis.finalStatus = disproverSuccessful ? 'refuted' : 'unresolved';
                } else {
                    hypothesis.finalStatus = 'unresolved';
                }

                renderActiveMathPipeline();
            }));

            currentProcess.hypothesisExplorerComplete = true;
            renderActiveMathPipeline();
        })();

        // Phase 2: Synchronization Point (The "Rendezvous")
        await Promise.allSettled([trackAPromise, trackBPromise]);

        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during parallel processing.");

        // Phase 3: Knowledge Packet Synthesis
        currentProcess.knowledgePacket = synthesizeKnowledgePacket(currentProcess.hypotheses);
        renderActiveMathPipeline();

        // Phase 4: Informed Solution & Refinement
        // Now that both tracks are complete and knowledge packet is synthesized,
        // proceed with solution attempts using the knowledge packet

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
                            currentSubStrategy: subStrategy.subStrategyText,
                            knowledgePacket: currentProcess.knowledgePacket || "No hypothesis exploration results available."
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

                        // Now perform self-improvement and refinement
                        if (currentProcess.isStopRequested) return;

                        subStrategy.selfImprovementStatus = 'processing';
                        renderActiveMathPipeline();

                        const selfImprovementUserPrompt = renderPrompt(customPromptsMathState.user_math_selfImprovement, {
                            originalProblemText: problemText,
                            currentSubStrategy: subStrategy.subStrategyText,
                            solutionAttempt: subStrategy.solutionAttempt,
                            knowledgePacket: currentProcess.knowledgePacket || "No hypothesis exploration results available."
                        });
                        const selfImprovementPromptParts: Part[] = [{ text: selfImprovementUserPrompt }];
                        if (imageBase64 && imageMimeType) {
                            selfImprovementPromptParts.unshift({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
                        }
                        subStrategy.requestPromptSelfImprovement = selfImprovementUserPrompt + (imageBase64 ? "\n[Image Provided]" : "");

                        const rawRefinedSolution = await makeMathApiCall(
                            selfImprovementPromptParts,
                            customPromptsMathState.sys_math_selfImprovement,
                            false,
                            `Self-Improvement for MS ${mainIndex + 1}, Sub ${subIndex + 1}`,
                            subStrategy,
                            'selfImprovementRetryAttempt'
                        );
                        subStrategy.refinedSolution = cleanTextOutput(rawRefinedSolution);
                        subStrategy.selfImprovementStatus = 'completed';

                    } catch (e: any) {
                        if (subStrategy.selfImprovementStatus === 'processing') {
                            subStrategy.selfImprovementStatus = 'error';
                            if (!subStrategy.selfImprovementError) subStrategy.selfImprovementError = e.message || "Failed to perform self-improvement.";
                        } else {
                            subStrategy.status = 'error';
                            if (!subStrategy.error) subStrategy.error = e.message || "Failed to attempt solution for this sub-strategy.";
                        }
                        console.error(`Error in solution/refinement for MS ${mainIndex + 1}, Sub ${subIndex + 1}:`, e);
                    } finally {
                        renderActiveMathPipeline();
                    }
                })());
            });
        });
        await Promise.allSettled(solutionPromises);

        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during solution attempts.");

        // --- Judging Phase 1: Intra-Strategy (using refined solutions) ---
        const intraStrategyJudgingPromises = currentProcess.initialStrategies.map(async (mainStrategy, mainIndex) => {
            if (currentProcess.isStopRequested) {
                mainStrategy.judgingStatus = 'cancelled';
                return;
            }
            mainStrategy.judgingStatus = 'processing';
            renderActiveMathPipeline();

            // Use refined solutions instead of original solution attempts
            const completedSolutions = mainStrategy.subStrategies
                .filter(ss => ss.selfImprovementStatus === 'completed' && ss.refinedSolution)
                .map(ss => ({ id: ss.id, solution: ss.refinedSolution! }));

            if (completedSolutions.length === 0) {
                mainStrategy.judgingStatus = 'completed'; // Completed with no result
                mainStrategy.judgingError = 'No valid refined solutions from sub-strategies to judge.';
                renderActiveMathPipeline();
                return;
            }

            const sysPromptJudge = `You are 'Mathesis Veritas', an AI Grandmaster of Mathematical Verification and Elegance. Your sole purpose is to analyze multiple proposed solutions to a mathematical problem, identify the most correct, rigorous, and elegant solution, and present it with a clear, step-by-step justification. Your output must be a JSON object.`;
            const solutionsText = completedSolutions.map((s, i) => `--- REFINED SOLUTION ${i + 1} (ID: ${s.id}) ---\n${s.solution}`).join('\n\n');
            const userPromptJudge = `Original Problem: ${problemText}\n\nMain Strategy Being Evaluated: "${mainStrategy.strategyText}"\n\nBelow are ${completedSolutions.length} refined and self-improved solutions derived from this main strategy. Your task is:\n1.  Critically analyze each solution for correctness, rigor, clarity, and elegance.\n2.  Identify the single BEST solution that most effectively and correctly solves the problem according to the main strategy.\n3.  Present your final judgment as a JSON object with the following structure: \`{"best_solution_id": "ID of the winning solution", "best_solution_text": "The full text of the winning solution, potentially corrected or clarified by you for perfection.", "reasoning": "A detailed, step-by-step explanation of why this solution is superior to the others."}\`\n\nRefined Solutions:\n${solutionsText}`;
            mainStrategy.judgingRequestPrompt = userPromptJudge;

            try {
                const judgingResponseText = await makeMathJudgingApiCall(
                    currentProcess,
                    [{ text: userPromptJudge }],
                    sysPromptJudge,
                    true,
                    `Judging for Main Strategy ${mainIndex + 1}`,
                    mainStrategy,
                    'intra-strategy'
                );
                mainStrategy.judgingResponseText = judgingResponseText;
                const cleanedJson = cleanOutputByType(judgingResponseText, 'json');
                const parsed = JSON.parse(cleanedJson);

                if (!parsed.best_solution_id || !parsed.best_solution_text || !parsed.reasoning) {
                    throw new Error("Judge LLM response is missing critical fields (best_solution_id, best_solution_text, reasoning).");
                }

                mainStrategy.judgedBestSubStrategyId = parsed.best_solution_id;
                const subStrategyOrigin = mainStrategy.subStrategies.find(s => s.id === parsed.best_solution_id);
                const subStrategyTitle = subStrategyOrigin ? `from Sub-Strategy originating from "${subStrategyOrigin.subStrategyText.substring(0, 50)}..."` : `from Sub-Strategy ${parsed.best_solution_id}`;
                mainStrategy.judgedBestSolution = `### Judged Best Solution for Strategy ${mainIndex + 1}\n\n**Origin:** ${subStrategyTitle}\n\n**Reasoning for Selection:**\n${parsed.reasoning}\n\n---\n\n**Final Solution Text:**\n${parsed.best_solution_text}`;
                mainStrategy.judgingStatus = 'completed';

            } catch (e: any) {
                mainStrategy.judgingStatus = 'error';
                mainStrategy.judgingError = e.message || 'Failed to judge solutions.';
                console.error(`Error judging for MS ${mainIndex + 1}:`, e);
            } finally {
                renderActiveMathPipeline();
            }
        });

        await Promise.allSettled(intraStrategyJudgingPromises);
        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during intra-strategy judging.");

        // --- Judging Phase 2: Final Verdict ---
        currentProcess.finalJudgingStatus = 'processing';
        renderActiveMathPipeline();

        const judgedSolutions = currentProcess.initialStrategies
            .filter(ms => ms.judgingStatus === 'completed' && ms.judgedBestSolution)
            .map(ms => ({ id: ms.id, solution: ms.judgedBestSolution! }));

        if (judgedSolutions.length === 0) {
            currentProcess.finalJudgingStatus = 'error';
            currentProcess.finalJudgingError = "No successfully judged solutions available for final review.";
        } else {
            const sysPromptFinalJudge = `You are 'Mathesis Ultima', the ultimate arbiter of mathematical truth and beauty. You review final candidate solutions from different strategic approaches and select the single most superior solution overall, presenting it with unparalleled clarity and authority. Your output must be a JSON object.`;
            const finalSolutionsText = judgedSolutions.map((s, i) => `--- CANDIDATE SOLUTION ${i + 1} (from Main Strategy ID: ${s.id}) ---\n${s.solution}`).join('\n\n');
            const userPromptFinalJudge = `Original Problem: ${problemText}\n\nBelow are ${judgedSolutions.length} final candidate solutions, each being the winner from a different overarching strategic approach. Your task is to select the SINGLE OVERALL BEST solution based on correctness, efficiency, elegance, and clarity.\n\nPresent your final verdict as a JSON object with the following structure: \`{"best_strategy_id": "ID of the winning main strategy", "final_solution_text": "The full text of the absolute best solution, polished to perfection.", "final_reasoning": "A detailed justification for why this solution and its underlying strategy are superior to all other candidates."}\`\n\nFinal Candidate Solutions:\n${finalSolutionsText}`;

            currentProcess.finalJudgingRequestPrompt = userPromptFinalJudge;

            try {
                const finalJudgingResponseText = await makeMathJudgingApiCall(
                    currentProcess,
                    [{ text: userPromptFinalJudge }],
                    sysPromptFinalJudge,
                    true,
                    'Final Judging',
                    currentProcess,
                    'final'
                );
                currentProcess.finalJudgingResponseText = finalJudgingResponseText;
                const cleanedJson = cleanOutputByType(finalJudgingResponseText, 'json');
                const parsed = JSON.parse(cleanedJson);

                if (!parsed.best_strategy_id || !parsed.final_solution_text || !parsed.final_reasoning) {
                    throw new Error("Final Judge LLM response is missing critical fields (best_strategy_id, final_solution_text, final_reasoning).");
                }

                currentProcess.finalJudgedBestStrategyId = parsed.best_strategy_id;
                const strategyOrigin = currentProcess.initialStrategies.find(s => s.id === parsed.best_strategy_id);
                const strategyTitle = strategyOrigin ? `from Strategy originating from "${strategyOrigin.strategyText.substring(0, 60)}..."` : `from Strategy ${parsed.best_strategy_id}`;

                currentProcess.finalJudgedBestSolution = `### Final Judged Best Solution\n\n**Origin:** ${strategyTitle}\n\n**Final Reasoning:**\n${parsed.final_reasoning}\n\n---\n\n**Definitive Solution:**\n${parsed.final_solution_text}`;
                currentProcess.finalJudgingStatus = 'completed';

            } catch (e: any) {
                currentProcess.finalJudgingStatus = 'error';
                currentProcess.finalJudgingError = e.message || "Failed to perform final judging.";
                console.error(`Error in final judging:`, e);
            }
        }

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

// Helper function to synthesize knowledge packet from hypothesis exploration results
function synthesizeKnowledgePacket(hypotheses: MathHypothesisData[]): string {
    if (!hypotheses || hypotheses.length === 0) {
        return "No hypothesis exploration results available.";
    }

    let knowledgePacket = "";

    hypotheses.forEach((hypothesis, index) => {
        const statusText = hypothesis.finalStatus.toUpperCase();
        let guidance = "";

        switch (hypothesis.finalStatus) {
            case 'proven':
                guidance = "You may use this as an established fact without proof.";
                break;
            case 'refuted':
                guidance = "A counterexample was found. Do NOT assume this statement is true. Avoid reasoning paths that require it.";
                break;
            case 'unresolved':
                guidance = "This remains an open question. If your solution relies on this, you must explicitly state it as a conditional assumption.";
                break;
            case 'contradiction':
                guidance = "Both proof and counterexample attempts were made, indicating potential logical inconsistency. Treat with extreme caution.";
                break;
            default:
                guidance = "Status unclear. Proceed with caution.";
        }

        knowledgePacket += `[${statusText}] Hypothesis ${index + 1}: ${hypothesis.hypothesisText}\n`;
        knowledgePacket += `- GUIDANCE: ${guidance}\n`;

        if (hypothesis.proverAttempt && hypothesis.finalStatus === 'proven') {
            knowledgePacket += `- PROOF SUMMARY: ${hypothesis.proverAttempt.substring(0, 200)}${hypothesis.proverAttempt.length > 200 ? '...' : ''}\n`;
        }

        if (hypothesis.disproverAttempt && hypothesis.finalStatus === 'refuted') {
            knowledgePacket += `- COUNTEREXAMPLE: ${hypothesis.disproverAttempt.substring(0, 200)}${hypothesis.disproverAttempt.length > 200 ? '...' : ''}\n`;
        }

        knowledgePacket += "\n";
    });

    return knowledgePacket;
}

// Helper function for math judging API calls (similar to makeMathApiCall but specialized for judging)
async function makeMathJudgingApiCall(
    currentProcess: MathPipelineState,
    parts: Part[],
    systemInstruction: string,
    isJson: boolean,
    stepDescription: string,
    targetStatusField: MathMainStrategyData | MathPipelineState,
    judgingType: 'intra-strategy' | 'final'
): Promise<string> {
    if (!currentProcess || currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${stepDescription}`);
    let responseText = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested during retry for: ${stepDescription}`);

        // Set retry attempt and status based on judging type
        if (judgingType === 'intra-strategy' && 'judgingRetryAttempt' in targetStatusField) {
            targetStatusField.judgingRetryAttempt = attempt;
            targetStatusField.judgingStatus = attempt > 0 ? 'retrying' : 'processing';
        } else if (judgingType === 'final' && 'finalJudgingRetryAttempt' in targetStatusField) {
            targetStatusField.finalJudgingRetryAttempt = attempt;
            targetStatusField.finalJudgingStatus = attempt > 0 ? 'retrying' : 'processing';
        }

        renderActiveMathPipeline();

        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt)));

        try {
            const apiResponse = await callGemini(parts, MATH_FIXED_TEMPERATURE, MATH_MODEL_NAME, systemInstruction, isJson);
            responseText = apiResponse.text;

            // Reset status to processing after successful call
            if (judgingType === 'intra-strategy' && 'judgingStatus' in targetStatusField) {
                targetStatusField.judgingStatus = 'processing';
            } else if (judgingType === 'final' && 'finalJudgingStatus' in targetStatusField) {
                targetStatusField.finalJudgingStatus = 'processing';
            }

            renderActiveMathPipeline();
            return responseText;
        } catch (e: any) {
            console.warn(`Math Solver (${stepDescription}), Attempt ${attempt + 1} failed: ${e.message}`);

            // Set appropriate error field
            if (judgingType === 'intra-strategy' && 'judgingError' in targetStatusField) {
                targetStatusField.judgingError = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
            } else if (judgingType === 'final' && 'finalJudgingError' in targetStatusField) {
                targetStatusField.finalJudgingError = `Attempt ${attempt + 1} for ${stepDescription} failed: ${e.message || 'Unknown API error'}`;
            }

            renderActiveMathPipeline();
            if (attempt === MAX_RETRIES) {
                if (judgingType === 'intra-strategy' && 'judgingError' in targetStatusField) {
                    targetStatusField.judgingError = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                } else if (judgingType === 'final' && 'finalJudgingError' in targetStatusField) {
                    targetStatusField.finalJudgingError = `Failed ${stepDescription} after ${MAX_RETRIES + 1} attempts: ${e.message || 'Unknown API error'}`;
                }
                throw e;
            }
        }
    }
    throw new Error(`API call for ${stepDescription} failed all retries.`);
}

function openSolutionModal(subStrategyId: string) {
    const subStrategy = activeMathPipeline?.initialStrategies.flatMap(ms => ms.subStrategies).find(ss => ss.id === subStrategyId);
    if (!subStrategy) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'solution-modal-overlay';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.style.display = 'flex';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.setAttribute('role', 'dialog');
    modalContent.setAttribute('aria-modal', 'true');
    modalContent.setAttribute('aria-labelledby', 'solution-modal-title');

    const modalHeader = document.createElement('header');
    modalHeader.className = 'modal-header';

    const modalTitle = document.createElement('h2');
    modalTitle.id = 'solution-modal-title';
    modalTitle.className = 'modal-title';
    modalTitle.textContent = 'Solution Details';
    modalHeader.appendChild(modalTitle);

    const closeModalButton = document.createElement('button');
    closeModalButton.className = 'modal-close-button';
    closeModalButton.setAttribute('aria-label', 'Close Solution Modal');
    closeModalButton.innerHTML = '<span class="material-symbols-outlined">close</span>';
    closeModalButton.addEventListener('click', closeSolutionModal);
    modalHeader.appendChild(closeModalButton);

    modalContent.appendChild(modalHeader);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';

    const solutionModalLayout = document.createElement('div');
    solutionModalLayout.className = 'solution-modal-layout';

    // Navigation panel (left side)
    const solutionNav = document.createElement('nav');
    solutionNav.className = 'solution-nav custom-scrollbar';
    
    const navTitle = document.createElement('div');
    navTitle.className = 'solution-nav-title';
    navTitle.textContent = 'Solution Components';
    solutionNav.appendChild(navTitle);

    const navItems = [
        { id: 'side-by-side', text: 'Side by Side View', icon: 'view_column' },
        { id: 'diff-view', text: 'Diff Analysis', icon: 'difference' }
    ];

    navItems.forEach((item, index) => {
        const navItem = document.createElement('div');
        navItem.className = 'solution-nav-item';
        if (index === 0) navItem.classList.add('active');
        navItem.dataset.target = item.id;
        
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = item.icon;
        navItem.appendChild(icon);
        
        const text = document.createElement('span');
        text.textContent = item.text;
        navItem.appendChild(text);
        
        navItem.addEventListener('click', () => activateSolutionTab(item.id));
        solutionNav.appendChild(navItem);
    });

    solutionModalLayout.appendChild(solutionNav);

    // Content panel (right side)
    const solutionContent = document.createElement('div');
    solutionContent.className = 'solution-content custom-scrollbar';

    // Side by Side Panel (Default View)
    const sideBySidePanel = document.createElement('div');
    sideBySidePanel.className = 'solution-content-pane active';
    sideBySidePanel.id = 'side-by-side';
    
    const sideBySideTitle = document.createElement('h3');
    sideBySideTitle.className = 'solution-pane-title';
    sideBySideTitle.innerHTML = '<span class="material-symbols-outlined">view_column</span>Solution Comparison';
    sideBySidePanel.appendChild(sideBySideTitle);
    
    const solutionComparison = document.createElement('div');
    solutionComparison.className = 'solution-comparison-grid';
    
    const leftPanel = document.createElement('div');
    leftPanel.className = 'comparison-panel';
    const leftHeader = document.createElement('h4');
    leftHeader.className = 'comparison-panel-title';
    leftHeader.innerHTML = '<span class="material-symbols-outlined">psychology</span>Attempted Solution';
    leftPanel.appendChild(leftHeader);
    const leftContent = document.createElement('div');
    leftContent.className = 'comparison-content custom-scrollbar';
    leftContent.innerHTML = renderMarkdown(subStrategy.solutionAttempt || 'Solution attempt not available');
    leftPanel.appendChild(leftContent);
    
    const rightPanel = document.createElement('div');
    rightPanel.className = 'comparison-panel';
    const rightHeader = document.createElement('h4');
    rightHeader.className = 'comparison-panel-title';
    rightHeader.innerHTML = '<span class="material-symbols-outlined">auto_fix_high</span>Refined Solution';
    rightPanel.appendChild(rightHeader);
    const rightContent = document.createElement('div');
    rightContent.className = 'comparison-content custom-scrollbar';
    rightContent.innerHTML = renderMarkdown(subStrategy.refinedSolution || 'Refined solution not available');
    rightPanel.appendChild(rightContent);
    
    solutionComparison.appendChild(leftPanel);
    solutionComparison.appendChild(rightPanel);
    sideBySidePanel.appendChild(solutionComparison);

    // Diff Analysis Panel (Full Screen Diff)
    const diffPanel = document.createElement('div');
    diffPanel.className = 'solution-content-pane';
    diffPanel.id = 'diff-view';
    
    const diffTitle = document.createElement('h3');
    diffTitle.className = 'solution-pane-title';
    diffTitle.innerHTML = '<span class="material-symbols-outlined">difference</span>Detailed Diff Analysis';
    diffPanel.appendChild(diffTitle);
    
    const diffCard = document.createElement('div');
    diffCard.className = 'solution-card diff-card-fullscreen';
    
    const diffCardHeader = document.createElement('div');
    diffCardHeader.className = 'solution-card-header';
    
    const diffCardTitle = document.createElement('span');
    diffCardTitle.className = 'solution-card-title';
    diffCardTitle.textContent = 'Line-by-Line Comparison';
    diffCardHeader.appendChild(diffCardTitle);
    
    const diffControls = document.createElement('div');
    diffControls.className = 'diff-controls';
    
    const generateDiffButton = document.createElement('button');
    generateDiffButton.className = 'button';
    generateDiffButton.innerHTML = '<span class="material-symbols-outlined">refresh</span><span class="button-text">Generate Diff</span>';
    diffControls.appendChild(generateDiffButton);
    
    const clearDiffButton = document.createElement('button');
    clearDiffButton.className = 'button';
    clearDiffButton.innerHTML = '<span class="material-symbols-outlined">clear</span><span class="button-text">Clear</span>';
    diffControls.appendChild(clearDiffButton);
    
    diffCardHeader.appendChild(diffControls);
    diffCard.appendChild(diffCardHeader);
    
    const diffCardBody = document.createElement('div');
    diffCardBody.className = 'solution-card-body';
    
    const diffOutput = document.createElement('div');
    diffOutput.className = 'diff-output-container-fullscreen custom-scrollbar';
    diffOutput.innerHTML = '<div class="empty-state-message">Click "Generate Diff" to see detailed line-by-line changes between the attempted and refined solutions</div>';
    diffCardBody.appendChild(diffOutput);
    diffCard.appendChild(diffCardBody);
    diffPanel.appendChild(diffCard);

    // Diff generation logic
    const generateDiff = () => {
        const diff = Diff.diffLines(subStrategy.solutionAttempt || '', subStrategy.refinedSolution || '');
        let diffHtml = '<div class="diff-view-fullscreen">';
        let lineNumber = 1;
        
        diff.forEach(part => {
            const lines = part.value.split('\n');
            lines.forEach((line, index) => {
                if (index === lines.length - 1 && line === '') return; // Skip empty last line
                
                const colorClass = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-neutral';
                const prefix = part.added ? '+' : part.removed ? '-' : ' ';
                
                diffHtml += `<div class="diff-line ${colorClass}">
                    <span class="diff-line-number">${lineNumber}</span>
                    <span class="diff-line-prefix">${prefix}</span>
                    <span class="diff-line-content">${escapeHtml(line)}</span>
                </div>`;
                
                if (!part.removed) lineNumber++;
            });
        });
        
        diffHtml += '</div>';
        diffOutput.innerHTML = diffHtml;
    };

    generateDiffButton.addEventListener('click', generateDiff);
    clearDiffButton.addEventListener('click', () => {
        diffOutput.innerHTML = '<div class="empty-state-message">Click "Generate Diff" to see detailed line-by-line changes between the attempted and refined solutions</div>';
    });

    solutionContent.appendChild(sideBySidePanel);
    solutionContent.appendChild(diffPanel);
    solutionModalLayout.appendChild(solutionContent);
    modalBody.appendChild(solutionModalLayout);
    modalContent.appendChild(modalBody);
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // Trigger the modal animation
    setTimeout(() => {
        modalOverlay.classList.add('is-visible');
    }, 10);
}

function activateSolutionTab(targetId: string) {
    // Update navigation
    const navItems = document.querySelectorAll('.solution-nav-item');
    navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.target === targetId);
    });

    // Update content panels
    const contentPanes = document.querySelectorAll('.solution-content-pane');
    contentPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === targetId);
    });
}

function closeSolutionModal() {
    const modalOverlay = document.getElementById('solution-modal-overlay');
    if (modalOverlay) {
        modalOverlay.remove();
    }
}

function openArgumentModal(hypothesisId: string) {
    const hypothesis = activeMathPipeline?.hypotheses.find(h => h.id === hypothesisId);
    if (!hypothesis) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'argument-modal-overlay';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.style.display = 'flex';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.setAttribute('role', 'dialog');
    modalContent.setAttribute('aria-modal', 'true');
    modalContent.setAttribute('aria-labelledby', 'argument-modal-title');

    const modalHeader = document.createElement('header');
    modalHeader.className = 'modal-header';

    const modalTitle = document.createElement('h2');
    modalTitle.id = 'argument-modal-title';
    modalTitle.className = 'modal-title';
    modalTitle.textContent = 'Hypothesis Argument Analysis';
    modalHeader.appendChild(modalTitle);

    const closeModalButton = document.createElement('button');
    closeModalButton.className = 'modal-close-button';
    closeModalButton.setAttribute('aria-label', 'Close Argument Modal');
    closeModalButton.innerHTML = '<span class="material-symbols-outlined">close</span>';
    closeModalButton.addEventListener('click', closeArgumentModal);
    modalHeader.appendChild(closeModalButton);

    modalContent.appendChild(modalHeader);

    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';

    const argumentModalLayout = document.createElement('div');
    argumentModalLayout.className = 'solution-modal-layout';

    // Navigation panel (left side) - no diff analysis for arguments
    const argumentNav = document.createElement('nav');
    argumentNav.className = 'solution-nav custom-scrollbar';
    
    const navTitle = document.createElement('div');
    navTitle.className = 'solution-nav-title';
    navTitle.textContent = 'Argument Components';
    argumentNav.appendChild(navTitle);

    const navItems = [
        { id: 'side-by-side-args', text: 'Side by Side View', icon: 'view_column' }
    ];

    navItems.forEach((item, index) => {
        const navItem = document.createElement('div');
        navItem.className = 'solution-nav-item';
        if (index === 0) navItem.classList.add('active');
        navItem.dataset.target = item.id;
        
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = item.icon;
        navItem.appendChild(icon);
        
        const text = document.createElement('span');
        text.textContent = item.text;
        navItem.appendChild(text);
        
        navItem.addEventListener('click', () => activateArgumentTab(item.id));
        argumentNav.appendChild(navItem);
    });

    argumentModalLayout.appendChild(argumentNav);

    // Content panel (right side)
    const argumentContent = document.createElement('div');
    argumentContent.className = 'solution-content custom-scrollbar';

    // Side by Side Panel (Default View)
    const sideBySidePanel = document.createElement('div');
    sideBySidePanel.className = 'solution-content-pane active';
    sideBySidePanel.id = 'side-by-side-args';
    
    const sideBySideTitle = document.createElement('h3');
    sideBySideTitle.className = 'solution-pane-title';
    sideBySideTitle.innerHTML = '<span class="material-symbols-outlined">view_column</span>Hypothesis Proving vs Testing';
    sideBySidePanel.appendChild(sideBySideTitle);
    
    const argumentComparison = document.createElement('div');
    argumentComparison.className = 'solution-comparison-grid';
    
    const leftPanel = document.createElement('div');
    leftPanel.className = 'comparison-panel';
    const leftHeader = document.createElement('h4');
    leftHeader.className = 'comparison-panel-title';
    leftHeader.innerHTML = '<span class="material-symbols-outlined">check_circle</span>Hypothesis Proving Agent';
    leftPanel.appendChild(leftHeader);
    const leftContent = document.createElement('div');
    leftContent.className = 'comparison-content custom-scrollbar';
    leftContent.innerHTML = renderMarkdown(hypothesis.proverAttempt || 'Prover attempt not available');
    leftPanel.appendChild(leftContent);
    
    const rightPanel = document.createElement('div');
    rightPanel.className = 'comparison-panel';
    const rightHeader = document.createElement('h4');
    rightHeader.className = 'comparison-panel-title';
    rightHeader.innerHTML = '<span class="material-symbols-outlined">science</span>Hypothesis Tester Agent';
    rightPanel.appendChild(rightHeader);
    const rightContent = document.createElement('div');
    rightContent.className = 'comparison-content custom-scrollbar';
    rightContent.innerHTML = renderMarkdown(hypothesis.disproverAttempt || 'Hypothesis tester attempt not available');
    rightPanel.appendChild(rightContent);
    
    argumentComparison.appendChild(leftPanel);
    argumentComparison.appendChild(rightPanel);
    sideBySidePanel.appendChild(argumentComparison);

    // Knowledge Packet Section
    const knowledgePacketSection = document.createElement('div');
    knowledgePacketSection.className = 'knowledge-packet-section';
    
    const knowledgePacketTitle = document.createElement('h4');
    knowledgePacketTitle.className = 'knowledge-packet-title';
    knowledgePacketTitle.innerHTML = '<span class="material-symbols-outlined">psychology</span>Synthesized Knowledge Packet';
    knowledgePacketSection.appendChild(knowledgePacketTitle);
    
    const knowledgePacketContent = document.createElement('div');
    knowledgePacketContent.className = 'knowledge-packet-content';
    
    // Get the status-based styling
    let statusClass = 'knowledge-status-pending';
    let statusIcon = 'help';
    let statusText = 'Pending Analysis';
    
    switch (hypothesis.finalStatus) {
        case 'proven':
            statusClass = 'knowledge-status-proven';
            statusIcon = 'verified';
            statusText = 'Hypothesis Proven';
            break;
        case 'refuted':
            statusClass = 'knowledge-status-refuted';
            statusIcon = 'dangerous';
            statusText = 'Hypothesis Refuted';
            break;
        case 'unresolved':
            statusClass = 'knowledge-status-unresolved';
            statusIcon = 'help';
            statusText = 'Unresolved';
            break;
        case 'contradiction':
            statusClass = 'knowledge-status-contradiction';
            statusIcon = 'warning';
            statusText = 'Contradiction Detected';
            break;
    }
    
    knowledgePacketContent.innerHTML = `
        <div class="knowledge-packet-card ${statusClass}">
            <div class="knowledge-packet-header">
                <span class="material-symbols-outlined">${statusIcon}</span>
                <span class="knowledge-packet-status">${statusText}</span>
            </div>
            <div class="knowledge-packet-hypothesis">
                <strong>Hypothesis:</strong> ${escapeHtml(hypothesis.hypothesisText)}
            </div>
            <div class="knowledge-packet-guidance">
                ${getHypothesisGuidance(hypothesis.finalStatus)}
            </div>
        </div>
    `;
    
    knowledgePacketSection.appendChild(knowledgePacketContent);
    sideBySidePanel.appendChild(knowledgePacketSection);

    argumentContent.appendChild(sideBySidePanel);
    argumentModalLayout.appendChild(argumentContent);
    modalBody.appendChild(argumentModalLayout);
    modalContent.appendChild(modalBody);
    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // Trigger the modal animation
    setTimeout(() => {
        modalOverlay.classList.add('is-visible');
    }, 10);
}

function activateArgumentTab(targetId: string) {
    // Update navigation
    const navItems = document.querySelectorAll('.solution-nav-item');
    navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.target === targetId);
    });

    // Update content panels
    const contentPanes = document.querySelectorAll('.solution-content-pane');
    contentPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === targetId);
    });
}

function closeArgumentModal() {
    const modalOverlay = document.getElementById('argument-modal-overlay');
    if (modalOverlay) {
        modalOverlay.remove();
    }
}

function getHypothesisGuidance(finalStatus: string): string {
    switch (finalStatus) {
        case 'proven':
            return '<div class="guidance-text guidance-proven"><strong>Guidance:</strong> You may use this as an established fact without proof.</div>';
        case 'refuted':
            return '<div class="guidance-text guidance-refuted"><strong>Guidance:</strong> A counterexample was found. Do NOT assume this statement is true. Avoid reasoning paths that require it.</div>';
        case 'unresolved':
            return '<div class="guidance-text guidance-unresolved"><strong>Guidance:</strong> This remains an open question. If your solution relies on this, you must explicitly state it as a conditional assumption.</div>';
        case 'contradiction':
            return '<div class="guidance-text guidance-contradiction"><strong>Guidance:</strong> Both proof and counterexample attempts were made, indicating potential logical inconsistency. Treat with extreme caution.</div>';
        default:
            return '<div class="guidance-text guidance-pending"><strong>Guidance:</strong> Status unclear. Proceed with caution.</div>';
    }
}

function parseKnowledgePacketForStyling(knowledgePacket: string, hypotheses: MathHypothesisData[]): string {
    if (!hypotheses || hypotheses.length === 0) {
        return '<div class="knowledge-packet-empty">No hypothesis exploration results available.</div>';
    }

    let styledPacketHtml = '';
    
    hypotheses.forEach((hypothesis, index) => {
        // Get the status-based styling
        let statusClass = 'knowledge-status-pending';
        let statusIcon = 'help';
        let statusText = 'Pending Analysis';
        
        switch (hypothesis.finalStatus) {
            case 'proven':
                statusClass = 'knowledge-status-proven';
                statusIcon = 'verified';
                statusText = 'Hypothesis Proven';
                break;
            case 'refuted':
                statusClass = 'knowledge-status-refuted';
                statusIcon = 'dangerous';
                statusText = 'Hypothesis Refuted';
                break;
            case 'unresolved':
                statusClass = 'knowledge-status-unresolved';
                statusIcon = 'help';
                statusText = 'Unresolved';
                break;
            case 'contradiction':
                statusClass = 'knowledge-status-contradiction';
                statusIcon = 'warning';
                statusText = 'Contradiction Detected';
                break;
        }
        
        styledPacketHtml += `
            <div class="knowledge-packet-card ${statusClass}">
                <div class="knowledge-packet-header">
                    <span class="material-symbols-outlined">${statusIcon}</span>
                    <span class="knowledge-packet-status">${statusText}</span>
                </div>
                <div class="knowledge-packet-hypothesis">
                    <strong>Hypothesis ${index + 1}:</strong> ${escapeHtml(hypothesis.hypothesisText)}
                </div>
                <div class="knowledge-packet-guidance">
                    ${getHypothesisGuidance(hypothesis.finalStatus)}
                </div>
            </div>
        `;
    });
    
    return styledPacketHtml;
}

function activateStrategyTab(strategyIndex: number) {
    if (!activeMathPipeline) return;
    activeMathPipeline.activeStrategyTab = strategyIndex;

    const subTabButtons = document.querySelectorAll('.sub-tab-button');
    subTabButtons.forEach((button, index) => {
        button.classList.toggle('active', index === strategyIndex);
    });

    const subTabContents = document.querySelectorAll('.sub-tab-content');
    subTabContents.forEach((content, index) => {
        content.classList.toggle('active', index === strategyIndex);
    });
}

function renderActiveMathPipeline() {
    if (currentMode !== 'math' || !pipelinesContentContainer || !tabsNavContainer) {
        if (currentMode !== 'math' && tabsNavContainer && pipelinesContentContainer) {
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

    // Main Tabs
    const mainTabs = [
        { id: 'problem-details', text: 'Problem Details' },
        { id: 'strategic-solver', text: 'Strategic Solver' },
        { id: 'hypothesis-explorer', text: 'Hypothesis Explorer' },
        { id: 'final-result', text: 'Final Result' }
    ];

    mainTabs.forEach(tabInfo => {
        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button math-mode-tab';
        tabButton.id = `math-tab-${tabInfo.id}`;
        tabButton.textContent = tabInfo.text;
        tabButton.setAttribute('role', 'tab');
        tabButton.setAttribute('aria-controls', `pipeline-content-${tabInfo.id}`);
        tabButton.addEventListener('click', () => activateTab(tabInfo.id));
        tabsNavContainer.appendChild(tabButton);

        if (tabInfo.id === 'strategic-solver') {
            if (mathProcess.strategicSolverComplete) {
                tabButton.classList.add('status-math-completed');
            } else if (mathProcess.status === 'processing') {
                tabButton.classList.add('status-math-processing');
            }
        } else if (tabInfo.id === 'hypothesis-explorer') {
            if (mathProcess.hypothesisExplorerComplete) {
                tabButton.classList.add('status-math-completed');
            } else if (mathProcess.status === 'processing') {
                tabButton.classList.add('status-math-processing');
            }
        } else if (tabInfo.id === 'final-result') {
            if (mathProcess.finalJudgingStatus === 'completed') {
                tabButton.classList.add('status-math-completed');
            } else if (mathProcess.finalJudgingStatus === 'processing' || mathProcess.finalJudgingStatus === 'retrying') {
                tabButton.classList.add('status-math-processing');
            } else if (mathProcess.finalJudgingStatus === 'error') {
                tabButton.classList.add('status-math-error');
            }
        }
    });

    // Problem Details Pane
    let problemContentPane = document.createElement('div');
    problemContentPane.id = `pipeline-content-problem-details`;
    problemContentPane.className = 'pipeline-content';
    problemContentPane.setAttribute('role', 'tabpanel');
    problemContentPane.setAttribute('aria-labelledby', `math-tab-problem-details`);
    let problemDetailsHtml = `
        <div class="math-problem-display model-detail-card">
            <h4 class="model-title">Original Problem</h4>
            <p class="problem-text">${escapeHtml(mathProcess.problemText)}</p>`;
    if (mathProcess.problemImageBase64 && mathProcess.problemImageMimeType) {
        problemDetailsHtml += `<img src="data:${mathProcess.problemImageMimeType};base64,${mathProcess.problemImageBase64}" alt="Uploaded Math Problem Image" class="problem-image-display">`;
    }
    if (mathProcess.requestPromptInitialStrategyGen) {
        problemDetailsHtml += `
            <details class="model-detail-section collapsible-section">
                <summary class="model-section-title">Initial Strategy Generation Prompt</summary>
                <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(mathProcess.requestPromptInitialStrategyGen)}</pre></div>
            </details>`;
    }
    if (mathProcess.status === 'retrying' && mathProcess.retryAttempt !== undefined && mathProcess.initialStrategies.length === 0) {
        problemDetailsHtml += `<p class="status-badge status-retrying">Retrying initial strategy generation (${mathProcess.retryAttempt}/${MAX_RETRIES})...</p>`;
    } else if (mathProcess.error && mathProcess.initialStrategies.length === 0) {
        problemDetailsHtml += `<div class="status-message error"><pre>${escapeHtml(mathProcess.error)}</pre></div>`;
    }
    problemDetailsHtml += `</div>`;
    problemContentPane.innerHTML = problemDetailsHtml;
    pipelinesContentContainer.appendChild(problemContentPane);

    // Strategic Solver Pane
    const strategicSolverContentPane = document.createElement('div');
    strategicSolverContentPane.id = `pipeline-content-strategic-solver`;
    strategicSolverContentPane.className = 'pipeline-content';
    strategicSolverContentPane.setAttribute('role', 'tabpanel');
    strategicSolverContentPane.setAttribute('aria-labelledby', `math-tab-strategic-solver`);
    
    const strategicSolverCard = document.createElement('div');
    strategicSolverCard.className = 'math-strategic-solver model-detail-card';

    const subTabsNav = document.createElement('div');
    subTabsNav.className = 'sub-tabs-nav';

    mathProcess.initialStrategies.forEach((_, index) => {
        const subTabButton = document.createElement('button');
        subTabButton.className = 'sub-tab-button';
        subTabButton.id = `sub-tab-strategy-${index}`;
        subTabButton.textContent = `Strategy ${index + 1}`;
        if (index === mathProcess.activeStrategyTab) {
            subTabButton.classList.add('active');
        }
        subTabButton.addEventListener('click', () => activateStrategyTab(index));
        subTabsNav.appendChild(subTabButton);
    });

    strategicSolverCard.appendChild(subTabsNav);

    mathProcess.initialStrategies.forEach((mainStrategy, index) => {
        const subTabContent = document.createElement('div');
        subTabContent.className = 'sub-tab-content';
        subTabContent.id = `sub-tab-content-strategy-${index}`;
        if (index === mathProcess.activeStrategyTab) {
            subTabContent.classList.add('active');
        }

        const strategyTitle = document.createElement('h5');
        strategyTitle.innerHTML = escapeHtml(mainStrategy.strategyText);
        subTabContent.appendChild(strategyTitle);

        const subStrategiesGrid = document.createElement('div');
        subStrategiesGrid.className = 'sub-strategies-grid';

        mainStrategy.subStrategies.forEach((subStrategy, subIndex) => {
            const subStrategyCard = document.createElement('div');
            subStrategyCard.className = 'sub-strategy-card';

            const subStrategyTitle = document.createElement('h6');
            subStrategyTitle.textContent = `Sub-Strategy ${index + 1}.${subIndex + 1}`;
            subStrategyCard.appendChild(subStrategyTitle);

            const subStrategyText = document.createElement('div');
            subStrategyText.className = 'markdown-content';
            subStrategyText.innerHTML = renderMarkdown(subStrategy.subStrategyText);
            subStrategyCard.appendChild(subStrategyText);

            const solutionButton = document.createElement('button');
            solutionButton.className = 'button';
            solutionButton.textContent = 'Solution';
            solutionButton.addEventListener('click', () => openSolutionModal(subStrategy.id));
            subStrategyCard.appendChild(solutionButton);

            subStrategiesGrid.appendChild(subStrategyCard);
        });

        subTabContent.appendChild(subStrategiesGrid);

        const bestJudgedSolution = document.createElement('div');
        bestJudgedSolution.className = 'best-judged-solution';

        const bestJudgedSolutionTitle = document.createElement('h6');
        bestJudgedSolutionTitle.textContent = `Best Judged Solution for Strategy ${index + 1}`;
        bestJudgedSolution.appendChild(bestJudgedSolutionTitle);

        const bestJudgedSolutionText = document.createElement('div');
        bestJudgedSolutionText.className = 'markdown-content';
        bestJudgedSolutionText.innerHTML = renderMarkdown(mainStrategy.judgedBestSolution || 'Not available');
        bestJudgedSolution.appendChild(bestJudgedSolutionText);

        subTabContent.appendChild(bestJudgedSolution);

        strategicSolverCard.appendChild(subTabContent);
    });

    strategicSolverContentPane.appendChild(strategicSolverCard);
    pipelinesContentContainer.appendChild(strategicSolverContentPane);

    // Hypothesis Explorer Pane
    const hypothesisExplorerContentPane = document.createElement('div');
    hypothesisExplorerContentPane.id = `pipeline-content-hypothesis-explorer`;
    hypothesisExplorerContentPane.className = 'pipeline-content';
    hypothesisExplorerContentPane.setAttribute('role', 'tabpanel');
    hypothesisExplorerContentPane.setAttribute('aria-labelledby', `math-tab-hypothesis-explorer`);
    let hypothesisExplorerHtml = `<div class="math-hypothesis-explorer model-detail-card">
        <h4 class="model-title">Hypothesis Explorer (Track B)</h4>
        <p class="track-description">Generates 3 hypotheses, then runs parallel Prover and Disprover agents for each.</p>`;
    if (mathProcess.hypothesisExplorerComplete) {
        hypothesisExplorerHtml += `<p class="status-badge status-completed">Hypothesis Explorer Complete</p>`;
    } else if (mathProcess.status === 'processing') {
        hypothesisExplorerHtml += `<p class="status-badge status-processing">Hypothesis Explorer In Progress</p>`;
    }
    if (mathProcess.hypotheses.length > 0) {
        hypothesisExplorerHtml += `<div class="hypotheses-grid">`;
        mathProcess.hypotheses.forEach((hypothesis, index) => {
            let statusClass = 'status-pending';
            let statusText = 'Pending';
            let glowClass = '';

            switch (hypothesis.finalStatus) {
                case 'proven':
                    statusClass = 'status-completed';
                    statusText = 'Proven';
                    glowClass = 'hypothesis-proven';
                    break;
                case 'refuted':
                    statusClass = 'status-error';
                    statusText = 'Refuted';
                    glowClass = 'hypothesis-refuted';
                    break;
                case 'unresolved':
                    statusClass = 'status-pending';
                    statusText = 'Unresolved';
                    break;
                case 'contradiction':
                    statusClass = 'status-error';
                    statusText = 'Contradiction';
                    glowClass = 'hypothesis-contradiction';
                    break;
                default:
                    if (hypothesis.proverStatus === 'processing' || hypothesis.disproverStatus === 'processing') {
                        statusClass = 'status-processing';
                        statusText = 'Processing';
                    }
            }

            hypothesisExplorerHtml += `<div class="hypothesis-card ${glowClass}">
                <h5>Hypothesis ${index + 1}</h5>
                <p class="hypothesis-text">${escapeHtml(hypothesis.hypothesisText)}</p>
                <div class="hypothesis-status">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="prover-disprover-status">
                    <div class="prover-status">
                        <span class="agent-label">Prover:</span>
                        <span class="status-badge ${hypothesis.proverStatus === 'completed' ? 'status-completed' : hypothesis.proverStatus === 'processing' ? 'status-processing' : hypothesis.proverStatus === 'error' ? 'status-error' : 'status-pending'}">${hypothesis.proverStatus}</span>
                    </div>
                    <div class="disprover-status">
                        <span class="agent-label">Disprover:</span>
                        <span class="status-badge ${hypothesis.disproverStatus === 'completed' ? 'status-completed' : hypothesis.disproverStatus === 'processing' ? 'status-processing' : hypothesis.disproverStatus === 'error' ? 'status-error' : 'status-pending'}">${hypothesis.disproverStatus}</span>
                    </div>
                </div>
                <button class="button view-argument-button" data-hypothesis-id="${hypothesis.id}">View The Argument</button>
            </div>`;
        });
        hypothesisExplorerHtml += `</div>`;
    }
    if (mathProcess.knowledgePacket) {
        // Parse the knowledge packet to create styled individual hypothesis cards
        const hypothesesFromPacket = parseKnowledgePacketForStyling(mathProcess.knowledgePacket, mathProcess.hypotheses);
        
        hypothesisExplorerHtml += `
            <div class="model-detail-section">
                <h5 class="model-section-title">Synthesized Knowledge Packet</h5>
                <div class="knowledge-packet-grid">
                    ${hypothesesFromPacket}
                </div>
            </div>`;
    }
    hypothesisExplorerHtml += `</div>`;
    hypothesisExplorerContentPane.innerHTML = hypothesisExplorerHtml;
    pipelinesContentContainer.appendChild(hypothesisExplorerContentPane);

    // Final Result Pane
    const finalResultContentPane = document.createElement('div');
    finalResultContentPane.id = `pipeline-content-final-result`;
    finalResultContentPane.className = 'pipeline-content';
    finalResultContentPane.setAttribute('role', 'tabpanel');
    finalResultContentPane.setAttribute('aria-labelledby', `math-tab-final-result`);
    let finalResultHtml = `<div class="math-final-result model-detail-card">
        <h4 class="model-title">Final Result</h4>
        <p class="track-description">The ultimate solution selected from all refined strategies.</p>`;
    if (mathProcess.finalJudgingStatus === 'completed' && mathProcess.finalJudgedBestSolution) {
        finalResultHtml += `<div class="final-solution-display">
            <div class="markdown-content">
                ${renderMarkdown(mathProcess.finalJudgedBestSolution)}
            </div>
        </div>`;
    } else if (mathProcess.finalJudgingStatus === 'processing' || mathProcess.finalJudgingStatus === 'retrying') {
        finalResultHtml += `<p class="status-badge status-processing">Final judging in progress...</p>`;
    } else if (mathProcess.finalJudgingStatus === 'error') {
        finalResultHtml += `<div class="status-message error">
            <p>Error during final judging:</p>
            <pre>${escapeHtml(mathProcess.finalJudgingError || 'Unknown error')}</pre>
        </div>`;
    } else if (mathProcess.status === 'completed') {
        finalResultHtml += `<p class="status-badge status-pending">Final result not available</p>`;
    } else {
        finalResultHtml += `<p class="status-badge status-pending">Waiting for solution completion...</p>`;
    }
    finalResultHtml += `</div>`;
    finalResultContentPane.innerHTML = finalResultHtml;
    pipelinesContentContainer.appendChild(finalResultContentPane);

    if (mathProcess.activeTabId) {
        activateTab(mathProcess.activeTabId);
    } else {
        activateTab('problem-details');
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
        activeTabId: 'orchestrator', // Default to orchestrator tab
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
                if (!activeReactPipeline.error) activeReactPipeline.error = error.message || "An unknown error occurred in React Orchestrator.";
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
            pipelinesContentContainer.innerHTML = '';
        }
        return;
    }

    if (!activeReactPipeline) {
        pipelinesContentContainer.innerHTML = '';
        return;
    }

    const pipeline = activeReactPipeline;

    tabsNavContainer.innerHTML = '';
    pipelinesContentContainer.innerHTML = '';

    // Orchestrator Tab
    const orchestratorTab = document.createElement('button');
    orchestratorTab.id = 'react-tab-orchestrator';
    orchestratorTab.className = 'tab-button react-mode-tab';
    orchestratorTab.textContent = 'Orchestrator';
    orchestratorTab.setAttribute('role', 'tab');
    orchestratorTab.setAttribute('aria-controls', 'pipeline-content-orchestrator');
    orchestratorTab.addEventListener('click', () => activateTab('orchestrator'));
    tabsNavContainer.appendChild(orchestratorTab);

    // Orchestrator Pane
    const orchestratorPane = document.createElement('div');
    orchestratorPane.id = 'pipeline-content-orchestrator';
    orchestratorPane.className = 'pipeline-content';
    let orchestratorHtml = `<div class="react-orchestrator-pane model-detail-card">
        <div class="model-detail-header">
             <div class="model-title-area">
                <h4 class="model-title">React App Orchestration</h4>
             </div>
             <div class="model-card-actions">
                <span class="status-badge status-${pipeline.status}" id="react-orchestrator-status-text">${pipeline.status.replace(/_/g, ' ')}</span>
                <button class="button" id="stop-react-pipeline-btn" title="Stop React App Generation" aria-label="Stop React App Generation" style="display: ${pipeline.status === 'orchestrating' || pipeline.status === 'processing_workers' ? 'inline-flex' : 'none'};">
                    <span class="material-symbols-outlined">stop_circle</span><span class="button-text">${pipeline.status === 'stopping' ? 'Stopping...' : 'Stop'}</span>
                </button>
            </div>
        </div>
        <div class="model-detail-section">
            <h5 class="model-section-title">User Request</h5>
            <p><strong>Request:</strong> ${escapeHtml(pipeline.userRequest)}</p>
        </div>`;
    if (pipeline.error && (pipeline.status === 'failed' || (pipeline.status === 'error' && pipeline.stages.every(s => s.status === 'pending')))) {
        orchestratorHtml += `<div class="status-message error"><pre>${escapeHtml(pipeline.error)}</pre></div>`;
    }
    if (pipeline.orchestratorPlan) {
        orchestratorHtml += `<details class="model-detail-section collapsible-section" open>
            <summary class="model-section-title">Orchestrator's Plan (plan.txt)</summary>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(pipeline.orchestratorPlan)}</pre></div>
        </details>`;
    }
    if (pipeline.orchestratorRawOutput) {
        orchestratorHtml += `<details class="model-detail-section collapsible-section">
            <summary class="model-section-title">Orchestrator Raw Output (Debug)</summary>
            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(pipeline.orchestratorRawOutput)}</pre></div>
        </details>`;
    }
    orchestratorHtml += `</div>`;
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
        const tabButtonId = `react-tab-worker-${stage.id}`;
        const contentPaneId = `pipeline-content-worker-${stage.id}`;

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
        workerContentPane.className = 'pipeline-content';

        let displayStatusText = stage.status.charAt(0).toUpperCase() + stage.status.slice(1);
        if (stage.status === 'retrying' && stage.retryAttempt !== undefined) {
            displayStatusText = `Retrying (${stage.retryAttempt}/${MAX_RETRIES})...`;
        }

        const hasContent = !!stage.generatedContent;
        let contentBlock;
        if (hasContent) {
            const contentToRender = `\`\`\`tsx\n${stage.generatedContent!}\n\`\`\``;
            contentBlock = renderMarkdown(contentToRender);
        } else {
            contentBlock = `<div class="empty-state-message">${getEmptyStateMessage(stage.status, 'code')}</div>`;
        }

        let workerDetailsHtml = `
            <div class="react-worker-content-pane model-detail-card">
                 <div class="model-detail-header">
                    <div class="model-title-area">
                        <h4 class="model-title">${escapeHtml(stage.title)}</h4>
                    </div>
                    <div class="model-card-actions">
                        <span class="status-badge status-${stage.status}">${displayStatusText}</span>
                    </div>
                </div>
                <div class="worker-details-grid">
                    <div class="info-column">
                        ${stage.error ? `<div class="status-message error"><pre>${escapeHtml(stage.error)}</pre></div>` : ''}
                        <details class="model-detail-section collapsible-section" open>
                            <summary class="model-section-title">System Instruction</summary>
                            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(stage.systemInstruction || "Not available.")}</pre></div>
                        </details>
                        <details class="model-detail-section collapsible-section">
                            <summary class="model-section-title">Rendered User Prompt</summary>
                            <div class="scrollable-content-area custom-scrollbar"><pre>${escapeHtml(stage.renderedUserPrompt || stage.userPrompt || "Not available.")}</pre></div>
                        </details>
                    </div>
                    <div class="code-column">
                        <div class="model-detail-section">
                            <div class="code-block-header">
                                <span class="model-section-title">Generated Code/Content</span>
                                <div class="code-actions">
                                    <button class="button copy-react-worker-code-btn" data-worker-id="${stage.id}" title="Copy Code Snippet" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">content_copy</span><span class="button-text">Copy</span></button>
                                    <button class="button download-react-worker-code-btn" data-worker-id="${stage.id}" title="Download Code Snippet" ${!hasContent ? 'disabled' : ''}><span class="material-symbols-outlined">download</span><span class="button-text">Download</span></button>
                                </div>
                            </div>
                            <div class="code-block-wrapper scrollable-content-area custom-scrollbar">${contentBlock}</div>
                        </div>
                    </div>
                </div>
            </div>`;
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
        if (downloadBtn) {
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
        const finalCodeHtml = renderMarkdown(`\`\`\`tsx\n${pipeline.finalAppendedCode}\n\`\`\``);

        finalOutputPane.innerHTML = `
            <div class="react-final-output-pane model-detail-card">
                <div class="model-detail-header">
                    <h4 class="model-title">Final Aggregated Application Code</h4>
                    <div class="model-card-actions">
                        <button id="download-react-runnable-project" class="button" type="button"><span class="material-symbols-outlined">archive</span><span class="button-text">Download Project (.zip)</span></button>
                    </div>
                </div>
                <p>The following is a concatenation of outputs from successful worker agents. File markers (e.g., // --- FILE: src/App.tsx ---) should indicate intended file paths.</p>
                <div class="code-block-wrapper scrollable-content-area custom-scrollbar" style="max-height: 60vh;">${finalCodeHtml}</div>
            </div>
        `;
        // Find the orchestrator pane and insert this after it.
        const orchestratorDiv = document.getElementById('pipeline-content-orchestrator');
        orchestratorDiv?.appendChild(finalOutputPane);

        const downloadRunnableProjectButton = document.getElementById('download-react-runnable-project');
        if (downloadRunnableProjectButton && pipeline.finalAppendedCode) {
            downloadRunnableProjectButton.addEventListener('click', createAndDownloadReactProjectZip);
        }
    }

    if (pipeline.activeTabId) {
        activateTab(pipeline.activeTabId);
    } else {
        activateTab(`orchestrator`);
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

    marked.setOptions({
        gfm: true,
        breaks: true,
        highlight: (code, lang) => {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
        },
    } as any);

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
    
    // Diff Mode Button Listeners
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('#instant-fixes-button')) {
            activateDiffMode('instant-fixes');
        } else if (target.closest('#global-compare-button')) {
            activateDiffMode('global-compare');
        } else if (target.closest('#diff-analysis-view-button')) {
            const diffAnalysisButton = document.getElementById('diff-analysis-view-button');
            if (diffAnalysisButton && !diffAnalysisButton.classList.contains('active')) {
                activateInstantFixesView('diff-analysis');
            } else {
                activateInstantFixesView('side-by-side');
            }
        } else if (target.closest('#preview-button')) {
            const previewButton = document.getElementById('preview-button');
            if (previewButton && !previewButton.classList.contains('active')) {
                activateInstantFixesView('preview');
            } else {
                activateInstantFixesView('side-by-side');
            }
        } else if (target.closest('#diff-view-toggle-button')) {
            toggleDiffViewDropdown();
        } else if (target.closest('.diff-view-option')) {
            const option = target.closest('.diff-view-option') as HTMLElement;
            const view = option.dataset.view as 'unified' | 'split';
            if (view) {
                activateDiffViewMode(view);
                hideDiffViewDropdown();
            }
        } else if (target.closest('#copy-source-button')) {
            copyPreviewContent('source');
        } else if (target.closest('#copy-target-button')) {
            copyPreviewContent('target');
        } else if (target.closest('#download-source-button')) {
            downloadPreviewContent('source');
        } else if (target.closest('#download-target-button')) {
            downloadPreviewContent('target');
        } else if (target.closest('#fullscreen-source-button')) {
            openPreviewFullscreen('source');
        } else if (target.closest('#fullscreen-target-button')) {
            openPreviewFullscreen('target');
        } else {
            // Close diff view dropdown if clicking outside
            if (!target.closest('#diff-view-toggle')) {
                hideDiffViewDropdown();
            }
        }
    });
    // Event delegation for dynamically created "Compare" buttons and "View The Argument" buttons
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
            } else if (target.classList.contains('view-argument-button')) {
                const hypothesisId = target.dataset.hypothesisId;
                if (hypothesisId) {
                    openArgumentModal(hypothesisId);
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
let currentDiffViewMode: 'unified' | 'split' = 'split';
let currentSourceContent: string = '';
let currentTargetContent: string = '';

// Helper function to extract HTML from old format request prompts
function extractHtmlFromRequestPrompt(requestPrompt: string): string | null {
    if (!requestPrompt) return null;
    
    // Look for HTML code blocks in the request prompt
    const htmlMatch = requestPrompt.match(/```html\n([\s\S]*?)\n```/);
    if (htmlMatch && htmlMatch[1]) {
        return htmlMatch[1].trim();
    }
    
    // Alternative pattern without language specifier
    const altMatch = requestPrompt.match(/```\n(<!DOCTYPE html[\s\S]*?)\n```/);
    if (altMatch && altMatch[1]) {
        return altMatch[1].trim();
    }
    
    return null;
}

function renderDiff(sourceText: string, targetText: string) {
    // Store content in global variables for toggle functionality
    currentSourceContent = sourceText;
    currentTargetContent = targetText;
    
    if (!diffViewerPanel) return;
    // Ensure parent containers can scroll in unified view (disable split lock on both containers)
    const unifiedGlobalContainer = document.getElementById('diff-viewer-panel');
    const unifiedInstantContainer = document.getElementById('instant-fixes-diff-viewer');
    unifiedGlobalContainer?.classList.remove('diff-side-by-side-active');
    unifiedInstantContainer?.classList.remove('diff-side-by-side-active');
    const differences = Diff.diffLines(sourceText, targetText, { newlineIsToken: true });
    
    // Calculate diff statistics
    let addedLines = 0;
    let removedLines = 0;
    let totalChanges = 0;
    
    differences.forEach(part => {
        const lines = part.value.split('\n').filter(line => line !== '' || part.value.endsWith('\n'));
        if (part.added) {
            addedLines += lines.length;
            totalChanges += lines.length;
        } else if (part.removed) {
            removedLines += lines.length;
            totalChanges += lines.length;
        }
    });
    
    // Update header diff stats
    updateHeaderDiffStats(sourceText, targetText);
    
    // Create diff content HTML
    let diffHtml = '<div class="diff-view-fullscreen">';
    let lineNumber = 1;
    
    differences.forEach(part => {
        const lines = part.value.split('\n');
        lines.forEach((line, index) => {
            if (index === lines.length - 1 && line === '') return; // Skip empty last line
            
            const colorClass = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-neutral';
            const prefix = part.added ? '+' : part.removed ? '-' : ' ';
            
            diffHtml += `<div class="diff-line ${colorClass}">
                <span class="diff-line-number">${lineNumber}</span>
                <span class="diff-line-prefix">${prefix}</span>
                <span class="diff-line-content">${escapeHtml(line)}</span>
            </div>`;
            
            if (!part.removed) lineNumber++;
        });
    });
    
    diffHtml += '</div>';
    
    // Only show diff content (stats are in header now)
    diffViewerPanel.innerHTML = diffHtml;
}

function renderSideBySideComparison(sourceText: string, targetText: string, sourceTitle: string, targetTitle: string) {
    // Store content in global variables for preview controls
    currentSourceContent = sourceText;
    currentTargetContent = targetText;
    
    const diffSourceContent = document.getElementById('diff-source-content');
    const diffTargetContent = document.getElementById('diff-target-content');
    const diffSourceTitleElement = document.getElementById('diff-source-title');
    const diffTargetTitleElement = document.getElementById('diff-target-title');
    
    if (!diffSourceContent || !diffTargetContent || !diffSourceTitleElement || !diffTargetTitleElement) return;
    
    // Update titles
    diffSourceTitleElement.textContent = sourceTitle;
    diffTargetTitleElement.textContent = targetTitle;
    
    // Update preview titles
    const previewSourceTitle = document.getElementById('preview-source-title');
    const previewTargetTitle = document.getElementById('preview-target-title');
    if (previewSourceTitle) previewSourceTitle.textContent = sourceTitle;
    if (previewTargetTitle) previewTargetTitle.textContent = targetTitle;
    
    // Calculate and update header diff stats
    updateHeaderDiffStats(sourceText, targetText);
    
    // Render content with syntax highlighting
    const renderContent = (text: string) => {
        if (diffSourceData?.contentType === 'html') {
            return `<pre><code class="language-html">${escapeHtml(text)}</code></pre>`;
        } else {
            return `<pre><code class="language-text">${escapeHtml(text)}</code></pre>`;
        }
    };
    
    diffSourceContent.innerHTML = renderContent(sourceText);
    diffTargetContent.innerHTML = renderContent(targetText);
    
    // Update preview frames if content is HTML
    if (diffSourceData && diffSourceData.contentType === 'html') {
        const previewSourceFrame = document.getElementById('preview-source-frame') as HTMLIFrameElement;
        const previewTargetFrame = document.getElementById('preview-target-frame') as HTMLIFrameElement;
        
        if (previewSourceFrame) {
            const sourceBlob = new Blob([sourceText], { type: 'text/html' });
            previewSourceFrame.src = URL.createObjectURL(sourceBlob);
        }
        
        if (previewTargetFrame) {
            const targetBlob = new Blob([targetText], { type: 'text/html' });
            previewTargetFrame.src = URL.createObjectURL(targetBlob);
        }
    }
    
    // Apply syntax highlighting
    if (typeof hljs !== 'undefined') {
        diffSourceContent.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block as HTMLElement));
        diffTargetContent.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block as HTMLElement));
    }
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
                        // Store the current content for toggle functionality
                        currentSourceContent = diffSourceData!.content;
                        currentTargetContent = targetContent;
                        
                        // Render based on current diff view mode
                        if (currentDiffViewMode === 'unified') {
                            renderDiff(diffSourceData!.content, targetContent);
                        } else {
                            renderDiffSideBySide(diffSourceData!.content, targetContent);
                        }
                        
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

    let sourceContent: string | undefined;
    let targetContent: string | undefined;
    let sourceTitle: string;
    let targetTitle: string;

    if (contentType === 'html') {
        // For HTML mode, compare Request 1 (raw) vs Request 2 (bug fixed) within the same iteration
        // Handle both old and new JSON formats
        
        if (iteration.generatedRawHtml) {
            // New format with separate raw and fixed versions
            sourceContent = iteration.generatedRawHtml;
            targetContent = iteration.generatedHtml;
            
            if (iteration.title.includes('Initial')) {
                sourceTitle = "Initial Generation (Request 1)";
                targetTitle = "Initial Bug Fix (Request 2)";
            } else if (iteration.title.includes('Refinement') || iteration.title.includes('Stabilization') || iteration.title.includes('Feature')) {
                sourceTitle = "Feature Implementation (Request 1)";
                targetTitle = "Bug Fix & Completion (Request 2)";
            } else {
                sourceTitle = "Before Fixing";
                targetTitle = "After Fixing";
            }
        } else {
            // Old format: extract raw HTML from request prompt
            const rawHtmlFromPrompt = extractHtmlFromRequestPrompt(iteration.requestPromptHtml_BugFix);
            
            if (rawHtmlFromPrompt) {
                sourceContent = rawHtmlFromPrompt;
                targetContent = iteration.generatedHtml;
                sourceTitle = "Before Bug Fix";
                targetTitle = "After Bug Fix";
            } else {
                // Fallback: compare with previous iteration if available
                if (iteration.iterationNumber > 0) {
                    const prevIteration = pipeline.iterations.find(iter => iter.iterationNumber === iteration.iterationNumber - 1);
                    if (prevIteration?.generatedHtml) {
                        sourceContent = prevIteration.generatedHtml;
                        targetContent = iteration.generatedHtml;
                        sourceTitle = `Previous: ${prevIteration.title}`;
                        targetTitle = `Current: ${iteration.title}`;
                    } else {
                        sourceContent = iteration.generatedHtml;
                        targetContent = iteration.generatedHtml;
                        sourceTitle = iteration.title;
                        targetTitle = iteration.title;
                    }
                } else {
                    sourceContent = iteration.generatedHtml;
                    targetContent = iteration.generatedHtml;
                    sourceTitle = iteration.title;
                    targetTitle = iteration.title;
                }
            }
        }
    } else { // text mode
        sourceContent = iteration.generatedOrRevisedText || iteration.generatedMainContent;
        targetContent = sourceContent; // For non-HTML modes, we don't have the raw vs fixed distinction yet
        sourceTitle = iteration.title;
        targetTitle = iteration.title;
    }

    if (!sourceContent) {
        alert("Source content is not available for comparison.");
        return;
    }

    if (!targetContent) {
        alert("Target content is not available for comparison.");
        return;
    }

    diffSourceData = { pipelineId, iterationNumber, contentType, content: sourceContent, title: sourceTitle };

    // Set up the modal for instant fixes mode by default
    activateDiffMode('instant-fixes');
    
    // Show side-by-side comparison by default
    renderSideBySideComparison(sourceContent, targetContent, sourceTitle, targetTitle);
    
    // Store content globally for diff view switching
    currentSourceContent = sourceContent;
    currentTargetContent = targetContent;
    
    // Initialize the diff view toggle button
    updateDiffViewToggleButton(currentDiffViewMode);

    // Set up global compare mode
    if (diffSourceLabel) diffSourceLabel.textContent = `Variant ${pipelineId + 1} - ${iteration.title}`;
    if (diffViewerPanel) {
        // Show initial message for global compare
        diffViewerPanel.innerHTML = '<div class="diff-no-selection empty-state-message"><p>Select a target (B) from the list to view differences.</p></div>';
    }
    populateDiffTargetTree();

    if (diffModalOverlay) {
        diffModalOverlay.style.display = 'flex';
        setTimeout(() => diffModalOverlay.classList.add('is-visible'), 10);
    }
}

function activateDiffMode(mode: 'instant-fixes' | 'global-compare') {
    const instantFixesButton = document.getElementById('instant-fixes-button');
    const globalCompareButton = document.getElementById('global-compare-button');
    const instantFixesPanel = document.getElementById('instant-fixes-panel');
    const globalComparePanel = document.getElementById('global-compare-panel');
    const diffAnalysisButton = document.getElementById('diff-analysis-view-button');
    const previewButton = document.getElementById('preview-button');
    
    if (!instantFixesButton || !globalCompareButton || !instantFixesPanel || !globalComparePanel || !diffAnalysisButton || !previewButton) return;
    
    // Update button states
    instantFixesButton.classList.toggle('active', mode === 'instant-fixes');
    globalCompareButton.classList.toggle('active', mode === 'global-compare');
    
    // Update panel visibility
    instantFixesPanel.classList.toggle('active', mode === 'instant-fixes');
    globalComparePanel.classList.toggle('active', mode === 'global-compare');
    
    // Show/hide and enable/disable view mode buttons based on mode
    if (mode === 'instant-fixes') {
        diffAnalysisButton.style.display = 'flex';
        previewButton.style.display = 'flex';
        // Reset to side-by-side view when switching to instant fixes
        activateInstantFixesView('side-by-side');
        hideDiffViewToggle(); // Hide toggle for side-by-side view
    } else {
        diffAnalysisButton.style.display = 'none';
        previewButton.style.display = 'none';
        // Reset button states when hiding
        diffAnalysisButton.classList.remove('active');
        previewButton.classList.remove('active');
        showDiffViewToggle(); // Show toggle for global compare mode
        
        // If we have content available, render it in the current mode
        if (currentSourceContent && currentTargetContent) {
            if (currentDiffViewMode === 'unified') {
                renderDiff(currentSourceContent, currentTargetContent);
            } else {
                renderDiffSideBySide(currentSourceContent, currentTargetContent);
            }
        }
    }
    
    // Check if we have the necessary data and next iteration
    if (diffSourceData) {
        const pipeline = pipelinesState.find(p => p.id === diffSourceData.pipelineId);
        const nextIteration = pipeline?.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber + 1);
        const hasNextIteration = !!nextIteration;
        const isHtmlContent = diffSourceData.contentType === 'html';
        
        // Handle instant fixes mode
        if (mode === 'instant-fixes') {
            // For HTML mode, compare Request 1 vs Request 2 within the same iteration
            let targetContent: string | undefined;
            let targetTitle: string;
            
            if (diffSourceData.contentType === 'html') {
                const sourceIteration = pipeline.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
                if (sourceIteration) {
                    if (sourceIteration.generatedRawHtml) {
                        // New format: compare raw vs fixed within same iteration
                        targetContent = sourceIteration.generatedHtml; // Request 2 output
                        
                        if (sourceIteration.title.includes('Initial')) {
                            targetTitle = "Initial Bug Fix (Request 2)";
                        } else if (sourceIteration.title.includes('Refinement') || sourceIteration.title.includes('Stabilization') || sourceIteration.title.includes('Feature')) {
                            targetTitle = "Bug Fix & Completion (Request 2)";
                        } else {
                            targetTitle = "After Fixing";
                        }
                    } else {
                        // Old format: check if we can extract raw HTML from request prompt
                        const rawHtmlFromPrompt = extractHtmlFromRequestPrompt(sourceIteration.requestPromptHtml_BugFix);
                        
                        if (rawHtmlFromPrompt) {
                            targetContent = sourceIteration.generatedHtml;
                            targetTitle = "After Bug Fix";
                        } else {
                            // Fallback: compare with previous iteration if available
                            if (diffSourceData.iterationNumber > 0) {
                                const prevIteration = pipeline.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber - 1);
                                if (prevIteration?.generatedHtml) {
                                    targetContent = sourceIteration.generatedHtml;
                                    targetTitle = `Current: ${sourceIteration.title}`;
                                }
                            }
                            
                            if (!targetContent) {
                                // Fallback: show same content
                                targetContent = sourceIteration.generatedHtml;
                                targetTitle = sourceIteration.title;
                            }
                        }
                    }
                }
            } else {
                // For non-HTML modes, we don't have separate raw vs fixed versions yet
                const sourceIteration = pipeline.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
                targetContent = sourceIteration?.generatedOrRevisedText || sourceIteration?.generatedMainContent;
                targetTitle = sourceIteration?.title || "Target";
            }
            
            if (targetContent) {
                renderSideBySideComparison(diffSourceData.content, targetContent, diffSourceData.title, targetTitle);
            }
        }
        
        // Check if we have both raw and bug-fixed versions within the same iteration
        let hasBugFixVersion = false;
        if (diffSourceData.contentType === 'html') {
            const sourceIteration = pipeline.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
            // New format: check for both generatedRawHtml and generatedHtml
            // Old format: check if we can extract raw HTML from request prompt, or have a previous iteration
            hasBugFixVersion = !!(sourceIteration?.generatedRawHtml && sourceIteration?.generatedHtml) ||
                              (!sourceIteration?.generatedRawHtml && (
                                  extractHtmlFromRequestPrompt(sourceIteration?.requestPromptHtml_BugFix || '') ||
                                  (diffSourceData.iterationNumber > 0 && 
                                   pipeline.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber - 1)?.generatedHtml)
                              ));
        } else {
            // For non-HTML modes, we don't have separate raw vs fixed versions yet
            hasBugFixVersion = !!pipeline.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
        }
        
        // Update button availability
        instantFixesButton.disabled = !hasBugFixVersion;
        diffAnalysisButton.disabled = !hasBugFixVersion || mode !== 'instant-fixes';
        previewButton.disabled = !hasBugFixVersion || mode !== 'instant-fixes' || !isHtmlContent;
        
        if (!hasBugFixVersion) {
            instantFixesButton.title = "No corresponding bug fixed/polished version available";
            diffAnalysisButton.title = "No corresponding bug fixed/polished version available";
            previewButton.title = "No corresponding bug fixed/polished version available";
        } else if (!isHtmlContent) {
            previewButton.title = "Preview only available for HTML content";
            diffAnalysisButton.title = mode === 'instant-fixes' ? "" : "Only available in Instant Fixes mode";
            instantFixesButton.title = "";
        } else {
            instantFixesButton.title = "";
            diffAnalysisButton.title = mode === 'instant-fixes' ? "" : "Only available in Instant Fixes mode";
            previewButton.title = mode === 'instant-fixes' ? "" : "Only available in Instant Fixes mode";
        }
    }
}

function renderDiffSideBySide(sourceText: string, targetText: string) {
    // Store content in global variables for toggle functionality
    currentSourceContent = sourceText;
    currentTargetContent = targetText;

    // Choose the correct container based on the active panel.
    // When in Global Compare, we must render into 'diff-viewer-panel'.
    // When in Instant Fixes, render into 'instant-fixes-diff-viewer'.
    const globalComparePanel = document.getElementById('global-compare-panel');
    const instantFixesPanel = document.getElementById('instant-fixes-panel');
    let container: HTMLElement | null = null;

    if (globalComparePanel && globalComparePanel.classList.contains('active')) {
        container = document.getElementById('diff-viewer-panel');
    } else if (instantFixesPanel && instantFixesPanel.classList.contains('active')) {
        container = document.getElementById('instant-fixes-diff-viewer');
    } else {
        // Fallback: try global compare container first, then instant fixes
        container = document.getElementById('diff-viewer-panel') || document.getElementById('instant-fixes-diff-viewer');
    }
    if (!container) return;
    // Only the active split container should suppress its own scrolling
    const globalContainer = document.getElementById('diff-viewer-panel');
    const instantContainer = document.getElementById('instant-fixes-diff-viewer');
    globalContainer?.classList.remove('diff-side-by-side-active');
    instantContainer?.classList.remove('diff-side-by-side-active');
    // Prevent parent container from scrolling; let panes handle scroll (for proper sync)
    container.classList.add('diff-side-by-side-active');

    // Calculate and update header diff stats
    updateHeaderDiffStats(sourceText, targetText);

    // Create side-by-side diff HTML
    const diff = Diff.diffLines(sourceText, targetText, { newlineIsToken: true });
    let leftPaneHtml = '';
    let rightPaneHtml = '';
    let leftLineNum = 1;
    let rightLineNum = 1;

    diff.forEach(part => {
        const lines = part.value.split('\n').filter(l => l.length > 0);
        if (part.added) {
            lines.forEach(line => {
                rightPaneHtml += `<div class="diff-line diff-added"><span class="diff-line-number">${rightLineNum++}</span><span class="diff-line-prefix">+</span><span class="diff-line-content">${escapeHtml(line)}</span></div>`;
                leftPaneHtml += `<div class="diff-line diff-placeholder"></div>`;
            });
        } else if (part.removed) {
            lines.forEach(line => {
                leftPaneHtml += `<div class="diff-line diff-removed"><span class="diff-line-number">${leftLineNum++}</span><span class="diff-line-prefix">-</span><span class="diff-line-content">${escapeHtml(line)}</span></div>`;
                rightPaneHtml += `<div class="diff-line diff-placeholder"></div>`;
            });
        } else {
            lines.forEach(line => {
                leftPaneHtml += `<div class="diff-line diff-neutral"><span class="diff-line-number">${leftLineNum++}</span><span class="diff-line-prefix"> </span><span class="diff-line-content">${escapeHtml(line)}</span></div>`;
                rightPaneHtml += `<div class="diff-line diff-neutral"><span class="diff-line-number">${rightLineNum++}</span><span class="diff-line-prefix"> </span><span class="diff-line-content">${escapeHtml(line)}</span></div>`;
            });
        }
    });

    const diffHtml = `
        <div class="diff-view-side-by-side">
            <div id="diff-pane-left" class="diff-pane custom-scrollbar">
                <pre style="font-family: var(--font-family)"><code>${leftPaneHtml}</code></pre>
            </div>
            <div id="diff-pane-right" class="diff-pane custom-scrollbar">
                <pre style="font-family: var(--font-family)"><code>${rightPaneHtml}</code></pre>
            </div>
        </div>
    `;

    container.innerHTML = diffHtml;

    // IMPORTANT: scope queries to the active container to avoid duplicate ID conflicts
    const leftPane = container.querySelector('#diff-pane-left') as HTMLElement | null;
    const rightPane = container.querySelector('#diff-pane-right') as HTMLElement | null;

    if (leftPane && rightPane) {
        let isSyncing = false;

        const syncScroll = (source: HTMLElement, target: HTMLElement) => {
            if (isSyncing) return;
            isSyncing = true;

            // Proportional vertical sync to handle minor height differences
            const sMax = Math.max(1, source.scrollHeight - source.clientHeight);
            const tMax = Math.max(1, target.scrollHeight - target.clientHeight);
            const ratio = source.scrollTop / sMax;
            target.scrollTop = Math.round(ratio * tMax);

            // Direct horizontal sync
            target.scrollLeft = source.scrollLeft;

            requestAnimationFrame(() => { isSyncing = false; });
        };

        const onLeftScroll = () => syncScroll(leftPane, rightPane);
        const onRightScroll = () => syncScroll(rightPane, leftPane);

        // Scroll events (keyboard, programmatic, touchpad)
        leftPane.addEventListener('scroll', onLeftScroll, { passive: true });
        rightPane.addEventListener('scroll', onRightScroll, { passive: true });

        // Wheel events for horizontal Shift+scroll
        leftPane.addEventListener('wheel', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
                leftPane.scrollLeft += e.deltaY;
                rightPane.scrollLeft = leftPane.scrollLeft;
            }
        }, { passive: false });

        rightPane.addEventListener('wheel', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
                rightPane.scrollLeft += e.deltaY;
                leftPane.scrollLeft = rightPane.scrollLeft;
            }
        }, { passive: false });

        // Resize observer to keep proportional mapping accurate
        const ro = new ResizeObserver(() => {
            // Trigger a sync from the currently scrolled pane
            if (leftPane.scrollTop >= rightPane.scrollTop) {
                onLeftScroll();
            } else {
                onRightScroll();
            }
        });
        ro.observe(leftPane);
        ro.observe(rightPane);
    }
}



function activateInstantFixesView(view: 'side-by-side' | 'diff-analysis' | 'preview') {
    const diffAnalysisButton = document.getElementById('diff-analysis-view-button');
    const previewButton = document.getElementById('preview-button');
    const sideBySideView = document.getElementById('side-by-side-view');
    const diffAnalysisView = document.getElementById('diff-analysis-view');
    const previewView = document.getElementById('preview-view');
    
    if (!diffAnalysisButton || !previewButton || !sideBySideView || !diffAnalysisView || !previewView) return;
    
    // Update button states
    diffAnalysisButton.classList.toggle('active', view === 'diff-analysis');
    previewButton.classList.toggle('active', view === 'preview');
    
    // Update view visibility
    sideBySideView.classList.toggle('active', view === 'side-by-side');
    diffAnalysisView.classList.toggle('active', view === 'diff-analysis');
    previewView.classList.toggle('active', view === 'preview');
    
    // Show/hide diff view toggle based on view
    if (view === 'diff-analysis') {
        showDiffViewToggle();
        // Get target content properly for diff analysis
        if (diffSourceData) {
            const pipeline = pipelinesState.find(p => p.id === diffSourceData.pipelineId);
            let analysisTargetContent: string | undefined;
            
            if (diffSourceData.contentType === 'html') {
                const sourceIteration = pipeline?.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
                analysisTargetContent = sourceIteration?.generatedHtml;
            } else {
                const sourceIteration = pipeline?.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
                analysisTargetContent = sourceIteration?.generatedOrRevisedText || sourceIteration?.generatedMainContent;
            }
            
            if (analysisTargetContent) {
                // Store current content for toggle functionality
                currentSourceContent = diffSourceData.content;
                currentTargetContent = analysisTargetContent;
                
                // Immediately render the diff analysis based on current mode
                if (currentDiffViewMode === 'unified') {
                    renderInstantFixesDiff(diffSourceData.content, analysisTargetContent);
                } else {
                    renderDiffSideBySide(diffSourceData.content, analysisTargetContent);
                }
            }
        }
    } else {
        hideDiffViewToggle();
    }
    
    // Handle different views
    if (diffSourceData) {
        const pipeline = pipelinesState.find(p => p.id === diffSourceData.pipelineId);
        
        // For HTML mode, compare Request 1 vs Request 2 within the same iteration
        let targetContent: string | undefined;
        let targetTitle: string;
        
        if (diffSourceData.contentType === 'html') {
            const sourceIteration = pipeline?.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
            if (sourceIteration) {
                targetContent = sourceIteration.generatedHtml; // Request 2 output
                
                if (sourceIteration.title.includes('Initial')) {
                    targetTitle = "Initial Bug Fix (Request 2)";
                } else if (sourceIteration.title.includes('Refinement') || sourceIteration.title.includes('Stabilization') || sourceIteration.title.includes('Feature')) {
                    targetTitle = "Bug Fix & Completion (Request 2)";
                } else {
                    targetTitle = "After Fixing";
                }
            }
        } else {
            // For non-HTML modes, we don't have separate raw vs fixed versions yet
            const sourceIteration = pipeline?.iterations.find(iter => iter.iterationNumber === diffSourceData.iterationNumber);
            targetContent = sourceIteration?.generatedOrRevisedText || sourceIteration?.generatedMainContent;
            targetTitle = sourceIteration?.title || "Target";
        }
        
        if (targetContent) {
            if (view === 'diff-analysis') {
                // Store current content for toggle functionality
                currentSourceContent = diffSourceData.content;
                currentTargetContent = targetContent;
                
                // Render based on current diff view mode
                if (currentDiffViewMode === 'unified') {
                    renderInstantFixesDiff(diffSourceData.content, targetContent);
                } else {
                    renderDiffSideBySide(diffSourceData.content, targetContent);
                }
            } else if (view === 'preview' && diffSourceData.contentType === 'html') {
                renderHtmlPreview(diffSourceData.content, targetContent, diffSourceData.title, targetTitle);
            } else if (view === 'side-by-side') {
                renderSideBySideComparison(diffSourceData.content, targetContent, diffSourceData.title, targetTitle);
            }
        }
    }
}



function renderHtmlPreview(sourceHtml: string, targetHtml: string, sourceTitle: string, targetTitle: string) {
    const previewSourceFrame = document.getElementById('preview-source-frame') as HTMLIFrameElement;
    const previewTargetFrame = document.getElementById('preview-target-frame') as HTMLIFrameElement;
    const previewSourceTitleElement = document.getElementById('preview-source-title');
    const previewTargetTitleElement = document.getElementById('preview-target-title');
    
    if (!previewSourceFrame || !previewTargetFrame || !previewSourceTitleElement || !previewTargetTitleElement) return;
    
    // Update titles
    previewSourceTitleElement.textContent = sourceTitle;
    previewTargetTitleElement.textContent = targetTitle;
    
    // Calculate and update header diff stats
    updateHeaderDiffStats(sourceHtml, targetHtml);
    
    // Load HTML content into iframes
    previewSourceFrame.srcdoc = sourceHtml;
    previewTargetFrame.srcdoc = targetHtml;
}

function renderInstantFixesDiff(sourceText: string, targetText: string) {
    const diffViewer = document.getElementById('instant-fixes-diff-viewer');
    if (!diffViewer) return;
    
    const differences = Diff.diffLines(sourceText, targetText, { newlineIsToken: true });
    
    // Calculate diff statistics
    let addedLines = 0;
    let removedLines = 0;
    let totalChanges = 0;
    
    differences.forEach(part => {
        const lines = part.value.split('\n').filter(line => line !== '' || part.value.endsWith('\n'));
        if (part.added) {
            addedLines += lines.length;
            totalChanges += lines.length;
        } else if (part.removed) {
            removedLines += lines.length;
            totalChanges += lines.length;
        }
    });
    
    // Update header diff stats
    updateHeaderDiffStats(sourceText, targetText);
    
    // Create diff content HTML
    let diffHtml = '<div class="diff-view-fullscreen">';
    let lineNumber = 1;
    
    differences.forEach(part => {
        const lines = part.value.split('\n');
        lines.forEach((line, index) => {
            if (index === lines.length - 1 && line === '') return; // Skip empty last line
            
            const colorClass = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-neutral';
            const prefix = part.added ? '+' : part.removed ? '-' : ' ';
            
            diffHtml += `<div class="diff-line ${colorClass}">
                <span class="diff-line-number">${lineNumber}</span>
                <span class="diff-line-prefix">${prefix}</span>
                <span class="diff-line-content">${escapeHtml(line)}</span>
            </div>`;
            
            if (!part.removed) lineNumber++;
        });
    });
    
    diffHtml += '</div>';
    
    // Only show diff content (stats are in header now)
    diffViewer.innerHTML = diffHtml;
}

function updateHeaderDiffStats(sourceText: string, targetText: string) {
    const headerDiffStats = document.getElementById('header-diff-stats');
    const additionsCount = document.getElementById('header-additions-count');
    const deletionsCount = document.getElementById('header-deletions-count');
    const totalCount = document.getElementById('header-total-count');
    
    if (!headerDiffStats || !additionsCount || !deletionsCount || !totalCount) return;
    
    const differences = Diff.diffLines(sourceText, targetText, { newlineIsToken: true });
    
    let addedLines = 0;
    let removedLines = 0;
    let totalChanges = 0;
    
    differences.forEach(part => {
        const lines = part.value.split('\n').filter(line => line !== '' || part.value.endsWith('\n'));
        if (part.added) {
            addedLines += lines.length;
            totalChanges += lines.length;
        } else if (part.removed) {
            removedLines += lines.length;
            totalChanges += lines.length;
        }
    });
    
    // Update the header stats
    additionsCount.textContent = `+${addedLines} lines`;
    deletionsCount.textContent = `-${removedLines} lines`;
    totalCount.textContent = `${totalChanges} changes`;
    
    // Show the stats with animation
    headerDiffStats.classList.add('visible');
}

function hideHeaderDiffStats() {
    const headerDiffStats = document.getElementById('header-diff-stats');
    if (headerDiffStats) {
        headerDiffStats.classList.remove('visible');
    }
}

// Missing diff view toggle functions
function toggleDiffViewDropdown() {
    const dropdown = document.getElementById('diff-view-dropdown');
    if (!dropdown) return;
    
    if (dropdown.classList.contains('visible')) {
        hideDiffViewDropdown();
    } else {
        showDiffViewDropdown();
    }
}

function showDiffViewDropdown() {
    const dropdown = document.getElementById('diff-view-dropdown');
    if (dropdown) {
        dropdown.classList.add('visible');
    }
}

function hideDiffViewDropdown() {
    const dropdown = document.getElementById('diff-view-dropdown');
    if (dropdown) {
        dropdown.classList.remove('visible');
    }
}

function showDiffViewToggle() {
    const toggle = document.getElementById('diff-view-toggle');
    if (toggle) {
        toggle.classList.add('visible');
    }
}

function hideDiffViewToggle() {
    const toggle = document.getElementById('diff-view-toggle');
    if (toggle) {
        toggle.classList.remove('visible');
    }
}

function updateDiffViewToggleButton(mode: 'unified' | 'split') {
    const toggleButton = document.getElementById('diff-view-toggle-button');
    const buttonText = toggleButton?.querySelector('.button-text');
    const buttonIcon = toggleButton?.querySelector('.material-symbols-outlined');
    
    if (!toggleButton || !buttonText || !buttonIcon) return;
    
    if (mode === 'split') {
        buttonText.textContent = 'Split View';
        buttonIcon.textContent = 'view_column';
    } else {
        buttonText.textContent = 'Unified View';
        buttonIcon.textContent = 'view_agenda';
    }
    
    // Update dropdown options
    const options = document.querySelectorAll('.diff-view-option');
    options.forEach(option => {
        const optionElement = option as HTMLElement;
        if (optionElement.dataset.view === mode) {
            optionElement.classList.add('active');
        } else {
            optionElement.classList.remove('active');
        }
    });
}


function activateDiffViewMode(mode: 'unified' | 'split') {
    currentDiffViewMode = mode;
    updateDiffViewToggleButton(mode);
    
    // Re-render the current diff with the new view mode
    if (diffSourceData && currentSourceContent && currentTargetContent) {
        const diffAnalysisView = document.getElementById('diff-analysis-view');
        const globalComparePanel = document.getElementById('global-compare-panel');
        const instantFixesPanel = document.getElementById('instant-fixes-panel');
        
        // For instant fixes mode - diff analysis view
        if (instantFixesPanel && instantFixesPanel.classList.contains('active') && 
            diffAnalysisView && diffAnalysisView.classList.contains('active')) {
            if (mode === 'unified') {
                renderInstantFixesDiff(currentSourceContent, currentTargetContent);
            } else {
                renderDiffSideBySide(currentSourceContent, currentTargetContent);
            }
        }
        
        // For global compare mode
        if (globalComparePanel && globalComparePanel.classList.contains('active')) {
            if (mode === 'unified') {
                renderDiff(currentSourceContent, currentTargetContent);
            } else {
                renderDiffSideBySide(currentSourceContent, currentTargetContent);
            }
        }
    }
}


function copyPreviewContent(type: 'source' | 'target') {
    const content = type === 'source' ? currentSourceContent : currentTargetContent;
    if (content) {
        navigator.clipboard.writeText(content).then(() => {
            // Show a brief success indication
            const button = document.getElementById(`copy-${type}-button`);
            if (button) {
                const originalIcon = button.querySelector('.material-symbols-outlined');
                if (originalIcon) {
                    originalIcon.textContent = 'check';
                    setTimeout(() => {
                        originalIcon.textContent = 'content_copy';
                    }, 1500);
                }
            }
        }).catch(err => {
            console.error('Failed to copy content:', err);
            alert('Failed to copy content to clipboard');
        });
    }
}

function downloadPreviewContent(type: 'source' | 'target') {
    const content = type === 'source' ? currentSourceContent : currentTargetContent;
    const title = type === 'source' ? 'source' : 'target';
    
    if (content) {
        const blob = new Blob([content], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}-${Date.now()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

function openPreviewFullscreen(type: 'source' | 'target') {
    const content = type === 'source' ? currentSourceContent : currentTargetContent;
    if (content) {
        const newWindow = window.open('', '_blank');
        if (newWindow) {
            // Add escape key listener to close the window
            const fullscreenContent = `
                ${content}
                <script>
                    document.addEventListener('keydown', function(e) {
                        if (e.key === 'Escape') {
                            window.close();
                        }
                    });
                    
                    // Add visual indicator that escape closes the window
                    const indicator = document.createElement('div');
                    indicator.style.cssText = \`
                        position: fixed;
                        top: 10px;
                        right: 10px;
                        background: rgba(0,0,0,0.8);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 4px;
                        font-family: system-ui, sans-serif;
                        font-size: 12px;
                        z-index: 10000;
                        opacity: 0.7;
                        pointer-events: none;
                    \`;
                    indicator.textContent = 'Press ESC to close';
                    document.body.appendChild(indicator);
                    
                    // Hide indicator after 3 seconds
                    setTimeout(() => {
                        if (indicator.parentNode) {
                            indicator.style.opacity = '0';
                            setTimeout(() => indicator.remove(), 300);
                        }
                    }, 3000);
                </script>
            `;
            
            newWindow.document.write(fullscreenContent);
            newWindow.document.close();
        }
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
    
    // Clear diff source data and content
    diffSourceData = null;
    currentSourceContent = '';
    currentTargetContent = '';
    
    // Clear content and reset state
    const diffSourceContent = document.getElementById('diff-source-content');
    const diffTargetContent = document.getElementById('diff-target-content');
    const instantFixesDiffViewer = document.getElementById('instant-fixes-diff-viewer');
    
    if (diffSourceContent) diffSourceContent.innerHTML = '';
    if (diffTargetContent) diffTargetContent.innerHTML = '';
    if (instantFixesDiffViewer) instantFixesDiffViewer.innerHTML = '<div class="empty-state-message"><p>Click "Diff Analysis" to see detailed line-by-line changes</p></div>';
    if (diffViewerPanel) diffViewerPanel.innerHTML = '<div class="diff-no-selection empty-state-message"><p>Select a target (B) from the list to view differences.</p></div>';
    
    // Clear preview frames
    const previewSourceFrame = document.getElementById('preview-source-frame') as HTMLIFrameElement;
    const previewTargetFrame = document.getElementById('preview-target-frame') as HTMLIFrameElement;
    if (previewSourceFrame) previewSourceFrame.src = 'about:blank';
    if (previewTargetFrame) previewTargetFrame.src = 'about:blank';
    
    // Reset button states
    const unifiedButton = document.getElementById('unified-view-button');
    const splitButton = document.getElementById('split-view-button');
    if (unifiedButton) unifiedButton.classList.remove('active');
    if (splitButton) splitButton.classList.add('active');
    currentDiffViewMode = 'split';
    
    // Hide header diff stats
    hideHeaderDiffStats();
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
