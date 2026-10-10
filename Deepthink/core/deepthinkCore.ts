/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink Core - the fixed iterative Deepthink implementation.
 */

import { GenerateContentResponse, Part } from "@google/genai";
import { nanoid } from 'nanoid';
import { ThinkingConfig } from '../../Routing/AIProvider';
import { CustomizablePromptsDeepthink } from '../prompts';
import { type ProximityTurn } from './proximity';
import {
    DeepthinkPipelineOrchestrator,
    PipelineStopRequestedError as OrchestratorStopRequestedError,
    extractJsonString,
} from './pipelineOrchestrator';
import { parsePromptToGeminiParts } from './contextBuilders';
import type {
    DeepthinkRunConfig,
    BsrGlobalUpdateRecord,
    BsrLedgerEntry,
    DosOutput,
    HeartbeatBlock,
    HypothesisRoundSnapshot,
} from './types';

export type { DeepthinkRunConfig } from './types';

type AgentStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';

export interface DeepthinkSolutionCritiqueData {
    id: string;
    mainStrategyId: string;
    critiqueResponse?: string;
    critiqueResponseDisplay?: string;
    status: AgentStatus;
    error?: string;
    globalIteration?: number;
    branchIteration?: number;
}

export interface SolutionPoolParsedSolution {
    title: string;
    content: string;
    confidence: number;
}

export interface SolutionPoolParsedResponse {
    strategy_id: string;
    solutions: SolutionPoolParsedSolution[];
}

export interface DeepthinkStructuredSolutionPoolAgentData {
    mainStrategyId: string;
    poolResponse?: string;
    parsedPoolResponse?: SolutionPoolParsedResponse;
    status: AgentStatus | 'skipped';
    globalIteration?: number;
    heartbeatNo?: number;
    branchIteration?: number;
    executionTraceText?: string;
}

export interface DeepthinkBranchIteration {
    iterationNumber: number;
    globalIteration?: number;
    branchIteration?: number;
    critique: string;
    critiqueDisplay?: string;
    correctedSolution: string;
    correctedSolutionDisplay?: string;
    correctedSolutionExecutionTraceText?: string;
    critiqueExecutionTraceText?: string;
    timestamp: number;
    label?: string;
}

export interface DeepthinkMainStrategyData {
    id: string;
    strategyText: string;
    solutionAttempt?: string;
    solutionAttemptDisplay?: string;
    solutionAttemptFinal?: string;
    solutionAttemptExecutionTraceText?: string;
    solutionCritique?: string;
    solutionCritiqueDisplay?: string;
    solutionCritiqueFinal?: string;
    solutionCritiqueExecutionTraceText?: string;
    solutionCritiqueStatus?: AgentStatus;
    refinedSolution?: string;
    refinedSolutionDisplay?: string;
    refinedSolutionFinal?: string;
    refinedSolutionExecutionTraceText?: string;
    correctionStatus?: AgentStatus | 'skipped';
    status: AgentStatus;
    error?: string;
    branchIterationCount?: number;
    iterationHistory?: {
        iterations: DeepthinkBranchIteration[];
        status: 'idle' | 'processing' | 'completed' | 'error';
    };
    memoryBank?: string;
}

export interface DeepthinkHypothesisData {
    id: string;
    hypothesisText: string;
    testerAttempt?: string;
    testerAttemptDisplay?: string;
    testerAttemptFinal?: string;
    testerAttemptExecutionTraceText?: string;
    testerStatus: AgentStatus;
    testerVerdict?: 'VALIDATED' | 'REJECTED' | 'INCONCLUSIVE';
    predicted_test_outcome?: any;
    targetBranchIds?: string[];
    roundNumber?: number;
    globalIteration?: number;
}

interface DeepthinkMemoryBankAgentData {
    mainStrategyId: string;
    memoryBank?: string;
    globalIteration: number;
}

