/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Deepthink Core - Core business logic for Deepthink mode
 * Contains state management, pipeline processing, and core algorithms
 */

import { Part, GenerateContentResponse } from "@google/genai";
import { AIProvider, ThinkingConfig } from '../Routing/AIProvider';
import { CustomizablePromptsDeepthink, RED_TEAM_AGGRESSIVENESS_LEVELS } from './DeepthinkPrompts';
import { SolutionCritiqueHistoryManager, SolutionCorrectionHistoryManager, StructuredSolutionPoolHistoryManager, PostQualityFilterHistoryManager, StrategiesGeneratorHistoryManager } from './DeepthinkIterativeHistory';
import { addSolutionPoolVersion } from './SolutionPool';
import { extractPartsInOrder, formatPartsForDisplay } from '../Routing/ResponseParser';
import { nanoid } from 'nanoid';

// ========== TYPE DEFINITIONS ==========

export type HypothesisInjectionMode = 'parallel' | 'strategy_aware' | 'selective_injection';

export interface DeepthinkSolutionCritiqueData {
    id: string;
    subStrategyId: string;
    mainStrategyId: string;
    requestPrompt?: string;
    critiqueResponse?: string;
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    retryAttempt?: number;
    isDetailsOpen?: boolean;
}

export interface SolutionPoolParsedSolution {
    title: string;
    approach_summary: string;
    content: string;
    confidence: number;
    internal_critique: string;
    atomic_reconstruction?: string;
}

export interface SolutionPoolParsedResponse {
    strategy_id: string;
    solutions: SolutionPoolParsedSolution[];
}

export interface DeepthinkStructuredSolutionPoolAgentData {
    id: string;
    mainStrategyId: string;
    requestPrompt?: string;
    poolResponse?: string;
    parsedPoolResponse?: SolutionPoolParsedResponse;
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    retryAttempt?: number;
    isDetailsOpen?: boolean;
}

export interface DeepthinkSubStrategyData {
    id: string;
    subStrategyText: string;
    requestPromptSolutionAttempt?: string;
    solutionAttempt?: string;
    requestPromptSolutionCritique?: string;
    solutionCritique?: string;
    solutionCritiqueStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    solutionCritiqueError?: string;
    solutionCritiqueRetryAttempt?: number;
    requestPromptSelfImprovement?: string;
    refinedSolution?: string;
    selfImprovementStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    selfImprovementError?: string;
    selfImprovementRetryAttempt?: number;
    isKilledByRedTeam?: boolean;
    redTeamReason?: string;
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
    subStrategyFormat?: string;
    iterativeCorrections?: {
        enabled: boolean;
        iterations: Array<{
            iterationNumber: number;
            critique: string;
            correctedSolution: string;
            timestamp: number;
        }>;
        status: 'idle' | 'processing' | 'completed' | 'error';
        error?: string;
    };
}

export interface DeepthinkHypothesisData {
    id: string;
    hypothesisText: string;
    testerRequestPrompt?: string;
    testerAttempt?: string;
    testerStatus: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    testerError?: string;
    isDetailsOpen?: boolean;
    targetStrategyIds?: string[];  // Mode 3 (selective_injection): which strategies this hypothesis maps to
}

export interface DeepthinkRedTeamData {
    id: string;
    assignedStrategyId: string;
    requestPrompt?: string;
    evaluationResponse?: string;
    killedStrategyIds: string[];
    killedSubStrategyIds: string[];
    reasoning?: string;
    rawResponse?: string;
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}

export interface DeepthinkPostQualityFilterData {
    id: string;
    iterationNumber: number;
    requestPrompt?: string;
    evaluationResponse?: string;
    prunedStrategyIds: string[];
    continuedStrategyIds: string[];
    reasoning?: string;
    rawResponse?: string;
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
}

export interface DeepthinkMainStrategyData {
    id: string;
    strategyText: string;
    requestPromptSubStrategyGen?: string;
    subStrategies: DeepthinkSubStrategyData[];
    status: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
    isKilledByRedTeam?: boolean;
    redTeamReason?: string;
    strategyFormat?: string;
    generatedByPostQualityFilter?: boolean;
    updatedByPostQualityFilter?: boolean;
    postQualityFilterIteration?: number;
    judgedBestSubStrategyId?: string;
    judgedBestSolution?: string;
    judgingRequestPrompt?: string;
    judgingResponseText?: string;
    judgingStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    judgingError?: string;
    judgingRetryAttempt?: number;
}

export interface DeepthinkPipelineState {
    id: string;
    challenge: string;
    challengeText: string;
    challengeImageBase64?: string | null;
    challengeImageMimeType?: string;
    status: 'idle' | 'processing' | 'retrying' | 'completed' | 'error' | 'stopping' | 'stopped' | 'cancelled';
    error?: string;
    activeTabId: string;
    activeStrategyTab?: number;
    isStopRequested?: boolean;
    retryAttempt?: number;
    requestPromptInitialStrategyGen?: string;
    initialStrategies: DeepthinkMainStrategyData[];
    requestPromptHypothesisGen?: string;
    hypotheses: DeepthinkHypothesisData[];
    hypothesisGenStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    hypothesisGenError?: string;
    hypothesisGenRetryAttempt?: number;
    knowledgePacket?: string;
    solutionCritiques: DeepthinkSolutionCritiqueData[];
    solutionCritiquesStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    solutionCritiquesError?: string;
    dissectedObservationsSynthesis?: string;
    dissectedSynthesisRequestPrompt?: string;
    dissectedSynthesisStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    dissectedSynthesisError?: string;
    dissectedSynthesisRetryAttempt?: number;
    redTeamEvaluations: DeepthinkRedTeamData[];
    redTeamStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    redTeamError?: string;
    postQualityFilterAgents: DeepthinkPostQualityFilterData[];
    postQualityFilterStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    postQualityFilterError?: string;
    postQualityFilterIterationCount?: number;
    strategicSolverComplete?: boolean;
    hypothesisExplorerComplete?: boolean;
    redTeamComplete?: boolean;
    finalJudgedBestStrategyId?: string;
    finalJudgedBestSolution?: string;
    finalJudgingRequestPrompt?: string;
    finalJudgingResponseText?: string;
    finalJudgingStatus?: 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';
    finalJudgingError?: string;
    finalJudgingRetryAttempt?: number;
    finalJudgingStatusDescription?: string;
    structuredSolutionPoolEnabled?: boolean;
    structuredSolutionPool?: string;
    structuredSolutionPoolAgents: DeepthinkStructuredSolutionPoolAgentData[];
    structuredSolutionPoolStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    structuredSolutionPoolError?: string;
    // Hypothesis injection mode tracking
    hypothesisInjectionMode?: HypothesisInjectionMode;
    strategySpecificKnowledgePackets?: Record<string, string>; // Mode 3: per-strategy packets
    liveEvents?: DeepthinkLiveEvent[]; // Real-time pipeline events
}

export interface DeepthinkLiveEvent {
    id: string;
    timestamp: number;
    agentName: string;
    stepDescription: string;
    eventType: 'info' | 'agent_start' | 'agent_complete' | 'agent_error' | 'agent_retry';
    systemInstruction?: string;
    prompt?: string;
    response?: string;
    error?: string;
    attempt?: number;
    modelName?: string;
    temperature?: number;
    topP?: number;
    codeExecutionEnabled?: boolean;
}

export function addLiveEvent(
    process: DeepthinkPipelineState, 
    agentName: string, 
    stepDescription: string, 
    eventType: 'info' | 'agent_start' | 'agent_complete' | 'agent_error' | 'agent_retry', 
    details?: { 
        systemInstruction?: string; 
        prompt?: string; 
        response?: string; 
        error?: string; 
        attempt?: number;
        modelName?: string;
        temperature?: number;
        topP?: number;
        codeExecutionEnabled?: boolean;
    }
) {
    if (!process.liveEvents) {
        process.liveEvents = [];
    }
    const event: DeepthinkLiveEvent = {
        id: `ev-${nanoid(8)}`,
        timestamp: Date.now(),
        agentName,
        stepDescription,
        eventType,
        ...details
    };
    process.liveEvents.push(event);
    render();
}

// ========== ERROR CLASSES ==========

export class PipelineStopRequestedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PipelineStopRequestedError";
    }
}

// ========== STATE MANAGEMENT ==========

export let activeDeepthinkPipeline: DeepthinkPipelineState | null = null;
let setActiveDeepthinkPipeline: ((pipeline: DeepthinkPipelineState | null) => void) | null = null;

/** No-op default so call sites never need null-checks */
let render: () => void = () => { };

// Dependency references stored as a single object after initialization
export interface DeepthinkCoreDeps {
    getAIProvider: () => AIProvider | null;
    callGemini: (parts: Part[], temperature: number, modelToUse: string, systemInstruction?: string, isJson?: boolean, topP?: number, thinkingConfig?: ThinkingConfig) => Promise<GenerateContentResponse>;
    parseJsonSafe: (raw: string, context: string) => any;
    getSelectedTemperature: () => number;
    getSelectedModel: () => string;
    getSelectedTopP: () => number;
    getSelectedStrategiesCount: () => number;
    getSelectedSubStrategiesCount: () => number;
    getRefinementEnabled: () => boolean;
    getSelectedHypothesisCount: () => number;
    getSelectedRedTeamAggressiveness: () => string;
    getSkipSubStrategies: () => boolean;
    getDissectedObservationsEnabled: () => boolean;
    getShareHypothesesToDissected: () => boolean;
    getIterativeCorrectionsEnabled: () => boolean;
    getIterativeDepth: () => number;
    getProvideAllSolutionsToCorrectors: () => boolean;
    getPostQualityFilterEnabled: () => boolean;
    getDeepthinkCodeExecutionEnabled: () => boolean;
    getModelProvider: () => string;
    getHypothesisInjectionMode: () => HypothesisInjectionMode;
    escapeHtml: (unsafe: string) => string;
    cleanTextOutput: (text: string) => string;
    updateControlsState: (newState: any) => void;
    getSelectedThinkingLevel?: () => 'low' | 'medium' | 'high' | 'minimal';
    customPromptsDeepthinkState: CustomizablePromptsDeepthink;
}

let deps: DeepthinkCoreDeps = null!;

// ========== CONSTANTS ==========

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 20000;
const BACKOFF_FACTOR = 2;
const STRUCTURED_SOLUTION_POOL_TIMEOUT_MS = 900000;

/** Model routing: maps step description keywords to prompt-state model keys */
const MODEL_MAP: [string, keyof CustomizablePromptsDeepthink][] = [
    ['Initial Strategy Generation', 'model_initialStrategy'],
    ['Sub-Strategy Generation', 'model_subStrategy'],
    ['Solution Attempt', 'model_solutionAttempt'],
    ['Solution Critique', 'model_solutionCritique'],
    ['Dissected Observations Synthesis', 'model_dissectedSynthesis'],
    ['Self-Improvement', 'model_selfImprovement'],
    ['Self Improvement', 'model_selfImprovement'],
    ['Hypothesis Generation', 'model_hypothesisGeneration'],
    ['Hypothesis Testing', 'model_hypothesisTester'],
    ['Red Team', 'model_redTeam'],
    ['PostQualityFilter', 'model_postQualityFilter'],
    ['Final Judge', 'model_finalJudge'],
];

/** Agents eligible for code execution */
const CODE_EXEC_AGENTS = new Set([
    'Hypothesis Testing', 'Solution Attempt', 'Solution Critique',
    'Self-Improvement', 'Self Improvement', 'Structured Solution Pool',
]);

// ========== UTILITY HELPERS ==========

/** Build image inline data parts from optional base64 + mimeType */
function buildImageParts(imageBase64?: string | null, imageMimeType?: string | null): Part[] {
    return (imageBase64 && imageMimeType)
        ? [{ inlineData: { mimeType: imageMimeType, data: imageBase64 } }]
        : [];
}


// ========== INITIALIZATION ==========

export function initializeDeepthinkCore(dependencies: DeepthinkCoreDeps & {
    setActiveDeepthinkPipeline: (pipeline: DeepthinkPipelineState | null) => void;
    renderActiveDeepthinkPipeline: () => void;
}) {
    const { setActiveDeepthinkPipeline: setFn, renderActiveDeepthinkPipeline: renderFn, ...coreDeps } = dependencies;
    deps = coreDeps as DeepthinkCoreDeps;
    setActiveDeepthinkPipeline = setFn;
    render = renderFn;
}