export interface DeepthinkPipelineState {
    id: string;
    challenge: string;
    status: 'idle' | 'processing' | 'completed' | 'error' | 'stopping' | 'stopped' | 'cancelled';
    error?: string;
    activeTabId: string;
    activeStrategyTab?: number;
    isStopRequested?: boolean;
    strategyGenerationHistory?: ProximityTurn[];
    initialStrategies: DeepthinkMainStrategyData[];
    hypothesisGenerationHistory?: ProximityTurn[];
    hypotheses: DeepthinkHypothesisData[];
    hypothesisHistory?: DeepthinkHypothesisData[][];
    hypothesisRounds?: HypothesisRoundSnapshot[];
    hypothesisGenStatus?: AgentStatus;
    knowledgePacket?: string;
    solutionCritiques: DeepthinkSolutionCritiqueData[];
    solutionCritiquesStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    memoryBankAgents?: DeepthinkMemoryBankAgentData[];
    hypothesisExplorerComplete?: boolean;
    finalJudgedBestSolution?: string;
    finalJudgingResponseText?: string;
    finalJudgingExecutionTraceText?: string;
    finalJudgingStatus?: AgentStatus;
    finalJudgingError?: string;
    structuredSolutionPoolEnabled?: boolean;
    structuredSolutionPoolAgents: DeepthinkStructuredSolutionPoolAgentData[];
    structuredSolutionPoolStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    strategySpecificKnowledgePackets?: Record<string, string>;
    liveEvents?: DeepthinkLiveEvent[];
    currentIteration?: number;
    heartbeatNo?: number;
    prunedBranches?: any[];
    /** Immutable settings and prompts that produced this run. */
    runConfig?: DeepthinkRunConfig;
    /** Current committed repository baseline used for read-only agent views. */
    repositoryRevision?: string;
    /** BSR Global Update Records & Decision tracking */
    bsrRecords?: BsrGlobalUpdateRecord[];
    branchLedgers?: Record<string, BsrLedgerEntry[]>;
    openPredictions?: Record<string, {
        issuedAtUpdate: number;
        probabilities: { PROGRESS: number; STALL: number; REGRESS: number };
    }>;
    /** DOS synthesis outputs */
    dosOutputs?: Array<{
        callType: 'heartbeat' | 'step_i' | 'step_ii';
        iteration: number;
        output: DosOutput;
    }>;
    heartbeats?: HeartbeatBlock[];
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
    executionTraceText?: string;
    error?: string;
    attempt?: number;
    modelName?: string;
    codeExecutionEnabled?: boolean;
    executionId?: string;
    executionGroupId?: string;
    executionGroupName?: string;
}

class PipelineStopRequestedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PipelineStopRequestedError";
    }
}

let activeDeepthinkPipeline: DeepthinkPipelineState | null = null;
let setActiveDeepthinkPipeline: ((pipeline: DeepthinkPipelineState | null) => void) | null = null;
let render: () => void = () => { };

export interface DeepthinkCoreDeps {
    callAI: (parts: Part[], modelToUse: string, systemInstruction?: string, isJson?: boolean, thinkingConfig?: ThinkingConfig) => Promise<GenerateContentResponse>;
    parseJsonSafe: (raw: string, context: string) => any;
    getSelectedModel: () => string;
    getSelectedStrategiesCount: () => number;
    getStrategyProximityLoops: () => number;
    getSelectedHypothesisCount: () => number;
    getHypothesisProximityLoops: () => number;
    getDeepthinkDepth: () => number;
    getIsolateBranchesEnabled: () => boolean;
    getSolutionPoolDisabled: () => boolean;
    getDeepthinkCodeExecutionEnabled: () => boolean;
    updateControlsState: (newState: any) => void;
    getSelectedThinkingLevel?: () => 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | string;
    getCustomPromptsDeepthinkState: () => CustomizablePromptsDeepthink;
    getBsrNoiseLevel?: () => number;
    getBsrPressureFloor?: () => number;
    getBsrWeightSmall?: () => number;
    getBsrWeightMedium?: () => number;
    getBsrWeightLarge?: () => number;
    getBsrWeightPreset?: () => string;
}

let deps: DeepthinkCoreDeps = null!;

function captureRunConfig(): DeepthinkRunConfig {
    const rawI = (deps as any).getI?.() ?? (deps.getDeepthinkDepth ? deps.getDeepthinkDepth() : 10);
    const rawJ = (deps as any).getJ?.() ?? 5;
    const rawK = (deps as any).getK?.() ?? 3;

    const i = Math.round(rawI || 10);
    const j = Math.round(rawJ || 5);
    const k = Math.round(rawK || 3);

    const model = deps.getSelectedModel();
    if (!model || !model.trim()) {
        throw new Error('No AI model selected for Deepthink execution.');
    }

    return {
        i,
        j,
        k,
        strategiesCount: deps.getSelectedStrategiesCount(),
        strategyProximityLoops: deps.getStrategyProximityLoops(),
        hypothesisCount: deps.getSelectedHypothesisCount(),
        hypothesisProximityLoops: deps.getHypothesisProximityLoops(),
        disableSolutionPool: Boolean(deps.getSolutionPoolDisabled()),
        isolateBranches: Boolean(deps.getIsolateBranchesEnabled()),
        deepthinkCodeExecutionEnabled: Boolean(deps.getDeepthinkCodeExecutionEnabled()),
        thinkingLevel: deps.getSelectedThinkingLevel?.() || 'high',
        model: model.trim(),
        bsrNoiseLevel: deps.getBsrNoiseLevel?.() ?? 2,
        bsrPressureFloor: deps.getBsrPressureFloor?.() ?? 0.3,
        bsrWeightSmall: deps.getBsrWeightSmall?.() ?? 1,
        bsrWeightMedium: deps.getBsrWeightMedium?.() ?? 2,
        bsrWeightLarge: deps.getBsrWeightLarge?.() ?? 4,
        bsrWeightPreset: deps.getBsrWeightPreset?.() ?? 'standard',
    };
}