// Export for external use
export function getActiveDeepthinkPipeline() {
    return activeDeepthinkPipeline;
}

export function setActiveDeepthinkPipelineForImport(pipeline: DeepthinkPipelineState | null) {
    activeDeepthinkPipeline = pipeline;
    if (setActiveDeepthinkPipeline) {
        setActiveDeepthinkPipeline(pipeline);
    }
}

export function setActiveDeepthinkPipelineInternal(pipeline: DeepthinkPipelineState | null) {
    activeDeepthinkPipeline = pipeline;
}

// ========== RED TEAM EVALUATION FUNCTIONS ==========

export function applyRedTeamResults(currentProcess: DeepthinkPipelineState): void {
    currentProcess.redTeamEvaluations.forEach(redTeamAgent => {
        if (redTeamAgent.status === 'completed') {
            const reasonMap = (redTeamAgent as any).killedReasonMap || {};
            const fallbackReason = `Eliminated by Red Team Agent ${redTeamAgent.id}`;

            redTeamAgent.killedStrategyIds.forEach(strategyId => {
                const strategy = currentProcess.initialStrategies.find(s => s.id === strategyId);
                if (strategy) {
                    strategy.isKilledByRedTeam = true;
                    strategy.redTeamReason = reasonMap[strategyId] || fallbackReason;
                }
            });

            redTeamAgent.killedSubStrategyIds.forEach(subStrategyId => {
                currentProcess.initialStrategies.forEach(strategy => {
                    const subStrategy = strategy.subStrategies.find(sub => sub.id === subStrategyId);
                    if (subStrategy) {
                        subStrategy.isKilledByRedTeam = true;
                        subStrategy.redTeamReason = reasonMap[subStrategyId] || fallbackReason;
                    }
                });
            });
        }
    });
}

export async function runConsolidatedRedTeamAnalysis(
    currentProcess: DeepthinkPipelineState,
    strategies: DeepthinkMainStrategyData[],
    problemText: string,
    imageBase64: string | null | undefined,
    imageMimeType: string | null | undefined,
    makeDeepthinkApiCall: any,
    aggressiveness: string
): Promise<void> {
    if (!strategies || strategies.length === 0) return;

    const redTeamAgent: DeepthinkRedTeamData = {
        id: `redteam-consolidated`,
        assignedStrategyId: 'all',
        killedStrategyIds: [],
        killedSubStrategyIds: [],
        status: 'pending',
        isDetailsOpen: true
    };
    currentProcess.redTeamEvaluations = [redTeamAgent];
    render();

    if (currentProcess.isStopRequested) {
        redTeamAgent.status = 'cancelled';
        return;
    }

    try {
        redTeamAgent.status = 'processing';
        render();

        const allStrategiesText = strategies.map(mainStrategy => {
            const subStrategiesText = mainStrategy.subStrategies
                .map((sub) => `  - Sub-Strategy [ID: ${sub.id}]: ${sub.subStrategyText}`)
                .join('\n');
            return `Main Strategy [ID: ${mainStrategy.id}]:\n${mainStrategy.strategyText}\nSub-Strategies:\n${subStrategiesText}`;
        }).join('\n\n' + '='.repeat(40) + '\n\n');

        const aggressivenessConfig = RED_TEAM_AGGRESSIVENESS_LEVELS[aggressiveness as keyof typeof RED_TEAM_AGGRESSIVENESS_LEVELS] || RED_TEAM_AGGRESSIVENESS_LEVELS.balanced;
        const redTeamPrompt = deps.customPromptsDeepthinkState.user_deepthink_redTeam
            .replace('{{originalProblemText}}', problemText)
            .replace('{{allStrategies}}', allStrategiesText)
            .replace(/\{\{RED_TEAM_AGGRESSIVENESS\}\}/g, aggressivenessConfig.description);
        const redTeamSysPrompt = deps.customPromptsDeepthinkState.sys_deepthink_redTeam
            .replace(/\{\{RED_TEAM_AGGRESSIVENESS\}\}/g, aggressivenessConfig.description);

        const redTeamPromptParts: Part[] = [...buildImageParts(imageBase64, imageMimeType), { text: redTeamPrompt }];
        redTeamAgent.requestPrompt = redTeamPrompt + (imageBase64 ? "\n[Image Provided]" : "");

        const redTeamResponse = await makeDeepthinkApiCall(
            redTeamPromptParts,
            redTeamSysPrompt,
            true,
            `Red Team Evaluation`,
            redTeamAgent,
            'retryAttempt'
        );

        redTeamAgent.evaluationResponse = deps.cleanTextOutput(redTeamResponse);
        redTeamAgent.rawResponse = redTeamResponse;

        try {
            let cleanedResponse = redTeamResponse.trim();
            cleanedResponse = cleanedResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');

            const jsonStart = cleanedResponse.indexOf('{');
            const jsonEnd = cleanedResponse.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1 || jsonStart >= jsonEnd) {
                throw new Error(`No valid JSON object boundaries found`);
            }
            cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);

            const parsed = JSON.parse(cleanedResponse);
            redTeamAgent.reasoning = JSON.stringify(parsed, null, 2);

            const killedStrategyIds: string[] = [];
            const killedSubStrategyIds: string[] = [];
            const reasonMap: { [key: string]: string } = {};

            if (Array.isArray(parsed.strategy_evaluations)) {
                parsed.strategy_evaluations.forEach((evaluation: any) => {
                    if (!evaluation || typeof evaluation !== 'object') return;
                    const decision = String(evaluation.decision || '').toLowerCase();
                    const id = typeof evaluation.id === 'string' ? evaluation.id : '';
                    if (!id) return;
                    if (decision === 'eliminate') {
                        if (id.includes('main')) {
                            if (id.includes('sub')) {
                                killedSubStrategyIds.push(id);
                            } else {
                                killedStrategyIds.push(id);
                            }
                        }
                        const reason = evaluation.reason || 'No reason provided';
                        reasonMap[id] = reason;
                    }
                });
            }

            redTeamAgent.killedStrategyIds = killedStrategyIds;
            redTeamAgent.killedSubStrategyIds = killedSubStrategyIds;
            (redTeamAgent as any).killedReasonMap = reasonMap;
            redTeamAgent.status = 'completed';
            render();

        } catch (e: any) {
            console.error("Error parsing Red Team JSON:", e);
            redTeamAgent.status = 'error';
            redTeamAgent.error = "Failed to parse Red Team response: " + e.message;
            render();
        }
    } catch (error: any) {
        redTeamAgent.status = 'error';
        redTeamAgent.error = error.message || "Red Team evaluation failed";
        render();
    }
}

// ========== MAIN PIPELINE FUNCTION ==========

export async function startDeepthinkAnalysisProcess(challengeText: string, imageBase64?: string | null, imageMimeType?: string | null) {
    const currentAIProvider = deps.getAIProvider();
    if (!currentAIProvider) {
        alert("AI provider not initialized. Please check your API key configuration.");
        return;
    }

    activeDeepthinkPipeline = {
        id: `deepthink-${nanoid(12)}`,
        challenge: challengeText,
        challengeText: challengeText,
        initialStrategies: [],
        hypotheses: [],
        solutionCritiques: [],
        redTeamEvaluations: [],
        postQualityFilterAgents: [],
        structuredSolutionPoolAgents: [],
        status: 'processing',
        isStopRequested: false,
        activeTabId: 'live',
        activeStrategyTab: 0,
        strategicSolverComplete: false,
        hypothesisExplorerComplete: false,
        redTeamComplete: false,
        knowledgePacket: '',
        finalJudgingStatus: 'pending',
        structuredSolutionPoolEnabled: false,
        liveEvents: []
    };

    addLiveEvent(activeDeepthinkPipeline, "Orchestrator", "Initializing Multi-Agent Pipeline", "info");

    if (setActiveDeepthinkPipeline) {
        setActiveDeepthinkPipeline(activeDeepthinkPipeline);
    }

    deps.updateControlsState({ isGenerating: true });
    render();

    const currentProcess = activeDeepthinkPipeline!;

    const makeDeepthinkApiCall = async (
        parts: Part[],
        systemInstruction: string,
        isJson: boolean,
        stepDescription: string,
        targetStatusField: DeepthinkMainStrategyData | DeepthinkSubStrategyData | DeepthinkPipelineState | DeepthinkHypothesisData | DeepthinkSolutionCritiqueData | DeepthinkRedTeamData | DeepthinkPostQualityFilterData,
        retryAttemptField: 'retryAttempt' | 'selfImprovementRetryAttempt' | 'testerRetryAttempt' | 'hypothesisGenRetryAttempt' | 'solutionCritiqueRetryAttempt' | 'dissectedSynthesisRetryAttempt'
    ): Promise<string> => {
        if (!currentProcess || currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${stepDescription}`);
        let responseText = "";
        const promptText = parts.map(p => p.text || (p.inlineData ? `[Attached Image: ${p.inlineData.mimeType}]` : '')).join('\n');

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (currentProcess.isStopRequested) throw new PipelineStopRequestedError(`Stop requested during retry for: ${stepDescription}`);

            try {
                (targetStatusField as any)[retryAttemptField] = attempt;
                render();

                // Route to per-agent model via MODEL_MAP lookup
                const matched = MODEL_MAP.find(([key]) => stepDescription.includes(key));
                const agentModel = matched
                    ? (deps.customPromptsDeepthinkState[matched[1]] as string) || deps.getSelectedModel()
                    : deps.getSelectedModel();

                // Check code execution eligibility
                const isCodeExecutionAgent = [...CODE_EXEC_AGENTS].some(agent => stepDescription.includes(agent));
                const isGeminiProvider = deps.getModelProvider() === 'gemini';
                const shouldEnableCodeExecution = isCodeExecutionAgent && isGeminiProvider && deps.getDeepthinkCodeExecutionEnabled();

                const currentTemp = deps.getSelectedTemperature();
                const currentTopP = deps.getSelectedTopP();

                addLiveEvent(currentProcess, stepDescription, `Invoking agent model (Attempt ${attempt + 1}/${MAX_RETRIES + 1})`, "agent_start", {
                    systemInstruction,
                    prompt: promptText,
                    attempt: attempt + 1,
                    modelName: agentModel,
                    temperature: currentTemp,
                    topP: currentTopP,
                    codeExecutionEnabled: shouldEnableCodeExecution
                });

                const selectedThinkingLevel = deps.getSelectedThinkingLevel ? deps.getSelectedThinkingLevel() : 'high';
                const thinkingConfig: ThinkingConfig = {
                    codeExecution: shouldEnableCodeExecution,
                    thinkingLevel: selectedThinkingLevel
                };

                const strategyResponse = await deps.callGemini(parts, currentTemp, agentModel, systemInstruction, isJson, currentTopP, thinkingConfig);

                // Handle code execution responses specially to preserve code blocks and output
                if (shouldEnableCodeExecution && strategyResponse?.candidates?.[0]?.content?.parts) {
                    const orderedParts = extractPartsInOrder(strategyResponse);
                    responseText = formatPartsForDisplay(orderedParts);
                } else {
                    responseText = strategyResponse.text || "";
                }

                if (responseText && responseText.trim() !== "") {
                    addLiveEvent(currentProcess, stepDescription, `Agent completed successfully`, "agent_complete", {
                        response: responseText,
                        systemInstruction,
                        prompt: promptText,
                        modelName: agentModel,
                        temperature: currentTemp,
                        topP: currentTopP,
                        codeExecutionEnabled: shouldEnableCodeExecution
                    });
                    break;
                } else {
                    throw new Error("Empty response from API");
                }
            } catch (error: any) {
                const matched = MODEL_MAP.find(([key]) => stepDescription.includes(key));
                const agentModel = matched
                    ? (deps.customPromptsDeepthinkState[matched[1]] as string) || deps.getSelectedModel()
                    : deps.getSelectedModel();
                const isCodeExecutionAgent = [...CODE_EXEC_AGENTS].some(agent => stepDescription.includes(agent));
                const isGeminiProvider = deps.getModelProvider() === 'gemini';
                const shouldEnableCodeExecution = isCodeExecutionAgent && isGeminiProvider && deps.getDeepthinkCodeExecutionEnabled();
                const currentTemp = deps.getSelectedTemperature();
                const currentTopP = deps.getSelectedTopP();

                if (attempt === MAX_RETRIES) {
                    addLiveEvent(currentProcess, stepDescription, `Agent failed permanently: ${error.message || String(error)}`, "agent_error", {
                        error: error.message || String(error),
                        systemInstruction,
                        prompt: promptText,
                        modelName: agentModel,
                        temperature: currentTemp,
                        topP: currentTopP,
                        codeExecutionEnabled: shouldEnableCodeExecution
                    });
                    throw error;
                } else {
                    addLiveEvent(currentProcess, stepDescription, `Agent attempt failed: ${error.message || String(error)}`, "agent_retry", {
                        error: error.message || String(error),
                        attempt: attempt + 1,
                        systemInstruction,
                        prompt: promptText,
                        modelName: agentModel,
                        temperature: currentTemp,
                        topP: currentTopP,
                        codeExecutionEnabled: shouldEnableCodeExecution
                    });

                    if ('status' in targetStatusField) {
                        (targetStatusField as any).status = 'retrying';
                    }
                    (targetStatusField as any)[retryAttemptField] = attempt + 1;
                    render();

                    const delay = INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt);
                    console.log(`[Deepthink] ${stepDescription} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay / 1000}s...`);

                    const chunks = Math.ceil(delay / 500);
                    for (let i = 0; i < chunks; i++) {
                        if (currentProcess.isStopRequested) {
                            throw new PipelineStopRequestedError(`Stop requested during retry delay for: ${stepDescription}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, Math.min(500, delay - i * 500)));
                    }

                    if ('status' in targetStatusField) {
                        (targetStatusField as any).status = 'processing';
                    }
                    render();
                }
            }
        }

        return responseText;
    };

    const strategiesFinalizedSignal = {
        resolve: undefined as (() => void) | undefined
    };
    const strategiesFinalizedPromise = new Promise<void>((resolve) => {
        strategiesFinalizedSignal.resolve = () => resolve();
    });

    const mode = deps.getHypothesisInjectionMode();
    currentProcess.hypothesisInjectionMode = mode;

    try {
        // Track B: Hypothesis Explorer
        const trackBPromise = (async () => {
            try {
                const currentHypothesisCount = deps.getSelectedHypothesisCount();

                if (currentHypothesisCount === 0) {
                    currentProcess.hypothesisGenStatus = 'completed';
                    currentProcess.hypotheses = [];
                    currentProcess.knowledgePacket = "<Full Information Packet>\nHYPOTHESIS EXPLORATION: Disabled - No hypotheses generated.\n</Full Information Packet>";
                    currentProcess.hypothesisExplorerComplete = true;
                    render();
                    return;
                }

                // If strategy-aware or selective injection, wait for Track A to finalize strategies
                if (mode !== 'parallel') {
                    console.log('[Deepthink] Hypothesis injection mode is strategy-aware. Track B waiting for strategies to finalize...');
                    await strategiesFinalizedPromise;
                    if (currentProcess.isStopRequested || currentProcess.status === 'error') {
                        return;
                    }
                    console.log('[Deepthink] Track B starting hypothesis generation.');
                }

                let hypothesisPrompt = deps.customPromptsDeepthinkState.user_deepthink_hypothesisGeneration
                    .replace('{{originalProblemText}}', challengeText)
                    .replace(/\{\{NUM_HYPOTHESES\}\}/g, deps.getSelectedHypothesisCount().toString());

                if (mode !== 'parallel') {
                    const activeStrategies = currentProcess.initialStrategies.filter(s => !s.isKilledByRedTeam);
                    const activeStrategiesText = activeStrategies.map(mainStrategy => {
                        const activeSub = mainStrategy.subStrategies.filter(sub => !sub.isKilledByRedTeam);
                        const subStrategiesText = activeSub
                            .map((sub) => `  - Sub-Strategy [ID: ${sub.id}]: ${sub.subStrategyText}`)
                            .join('\n');
                        return `Main Strategy [ID: ${mainStrategy.id}]:\n${mainStrategy.strategyText}\nSub-Strategies:\n${subStrategiesText}`;
                    }).join('\n\n' + '='.repeat(40) + '\n\n');

                    const strategiesContextStr = `
<Finalized Strategies Context>
Below are the finalized strategies/sub-strategies that will be executed downstream. Generate hypotheses and reconnaissance targets specifically tailored to support, validate, or explore risks/feasibility for these strategies.
Do not generate generic or irrelevant hypotheses. Tailor your inquiries directly to the paths represented by these Strategy/Sub-Strategy IDs.

${activeStrategiesText}
</Finalized Strategies Context>`;

                    if (hypothesisPrompt.includes('{{strategiesContext}}')) {
                        hypothesisPrompt = hypothesisPrompt.replace('{{strategiesContext}}', strategiesContextStr);
                    } else {
                        hypothesisPrompt = hypothesisPrompt + '\n' + strategiesContextStr;
                    }
                }

                currentProcess.requestPromptHypothesisGen = hypothesisPrompt;
                currentProcess.hypothesisGenStatus = 'processing';
                render();

                const parts: Part[] = buildImageParts(imageBase64, imageMimeType);

                let hypothesisSysPrompt = deps.customPromptsDeepthinkState.sys_deepthink_hypothesisGeneration
                    .replace(/\{\{NUM_HYPOTHESES\}\}/g, deps.getSelectedHypothesisCount().toString());

                if (mode === 'selective_injection') {
                    const originalFormatSection = `<Output Format Requirements>
Your response must be exclusively a valid JSON object. No additional text, commentary, or explanation is permitted. This is an absolute system requirement for programmatic parsing. Any deviation will result in a fatal error. The JSON must adhere with perfect precision to the following structure:

\`\`\`json
{
  "hypotheses": [
    "Hypothesis 1: [A clear, precise, testable statement probing a critical unknown...]",
    "Hypothesis 2: [...]",
    "... up to Hypothesis {{NUM_HYPOTHESES}}"
  ]
}
\`\`\`
You MUST produce exactly {{NUM_HYPOTHESES}} hypotheses in the array.
</Output Format Requirements>`;

                    const newFormatSection = `<Output Format Requirements>
Your response must be exclusively a valid JSON object. No additional text, commentary, or explanation is permitted. This is an absolute system requirement for programmatic parsing. Any deviation will result in a fatal error. The JSON must adhere with perfect precision to the following structure:

\`\`\`json
{
  "hypotheses": [
    {
      "text": "Hypothesis 1: [A clear, precise, testable statement probing a critical unknown...]",
      "target_strategies": ["main1", "main2"] 
    },
    {
      "text": "Hypothesis 2: [...]",
      "target_strategies": ["main1"]
    }
  ]
}
\`\`\`
For "target_strategies", provide an array of Main Strategy IDs (e.g., "main1", "main2") to which this hypothesis is relevant. If a hypothesis is globally applicable to all strategies, or you cannot decide, return an empty array [] or include all strategy IDs.
You MUST produce exactly {{NUM_HYPOTHESES}} hypothesis objects in the array.
</Output Format Requirements>`;

                    if (hypothesisSysPrompt.includes(originalFormatSection)) {
                        hypothesisSysPrompt = hypothesisSysPrompt.replace(originalFormatSection, newFormatSection);
                    } else {
                        hypothesisSysPrompt += `\n\n<CRITICAL FORMAT OVERRIDE FOR SELECTIVE INJECTION>
You must return the hypotheses as objects containing "text" and "target_strategies" (an array of Main Strategy IDs like ["main1", "main2"] that this hypothesis is tailored for).
Example structure:
{
  "hypotheses": [
    {
      "text": "Hypothesis Text here",
      "target_strategies": ["main1"]
    }
  ]
}
</CRITICAL FORMAT OVERRIDE FOR SELECTIVE INJECTION>`;
                    }
                }

                const hypothesisResponse = await makeDeepthinkApiCall(
                    parts.concat([{ text: hypothesisPrompt }]),
                    hypothesisSysPrompt,
                    true,
                    "Hypothesis Generation",
                    currentProcess,
                    'hypothesisGenRetryAttempt'
                );

                const hypothesisData = deps.parseJsonSafe(hypothesisResponse, 'Hypothesis Generation');
                const hypotheses = hypothesisData.hypotheses || [];

                for (let i = 0; i < hypotheses.length; i++) {
                    let hypothesisText = "";
                    let targetStrategyIds: string[] | undefined = undefined;

                    const rawHyp = hypotheses[i];
                    if (typeof rawHyp === 'object' && rawHyp !== null) {
                        hypothesisText = rawHyp.text || "";
                        if (Array.isArray(rawHyp.target_strategies)) {
                            targetStrategyIds = rawHyp.target_strategies.map((id: any) => String(id).trim());
                        }
                    } else {
                        hypothesisText = String(rawHyp);
                    }

                    const hypothesis: DeepthinkHypothesisData = {
                        id: `hyp${i + 1}`,
                        hypothesisText: hypothesisText,
                        testerStatus: 'pending',
                        isDetailsOpen: false,
                        targetStrategyIds: targetStrategyIds
                    };
                    currentProcess.hypotheses.push(hypothesis);
                }

                currentProcess.hypothesisGenStatus = 'completed';
                render();

                const hypothesisTestingPromises = currentProcess.hypotheses.map(async (hypothesis) => {
                    if (currentProcess.isStopRequested) {
                        hypothesis.testerStatus = 'cancelled';
                        return;
                    }

                    hypothesis.testerStatus = 'processing';
                    render();

                    try {
                        const testerPrompt = deps.customPromptsDeepthinkState.user_deepthink_hypothesisTester
                            .replace('{{originalProblemText}}', challengeText)
                            .replace('{{hypothesisText}}', hypothesis.hypothesisText);

                        hypothesis.testerRequestPrompt = testerPrompt;

                        const testerResponse = await makeDeepthinkApiCall(
                            parts.concat([{ text: testerPrompt }]),
                            deps.customPromptsDeepthinkState.sys_deepthink_hypothesisTester,
                            false,
                            `Hypothesis Testing for ${hypothesis.id}`,
                            hypothesis,
                            'testerRetryAttempt'
                        );

                        hypothesis.testerAttempt = testerResponse;
                        hypothesis.testerStatus = 'completed';

                        render();
                    } catch (error: any) {
                        hypothesis.testerStatus = 'error';
                        hypothesis.testerError = error.message || "Hypothesis testing failed";
                        render();
                    }
                });

                await Promise.allSettled(hypothesisTestingPromises);

                // 1. Build global/full knowledge packet
                let knowledgePacket = "<Full Information Packet>\n";
                currentProcess.hypotheses.forEach((hypothesis, index) => {
                    knowledgePacket += `<Hypothesis ${index + 1}>\n`;
                    knowledgePacket += `Hypothesis: ${hypothesis.hypothesisText}\n`;
                    knowledgePacket += `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}\n`;
                    knowledgePacket += `</Hypothesis ${index + 1}>\n`;
                });
                knowledgePacket += "</Full Information Packet>";
                currentProcess.knowledgePacket = knowledgePacket;

                // 2. Build strategy-specific knowledge packets (Mode 3)
                if (mode === 'selective_injection') {
                    const strategyPackets: Record<string, string> = {};
                    const activeStrategies = currentProcess.initialStrategies.filter(s => !s.isKilledByRedTeam);

                    activeStrategies.forEach((strat) => {
                        const stratId = strat.id; // e.g. "main1"
                        const relevantHyps = currentProcess.hypotheses.filter(hyp => {
                            if (!hyp.targetStrategyIds || hyp.targetStrategyIds.length === 0) {
                                return true; // Global by default
                            }
                            return hyp.targetStrategyIds.includes(stratId);
                        });

                        let stratPacket = `<Strategy-Specific Information Packet for Strategy ${stratId}>\n`;
                        if (relevantHyps.length === 0) {
                            stratPacket += "No strategy-specific hypotheses were generated or mapped to this strategy.\n";
                        } else {
                            relevantHyps.forEach((hypothesis) => {
                                stratPacket += `<Hypothesis ${hypothesis.id}>\n`;
                                stratPacket += `Hypothesis: ${hypothesis.hypothesisText}\n`;
                                stratPacket += `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}\n`;
                                stratPacket += `</Hypothesis ${hypothesis.id}>\n`;
                            });
                        }
                        stratPacket += `</Strategy-Specific Information Packet for Strategy ${stratId}>`;
                        strategyPackets[stratId] = stratPacket;
                    });

                    currentProcess.strategySpecificKnowledgePackets = strategyPackets;
                }

                currentProcess.hypothesisExplorerComplete = true;
                render();

            } catch (error: any) {
                if (!(error instanceof PipelineStopRequestedError)) {
                    currentProcess.hypothesisGenStatus = 'error';
                    currentProcess.hypothesisGenError = `Hypothesis exploration failed: ${error.message}`;
                    render();
                }
                throw error;
            }
        })();

        // Track A: Strategic Solver - PART 1
        const trackAPromise = (async () => {
            try {
                currentProcess.status = 'processing';
                render();

                const parts: Part[] = buildImageParts(imageBase64, imageMimeType);

                const strategiesPrompt = deps.customPromptsDeepthinkState.user_deepthink_initialStrategy
                    .replace('{{originalProblemText}}', challengeText)
                    .replace(/\{\{NUM_STRATEGIES\}\}/g, deps.getSelectedStrategiesCount().toString());
                currentProcess.requestPromptInitialStrategyGen = strategiesPrompt;

                const strategiesResponse = await makeDeepthinkApiCall(
                    parts.concat([{ text: strategiesPrompt }]),
                    deps.customPromptsDeepthinkState.sys_deepthink_initialStrategy,
                    true,
                    "Initial Strategy Generation",
                    currentProcess,
                    'retryAttempt'
                );

                const parsedStrategies = deps.parseJsonSafe(strategiesResponse, 'Initial Strategy Generation');
                const strategies: string[] = parsedStrategies.strategies || parsedStrategies.features || parsedStrategies.suggestions || [];

                for (let i = 0; i < strategies.length; i++) {
                    const strategy: DeepthinkMainStrategyData = {
                        id: `main${i + 1}`,
                        strategyText: strategies[i],
                        subStrategies: [],
                        status: 'pending',
                        isDetailsOpen: false,
                        strategyFormat: 'markdown'
                    };
                    currentProcess.initialStrategies.push(strategy);
                }

                render();

                const skipSubStrategies = deps.getSkipSubStrategies();
                const currentRedTeamAggressiveness = deps.getSelectedRedTeamAggressiveness();

                currentProcess.redTeamEvaluations = [];
                if (currentRedTeamAggressiveness !== 'off') {
                    currentProcess.redTeamStatus = 'processing';
                } else {
                    currentProcess.redTeamStatus = 'completed';
                    currentProcess.redTeamComplete = true;
                }
                render();

                if (skipSubStrategies) {
                    currentProcess.initialStrategies.forEach((mainStrategy) => {
                        const subStrategy: DeepthinkSubStrategyData = {
                            id: `${mainStrategy.id}-direct`,
                            subStrategyText: mainStrategy.strategyText,
                            status: 'pending',
                            isDetailsOpen: false,
                            subStrategyFormat: 'markdown'
                        };
                        mainStrategy.subStrategies.push(subStrategy);
                    });
                    render();
                } else {
                    await Promise.allSettled(currentProcess.initialStrategies.map(async (mainStrategy) => {
                        if (currentProcess.isStopRequested) {
                            mainStrategy.status = 'cancelled';
                            mainStrategy.error = "Process stopped by user.";
                            return;
                        }

                        try {
                            mainStrategy.status = 'processing';
                            render();

                            const otherStrategies = currentProcess.initialStrategies
                                .filter(s => s.id !== mainStrategy.id)
                                .map(s => s.strategyText);
                            const otherMainStrategiesStr = otherStrategies.length > 0
                                ? otherStrategies.map((s, idx) => `Strategy ${idx + 1}: ${s}`).join('\n\n')
                                : "No other strategies.";

                            const subStrategyPrompt = deps.customPromptsDeepthinkState.user_deepthink_subStrategy
                                .replace('{{originalProblemText}}', challengeText)
                                .replace('{{currentMainStrategy}}', mainStrategy.strategyText)
                                .replace('{{otherMainStrategiesStr}}', otherMainStrategiesStr)
                                .replace(/\{\{NUM_SUB_STRATEGIES\}\}/g, deps.getSelectedSubStrategiesCount().toString());

                            mainStrategy.requestPromptSubStrategyGen = subStrategyPrompt;

                            const subStrategyResponse = await makeDeepthinkApiCall(
                                parts.concat([{ text: subStrategyPrompt }]),
                                deps.customPromptsDeepthinkState.sys_deepthink_subStrategy,
                                true,
                                `Sub-Strategy Generation for ${mainStrategy.id}`,
                                mainStrategy,
                                'retryAttempt'
                            );

                            const parsedSub = deps.parseJsonSafe(subStrategyResponse, `Sub-Strategy Generation for ${mainStrategy.id}`);
                            const subStrategies: string[] = parsedSub.sub_strategies || parsedSub.subStrategies || parsedSub.strategies || [];

                            for (let j = 0; j < subStrategies.length; j++) {
                                const subStrategy: DeepthinkSubStrategyData = {
                                    id: `${mainStrategy.id}-sub${j + 1}`,
                                    subStrategyText: subStrategies[j],
                                    status: 'pending',
                                    isDetailsOpen: false,
                                    subStrategyFormat: 'markdown'
                                };
                                mainStrategy.subStrategies.push(subStrategy);
                            }

                        } catch (error: any) {
                            mainStrategy.status = 'error';
                            mainStrategy.error = error.message || "Sub-strategy generation failed";
                            render();
                        }
                    }));
                }

                if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped after sub-strategy generation.");

                if (currentRedTeamAggressiveness !== 'off') {
                    await runConsolidatedRedTeamAnalysis(
                        currentProcess,
                        currentProcess.initialStrategies,
                        challengeText,
                        imageBase64,
                        imageMimeType,
                        makeDeepthinkApiCall,
                        currentRedTeamAggressiveness
                    );
                    currentProcess.redTeamComplete = true;
                    currentProcess.redTeamStatus = 'completed';
                    render();

                    applyRedTeamResults(currentProcess);
                    render();

                    // Signal that strategies are finalized
                    if (strategiesFinalizedSignal.resolve) {
                        strategiesFinalizedSignal.resolve();
                    }

                    const remainingStrategies = currentProcess.initialStrategies.filter(s => !s.isKilledByRedTeam);
                    const remainingSubStrategies = currentProcess.initialStrategies.flatMap(s => s.subStrategies.filter(sub => !sub.isKilledByRedTeam));
                    if (remainingStrategies.length === 0) {
                        currentProcess.status = 'completed';
                        currentProcess.error = "All strategies were eliminated by Red Team evaluation. No solution attempts can be made.";
                        render();
                        return;
                    }
                    if (remainingSubStrategies.length === 0) {
                        currentProcess.status = 'completed';
                        currentProcess.error = "All sub-strategies were eliminated by Red Team evaluation. No solution attempts can be made.";
                        render();
                        return;
                    }
                } else {
                    // Signal that strategies are finalized (since Red Team is off)
                    if (strategiesFinalizedSignal.resolve) {
                        strategiesFinalizedSignal.resolve();
                    }
                }

                const hypothesisCount = deps.getSelectedHypothesisCount();
                if (hypothesisCount > 0) {
                    console.log('[Deepthink] Waiting for hypothesis exploration to complete before executing solutions...');
                    await trackBPromise;
                    console.log('[Deepthink] Hypothesis exploration complete. Proceeding to solution execution...');
                }

                if (currentProcess.isStopRequested) {
                    throw new PipelineStopRequestedError("Stopped while waiting for hypothesis exploration.");
                }

                const refinementEnabled = deps.getRefinementEnabled();
                const iterativeCorrectionsEnabled = deps.getIterativeCorrectionsEnabled();
                const dissectedObservationsEnabled = deps.getDissectedObservationsEnabled();

                currentProcess.solutionCritiques = [];
                if (!iterativeCorrectionsEnabled && refinementEnabled) {
                    currentProcess.solutionCritiquesStatus = 'processing';
                }

                const critiquePromisesPerStrategy: Promise<void>[] = [];

                const strategyExecutionPromises = currentProcess.initialStrategies.map(async (mainStrategy) => {
                    const activeSubStrategies = mainStrategy.subStrategies.filter(sub => !sub.isKilledByRedTeam);
                    if (activeSubStrategies.length === 0) return;

                    const subStrategyExecutions = activeSubStrategies.map(async (subStrategy) => {
                        if (currentProcess.isStopRequested) {
                            subStrategy.status = 'cancelled';
                            subStrategy.error = "Process stopped by user.";
                            return;
                        }

                        try {
                            subStrategy.status = 'processing';
                            render();

                            let injectedPacket = currentProcess.knowledgePacket || 'No hypothesis exploration performed.';
                            if (mode === 'selective_injection' && currentProcess.strategySpecificKnowledgePackets) {
                                injectedPacket = currentProcess.strategySpecificKnowledgePackets[mainStrategy.id] || injectedPacket;
                            }

                            const solutionPrompt = deps.customPromptsDeepthinkState.user_deepthink_solutionAttempt
                                .replace('{{originalProblemText}}', challengeText)
                                .replace('{{currentMainStrategy}}', mainStrategy.strategyText)
                                .replace('{{currentSubStrategy}}', subStrategy.subStrategyText)
                                .replace('{{knowledgePacket}}', injectedPacket);

                            subStrategy.requestPromptSolutionAttempt = solutionPrompt;

                            const solutionResponse = await makeDeepthinkApiCall(
                                parts.concat([{ text: solutionPrompt }]),
                                deps.customPromptsDeepthinkState.sys_deepthink_solutionAttempt,
                                false,
                                `Solution Attempt for ${subStrategy.id}`,
                                subStrategy,
                                'retryAttempt'
                            );

                            subStrategy.solutionAttempt = solutionResponse;
                            subStrategy.status = 'completed';
                            render();
                        } catch (error: any) {
                            subStrategy.status = 'error';
                            subStrategy.error = error.message || "Solution attempt failed";
                            render();
                        }
                    });

                    await Promise.allSettled(subStrategyExecutions);

                    if (!iterativeCorrectionsEnabled && refinementEnabled) {
                        const completedSubStrategies = mainStrategy.subStrategies.filter(
                            sub => !sub.isKilledByRedTeam && sub.solutionAttempt
                        );

                        if (completedSubStrategies.length > 0) {
                            const critiquePromise = (async () => {
                                const critiqueData: DeepthinkSolutionCritiqueData = {
                                    id: `critique-${mainStrategy.id}`,
                                    subStrategyId: '',
                                    mainStrategyId: mainStrategy.id,
                                    status: 'pending',
                                    isDetailsOpen: true
                                };
                                currentProcess.solutionCritiques.push(critiqueData);
                                render();

                                if (currentProcess.isStopRequested) {
                                    critiqueData.status = 'cancelled';
                                    critiqueData.error = "Process stopped by user.";
                                    return;
                                }

                                try {
                                    critiqueData.status = 'processing';
                                    render();

                                    const solutionsText = completedSubStrategies.map(sub =>
                                        `${sub.id}:\nSub-Strategy: ${sub.subStrategyText}\n\nSolution Attempt:\n${sub.solutionAttempt}`
                                    ).join('\n\n---\n\n');

                                    const critiquePrompt = deps.customPromptsDeepthinkState.user_deepthink_solutionCritique
                                        .replace('{{originalProblemText}}', challengeText)
                                        .replace('{{currentMainStrategy}}', mainStrategy.strategyText)
                                        .replace('{{allSubStrategiesAndSolutions}}', solutionsText);

                                    critiqueData.requestPrompt = critiquePrompt;

                                    const critiqueResponse = await makeDeepthinkApiCall(
                                        parts.concat([{ text: critiquePrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_solutionCritique,
                                        false,
                                        `Solution Critique for ${mainStrategy.id}`,
                                        critiqueData,
                                        'retryAttempt'
                                    );

                                    critiqueData.critiqueResponse = critiqueResponse;

                                    completedSubStrategies.forEach(sub => {
                                        sub.solutionCritique = critiqueResponse;
                                        sub.solutionCritiqueStatus = 'completed';
                                    });

                                    critiqueData.status = 'completed';
                                    render();
                                } catch (error: any) {
                                    critiqueData.status = 'error';
                                    critiqueData.error = error.message || "Solution critique failed";

                                    completedSubStrategies.forEach(sub => {
                                        sub.solutionCritiqueStatus = 'error';
                                        sub.solutionCritiqueError = error.message || "Solution critique failed";
                                    });

                                    render();
                                }
                            })();

                            critiquePromisesPerStrategy.push(critiquePromise);
                        }
                    }
                });

                console.log('[Deepthink] Waiting for all solution executions to complete...');
                await Promise.allSettled(strategyExecutionPromises);
                console.log('[Deepthink] All solution executions complete.');

                if (!iterativeCorrectionsEnabled && refinementEnabled && dissectedObservationsEnabled) {
                    console.log('[Deepthink] Dissected observations enabled - waiting for all critiques to complete...');
                    await Promise.allSettled(critiquePromisesPerStrategy);
                    currentProcess.solutionCritiquesStatus = 'completed';
                    render();
                    console.log('[Deepthink] All critiques complete.');
                } else if (!iterativeCorrectionsEnabled && refinementEnabled && !dissectedObservationsEnabled) {
                    console.log('[Deepthink] Dissected observations disabled - critiques running in background, correctors starting immediately.');
                }

                if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during solution attempts or critiques.");

                if (!refinementEnabled) {
                    currentProcess.initialStrategies.forEach((mainStrategy) => {
                        mainStrategy.subStrategies.forEach((subStrategy) => {
                            if (subStrategy.isKilledByRedTeam || !subStrategy.solutionAttempt) return;
                            subStrategy.refinedSolution = subStrategy.solutionAttempt;
                            subStrategy.selfImprovementStatus = 'completed';
                        });
                    });
                    render();
                } else if (iterativeCorrectionsEnabled) {
                    // PostQualityFilter workflow - only when sub-strategies are disabled
                    const skipSubStrategies = deps.getSkipSubStrategies();
                    const postQualityFilterEnabled = deps.getPostQualityFilterEnabled();
                    if (skipSubStrategies) {
                        // Only run PostQualityFilter if enabled
                        // Initial critiques are needed for PQF to evaluate strategies
                        // When PQF is disabled, the main iteration loop handles critiques at iteration 1
                        if (postQualityFilterEnabled) {
                            console.log('[Deepthink] Generating initial critiques for PostQualityFilter...');

                            // Generate initial critiques for all strategies
                            const initialCritiquePromises: Promise<void>[] = [];
                            currentProcess.initialStrategies.forEach((mainStrategy) => {
                                if (mainStrategy.isKilledByRedTeam) return;
                                const directSub = mainStrategy.subStrategies[0];
                                if (!directSub || directSub.isKilledByRedTeam || !directSub.solutionAttempt) return;

                                const critiquePromise = (async () => {
                                    try {
                                        directSub.solutionCritiqueStatus = 'processing';
                                        render();

                                        const solutionsText = `${directSub.id}:\nSub-Strategy: ${directSub.subStrategyText}\n\nSolution Attempt:\n${directSub.solutionAttempt}`;

                                        const critiquePrompt = deps.customPromptsDeepthinkState.user_deepthink_solutionCritique
                                            .replace(/\{\{originalProblemText\}\}/g, challengeText)
                                            .replace(/\{\{currentMainStrategy\}\}/g, mainStrategy.strategyText)
                                            .replace(/\{\{allSubStrategiesAndSolutions\}\}/g, solutionsText);

                                        const critiqueResponse = await makeDeepthinkApiCall(
                                            parts.concat([{ text: critiquePrompt }]),
                                            deps.customPromptsDeepthinkState.sys_deepthink_solutionCritique,
                                            false,
                                            `Initial Solution Critique for ${mainStrategy.id}`,
                                            directSub,
                                            'solutionCritiqueRetryAttempt'
                                        );

                                        directSub.solutionCritique = deps.cleanTextOutput(critiqueResponse);
                                        directSub.solutionCritiqueStatus = 'completed';
                                        render();
                                    } catch (error: any) {
                                        directSub.solutionCritiqueStatus = 'error';
                                        directSub.solutionCritiqueError = error.message || "Initial critique failed";
                                        console.error(`[Deepthink] Initial critique failed for ${mainStrategy.id}:`, error.message);
                                        render();
                                    }
                                })();

                                initialCritiquePromises.push(critiquePromise);
                            });

                            await Promise.allSettled(initialCritiquePromises);
                            console.log('[Deepthink] Initial critiques complete');
                            console.log('[Deepthink] Starting PostQualityFilter workflow...');
                            currentProcess.postQualityFilterStatus = 'processing';
                            currentProcess.postQualityFilterIterationCount = 0;
                            render();

                            // Initialize history managers
                            const postQualityFilterHistoryManager = new PostQualityFilterHistoryManager(
                                deps.customPromptsDeepthinkState.sys_deepthink_postQualityFilter,
                                challengeText
                            );
                            const strategiesGeneratorHistoryManager = new StrategiesGeneratorHistoryManager(
                                deps.customPromptsDeepthinkState.sys_deepthink_initialStrategy,
                                challengeText
                            );



                            // Run PostQualityFilter iterations (max 3)
                            for (let pqfIteration = 1; pqfIteration <= 3; pqfIteration++) {
                                if (currentProcess.isStopRequested) break;
                                console.log(`[Deepthink] PostQualityFilter iteration ${pqfIteration}...`);
                                currentProcess.postQualityFilterIterationCount = pqfIteration;

                                // Get all strategies with their solutions and critiques
                                const strategiesWithExecutions: Array<{
                                    strategyId: string;
                                    strategyText: string;
                                    solutionAttempt: string;
                                    solutionCritique: string;
                                }> = [];

                                currentProcess.initialStrategies.forEach(mainStrategy => {
                                    if (mainStrategy.isKilledByRedTeam) return;
                                    const directSub = mainStrategy.subStrategies[0];
                                    if (!directSub || !directSub.solutionAttempt || !directSub.solutionCritique) return;

                                    strategiesWithExecutions.push({
                                        strategyId: mainStrategy.id,
                                        strategyText: mainStrategy.strategyText,
                                        solutionAttempt: directSub.solutionAttempt,
                                        solutionCritique: directSub.solutionCritique
                                    });
                                });

                                if (strategiesWithExecutions.length === 0) {
                                    console.log('[Deepthink] No strategies available for PostQualityFilter');
                                    break;
                                }

                                // Build prompt using history manager
                                const pqfPromptMessages = await postQualityFilterHistoryManager.buildPromptForIteration(
                                    strategiesWithExecutions,
                                    pqfIteration
                                );
                                const pqfPrompt = pqfPromptMessages.map(m => m.content).join('\n\n');

                                // Create PostQualityFilter agent
                                const pqfAgent: DeepthinkPostQualityFilterData = {
                                    id: `postqf-${pqfIteration}`,
                                    iterationNumber: pqfIteration,
                                    requestPrompt: pqfPrompt,
                                    prunedStrategyIds: [],
                                    continuedStrategyIds: [],
                                    status: 'processing',
                                    isDetailsOpen: true
                                };
                                currentProcess.postQualityFilterAgents.push(pqfAgent);
                                render();

                                try {
                                    // Call PostQualityFilter agent
                                    const pqfResponse = await makeDeepthinkApiCall(
                                        parts.concat([{ text: pqfPrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_postQualityFilter,
                                        true,
                                        `PostQualityFilter Iteration ${pqfIteration}`,
                                        pqfAgent,
                                        'retryAttempt'
                                    );

                                    pqfAgent.evaluationResponse = deps.cleanTextOutput(pqfResponse);
                                    pqfAgent.rawResponse = pqfResponse;

                                    // Parse JSON response
                                    let cleanedResponse = pqfResponse.trim();
                                    cleanedResponse = cleanedResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');
                                    const jsonStart = cleanedResponse.indexOf('{');
                                    const jsonEnd = cleanedResponse.lastIndexOf('}');
                                    if (jsonStart === -1 || jsonEnd === -1 || jsonStart >= jsonEnd) {
                                        throw new Error('No valid JSON object boundaries found');
                                    }
                                    cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
                                    const parsed = JSON.parse(cleanedResponse);

                                    // Extract decisions
                                    const updateIds: string[] = []; // Strategies that need updating
                                    const keepIds: string[] = []; // Strategies that are good

                                    // Create set of valid strategy IDs that were sent for evaluation
                                    const validStrategyIds = new Set(strategiesWithExecutions.map(s => s.strategyId.trim().toLowerCase()));

                                    if (Array.isArray(parsed.strategies)) {
                                        parsed.strategies.forEach((strategyEval: any) => {
                                            const decision = String(strategyEval.decision || '').toLowerCase();
                                            const id = strategyEval.strategy_id || '';

                                            // CRITICAL: Validate that this strategy was actually sent for evaluation
                                            const cleanId = String(id).trim().toLowerCase();
                                            if (!validStrategyIds.has(cleanId)) {
                                                console.log(`[Deepthink] PostQualityFilter returned decision for unexpected strategy "${id}" - IGNORING`);
                                                return; // Skip this decision
                                            }

                                            if (decision === 'update') {
                                                updateIds.push(id);
                                            } else if (decision === 'keep') {
                                                keepIds.push(id);
                                            }
                                        });
                                    }

                                    pqfAgent.reasoning = JSON.stringify(parsed, null, 2);
                                    pqfAgent.prunedStrategyIds = updateIds; // Reusing this field for updateIds
                                    pqfAgent.continuedStrategyIds = keepIds; // Reusing this field for keepIds
                                    pqfAgent.status = 'completed';

                                    // Add to history (both user prompt and AI response)
                                    await postQualityFilterHistoryManager.addFilterDecision(pqfResponse, pqfPrompt);

                                    console.log(`[Deepthink] PostQualityFilter: ${updateIds.length} strategies need update, ${keepIds.length} kept`);

                                    // If no strategies need update, stop
                                    if (updateIds.length === 0) {
                                        console.log('[Deepthink] No strategies need update - stopping PostQualityFilter workflow');
                                        break;
                                    }

                                    // If this is the 3rd iteration, don't update strategies
                                    if (pqfIteration === 3) {
                                        console.log('[Deepthink] Reached max PostQualityFilter iterations (3) - stopping');
                                        break;
                                    }

                                    // Generate UPDATED strategies (same IDs, new text)
                                    console.log(`[Deepthink] Updating ${updateIds.length} flawed strategies...`);

                                    const strategiesGenPromptMessages = await strategiesGeneratorHistoryManager.buildPromptForGeneration(
                                        updateIds.length,
                                        updateIds,
                                        keepIds,
                                        pqfIteration
                                    );
                                    const strategiesGenPrompt = strategiesGenPromptMessages.map(m => m.content).join('\n\n');

                                    const updatedStrategiesResponse = await makeDeepthinkApiCall(
                                        parts.concat([{ text: strategiesGenPrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_initialStrategy,
                                        true,
                                        `Strategy Updates (PostQualityFilter Iteration ${pqfIteration})`,
                                        currentProcess,
                                        'retryAttempt'
                                    );

                                    const parsedUpdated = deps.parseJsonSafe(updatedStrategiesResponse, `Strategy Updates (PostQualityFilter Iteration ${pqfIteration})`);
                                    const updatedStrategies: string[] = parsedUpdated.strategies || parsedUpdated.features || parsedUpdated.suggestions || Object.values(parsedUpdated) || [];

                                    // Add to history (user prompt + AI response)
                                    await strategiesGeneratorHistoryManager.addGeneratedStrategies(updatedStrategiesResponse, strategiesGenPrompt);

                                    // Update existing strategies IN-PLACE (same IDs)
                                    const updatedStrategyObjects: DeepthinkMainStrategyData[] = [];
                                    for (let i = 0; i < Math.min(updatedStrategies.length, updateIds.length); i++) {
                                        const strategyId = updateIds[i];
                                        const cleanId = String(strategyId).trim().toLowerCase();
                                        const existingStrategy = currentProcess.initialStrategies.find(s =>
                                            s.id.trim().toLowerCase() === cleanId
                                        );

                                        if (existingStrategy) {
                                            // Update strategy text IN-PLACE
                                            existingStrategy.strategyText = updatedStrategies[i];
                                            existingStrategy.updatedByPostQualityFilter = true;
                                            existingStrategy.postQualityFilterIteration = pqfIteration;

                                            // Reset sub-strategy for re-execution
                                            const directSub = existingStrategy.subStrategies[0];
                                            if (directSub) {
                                                directSub.subStrategyText = updatedStrategies[i];
                                                directSub.status = 'pending';
                                                directSub.solutionAttempt = undefined;
                                                directSub.solutionCritique = undefined;
                                                directSub.solutionCritiqueStatus = undefined;
                                            }

                                            updatedStrategyObjects.push(existingStrategy);
                                        }
                                    }

                                    render();

                                    // Re-execute solutions for updated strategies
                                    console.log(`[Deepthink] Re-executing solutions for ${updatedStrategyObjects.length} updated strategies...`);
                                    const updatedStrategyExecutionPromises = updatedStrategyObjects.map(async (strategy) => {
                                        const directSub = strategy.subStrategies[0];
                                        if (!directSub) return;

                                        try {
                                            directSub.status = 'processing';
                                            render();

                                            let injectedPacket = currentProcess.knowledgePacket || '';
                                            if (mode === 'selective_injection' && currentProcess.strategySpecificKnowledgePackets) {
                                                injectedPacket = currentProcess.strategySpecificKnowledgePackets[strategy.id] || injectedPacket;
                                            }

                                            const solutionPrompt = deps.customPromptsDeepthinkState.user_deepthink_solutionAttempt
                                                .replace('{{originalProblemText}}', challengeText)
                                                .replace('{{assignedStrategy}}', strategy.strategyText)
                                                .replace('{{knowledgePacket}}', injectedPacket);

                                            directSub.requestPromptSolutionAttempt = solutionPrompt;

                                            const solutionResponse = await makeDeepthinkApiCall(
                                                parts.concat([{ text: solutionPrompt }]),
                                                deps.customPromptsDeepthinkState.sys_deepthink_solutionAttempt,
                                                false,
                                                `Solution Execution for ${strategy.id} (Updated)`,
                                                directSub,
                                                'retryAttempt'
                                            );

                                            directSub.solutionAttempt = deps.cleanTextOutput(solutionResponse);
                                            directSub.status = 'completed';
                                            render();

                                            // Generate critique immediately
                                            directSub.solutionCritiqueStatus = 'processing';
                                            render();

                                            const solutionsText = `${directSub.id}:\nSub-Strategy: ${directSub.subStrategyText}\n\nSolution Attempt:\n${directSub.solutionAttempt}`;

                                            const critiquePrompt = deps.customPromptsDeepthinkState.user_deepthink_solutionCritique
                                                .replace('{{originalProblemText}}', challengeText)
                                                .replace('{{currentMainStrategy}}', strategy.strategyText)
                                                .replace('{{allSubStrategiesAndSolutions}}', solutionsText);

                                            directSub.requestPromptSolutionCritique = critiquePrompt;

                                            const critiqueResponse = await makeDeepthinkApiCall(
                                                parts.concat([{ text: critiquePrompt }]),
                                                deps.customPromptsDeepthinkState.sys_deepthink_solutionCritique,
                                                false,
                                                `Solution Critique for ${strategy.id} (Updated)`,
                                                directSub,
                                                'solutionCritiqueRetryAttempt'
                                            );

                                            directSub.solutionCritique = deps.cleanTextOutput(critiqueResponse);
                                            directSub.solutionCritiqueStatus = 'completed';
                                            render();

                                        } catch (error: any) {
                                            directSub.status = 'error';
                                            directSub.error = error.message || 'Solution execution failed';
                                            render();
                                        }
                                    });

                                    await Promise.allSettled(updatedStrategyExecutionPromises);
                                    console.log(`[Deepthink] Completed re-execution for updated strategies`);

                                    // CRITICAL: Mark updated strategies so PQF re-evaluates them with new executions
                                    postQualityFilterHistoryManager.markStrategiesAsUpdated(updateIds);
                                    console.log(`[Deepthink] Marked ${updateIds.length} strategies as updated for re-evaluation`);

                                    render();

                                } catch (error: any) {
                                    pqfAgent.status = 'error';
                                    pqfAgent.error = error.message || 'PostQualityFilter failed';
                                    console.error(`[Deepthink] PostQualityFilter error:`, error.message);
                                    render();
                                    break;
                                }
                            }

                            currentProcess.postQualityFilterStatus = 'completed';
                            console.log('[Deepthink] PostQualityFilter workflow complete');
                            render();
                        } else {
                            // PostQualityFilter is disabled - proceed directly with current strategies
                            console.log('[Deepthink] PostQualityFilter disabled - proceeding with current strategies');
                            currentProcess.postQualityFilterStatus = 'completed';
                        }
                    }

                    // StructuredSolutionPool mode enabled
                    currentProcess.structuredSolutionPoolEnabled = true;
                    currentProcess.structuredSolutionPoolStatus = 'processing';
                    console.log('[Deepthink] Starting StructuredSolutionPool mode with iterative corrections...');

                    // Get active main strategies (sub-strategies are disabled in this mode)
                    const activeMainStrategies = currentProcess.initialStrategies.filter(s => !s.isKilledByRedTeam);

                    if (activeMainStrategies.length === 0) {
                        console.log('[Deepthink] No active main strategies. Skipping StructuredSolutionPool.');
                        currentProcess.structuredSolutionPoolStatus = 'completed';
                    } else {
                        // Helper function to build StructuredSolutionPool string
                        const buildStructuredSolutionPool = (): string => {
                            const poolData: {
                                strategies: Array<{
                                    strategy_id: string;
                                    strategy_text: string;
                                    original_solution: string;
                                    iterations: Array<{
                                        iteration_number: number;
                                        critique: string;
                                        corrected_solution: string;
                                    }>;
                                    latest_critique?: string;
                                    solution_pool?: any;
                                }>;
                            } = { strategies: [] };

                            activeMainStrategies.forEach((mainStrategy) => {
                                const directSub = mainStrategy.subStrategies[0];
                                if (!directSub || directSub.isKilledByRedTeam || !directSub.solutionAttempt) return;

                                const strategyEntry: any = {
                                    strategy_id: mainStrategy.id,
                                    strategy_text: mainStrategy.strategyText,
                                    original_solution: directSub.solutionAttempt,
                                    iterations: []
                                };

                                // Add critiques and corrected solutions from COMPLETED iterations
                                // History compression: only keep the last 3 iterations in full detail
                                const iterations = (directSub as any).iterativeCorrections?.iterations || [];
                                const compressionThreshold = 3;
                                const totalIterations = iterations.length;
                                if (totalIterations > compressionThreshold) {
                                    strategyEntry.compressed_iterations_note = `Iterations 1-${totalIterations - compressionThreshold} completed and compressed. See atomic_reconstruction in solution_pool for summaries.`;
                                }
                                const startIdx = Math.max(0, totalIterations - compressionThreshold);
                                iterations.forEach((iter: any, idx: number) => {
                                    if (idx >= startIdx) {
                                        strategyEntry.iterations.push({
                                            iteration_number: idx + 1,
                                            critique: iter.critique,
                                            corrected_solution: iter.correctedSolution
                                        });
                                    }
                                });

                                // CRITICAL FIX: Add the LATEST critique if it exists but isn't in the iterations array yet
                                if (directSub.solutionCritique && directSub.solutionCritiqueStatus === 'completed') {
                                    const lastIter = iterations.length > 0 ? iterations[iterations.length - 1] : null;
                                    if (!lastIter || lastIter.critique !== directSub.solutionCritique) {
                                        strategyEntry.latest_critique = directSub.solutionCritique;
                                    }
                                }

                                // Add solution pool output if exists
                                const poolAgent = currentProcess.structuredSolutionPoolAgents.find(a => a.mainStrategyId === mainStrategy.id);
                                if (poolAgent && poolAgent.poolResponse) {
                                    // Try to use parsed pool response if available, otherwise include raw
                                    strategyEntry.solution_pool = poolAgent.parsedPoolResponse || poolAgent.poolResponse;
                                }

                                poolData.strategies.push(strategyEntry);
                            });

                            return JSON.stringify(poolData, null, 2);
                        };

                        // Helper function to make API call with timeout
                        const makeDeepthinkApiCallWithTimeout = async (
                            parts: Part[],
                            systemInstruction: string,
                            isJson: boolean,
                            stepDescription: string,
                            targetStatusField: any,
                            retryAttemptField: 'retryAttempt' | 'selfImprovementRetryAttempt' | 'testerRetryAttempt' | 'hypothesisGenRetryAttempt' | 'solutionCritiqueRetryAttempt' | 'dissectedSynthesisRetryAttempt'
                        ): Promise<string> => {
                            return Promise.race([
                                makeDeepthinkApiCall(parts, systemInstruction, isJson, stepDescription, targetStatusField, retryAttemptField),
                                new Promise<string>((_, reject) =>
                                    setTimeout(() => reject(new Error(`Timeout after ${STRUCTURED_SOLUTION_POOL_TIMEOUT_MS / 1000 / 60} minutes`)),
                                        STRUCTURED_SOLUTION_POOL_TIMEOUT_MS)
                                )
                            ]);
                        };

                        // Initialize iterative corrections for all active strategies
                        activeMainStrategies.forEach((mainStrategy) => {
                            const directSub = mainStrategy.subStrategies[0];
                            if (directSub && !directSub.isKilledByRedTeam && directSub.solutionAttempt) {
                                (directSub as any).iterativeCorrections = {
                                    iterations: [],
                                    status: 'processing'
                                };
                            }
                        });

                        // Initialize StructuredSolutionPool
                        currentProcess.structuredSolutionPool = buildStructuredSolutionPool();
                        console.log('[Deepthink] Initialized StructuredSolutionPool');

                        // Track initial version for evolution viewer
                        if (currentProcess.structuredSolutionPool) {
                            addSolutionPoolVersion(currentProcess.id, currentProcess.structuredSolutionPool, 0);
                        }

                        render();

                        // Initialize history managers for critiques, pool agents, and correctors
                        const critiqueHistoryManagers = new Map<string, SolutionCritiqueHistoryManager>();
                        const poolHistoryManagers = new Map<string, StructuredSolutionPoolHistoryManager>();
                        const correctionHistoryManagers = new Map<string, SolutionCorrectionHistoryManager>();

                        activeMainStrategies.forEach((mainStrategy) => {
                            const directSub = mainStrategy.subStrategies[0];
                            if (!directSub || directSub.isKilledByRedTeam || !directSub.solutionAttempt) return;

                            // Create critique history manager with original solution
                            critiqueHistoryManagers.set(
                                mainStrategy.id,
                                new SolutionCritiqueHistoryManager(
                                    deps.customPromptsDeepthinkState.sys_deepthink_solutionCritique,
                                    challengeText,
                                    mainStrategy.strategyText,
                                    directSub.solutionAttempt
                                )
                            );

                            // Create pool history manager
                            poolHistoryManagers.set(
                                mainStrategy.id,
                                new StructuredSolutionPoolHistoryManager(
                                    deps.customPromptsDeepthinkState.sys_deepthink_structuredSolutionPool,
                                    challengeText,
                                    mainStrategy.id,
                                    mainStrategy.strategyText
                                )
                            );
                        });

                        // Main iteration loop (configurable depth)
                        const iterativeDepth = deps.getIterativeDepth();
                        for (let iterNum = 1; iterNum <= iterativeDepth; iterNum++) {
                            if (currentProcess.isStopRequested) break;
                            console.log(`[Deepthink] Starting StructuredSolutionPool iteration ${iterNum}...`);

                            // PHASE 1: Generate critiques for all strategies in parallel
                            // For iteration 1, reuse the initial critiques already generated before PQF
                            // to avoid duplicate critique API calls at the start of the pipeline
                            console.log(`[Deepthink] Phase 1: Generating critiques for iteration ${iterNum}...`);
                            const critiquePromises = activeMainStrategies.map(async (mainStrategy) => {
                                const directSub = mainStrategy.subStrategies[0];
                                if (!directSub || directSub.isKilledByRedTeam || !directSub.solutionAttempt) return;

                                if (currentProcess.isStopRequested) {
                                    directSub.solutionCritiqueStatus = 'cancelled';
                                    return;
                                }

                                try {
                                    // Get history manager for this strategy
                                    const critiqueHistoryManager = critiqueHistoryManagers.get(mainStrategy.id);
                                    if (!critiqueHistoryManager) throw new Error(`No critique history manager for ${mainStrategy.id}`);

                                    // Iteration 1: Reuse initial critique (already generated before PQF)
                                    if (iterNum === 1 && directSub.solutionCritique && directSub.solutionCritiqueStatus === 'completed') {
                                        console.log(`[Deepthink] Reusing existing initial critique for ${mainStrategy.id}`);
                                        // Seed the history manager with the existing critique for proper conversation history
                                        await critiqueHistoryManager.addCritique(directSub.solutionCritique);
                                        render();
                                        return;
                                    }

                                    directSub.solutionCritiqueStatus = 'processing';
                                    render();

                                    // Get the current solution to critique
                                    let currentSolution: string;
                                    const iterations = (directSub as any).iterativeCorrections?.iterations || [];
                                    if (iterations.length > 0) {
                                        currentSolution = iterations[iterations.length - 1].correctedSolution;
                                    } else {
                                        currentSolution = directSub.solutionAttempt || '';
                                    }

                                    // Build critique prompt using history manager
                                    const critiquePromptMessages = await critiqueHistoryManager.buildPromptForIteration(
                                        currentSolution,
                                        iterNum
                                    );

                                    const critiquePrompt = critiquePromptMessages.map(m => m.content).join('\n\n');
                                    directSub.requestPromptSolutionCritique = critiquePrompt;

                                    const critiqueResponse = await makeDeepthinkApiCallWithTimeout(
                                        parts.concat([{ text: critiquePrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_solutionCritique,
                                        false,
                                        `Solution Critique Iteration ${iterNum} for ${mainStrategy.id}`,
                                        directSub,
                                        'solutionCritiqueRetryAttempt'
                                    );

                                    // Add critique to history
                                    await critiqueHistoryManager.addCritique(critiqueResponse);

                                    // Add corrected solution to history if this isn't the first iteration
                                    if (iterNum > 1 && iterations.length > 0) {
                                        await critiqueHistoryManager.addCorrectedSolution(
                                            iterations[iterations.length - 1].correctedSolution,
                                            iterNum
                                        );
                                    }

                                    directSub.solutionCritique = critiqueResponse;
                                    directSub.solutionCritiqueStatus = 'completed';
                                    render();

                                    const critiqueData: DeepthinkSolutionCritiqueData = {
                                        id: `critique-${mainStrategy.id}-iter${iterNum}`,
                                        subStrategyId: directSub.id,
                                        mainStrategyId: mainStrategy.id,
                                        requestPrompt: critiquePrompt,
                                        critiqueResponse: critiqueResponse,
                                        status: 'completed',
                                        isDetailsOpen: true,
                                        retryAttempt: iterNum
                                    };
                                    currentProcess.solutionCritiques.push(critiqueData);
                                    render();

                                } catch (error: any) {
                                    directSub.solutionCritiqueStatus = 'error';
                                    directSub.solutionCritiqueError = error.message || "Critique failed";
                                    console.error(`[Deepthink] Critique failed for ${mainStrategy.id}:`, error.message);
                                    render();
                                }
                            });

                            await Promise.allSettled(critiquePromises);
                            console.log(`[Deepthink] All critiques completed for iteration ${iterNum}`);

                            // Update StructuredSolutionPool to include the new critiques
                            currentProcess.structuredSolutionPool = buildStructuredSolutionPool();
                            console.log(`[Deepthink] Updated StructuredSolutionPool after critique generation`);
                            render();

                            // PHASE 2: Generate solution pools for all strategies in parallel
                            console.log(`[Deepthink] Phase 2: Generating solution pools for iteration ${iterNum}...`);
                            const poolPromises = activeMainStrategies.map(async (mainStrategy) => {
                                const directSub = mainStrategy.subStrategies[0];
                                if (!directSub || directSub.isKilledByRedTeam || !directSub.solutionAttempt) return;
                                if (directSub.solutionCritiqueStatus !== 'completed' || !directSub.solutionCritique) return;

                                if (currentProcess.isStopRequested) return;

                                // Find or create pool agent for this strategy
                                let poolAgent = currentProcess.structuredSolutionPoolAgents.find(a => a.mainStrategyId === mainStrategy.id);
                                if (!poolAgent) {
                                    poolAgent = {
                                        id: `pool-${mainStrategy.id}`,
                                        mainStrategyId: mainStrategy.id,
                                        status: 'pending',
                                        isDetailsOpen: true
                                    };
                                    currentProcess.structuredSolutionPoolAgents.push(poolAgent);
                                }

                                try {
                                    poolAgent.status = 'processing';
                                    render();

                                    // Get history manager for this strategy
                                    const poolHistoryManager = poolHistoryManagers.get(mainStrategy.id);
                                    if (!poolHistoryManager) throw new Error(`No history manager for ${mainStrategy.id}`);

                                    // Build prompt using history manager
                                    const poolPromptMessages = await poolHistoryManager.buildPromptForIteration(
                                        currentProcess.structuredSolutionPool || '',
                                        directSub.solutionCritique || '',
                                        iterNum
                                    );

                                    const poolPrompt = poolPromptMessages.map(m => m.content).join('\n\n');
                                    poolAgent.requestPrompt = poolPrompt;

                                    const poolResponse = await makeDeepthinkApiCallWithTimeout(
                                        parts.concat([{ text: poolPrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_structuredSolutionPool,
                                        true,
                                        `StructuredSolutionPool Agent for ${mainStrategy.id} Iteration ${iterNum}`,
                                        poolAgent,
                                        'retryAttempt'
                                    );

                                    // Add response to history
                                    await poolHistoryManager.addPoolResponse(poolResponse);

                                    poolAgent.poolResponse = poolResponse;

                                    // Parse JSON response for UI consumption
                                    try {
                                        const parsed = deps.parseJsonSafe(poolResponse, `SolutionPool-${mainStrategy.id}`);
                                        if (parsed && Array.isArray(parsed.solutions)) {
                                            poolAgent.parsedPoolResponse = {
                                                strategy_id: parsed.strategy_id || mainStrategy.id,
                                                solutions: parsed.solutions.map((s: any) => ({
                                                    title: s.title || 'Untitled Solution',
                                                    approach_summary: s.approach_summary || '',
                                                    content: s.content || '',
                                                    confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
                                                    internal_critique: s.internal_critique || '',
                                                    atomic_reconstruction: s.atomic_reconstruction || ''
                                                }))
                                            };
                                        }
                                    } catch (parseError: any) {
                                        console.warn(`[Deepthink] Failed to parse pool JSON for ${mainStrategy.id}, raw text will be used:`, parseError.message);
                                    }

                                    poolAgent.status = 'completed';
                                    render();

                                } catch (error: any) {
                                    poolAgent.status = 'error';
                                    poolAgent.error = error.message || "Solution pool generation failed";
                                    console.error(`[Deepthink] Solution pool failed for ${mainStrategy.id}:`, error.message);
                                    render();
                                }
                            });

                            await Promise.allSettled(poolPromises);
                            console.log(`[Deepthink] All solution pools completed for iteration ${iterNum}`);

                            // Update the StructuredSolutionPool with new pool outputs
                            currentProcess.structuredSolutionPool = buildStructuredSolutionPool();
                            console.log(`[Deepthink] Updated StructuredSolutionPool after pool generation`);

                            // Track version for evolution viewer
                            if (currentProcess.structuredSolutionPool) {
                                addSolutionPoolVersion(currentProcess.id, currentProcess.structuredSolutionPool, iterNum);
                            }

                            render();

                            // PHASE 3: Generate corrected solutions for all strategies in parallel
                            console.log(`[Deepthink] Phase 3: Generating corrected solutions for iteration ${iterNum}...`);
                            const correctionPromises = activeMainStrategies.map(async (mainStrategy) => {
                                const directSub = mainStrategy.subStrategies[0];
                                if (!directSub || directSub.isKilledByRedTeam || !directSub.solutionAttempt) return;
                                if (directSub.solutionCritiqueStatus !== 'completed' || !directSub.solutionCritique) return;

                                if (currentProcess.isStopRequested) {
                                    directSub.selfImprovementStatus = 'cancelled';
                                    return;
                                }

                                try {
                                    directSub.selfImprovementStatus = 'processing';
                                    render();

                                    // Get or create correction history manager for this strategy
                                    let correctionManager = correctionHistoryManagers.get(mainStrategy.id);

                                    // Get current solution to correct
                                    let currentSolution: string;
                                    const iterations = (directSub as any).iterativeCorrections?.iterations || [];
                                    if (iterations.length > 0) {
                                        currentSolution = iterations[iterations.length - 1].correctedSolution;
                                    } else {
                                        currentSolution = directSub.solutionAttempt || '';
                                    }

                                    if (iterNum === 1) {
                                        // Create manager with pool context on first iteration
                                        correctionManager = new SolutionCorrectionHistoryManager(
                                            deps.customPromptsDeepthinkState.sys_deepthink_selfImprovement,
                                            challengeText,
                                            mainStrategy.strategyText,
                                            currentSolution,
                                            directSub.solutionCritique || '',
                                            mainStrategy.id,
                                            currentProcess.structuredSolutionPool || null // Pass full pool as context
                                        );
                                        correctionHistoryManagers.set(mainStrategy.id, correctionManager);
                                    } else {
                                        // Add new critique to existing manager
                                        if (correctionManager) {
                                            await correctionManager.addNewCritique(directSub.solutionCritique || '', iterNum);
                                        }
                                    }

                                    if (!correctionManager) throw new Error(`No correction manager for ${mainStrategy.id}`);

                                    // Build correction prompt using history manager (pass current pool for iterations 2+)
                                    const correctionPromptMessages = await correctionManager.buildPromptForIteration(
                                        directSub.solutionCritique || '',
                                        iterNum,
                                        iterNum > 1 ? currentProcess.structuredSolutionPool : null
                                    );

                                    const correctionPrompt = correctionPromptMessages.map(m => m.content).join('\n\n');
                                    directSub.requestPromptSelfImprovement = correctionPrompt;

                                    const correctedSolution = await makeDeepthinkApiCallWithTimeout(
                                        parts.concat([{ text: correctionPrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_selfImprovement,
                                        false,
                                        `Solution Correction Iteration ${iterNum} for ${mainStrategy.id}`,
                                        directSub,
                                        'selfImprovementRetryAttempt'
                                    );

                                    // Add corrected solution to history
                                    await correctionManager.addCorrectedSolution(correctedSolution);

                                    directSub.refinedSolution = correctedSolution;
                                    directSub.selfImprovementStatus = 'completed';

                                    // Add to iterations
                                    (directSub as any).iterativeCorrections.iterations.push({
                                        iterationNumber: iterNum,
                                        critique: directSub.solutionCritique || '',
                                        correctedSolution: correctedSolution,
                                        timestamp: Date.now()
                                    });

                                    render();

                                } catch (error: any) {
                                    directSub.selfImprovementStatus = 'error';
                                    directSub.selfImprovementError = error.message || "Correction failed";
                                    console.error(`[Deepthink] Correction failed for ${mainStrategy.id}:`, error.message);
                                    render();
                                }
                            });

                            await Promise.allSettled(correctionPromises);
                            console.log(`[Deepthink] All corrections completed for iteration ${iterNum}`);

                            // Update the StructuredSolutionPool with new corrected solutions
                            currentProcess.structuredSolutionPool = buildStructuredSolutionPool();
                            console.log(`[Deepthink] Updated StructuredSolutionPool after corrections`);

                            // Track version for evolution viewer (final state for this iteration)
                            if (currentProcess.structuredSolutionPool) {
                                addSolutionPoolVersion(currentProcess.id, currentProcess.structuredSolutionPool, iterNum + 0.5);
                            }

                            render();
                        }

                        // Mark all iterative corrections as completed
                        activeMainStrategies.forEach((mainStrategy) => {
                            const directSub = mainStrategy.subStrategies[0];
                            if (directSub && (directSub as any).iterativeCorrections) {
                                (directSub as any).iterativeCorrections.status = 'completed';
                            }
                        });

                        currentProcess.structuredSolutionPoolStatus = 'completed';
                        console.log('[Deepthink] StructuredSolutionPool mode completed');
                        render();
                    }

                } else {
                    // Non-iterative refinement mode with dissected observations synthesis
                    if (dissectedObservationsEnabled) {
                        currentProcess.dissectedSynthesisStatus = 'processing';
                        render();

                        try {
                            const solutionsWithCritiques = currentProcess.initialStrategies
                                .filter(mainStrategy => !mainStrategy.isKilledByRedTeam)
                                .map(mainStrategy => {
                                    const activeSubStrategies = mainStrategy.subStrategies
                                        .filter(sub => !sub.isKilledByRedTeam && sub.solutionAttempt);

                                    if (activeSubStrategies.length === 0) {
                                        return '';
                                    }

                                    const critiqueData = currentProcess.solutionCritiques.find(c => c.mainStrategyId === mainStrategy.id);
                                    const strategyCritique = critiqueData?.critiqueResponse || 'No critique available';

                                    const subStrategiesSolutions = activeSubStrategies
                                        .map(sub => {
                                            return `
═══════════════════════════════════════════════════════════════
SUB-STRATEGY:
${sub.subStrategyText}

THE EXECUTION:
${sub.solutionAttempt}
═══════════════════════════════════════════════════════════════`;
                                        })
                                        .join('\n\n');

                                    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRATEGY:
${mainStrategy.strategyText}

${subStrategiesSolutions}

ITS CRITIQUE (covers all sub-strategies above):
${strategyCritique}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                                })
                                .filter(section => section.trim().length > 0)
                                .join('\n\n\n');

                            const shareHypotheses = deps.getShareHypothesesToDissected();
                            const packetToUse = shareHypotheses ? (currentProcess.knowledgePacket || 'No hypothesis exploration performed.') : 'Hypothesis exploration sharing is disabled for dissected observations.';

                            const synthesisPrompt = deps.customPromptsDeepthinkState.user_deepthink_dissectedSynthesis
                                .replace('{{originalProblemText}}', challengeText)
                                .replace('{{knowledgePacket}}', packetToUse)
                                .replace('{{solutionsWithCritiques}}', solutionsWithCritiques || 'No solution attempts available.');

                            currentProcess.dissectedSynthesisRequestPrompt = synthesisPrompt;

                            const synthesisResponse = await makeDeepthinkApiCall(
                                parts.concat([{ text: synthesisPrompt }]),
                                deps.customPromptsDeepthinkState.sys_deepthink_dissectedSynthesis,
                                false,
                                'Dissected Observations Synthesis',
                                currentProcess,
                                'dissectedSynthesisRetryAttempt'
                            );

                            currentProcess.dissectedObservationsSynthesis = synthesisResponse;
                            currentProcess.dissectedSynthesisStatus = 'completed';
                            render();
                        } catch (error: any) {
                            currentProcess.dissectedSynthesisStatus = 'error';
                            currentProcess.dissectedSynthesisError = error.message || "Dissected synthesis failed";
                            render();
                        }

                        if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during dissected synthesis.");
                    }

                    const improvementPromises: Promise<void>[] = [];

                    currentProcess.initialStrategies.forEach((mainStrategy) => {
                        mainStrategy.subStrategies.forEach((subStrategy) => {
                            if (subStrategy.isKilledByRedTeam || !subStrategy.solutionAttempt) return;

                            improvementPromises.push((async () => {
                                if (currentProcess.isStopRequested) {
                                    subStrategy.selfImprovementStatus = 'cancelled';
                                    subStrategy.selfImprovementError = "Process stopped by user.";
                                    return;
                                }

                                try {
                                    subStrategy.selfImprovementStatus = 'processing';
                                    render();

                                    const provideAllSolutions = deps.getProvideAllSolutionsToCorrectors();

                                    let solutionSection: string;

                                    if (provideAllSolutions) {
                                        const allSolutionsWithCritiques = currentProcess.initialStrategies
                                            .filter(strat => !strat.isKilledByRedTeam)
                                            .map(strat => {
                                                const activeSubs = strat.subStrategies
                                                    .filter(sub => !sub.isKilledByRedTeam && sub.solutionAttempt);

                                                if (activeSubs.length === 0) return '';

                                                const critiqueData = currentProcess.solutionCritiques.find(c => c.mainStrategyId === strat.id);
                                                const stratCritique = critiqueData?.critiqueResponse || 'No critique available';

                                                const subsSection = activeSubs
                                                    .map(sub => {
                                                        return `
═══════════════════════════════════════════════════════════════
SUB-STRATEGY: ${sub.id}${sub.id === subStrategy.id ? ' ← YOUR ASSIGNED SUB-STRATEGY' : ''}
${sub.subStrategyText}

THE EXECUTION:
${sub.solutionAttempt}
═══════════════════════════════════════════════════════════════`;
                                                    })
                                                    .join('\n\n');

                                                return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRATEGY: ${strat.id}${strat.id === mainStrategy.id ? ' ← YOUR ASSIGNED STRATEGY' : ''}
${strat.strategyText}

${subsSection}

ITS CRITIQUE (covers all sub-strategies above):
${stratCritique}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                                            })
                                            .filter(section => section.trim().length > 0)
                                            .join('\n\n\n');

                                        solutionSection = `<ALL SOLUTION ATTEMPTS WITH THEIR CRITIQUES ACROSS ALL STRATEGIES>
You are correcting the solution for sub-strategy: ${subStrategy.id}
Below you can see all solutions attempted across all strategies and sub-strategies with their critiques. Your assigned sub-strategy is marked clearly.

${allSolutionsWithCritiques}
</ALL SOLUTION ATTEMPTS WITH THEIR CRITIQUES ACROSS ALL STRATEGIES>`;
                                    } else {
                                        const strategyCritique = currentProcess.solutionCritiques.find(
                                            c => c.mainStrategyId === mainStrategy.id && c.status === 'completed'
                                        );

                                        solutionSection = `<Solution Critique For Your Provided Main Framework>
This analysis identifies problems in the specific solution attempt you have received as well as the problems in other solutions attempted in parallel inside this framework.
You have received the executed solution from the ${subStrategy.id}. You must take those findings seriously as well as learn from the other parallel critique in the same framework.
${strategyCritique?.critiqueResponse || 'No critique available for this strategy.'}
</Solution Critique For Your Provided Main Framework>

<ORIGINAL SOLUTION ATTEMPT>
${subStrategy.solutionAttempt || ''}
</ORIGINAL SOLUTION ATTEMPT>`;
                                    }

                                    if (dissectedObservationsEnabled && currentProcess.dissectedObservationsSynthesis) {
                                        solutionSection += `\n\n<DISSECTED OBSERVATIONS SYNTHESIS>
This synthesis consolidates diagnostic intelligence across ALL solutions, identifies patterns of failure, documents proven impossibilities, and provides correction guidance. Learn from mistakes made across all solution attempts, not just the solution you received. This is the most critical piece of synthesis and you must genuinely accept these findings and correct the solution.
${currentProcess.dissectedObservationsSynthesis}
</DISSECTED OBSERVATIONS SYNTHESIS>`;
                                    }

                                    const improvementPrompt = deps.customPromptsDeepthinkState.user_deepthink_selfImprovement
                                        .replace('{{originalProblemText}}', challengeText)
                                        .replace('{{currentMainStrategy}}', mainStrategy.strategyText)
                                        .replace('{{currentSubStrategy}}', subStrategy.subStrategyText)
                                        .replace('{{solutionAttempt}}', subStrategy.solutionAttempt || 'No solution attempt available')
                                        .replace('{{solutionCritique}}', subStrategy.solutionCritique || 'No critique available');

                                    subStrategy.requestPromptSelfImprovement = improvementPrompt;

                                    const improvementResponse = await makeDeepthinkApiCall(
                                        parts.concat([{ text: improvementPrompt }]),
                                        deps.customPromptsDeepthinkState.sys_deepthink_selfImprovement,
                                        false,
                                        `Self-Improvement for ${subStrategy.id}`,
                                        subStrategy,
                                        'selfImprovementRetryAttempt'
                                    );

                                    subStrategy.refinedSolution = improvementResponse;
                                    subStrategy.selfImprovementStatus = 'completed';
                                    render();
                                } catch (error: any) {
                                    subStrategy.selfImprovementStatus = 'error';
                                    subStrategy.selfImprovementError = error.message || "Self-improvement failed";
                                    render();
                                }
                            })());
                        });
                    });

                    await Promise.allSettled(improvementPromises);
                }

                if (currentProcess.isStopRequested) throw new PipelineStopRequestedError("Stopped during self-improvement.");

                currentProcess.strategicSolverComplete = true;
                render();

            } catch (error: any) {
                if (strategiesFinalizedSignal.resolve) {
                    strategiesFinalizedSignal.resolve();
                }
                if (!(error instanceof PipelineStopRequestedError)) {
                    currentProcess.status = 'error';
                    currentProcess.error = `Strategic Solver failed: ${error.message}`;
                    render();
                }
                throw error;
            }
        })();

        await Promise.all([trackAPromise, trackBPromise]);

        currentProcess.finalJudgingStatus = 'processing';
        render();

        const allSolutions: Array<{ id: string, solution: string, mainStrategyId: string, subStrategyText: string }> = [];

        currentProcess.initialStrategies.forEach(mainStrategy => {
            if (mainStrategy.isKilledByRedTeam) return;

            mainStrategy.subStrategies.forEach(subStrategy => {
                if (subStrategy.isKilledByRedTeam) return;

                const solution = subStrategy.refinedSolution || subStrategy.solutionAttempt;
                if (solution && subStrategy.selfImprovementStatus === 'completed') {
                    allSolutions.push({
                        id: subStrategy.id,
                        solution: solution,
                        mainStrategyId: mainStrategy.id,
                        subStrategyText: subStrategy.subStrategyText
                    });
                }
            });
        });

        if (allSolutions.length === 0) {
            currentProcess.finalJudgingStatus = 'error';
            currentProcess.finalJudgingError = "No completed solutions available for final review.";
        } else {
            const sysPromptFinalJudge = deps.customPromptsDeepthinkState.sys_deepthink_finalJudge;

            const finalSolutionsText = allSolutions.map((sol, i) =>
                `<SOLUTION_${i + 1}>\n` +
                `ID: ${sol.id}\n` +
                `Main Strategy: ${sol.mainStrategyId}\n` +
                `Sub-Strategy: ${sol.subStrategyText.substring(0, 100)}...\n` +
                `Solution Text:\n${sol.solution}\n` +
                `</SOLUTION_${i + 1}>`
            ).join('\n\n');

            const userPromptFinalJudge = `Original Challenge: ${challengeText}\n\nBelow are ${allSolutions.length} candidate solutions from different strategic approaches and sub-strategies. Your task is to select the SINGLE OVERALL BEST solution based on correctness, efficiency, elegance, and clarity.\n\nPresent your final verdict as a JSON object with the following structure: \`{"best_solution_id": "ID of the winning solution", "final_solution_text": "The full text of the absolute best solution", "final_reasoning": "Your detailed reasoning for why this solution is the ultimate winner"}\`\n\n${finalSolutionsText}`;

            currentProcess.finalJudgingRequestPrompt = userPromptFinalJudge;

            try {
                const finalJudgingResponseText = await makeDeepthinkApiCall(
                    [{ text: userPromptFinalJudge }],
                    sysPromptFinalJudge,
                    true,
                    'Final Judging',
                    currentProcess,
                    'retryAttempt'
                );
                currentProcess.finalJudgingResponseText = finalJudgingResponseText;
                const parsed = deps.parseJsonSafe(finalJudgingResponseText, 'Final Judge');

                if (!parsed.best_solution_id || !parsed.final_reasoning) {
                    throw new Error("Final Judge LLM response is missing critical fields (best_solution_id, final_reasoning).");
                }

                const winningSolution = allSolutions.find(sol => sol.id === parsed.best_solution_id);
                const solutionTitle = winningSolution ?
                    `Sub-Strategy "${winningSolution.subStrategyText.substring(0, 60)}..." from Main Strategy ${winningSolution.mainStrategyId}` :
                    `Solution ${parsed.best_solution_id}`;

                currentProcess.finalJudgedBestStrategyId = winningSolution?.id || parsed.best_solution_id;
                currentProcess.finalJudgedBestSolution = `**Solution ID:** <span class="sub-strategy-purple-id">${parsed.best_solution_id}</span>\n\n**Origin:** ${solutionTitle}\n\n**Final Reasoning:**\n${parsed.final_reasoning}\n\n---\n\n**Definitive Solution:**\n${winningSolution?.solution || parsed.final_solution_text || 'Solution not found'}`;
                currentProcess.finalJudgingStatus = 'completed';

            } catch (e: any) {
                currentProcess.finalJudgingStatus = 'error';
                currentProcess.finalJudgingError = e.message || "Failed to perform final judging.";
            }
        }

        currentProcess.status = 'completed';
        render();

    } catch (error: any) {
        if (error instanceof PipelineStopRequestedError) {
            currentProcess.status = 'stopped';
        } else {
            currentProcess.status = 'error';
            currentProcess.error = error.message;
        }
        render();
    } finally {
        deps.updateControlsState({ isGenerating: false });
    }
}