export function initializeDeepthinkCore(dependencies: DeepthinkCoreDeps & {
    setActiveDeepthinkPipeline: (pipeline: DeepthinkPipelineState | null) => void;
    renderActiveDeepthinkPipeline: () => void;
}) {
    const { setActiveDeepthinkPipeline: setFn, renderActiveDeepthinkPipeline: renderFn, ...coreDeps } = dependencies;
    deps = coreDeps as DeepthinkCoreDeps;
    setActiveDeepthinkPipeline = setFn;
    render = renderFn;
}

export function getActiveDeepthinkPipeline() {
    return activeDeepthinkPipeline;
}

export function setActiveDeepthinkPipelineForImport(pipeline: DeepthinkPipelineState | null) {
    activeDeepthinkPipeline = pipeline;
    if (setActiveDeepthinkPipeline) setActiveDeepthinkPipeline(pipeline);
}

export async function startDeepthinkAnalysisProcess(challengeText: string, directContextFiles: any[] = []) {
    const runConfig = captureRunConfig();
    const customPrompts = deps.getCustomPromptsDeepthinkState();

    let fullChallengeText = challengeText;

    if (directContextFiles.length > 0) {
        const textFiles = directContextFiles.filter(file => file.mimeType.startsWith('text/') || file.mimeType === 'application/json');
        const imageFiles = directContextFiles.filter(file => file.mimeType.startsWith('image/'));

        if (textFiles.length > 0) {
            const decoder = new TextDecoder();
            const contents = textFiles.map(file => {
                try {
                    const binary = atob(file.base64);
                    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
                    return `\n\n--- ${file.name || 'uploaded text file'} ---\n${decoder.decode(bytes)}\n--- end file ---`;
                } catch {
                    return `\n\n--- ${file.name || 'uploaded text file'} ---\n[Unable to decode file]\n--- end file ---`;
                }
            });
            fullChallengeText += `\n\nDirect context files:${contents.join('')}`;
        }

        if (imageFiles.length > 0) {
            const imageBlocks = imageFiles.map(file =>
                `<!-- EXECUTION_IMAGE_START -->\n<!-- MIME_TYPE: ${file.mimeType} -->\n${file.base64}\n<!-- EXECUTION_IMAGE_END -->`
            );
            fullChallengeText += `\n\n${imageBlocks.join('\n\n')}`;
        }
    }

    activeDeepthinkPipeline = {
        id: `deepthink-${nanoid(12)}`,
        challenge: fullChallengeText,
        status: 'processing',
        activeTabId: 'live',
        activeStrategyTab: 0,
        isStopRequested: false,
        runConfig,
        customPrompts,
        initialStrategies: [],
        strategyGenerationHistory: [],
        strategyProximityHistory: [],
        hypothesisGenerationHistory: [],
        hypotheses: [],
        hypothesisHistory: [],
        hypothesisRounds: [],
        solutionCritiques: [],
        memoryBankAgents: [],
        structuredSolutionPoolAgents: [],
        heartbeats: [],
        hypothesisProximityHistory: [],
        bsrRecords: [],
        branchLedgers: {},
        openPredictions: {},
        dosOutputs: [],
        liveEvents: [],
    } as any;

    if (setActiveDeepthinkPipeline) setActiveDeepthinkPipeline(activeDeepthinkPipeline);
    deps.updateControlsState({ isGenerating: true });
    render();

    const orchestrator = new DeepthinkPipelineOrchestrator(activeDeepthinkPipeline as any, {
        callAI: async (args) => {
            const parts = parsePromptToGeminiParts(args.prompt) as any;
            const response = await deps.callAI(
                parts,
                args.model,
                args.systemInstruction,
                Boolean(args.responseSchema),
                args.thinkingConfig ? { thinkingLevel: args.thinkingConfig.thinkingLevel as any } : undefined
            );
            return response.text || '';
        },
        parseJsonStrict: <T>(text: string): T => {
            const extracted = extractJsonString(text);
            return JSON.parse(extracted) as T;
        },
        onLiveEvent: () => {
            render();
        },
        onStateChange: () => {
            render();
        },
    });

const pipeline = activeDeepthinkPipeline!;
try {
    await orchestrator.run();
    pipeline.status = 'completed';
} catch (error: any) {
    if (error instanceof PipelineStopRequestedError || error instanceof OrchestratorStopRequestedError || error.name === 'PipelineStopRequestedError') {
        pipeline.status = 'stopped';
    } else {
        pipeline.status = 'error';
        pipeline.error = error.message || String(error);
    }
} finally {
    deps.updateControlsState({ isGenerating: false });
    render();
}
}
