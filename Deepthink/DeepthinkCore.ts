/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink Core - Evolving Depth First Search implementation.
 */

import { GenerateContentResponse, Part } from "@google/genai";
import { HumanMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { AIProvider, ThinkingConfig } from '../Routing/AIProvider';
import { archiveSandboxRepositoryStrategy, ensureDeepthinkResultsRepository, runSandboxToolAgent, snapshotDeepthinkResultsRepository, snapshotSandboxRepositoryById, type DeepthinkResultsContextFile, type SandboxFinalOutputContract, type SandboxRepositoryAccess, type SeedFile } from '../Core/SandboxToolRuntime';
import { describeProviderError } from '../Core/ProviderError';
import { globalState } from '../Core/State';
import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';
import { addSolutionPoolVersion } from './SolutionPool';
import { buildDeepthinkSandboxRepositoryAccess, DEEPTHINK_SANDBOX_DIRECTORY_POLICY } from './DeepthinkSandboxAccess';
import {
    BranchHistoryEntry,
    HypothesisRoundSnapshot,
    PoolHistoryEntry,
    PqfDecision,
    StrategySnapshot,
    StrategyUpdateRequest,
    buildCorrectionPrompt,
    buildCorrectionRepository,
    buildCritiquePrompt,
    buildHypothesisRefreshPrompt,
    buildMemoryBankPrompt,
    buildPqfPrompt,
    buildSolutionPoolPrompt,
    buildSolutionPoolRepository,
    buildStrategyUpdatePrompt,
} from './DeepthinkIterativeHistory';

export type HypothesisInjectionMode = 'parallel' | 'strategy_aware' | 'selective_injection';

type AgentStatus = 'pending' | 'processing' | 'retrying' | 'completed' | 'error' | 'cancelled';

export interface DeepthinkSolutionCritiqueData {
    id: string;
    subStrategyId: string;
    mainStrategyId: string;
    branchVersion?: number;
    strategyTextSnapshot?: string;
    requestPrompt?: string;
    critiqueResponse?: string;
    critiqueResponseDisplay?: string;
    critiqueResponseFinal?: string;
    interactionTraceText?: string;
    executionTraceText?: string;
    status: AgentStatus;
    error?: string;
    retryAttempt?: number;
    isDetailsOpen?: boolean;
    globalIteration?: number;
    branchIteration?: number;
}

export interface SolutionPoolParsedSolution {
    title: string;
    content: string;
    confidence: number;
    internal_critique: string;
    key_insights?: string;
}

export interface SolutionPoolParsedResponse {
    strategy_id: string;
    solutions: SolutionPoolParsedSolution[];
}

export interface DeepthinkStructuredSolutionPoolAgentData {
    id: string;
    mainStrategyId: string;
    branchVersion?: number;
    requestPrompt?: string;
    poolResponse?: string;
    parsedPoolResponse?: SolutionPoolParsedResponse;
    status: AgentStatus | 'skipped';
    error?: string;
    retryAttempt?: number;
    isDetailsOpen?: boolean;
    globalIteration?: number;
    branchIteration?: number;
    interactionTraceText?: string;
    executionTraceText?: string;
}

export interface DeepthinkSubStrategyData {
    id: string;
    subStrategyText: string;
    requestPromptSolutionAttempt?: string;
    solutionAttempt?: string;
    solutionAttemptDisplay?: string;
    solutionAttemptFinal?: string;
    solutionAttemptTraceText?: string;
    solutionAttemptExecutionTraceText?: string;
    requestPromptSolutionCritique?: string;
    solutionCritique?: string;
    solutionCritiqueDisplay?: string;
    solutionCritiqueFinal?: string;
    solutionCritiqueTraceText?: string;
    solutionCritiqueExecutionTraceText?: string;
    solutionCritiqueStatus?: AgentStatus;
    solutionCritiqueError?: string;
    solutionCritiqueRetryAttempt?: number;
    requestPromptSelfImprovement?: string;
    refinedSolution?: string;
    refinedSolutionDisplay?: string;
    refinedSolutionFinal?: string;
    refinedSolutionTraceText?: string;
    refinedSolutionExecutionTraceText?: string;
    selfImprovementStatus?: AgentStatus;
    selfImprovementError?: string;
    selfImprovementRetryAttempt?: number;
    status: AgentStatus;
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
    subStrategyFormat?: string;
    branchIterationCount?: number;
    evolvingDfs?: {
        enabled: boolean;
        iterations: Array<{
            iterationNumber: number;
            globalIteration?: number;
            branchIteration?: number;
            branchVersion?: number;
            critique: string;
            critiqueDisplay?: string;
            critiqueFinal?: string;
            correctedSolution: string;
            correctedSolutionDisplay?: string;
            correctedSolutionFinal?: string;
            correctedSolutionTraceText?: string;
            timestamp: number;
            label?: string;
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
    testerAttemptDisplay?: string;
    testerAttemptFinal?: string;
    testerAttemptTraceText?: string;
    testerAttemptExecutionTraceText?: string;
    testerStatus: AgentStatus;
    testerError?: string;
    isDetailsOpen?: boolean;
    targetStrategyIds?: string[];
    roundNumber?: number;
    globalIteration?: number;
}

export interface DeepthinkPostQualityFilterData {
    id: string;
    iterationNumber: number;
    requestPrompt?: string;
    evaluationResponse?: string;
    evaluationResponseDisplay?: string;
    evaluationResponseFinal?: string;
    interactionTraceText?: string;
    executionTraceText?: string;
    prunedStrategyIds: string[];
    continuedStrategyIds: string[];
    reasoning?: string;
    rawResponse?: string;
    status: AgentStatus;
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
    groupIndex?: number;
    groupStrategyIds?: string[];
}

export interface DeepthinkMemoryBankAgentData {
    id: string;
    mainStrategyId: string;
    branchVersion?: number;
    requestPrompt?: string;
    memoryBank?: string;
    status: AgentStatus;
    error?: string;
    retryAttempt?: number;
    globalIteration: number;
    branchIterationStart: number;
    branchIterationEnd: number;
}

export interface DeepthinkStrategyReplacementRecord {
    strategyId: string;
    previousStrategyText: string;
    replacementStrategyText: string;
    replacedAtGlobalIteration: number;
    previousBranchVersion: number;
    newBranchVersion: number;
    pqfReasoning: string;
    memoryBank?: string;
    latestSolution?: string;
    latestSolutionDisplay?: string;
    latestSolutionFinal?: string;
    latestCritique?: string;
    latestCritiqueDisplay?: string;
    latestCritiqueFinal?: string;
    branchHistory?: BranchHistoryEntry[];
    poolHistory?: PoolHistoryEntry[];
}

export interface DeepthinkMainStrategyData {
    id: string;
    strategyText: string;
    requestPromptSubStrategyGen?: string;
    subStrategies: DeepthinkSubStrategyData[];
    status: AgentStatus;
    error?: string;
    isDetailsOpen?: boolean;
    retryAttempt?: number;
    strategyFormat?: string;
    generatedByPostQualityFilter?: boolean;
    updatedByPostQualityFilter?: boolean;
    postQualityFilterIteration?: number;
    branchVersion?: number;
    branchIterationCount?: number;
    memoryBank?: string;
    replacementHistory?: DeepthinkStrategyReplacementRecord[];
    judgedBestSubStrategyId?: string;
    judgedBestSolution?: string;
    judgingRequestPrompt?: string;
    judgingResponseText?: string;
    judgingStatus?: AgentStatus;
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
    hypothesisHistory?: DeepthinkHypothesisData[][];
    hypothesisRounds?: HypothesisRoundSnapshot[];
    hypothesisGenStatus?: AgentStatus;
    hypothesisGenError?: string;
    hypothesisGenRetryAttempt?: number;
    knowledgePacket?: string;
    solutionCritiques: DeepthinkSolutionCritiqueData[];
    solutionCritiquesStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    solutionCritiquesError?: string;
    dissectedObservationsSynthesis?: string;
    dissectedSynthesisTraceText?: string;
    dissectedSynthesisExecutionTraceText?: string;
    dissectedSynthesisRequestPrompt?: string;
    dissectedSynthesisStatus?: AgentStatus;
    dissectedSynthesisError?: string;
    dissectedSynthesisRetryAttempt?: number;
    postQualityFilterAgents: DeepthinkPostQualityFilterData[];
    postQualityFilterStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    postQualityFilterError?: string;
    postQualityFilterIterationCount?: number;
    memoryBankAgents?: DeepthinkMemoryBankAgentData[];
    strategicSolverComplete?: boolean;
    hypothesisExplorerComplete?: boolean;
    finalJudgedBestStrategyId?: string;
    finalJudgedBestSolution?: string;
    finalJudgingRequestPrompt?: string;
    finalJudgingResponseText?: string;
    finalJudgingTraceText?: string;
    finalJudgingExecutionTraceText?: string;
    finalJudgingStatus?: AgentStatus;
    finalJudgingError?: string;
    finalJudgingRetryAttempt?: number;
    finalJudgingStatusDescription?: string;
    structuredSolutionPoolEnabled?: boolean;
    structuredSolutionPool?: string;
    structuredSolutionPoolAgents: DeepthinkStructuredSolutionPoolAgentData[];
    structuredSolutionPoolStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
    structuredSolutionPoolError?: string;
    hypothesisInjectionMode?: HypothesisInjectionMode;
    strategySpecificKnowledgePackets?: Record<string, string>;
    liveEvents?: DeepthinkLiveEvent[];
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
    interactionTraceText?: string;
    executionTraceText?: string;
    error?: string;
    attempt?: number;
    modelName?: string;
    temperature?: number;
    topP?: number;
    codeExecutionEnabled?: boolean;
}

export class PipelineStopRequestedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PipelineStopRequestedError";
    }
}

export let activeDeepthinkPipeline: DeepthinkPipelineState | null = null;
let setActiveDeepthinkPipeline: ((pipeline: DeepthinkPipelineState | null) => void) | null = null;
let render: () => void = () => { };

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
    getSelectedPqfAggressiveness: () => string;
    getSkipSubStrategies: () => boolean;
    getDissectedObservationsEnabled: () => boolean;
    getShareHypothesesToDissected: () => boolean;
    getEvolvingDfsEnabled: () => boolean;
    getEvolvingDfsDepth: () => number;
    getIsolateBranchesEnabled: () => boolean;
    getSolutionPoolDisabled: () => boolean;
    getProvideAllSolutionsToCorrectors: () => boolean;
    getPostQualityFilterEnabled: () => boolean;
    getDeepthinkCodeExecutionEnabled: () => boolean;
    getHypothesisInjectionMode: () => HypothesisInjectionMode;
    escapeHtml: (unsafe: string) => string;
    cleanTextOutput: (text: string) => string;
    updateControlsState: (newState: any) => void;
    getSelectedThinkingLevel?: () => 'low' | 'medium' | 'high' | 'minimal';
    customPromptsDeepthinkState: CustomizablePromptsDeepthink;
}

let deps: DeepthinkCoreDeps = null!;

const RETRY_DELAYS_MS = [30_000, 60_000, 5 * 60_000] as const;
const MAX_API_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const SANDBOX_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const POOL_HISTORY_WINDOW = 5;
const CORRECTION_HISTORY_WINDOW = 5;
const MEMORY_INTERVAL = 5;
const PQF_GROUP_SIZE = 2;
const HYPOTHESIS_HEARTBEAT_INTERVAL = 2;
const NO_SOLUTION_POOL_AVAILABLE = 'No solution pool available';

const MODEL_MAP: [string, keyof CustomizablePromptsDeepthink][] = [
    ['Initial Strategy Generation', 'model_initialStrategy'],
    ['Sub-Strategy Generation', 'model_subStrategy'],
    ['Solution Attempt', 'model_solutionAttempt'],
    ['Solution Critique', 'model_solutionCritique'],
    ['Dissected Observations Synthesis', 'model_dissectedSynthesis'],
    ['Self-Improvement', 'model_selfImprovement'],
    ['Solution Correction', 'model_selfImprovement'],
    ['Hypothesis Generation', 'model_hypothesisGeneration'],
    ['Hypothesis Testing', 'model_hypothesisTester'],
    ['PostQualityFilter', 'model_postQualityFilter'],
    ['Strategy Updates', 'model_initialStrategy'],
    ['Memory Bank', 'model_memoryBank'],
    ['Structured Solution Pool', 'model_structuredSolutionPool'],
    ['Final Judging', 'model_finalJudge'],
];

const SANDBOX_TOOL_AGENTS = new Set<DeepthinkSandboxAgentKind>([
    'Main Strategy Generation',
    'Sub-Strategy Generation',
    'Hypothesis Generation',
    'Hypothesis Testing',
    'Solution Attempt',
    'Solution Critique',
    'Dissected Observations Synthesis',
    'Self-Improvement',
    'Solution Correction',
    'Post Quality Filter',
    'Memory Bank',
    'Structured Solution Pool',
    'Final Judge',
]);

type DeepthinkSandboxAgentKind =
    | 'Main Strategy Generation'
    | 'Sub-Strategy Generation'
    | 'Hypothesis Generation'
    | 'Hypothesis Testing'
    | 'Solution Attempt'
    | 'Solution Critique'
    | 'Dissected Observations Synthesis'
    | 'Self-Improvement'
    | 'Solution Correction'
    | 'Post Quality Filter'
    | 'Memory Bank'
    | 'Structured Solution Pool'
    | 'Final Judge';

interface DeepthinkSandboxAgentAccess {
    kind: DeepthinkSandboxAgentKind;
    agentName: string;
    sessionId: string;
    repositoryAccess?: SandboxRepositoryAccess;
}

interface DeepthinkAgentCallOutput {
    contextText: string;
    displayText: string;
    finalText: string;
    interactionTraceText?: string;
    executionTraceText?: string;
}

interface BranchRuntime {
    strategyId: string;
    branchVersion: number;
    branchIterationCount: number;
    globalIteration: number;
    history: BranchHistoryEntry[];
    poolHistory: PoolHistoryEntry[];
    memoryBank?: string;
    lastMemoryHistoryCount: number;
    lastHypothesisFlushGlobalIteration?: number;
}

function buildImageParts(imageBase64?: string | null, imageMimeType?: string | null): Part[] {
    const directFiles = globalState.directContextFiles;
    if (directFiles.length) {
        return directFiles.map(file => ({ inlineData: { mimeType: file.mimeType, data: file.base64 } }));
    }
    return (imageBase64 && imageMimeType) ? [{ inlineData: { mimeType: imageMimeType, data: imageBase64 } }] : [];
}

function extensionForMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/gif':
            return '.gif';
        case 'image/webp':
            return '.webp';
        case 'image/bmp':
            return '.bmp';
        case 'image/tiff':
            return '.tiff';
        case 'image/png':
        default:
            return '.png';
    }
}

function getDeepthinkSeedFiles(process: DeepthinkPipelineState): SeedFile[] {
    if (globalState.directContextFiles.length) {
        return globalState.directContextFiles.map((file, index) => ({
            name: file.name || `deepthink-uploaded-file-${index + 1}${extensionForMimeType(file.mimeType)}`,
            mimeType: file.mimeType,
            base64: file.base64,
        }));
    }
    if (!process.challengeImageBase64 || !process.challengeImageMimeType?.startsWith('image/')) return [];
    return [{ name: `deepthink-uploaded-image${extensionForMimeType(process.challengeImageMimeType)}`, mimeType: process.challengeImageMimeType, base64: process.challengeImageBase64 }];
}

function getDirectTextContext(): string {
    const textFiles = globalState.directContextFiles.filter(file => file.mimeType.startsWith('text/') || file.mimeType === 'application/json');
    if (!textFiles.length) return '';
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
    return `\n\nDirect context files:${contents.join('')}`;
}

function safeSessionSegment(value: string | number | undefined, fallback: string): string {
    const normalized = String(value ?? fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return (normalized || fallback).slice(0, 28);
}

function buildDeepthinkSandboxSessionId(process: DeepthinkPipelineState, parts: Array<string | number | undefined>): string {
    const segments = [
        'dtsb',
        safeSessionSegment(process.id, 'run'),
        ...parts.map((part, index) => safeSessionSegment(part, `p${index + 1}`)),
    ];
    return segments.join('-').slice(0, 80);
}

function strategySlotIndex(process: DeepthinkPipelineState, strategyId: string): number {
    return Math.max(0, activeStrategies(process).findIndex(strategy => strategy.id === strategyId));
}

function hypothesisDirectoryLabel(hypothesis: DeepthinkHypothesisData): string {
    return hypothesis.id.match(/hyp\d+-(\d+)/)?.[1] || hypothesis.id.replace(/^hyp/i, '');
}

function currentHypothesisRoundNumber(process: DeepthinkPipelineState): number | undefined {
    return process.hypotheses[0]?.roundNumber;
}

function completedHypothesisRoundNumbers(process: DeepthinkPipelineState, currentRoundNumber: number): number[] {
    return Array.from(new Set((process.hypothesisRounds || [])
        .map(round => round.roundNumber)
        .filter(roundNumber => roundNumber > 0 && roundNumber !== currentRoundNumber)))
        .sort((left, right) => left - right);
}

function selectedHypothesisLabelsForStrategy(process: DeepthinkPipelineState, strategyId: string): string[] {
    return process.hypotheses
        .filter(hypothesis => {
            if (!hypothesis.targetStrategyIds || hypothesis.targetStrategyIds.length === 0) return true;
            return hypothesis.targetStrategyIds.includes(strategyId);
        })
        .map(hypothesisDirectoryLabel);
}

function peerStrategySlotIndexes(process: DeepthinkPipelineState, strategyId: string): number[] {
    return activeStrategies(process)
        .map((strategy, index) => strategy.id === strategyId ? -1 : index)
        .filter(index => index >= 0);
}

function getDeepthinkSandboxFilesystemRules(): string[] {
    return [
        '- Every Deepthink role can use the sandbox when the Sandbox Terminal Environment is enabled for the run.',
        '- Deepthink runs use one shared repository view rooted at /workspace.',
        '- A strategy branch is Strategy-N with direct work files at its root, a Critique child, and a SolutionPool child. Execution and correction workers write only direct branch files; child directories are role-owned mounts.',
        '- Critique workers write only inside Strategy-N/Critique and can read the matching branch except its SolutionPool child directory.',
        '- Hypothesis testers write only inside Hypothesis-vN/Hypothesis-M and receive earlier Hypothesis-v directories read-only, never strategy directories.',
        '- Strategy, hypothesis, synthesis, and final-judge roles receive a full read-only repository view; PQF and memory roles receive only their explicitly assigned branch directories read-only.',
        '- Correctors and Structured Solution Pool agents can read peer Strategy-N directories; selective hypothesis directories remain visible only to branches whose text context receives those same tested packets.',
        '- Directories outside the current role-specific context contract are not mounted or visible.',
    ];
}

function createPersistentSandboxAccess(args: {
    process: DeepthinkPipelineState;
    kind: Exclude<DeepthinkSandboxAgentKind, 'Hypothesis Testing'>;
    strategyId: string;
    subStrategyId?: string;
    branchVersion?: number;
    includeAllSolutionContextDirectories?: boolean;
}): DeepthinkSandboxAgentAccess {
    const sessionId = buildDeepthinkSandboxSessionId(args.process, [
        args.kind,
        args.strategyId,
        args.subStrategyId || 'direct',
        `v${args.branchVersion || 1}`,
    ]);
    const slotIndex = strategySlotIndex(args.process, args.strategyId);
    const includeCritiqueForCurrentStrategy = args.kind === 'Self-Improvement' || args.kind === 'Solution Correction';
    const includeAllCritiqueDirectories = !!args.includeAllSolutionContextDirectories;
    const peerIndexes = args.kind === 'Self-Improvement' || args.kind === 'Solution Correction'
        ? peerStrategySlotIndexes(args.process, args.strategyId)
        : args.includeAllSolutionContextDirectories
            ? activeStrategies(args.process).map((_strategy, index) => index).filter(index => index !== slotIndex)
            : [];

    return {
        kind: args.kind,
        agentName: `${args.kind} Agent`,
        sessionId,
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: args.process.id,
            role: args.kind,
            strategySlotIndex: slotIndex,
            selectedHypothesisLabels: args.kind === 'Solution Attempt' || args.kind === 'Solution Correction'
                ? selectedHypothesisLabelsForStrategy(args.process, args.strategyId)
                : [],
            selectedHypothesisRoundNumber: currentHypothesisRoundNumber(args.process),
            peerStrategySlotIndexes: peerIndexes,
            includeCritiqueForCurrentStrategy,
            includeAllCritiqueDirectories,
        }),
    };
}

function createHypothesisSandboxAccess(process: DeepthinkPipelineState, hypothesis: DeepthinkHypothesisData): DeepthinkSandboxAgentAccess {
    return {
        kind: 'Hypothesis Testing',
        agentName: 'Hypothesis Testing Agent',
        sessionId: buildDeepthinkSandboxSessionId(process, [
            'hypothesis-testing',
            hypothesis.id,
            `round-${hypothesis.roundNumber || 1}`,
            `global-${hypothesis.globalIteration || 0}`,
        ]),
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: process.id,
            role: 'Hypothesis Testing',
            hypothesisLabel: hypothesisDirectoryLabel(hypothesis),
            hypothesisRoundNumber: hypothesis.roundNumber || 1,
            previousHypothesisRoundNumbers: completedHypothesisRoundNumbers(process, hypothesis.roundNumber || 1),
        }),
    };
}

function createFullRepositorySandboxAccess(args: {
    process: DeepthinkPipelineState;
    kind: Extract<DeepthinkSandboxAgentKind,
        'Main Strategy Generation'
        | 'Sub-Strategy Generation'
        | 'Hypothesis Generation'
        | 'Dissected Observations Synthesis'
        | 'Final Judge'>;
    sessionParts?: Array<string | number | undefined>;
}): DeepthinkSandboxAgentAccess {
    return {
        kind: args.kind,
        agentName: `${args.kind} Agent`,
        sessionId: buildDeepthinkSandboxSessionId(args.process, [args.kind, ...(args.sessionParts || [])]),
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: args.process.id,
            role: args.kind,
        }),
    };
}

function createPqfSandboxAccess(args: {
    process: DeepthinkPipelineState;
    groupIndex: number;
    globalIteration: number;
    strategyIds: string[];
}): DeepthinkSandboxAgentAccess {
    const assignedStrategySlotIndexes = args.strategyIds.map(strategyId => strategySlotIndex(args.process, strategyId));
    return {
        kind: 'Post Quality Filter',
        agentName: 'Post Quality Filter Agent',
        sessionId: buildDeepthinkSandboxSessionId(args.process, ['pqf', args.groupIndex + 1, `global-${args.globalIteration}`]),
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: args.process.id,
            role: 'Post Quality Filter',
            assignedStrategySlotIndexes,
        }),
    };
}

function createMemoryBankSandboxAccess(args: {
    process: DeepthinkPipelineState;
    strategyId: string;
    branchVersion: number;
    globalIteration: number;
}): DeepthinkSandboxAgentAccess {
    const slotIndex = strategySlotIndex(args.process, args.strategyId);
    return {
        kind: 'Memory Bank',
        agentName: 'Memory Bank Agent',
        sessionId: buildDeepthinkSandboxSessionId(args.process, ['memory-bank', args.strategyId, `v${args.branchVersion}`, `global-${args.globalIteration}`]),
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: args.process.id,
            role: 'Memory Bank',
            strategySlotIndex: slotIndex,
        }),
    };
}

function createSolutionPoolSandboxAccess(args: {
    process: DeepthinkPipelineState;
    strategyId: string;
    branchVersion: number;
    globalIteration: number;
}): DeepthinkSandboxAgentAccess {
    const slotIndex = strategySlotIndex(args.process, args.strategyId);
    return {
        kind: 'Structured Solution Pool',
        agentName: 'Structured Solution Pool Agent',
        sessionId: buildDeepthinkSandboxSessionId(args.process, ['solution-pool', args.strategyId, `v${args.branchVersion}`, `global-${args.globalIteration}`]),
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: args.process.id,
            role: 'Structured Solution Pool',
            strategySlotIndex: slotIndex,
            selectedHypothesisLabels: selectedHypothesisLabelsForStrategy(args.process, args.strategyId),
            selectedHypothesisRoundNumber: currentHypothesisRoundNumber(args.process),
            peerStrategySlotIndexes: peerStrategySlotIndexes(args.process, args.strategyId),
        }),
    };
}

function textAgentOutput(text: string): DeepthinkAgentCallOutput {
    return {
        contextText: text,
        displayText: text,
        finalText: text,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function messageText(messages: Array<{ content: string }>): string {
    return messages.map(message => message.content).join('\n\n');
}

function cleanJsonText(raw: string): string {
    const trimmed = raw.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || start >= end) {
        throw new Error('No valid JSON object boundaries found');
    }
    return trimmed.slice(start, end + 1);
}

function parseJson(raw: string, context: string): any {
    try {
        return deps.parseJsonSafe(raw, context);
    } catch {
        return JSON.parse(cleanJsonText(raw));
    }
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            return String(record.strategy || record.text || record.content || '');
        }
        return String(item ?? '');
    }).filter(Boolean);
}

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown, label: string): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    return value as JsonObject;
}

function requireExactKeys(value: JsonObject, label: string, required: string[], optional: string[] = []): void {
    const allowed = new Set([...required, ...optional]);
    const missing = required.filter(key => !(key in value));
    const extras = Object.keys(value).filter(key => !allowed.has(key));
    if (missing.length || extras.length) {
        const details = [
            missing.length ? `missing: ${missing.join(', ')}` : '',
            extras.length ? `unexpected: ${extras.join(', ')}` : '',
        ].filter(Boolean).join('; ');
        throw new Error(`${label} has an invalid shape (${details}).`);
    }
}

function requireString(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
}

function requireStringArray(value: unknown, label: string, count?: number): asserts value is string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
        throw new Error(`${label} must be an array of non-empty strings.`);
    }
    if (count !== undefined && value.length !== count) {
        throw new Error(`${label} must contain exactly ${count} entries (received ${value.length}).`);
    }
}

function structuredContract(
    name: string,
    responseSchema: Record<string, unknown>,
    validate: (payload: unknown) => void,
): SandboxFinalOutputContract {
    return { name, responseSchema, validate };
}

const STRING_SCHEMA = { type: 'string' };
const STRING_ARRAY_SCHEMA = (count?: number) => ({
    type: 'array',
    items: STRING_SCHEMA,
    ...(count === undefined ? {} : { description: `Exactly ${count} entries are required.` }),
});

function strategyOutputContract(count: number, mode: 'initial' | 'update' = 'initial'): SandboxFinalOutputContract {
    if (mode === 'update') {
        return structuredContract('Strategy Update', {
            type: 'object',
            properties: {
                strategies: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            strategy_id: STRING_SCHEMA,
                            strategy: STRING_SCHEMA,
                        },
                        required: ['strategy_id', 'strategy'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['strategies'],
            additionalProperties: false,
        }, payload => {
            const root = asJsonObject(payload, 'Strategy Update response');
            requireExactKeys(root, 'Strategy Update response', ['strategies']);
            if (!Array.isArray(root.strategies) || root.strategies.length !== count) {
                throw new Error(`Strategy Update response.strategies must contain exactly ${count} entries.`);
            }
            root.strategies.forEach((strategy, index) => {
                const entry = asJsonObject(strategy, `Strategy Update response.strategies[${index}]`);
                requireExactKeys(entry, `Strategy Update response.strategies[${index}]`, ['strategy_id', 'strategy']);
                requireString(entry.strategy_id, `Strategy Update response.strategies[${index}].strategy_id`);
                requireString(entry.strategy, `Strategy Update response.strategies[${index}].strategy`);
            });
        });
    }

    return structuredContract('Initial Strategy Generation', {
        type: 'object',
        properties: { strategies: STRING_ARRAY_SCHEMA(count) },
        required: ['strategies'],
        additionalProperties: false,
    }, payload => {
        const root = asJsonObject(payload, 'Initial Strategy Generation response');
        requireExactKeys(root, 'Initial Strategy Generation response', ['strategies']);
        requireStringArray(root.strategies, 'Initial Strategy Generation response.strategies', count);
    });
}

function subStrategyOutputContract(count: number): SandboxFinalOutputContract {
    return structuredContract('Sub-Strategy Generation', {
        type: 'object',
        properties: { sub_strategies: STRING_ARRAY_SCHEMA(count) },
        required: ['sub_strategies'],
        additionalProperties: false,
    }, payload => {
        const root = asJsonObject(payload, 'Sub-Strategy Generation response');
        requireExactKeys(root, 'Sub-Strategy Generation response', ['sub_strategies']);
        requireStringArray(root.sub_strategies, 'Sub-Strategy Generation response.sub_strategies', count);
    });
}

function hypothesisOutputContract(count: number, mode: HypothesisInjectionMode): SandboxFinalOutputContract {
    const selective = mode === 'selective_injection';
    const modeName = mode === 'selective_injection'
        ? 'Selective Injection'
        : mode === 'strategy_aware'
            ? 'Strategy-Aware'
            : 'Parallel';
    const hypothesisSchema = selective
        ? {
            type: 'object',
            properties: {
                text: STRING_SCHEMA,
                target_strategies: { type: 'array', items: STRING_SCHEMA },
            },
            required: ['text', 'target_strategies'],
            additionalProperties: false,
        }
        : STRING_SCHEMA;

    return structuredContract(`Hypothesis Generation (${modeName})`, {
        type: 'object',
        properties: {
            hypotheses: {
                type: 'array',
                items: hypothesisSchema,
            },
        },
        required: ['hypotheses'],
        additionalProperties: false,
    }, payload => {
        const root = asJsonObject(payload, 'Hypothesis Generation response');
        requireExactKeys(root, 'Hypothesis Generation response', ['hypotheses']);
        if (!Array.isArray(root.hypotheses) || root.hypotheses.length !== count) {
            throw new Error(`Hypothesis Generation response.hypotheses must contain exactly ${count} entries.`);
        }
        root.hypotheses.forEach((hypothesis, index) => {
            if (!selective) {
                requireString(hypothesis, `Hypothesis Generation response.hypotheses[${index}]`);
                return;
            }
            const entry = asJsonObject(hypothesis, `Hypothesis Generation response.hypotheses[${index}]`);
            requireExactKeys(entry, `Hypothesis Generation response.hypotheses[${index}]`, ['text', 'target_strategies']);
            requireString(entry.text, `Hypothesis Generation response.hypotheses[${index}].text`);
            requireStringArray(entry.target_strategies, `Hypothesis Generation response.hypotheses[${index}].target_strategies`);
        });
    });
}

function pqfOutputContract(strategyIds: string[]): SandboxFinalOutputContract {
    return structuredContract('Post Quality Filter', {
        type: 'object',
        properties: {
            analysis_summary: STRING_SCHEMA,
            strategies: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        strategy_id: STRING_SCHEMA,
                        decision: { type: 'string', enum: ['keep', 'update'] },
                        reasoning: STRING_SCHEMA,
                    },
                    required: ['strategy_id', 'decision', 'reasoning'],
                    additionalProperties: false,
                },
            },
        },
        required: ['analysis_summary', 'strategies'],
        additionalProperties: false,
    }, payload => {
        const root = asJsonObject(payload, 'Post Quality Filter response');
        requireExactKeys(root, 'Post Quality Filter response', ['analysis_summary', 'strategies']);
        requireString(root.analysis_summary, 'Post Quality Filter response.analysis_summary');
        if (!Array.isArray(root.strategies) || root.strategies.length !== strategyIds.length) {
            throw new Error(`Post Quality Filter response.strategies must contain exactly ${strategyIds.length} entries.`);
        }
        const returnedIds = new Set<string>();
        root.strategies.forEach((strategy, index) => {
            const entry = asJsonObject(strategy, `Post Quality Filter response.strategies[${index}]`);
            requireExactKeys(entry, `Post Quality Filter response.strategies[${index}]`, ['strategy_id', 'decision', 'reasoning']);
            requireString(entry.strategy_id, `Post Quality Filter response.strategies[${index}].strategy_id`);
            requireString(entry.reasoning, `Post Quality Filter response.strategies[${index}].reasoning`);
            if (entry.decision !== 'keep' && entry.decision !== 'update') {
                throw new Error(`Post Quality Filter response.strategies[${index}].decision must be "keep" or "update".`);
            }
            returnedIds.add(entry.strategy_id);
        });
        if (returnedIds.size !== strategyIds.length || strategyIds.some(id => !returnedIds.has(id))) {
            throw new Error(`Post Quality Filter response.strategies must contain exactly these strategy IDs: ${strategyIds.join(', ')}.`);
        }
    });
}

function solutionPoolOutputContract(strategyId: string): SandboxFinalOutputContract {
    const solutionSchema = {
        type: 'object',
        properties: {
            title: STRING_SCHEMA,
            content: STRING_SCHEMA,
            confidence: { type: 'number' },
            internal_critique: STRING_SCHEMA,
            key_insights: STRING_SCHEMA,
        },
        required: ['title', 'content', 'confidence', 'internal_critique'],
        additionalProperties: false,
    };
    return structuredContract('Structured Solution Pool', {
        type: 'object',
        properties: {
            strategy_id: STRING_SCHEMA,
            solutions: { type: 'array', items: solutionSchema },
        },
        required: ['strategy_id', 'solutions'],
        additionalProperties: false,
    }, payload => {
        const root = asJsonObject(payload, 'Structured Solution Pool response');
        requireExactKeys(root, 'Structured Solution Pool response', ['strategy_id', 'solutions']);
        requireString(root.strategy_id, 'Structured Solution Pool response.strategy_id');
        if (root.strategy_id !== strategyId) {
            throw new Error(`Structured Solution Pool response.strategy_id must be "${strategyId}".`);
        }
        if (!Array.isArray(root.solutions) || root.solutions.length !== 5) {
            throw new Error('Structured Solution Pool response.solutions must contain exactly 5 entries.');
        }
        root.solutions.forEach((solution, index) => {
            const entry = asJsonObject(solution, `Structured Solution Pool response.solutions[${index}]`);
            requireExactKeys(entry, `Structured Solution Pool response.solutions[${index}]`, ['title', 'content', 'confidence', 'internal_critique'], ['key_insights']);
            requireString(entry.title, `Structured Solution Pool response.solutions[${index}].title`);
            requireString(entry.content, `Structured Solution Pool response.solutions[${index}].content`);
            requireString(entry.internal_critique, `Structured Solution Pool response.solutions[${index}].internal_critique`);
            if (typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
                throw new Error(`Structured Solution Pool response.solutions[${index}].confidence must be a number from 0 to 1.`);
            }
            if (entry.key_insights !== undefined) requireString(entry.key_insights, `Structured Solution Pool response.solutions[${index}].key_insights`);
        });
    });
}

function finalJudgeOutputContract(): SandboxFinalOutputContract {
    return structuredContract('Final Judge', {
        type: 'object',
        properties: {
            best_solution_id: STRING_SCHEMA,
            final_reasoning: STRING_SCHEMA,
        },
        required: ['best_solution_id', 'final_reasoning'],
        additionalProperties: false,
    }, payload => {
        const root = asJsonObject(payload, 'Final Judge response');
        requireExactKeys(root, 'Final Judge response', ['best_solution_id', 'final_reasoning']);
        requireString(root.best_solution_id, 'Final Judge response.best_solution_id');
        requireString(root.final_reasoning, 'Final Judge response.final_reasoning');
    });
}

function buildInitialStrategyPrompt(challengeText: string, strategyCount: number): string {
    return `Core Challenge:
${challengeText}

<Initial Strategy Generation Request>
Generate exactly ${strategyCount} genuinely novel, fundamentally distinct high-level strategic interpretations for the Core Challenge.
Each strategy must be a single concise, information-dense paragraph.
Do not solve the challenge. Do not include final answers, conclusions, calculations, code, or detailed execution steps.
Return only JSON:
{
  "strategies": [
    "Strategy 1: ..."
  ]
}
</Initial Strategy Generation Request>`;
}

function buildSubStrategyPrompt(args: {
    challengeText: string;
    currentMainStrategy: string;
    otherMainStrategies: string;
    subStrategyCount: number;
}): string {
    return `Core Challenge:
${args.challengeText}

<Assigned Main Strategy>
${args.currentMainStrategy}
</Assigned Main Strategy>

<Other Main Strategies For Awareness>
${args.otherMainStrategies}
</Other Main Strategies For Awareness>

<Sub-Strategy Generation Request>
Generate exactly ${args.subStrategyCount} genuinely distinct high-level sub-strategy interpretations within the assigned main strategy.
Do not solve the challenge. Do not output detailed execution plans.
Return only JSON:
{
  "sub_strategies": [
    "Sub-strategy 1: ..."
  ]
}
</Sub-Strategy Generation Request>`;
}

function buildHypothesisGenerationPrompt(args: {
    challengeText: string;
    count: number;
    mode: HypothesisInjectionMode;
    strategyContext: string;
}): string {
    const mappingInstruction = args.mode === 'selective_injection'
        ? `Each hypothesis must include "target_strategies" as an array of strategy IDs. Use an empty array only for globally useful hypotheses.`
        : `Hypotheses may be globally useful and do not need strategy mappings.`;

    return `Core Challenge:
${args.challengeText}

<Current Strategies>
${args.strategyContext || 'Strategy context is not required for this hypothesis mode.'}
</Current Strategies>

<Hypothesis Generation Request>
Generate exactly ${args.count} hypotheses to investigate before execution.
Do not solve the Core Challenge and do not include final answers.
${mappingInstruction}
Return only JSON:
{
  "hypotheses": [
    {
      "text": "Hypothesis text",
      "target_strategies": ["main1"]
    }
  ]
}
</Hypothesis Generation Request>`;
}

function buildHypothesisTesterPrompt(challengeText: string, hypothesisText: string): string {
    return `Core Challenge:
${challengeText}

<Assigned Hypothesis To Test>
${hypothesisText}
</Assigned Hypothesis To Test>

<Hypothesis Testing Request>
Investigate this hypothesis rigorously and independently. Attempt validation and refutation, test edge cases, and report only findings about the hypothesis.
Do not solve the Core Challenge unless the hypothesis explicitly requires checking a proposed answer.
</Hypothesis Testing Request>`;
}

function buildSolutionAttemptPrompt(args: {
    challengeText: string;
    mainStrategy: string;
    subStrategy: string;
    knowledgePacket: string;
    otherStrategyContext?: string;
    branchContext?: string;
}): string {
    return `Core Challenge:
${args.challengeText}

<Assigned Strategy Text>
${args.mainStrategy}
</Assigned Strategy Text>

-------------------------------------------------------------------------------
<Context From Other Strategies>
${args.otherStrategyContext || 'No cross-strategy context is available for this execution.'}
</Context From Other Strategies>

-------------------------------------------------------------------------------
<Strategy-Aware Selective Knowledge Packet>
${args.knowledgePacket}
</Strategy-Aware Selective Knowledge Packet>

<Execution Request>
Execute the assigned framework completely and faithfully. Do not switch strategies. Produce the full solution attempt for this assigned framework.
</Execution Request>

-------------------------------------------------------------------------------
<Relevant Context For Your Current Strategy>
This is all the relevant context related to your current strategy. Treat this as your primary identity, constraint set, and final context anchor.

<Assigned Main Strategy>
${args.mainStrategy}
</Assigned Main Strategy>

<Assigned Sub-Strategy Or Direct Strategy>
${args.subStrategy}
</Assigned Sub-Strategy Or Direct Strategy>

${args.branchContext || 'No prior branch-local execution context exists yet.'}
</Relevant Context For Your Current Strategy>`;
}

function buildNonIterativeCritiquePrompt(args: {
    challengeText: string;
    mainStrategy: string;
    subStrategyId: string;
    subStrategyText: string;
    solution: string;
}): string {
    return `Core Challenge:
${args.challengeText}

<Main Strategy>
${args.mainStrategy}
</Main Strategy>

<Sub-Strategy id="${args.subStrategyId}">
${args.subStrategyText}
</Sub-Strategy>

<Solution Attempt To Critique>
${args.solution}
</Solution Attempt To Critique>

<Critique Request>
Critique this solution attempt for correctness, rigor, completeness, strategy fidelity, and unresolved issues. Do not produce the corrected solution.
</Critique Request>`;
}

function buildDissectedSynthesisPrompt(args: {
    challengeText: string;
    knowledgePacket: string;
    solutionsWithCritiques: string;
}): string {
    return `Original Problem:
${args.challengeText}

<Information Packet>
${args.knowledgePacket}
</Information Packet>

<Solutions With Critiques>
${args.solutionsWithCritiques || 'No solution attempts available.'}
</Solutions With Critiques>

<Synthesis Request>
Synthesize the critiques into a concise, rigorous correction brief. Resolve conflicts by prioritizing the most concrete, logically supported critique. Do not solve from scratch.
</Synthesis Request>`;
}

function buildSelfImprovementPrompt(args: {
    challengeText: string;
    mainStrategy: string;
    subStrategy: string;
    solutionAttempt: string;
    solutionSection: string;
}): string {
    return `Original Problem:
${args.challengeText}

<Assigned Main Strategy>
${args.mainStrategy}
</Assigned Main Strategy>

<Assigned Sub-Strategy>
${args.subStrategy}
</Assigned Sub-Strategy>

<Original Solution Attempt>
${args.solutionAttempt}
</Original Solution Attempt>

<Correction Context>
${args.solutionSection}
</Correction Context>

<Self-Improvement Request>
Produce the corrected final solution for this assigned strategy/sub-strategy. Address the critique directly. Preserve strategy fidelity and output the full corrected solution.
</Self-Improvement Request>`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${Math.round(timeoutMs / 60000)} minutes: ${description}`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function isSandboxToolEnabledFor(access: DeepthinkSandboxAgentAccess | undefined): boolean {
    return !!access && SANDBOX_TOOL_AGENTS.has(access.kind)
        && (deps.getDeepthinkCodeExecutionEnabled()
            || globalState.directContextFiles.length > 0
            || globalState.filesystemContextFiles.length > 0);
}

function modelFor(stepDescription: string): string {
    const matched = MODEL_MAP.find(([key]) => stepDescription.includes(key));
    if (!matched) return deps.getSelectedModel();
    return (deps.customPromptsDeepthinkState[matched[1]] as string | null | undefined) || deps.getSelectedModel();
}

function addLiveEvent(
    process: DeepthinkPipelineState,
    agentName: string,
    stepDescription: string,
    eventType: DeepthinkLiveEvent['eventType'],
    details?: Partial<DeepthinkLiveEvent>
) {
    if (!process.liveEvents) process.liveEvents = [];
    process.liveEvents.push({
        id: `ev-${nanoid(8)}`,
        timestamp: Date.now(),
        agentName,
        stepDescription,
        eventType,
        ...details,
    });
    render();
}

export { addLiveEvent };

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

export function setActiveDeepthinkPipelineInternal(pipeline: DeepthinkPipelineState | null) {
    activeDeepthinkPipeline = pipeline;
}

async function callDeepthinkSandboxToolAgent(args: {
    process: DeepthinkPipelineState;
    promptText: string;
    systemInstruction: string;
    modelName: string;
    temperature: number;
    topP?: number;
    access: DeepthinkSandboxAgentAccess;
    finalOutputContract?: SandboxFinalOutputContract;
}): Promise<DeepthinkAgentCallOutput> {
    const promptMessage = new HumanMessage(args.promptText);

    const result = await runSandboxToolAgent({
        agentName: args.access.agentName,
        sessionId: args.access.sessionId,
        messages: [promptMessage],
        systemPrompt: args.systemInstruction,
        modelName: args.modelName,
        temperature: args.temperature,
        topP: args.topP,
        seedFiles: getDeepthinkSeedFiles(args.process),
        runScopeDescription: 'same Deepthink run',
        agentFilesystemRules: getDeepthinkSandboxFilesystemRules(),
        repositoryAccess: args.access.repositoryAccess,
        finalOutputContract: args.finalOutputContract,
    });

    return {
        // Structured contracts must be parsed from the raw final tool payload,
        // not from UI-rendered text that may include artifact links.
        contextText: args.finalOutputContract ? result.finalText : (result.promptText || result.finalText || result.text),
        displayText: result.text,
        finalText: args.finalOutputContract ? result.finalText : (result.promptText || result.finalText || result.text),
        interactionTraceText: result.interactionTraceText,
        executionTraceText: result.executionTraceText,
    };
}

async function callAgent(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    systemInstruction: string;
    isJson: boolean;
    stepDescription: string;
    target: any;
    retryField: string;
    timeoutMs?: number;
    critical: boolean;
    sandboxAccess?: DeepthinkSandboxAgentAccess;
    finalOutputContract?: SandboxFinalOutputContract;
}): Promise<DeepthinkAgentCallOutput> {
    const promptText = args.parts.map(part => part.text || (part.inlineData ? `[Attached Image: ${part.inlineData.mimeType}]` : '')).join('\n');
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
        if (args.process.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${args.stepDescription}`);

        const agentModel = modelFor(args.stepDescription);
        const temperature = deps.getSelectedTemperature();
        const topP = deps.getSelectedTopP();
        const sandboxToolEnabled = isSandboxToolEnabledFor(args.sandboxAccess);
        // A tool-enabled structured role uses final_output's role contract,
        // never the provider's native JSON-response mode.
        const nativeJsonOutput = sandboxToolEnabled ? false : args.isJson;
        const thinkingConfig: ThinkingConfig = {
            thinkingLevel: deps.getSelectedThinkingLevel ? deps.getSelectedThinkingLevel() : 'high',
        };
        const agentTimeoutMs = args.timeoutMs
            ? (sandboxToolEnabled ? SANDBOX_AGENT_TIMEOUT_MS : args.timeoutMs)
            : undefined;

        args.target[args.retryField] = attempt - 1;
        render();

        addLiveEvent(args.process, args.stepDescription, `Invoking agent model (Attempt ${attempt}/${MAX_API_ATTEMPTS})`, 'agent_start', {
            systemInstruction: args.systemInstruction,
            prompt: promptText,
            attempt,
            modelName: agentModel,
            temperature,
            topP,
            codeExecutionEnabled: sandboxToolEnabled,
        });

        try {
            const call = sandboxToolEnabled
                ? callDeepthinkSandboxToolAgent({
                    process: args.process,
                    promptText,
                    systemInstruction: args.systemInstruction,
                    modelName: agentModel,
                    temperature,
                    topP,
                    access: args.sandboxAccess!,
                    finalOutputContract: args.finalOutputContract,
                })
                // Tool-calling providers cannot combine native structured output
                // with this role-specific final_output contract. The contract
                // validates the tool payload instead.
                : deps.callGemini(args.parts, temperature, agentModel, args.systemInstruction, nativeJsonOutput, topP, thinkingConfig)
                    .then(response => {
                        const text = response.text || '';
                        return textAgentOutput(text);
                    });
            const remaining = agentTimeoutMs ? Math.max(1, agentTimeoutMs - (Date.now() - startedAt)) : undefined;
            const responseOutput = remaining ? await withTimeout(call, remaining, args.stepDescription) : await call;
            const responseText = responseOutput.contextText;

            if (!responseText.trim()) throw new Error('Empty response from API');

            addLiveEvent(args.process, args.stepDescription, 'Agent completed successfully', 'agent_complete', {
                response: responseOutput.displayText,
                interactionTraceText: responseOutput.interactionTraceText,
                executionTraceText: responseOutput.executionTraceText,
                systemInstruction: args.systemInstruction,
                prompt: promptText,
                modelName: agentModel,
                temperature,
                topP,
                codeExecutionEnabled: sandboxToolEnabled,
            });

            return responseOutput;
        } catch (error: any) {
            lastError = error;
            const errorMessage = describeProviderError(error);
            const shouldRetry = attempt < MAX_API_ATTEMPTS;
            addLiveEvent(args.process, args.stepDescription, `Agent attempt failed: ${errorMessage}`, shouldRetry ? 'agent_retry' : 'agent_error', {
                error: errorMessage,
                attempt,
                systemInstruction: args.systemInstruction,
                prompt: promptText,
                modelName: agentModel,
                temperature,
                topP,
                codeExecutionEnabled: sandboxToolEnabled,
            });

            if (!shouldRetry) break;

            if (agentTimeoutMs && Date.now() - startedAt >= agentTimeoutMs) break;

            if ('status' in args.target) args.target.status = 'retrying';
            args.target[args.retryField] = attempt;
            render();

            const delay = RETRY_DELAYS_MS[attempt - 1] ?? 0;
            const deadlineRemaining = agentTimeoutMs ? agentTimeoutMs - (Date.now() - startedAt) : delay;
            await sleep(Math.max(0, Math.min(delay, deadlineRemaining)));

            if ('status' in args.target) args.target.status = 'processing';
            render();
        }
    }

    const message = describeProviderError(lastError);
    if (args.critical) throw new Error(message);
    throw new Error(message);
}

function createPipeline(challengeText: string, imageBase64?: string | null, imageMimeType?: string | null): DeepthinkPipelineState {
    return {
        id: `deepthink-${nanoid(12)}`,
        challenge: challengeText,
        challengeText,
        challengeImageBase64: imageBase64,
        challengeImageMimeType: imageMimeType || undefined,
        initialStrategies: [],
        hypotheses: [],
        hypothesisHistory: [],
        hypothesisRounds: [],
        solutionCritiques: [],
        postQualityFilterAgents: [],
        memoryBankAgents: [],
        structuredSolutionPoolAgents: [],
        status: 'processing',
        isStopRequested: false,
        activeTabId: 'live',
        activeStrategyTab: 0,
        strategicSolverComplete: false,
        hypothesisExplorerComplete: false,
        knowledgePacket: '',
        finalJudgingStatus: 'pending',
        structuredSolutionPoolEnabled: false,
        structuredSolutionPoolStatus: 'pending',
        liveEvents: [],
    };
}

function directSubFor(strategy: DeepthinkMainStrategyData): DeepthinkSubStrategyData | undefined {
    return strategy.subStrategies[0];
}

function activeStrategies(process: DeepthinkPipelineState): DeepthinkMainStrategyData[] {
    return process.initialStrategies;
}

function ensureDirectSubStrategy(strategy: DeepthinkMainStrategyData): DeepthinkSubStrategyData {
    let sub = directSubFor(strategy);
    if (!sub) {
        sub = {
            id: `${strategy.id}-direct`,
            subStrategyText: strategy.strategyText,
            status: 'pending',
            isDetailsOpen: false,
            subStrategyFormat: 'markdown',
        };
        strategy.subStrategies = [sub];
    }
    return sub;
}

function createRuntime(strategy: DeepthinkMainStrategyData): BranchRuntime {
    return {
        strategyId: strategy.id,
        branchVersion: strategy.branchVersion || 1,
        branchIterationCount: strategy.branchIterationCount || 0,
        globalIteration: 0,
        history: [],
        poolHistory: [],
        memoryBank: strategy.memoryBank,
        lastMemoryHistoryCount: 0,
    };
}

function runtimeSnapshot(
    process: DeepthinkPipelineState,
    strategy: DeepthinkMainStrategyData,
    runtime: BranchRuntime,
    slotIndex: number
): StrategySnapshot {
    const directSub = ensureDirectSubStrategy(strategy);
    const latestHistory = runtime.history[runtime.history.length - 1];
    const latestPool = runtime.poolHistory[runtime.poolHistory.length - 1];
    return {
        id: strategy.id,
        strategyText: strategy.strategyText,
        slotIndex,
        branchVersion: runtime.branchVersion,
        branchIterationCount: runtime.branchIterationCount,
        globalIteration: runtime.globalIteration,
        latestSolution: directSub.solutionAttempt,
        latestCorrection: latestHistory?.solution || directSub.refinedSolution,
        latestCritique: latestHistory?.critique || directSub.solutionCritique,
        latestPool: latestPool?.poolResponse,
        memoryBank: runtime.memoryBank,
        hypothesisPacket: process.strategySpecificKnowledgePackets?.[strategy.id],
    };
}

function allSnapshots(process: DeepthinkPipelineState, runtimes: Map<string, BranchRuntime>): StrategySnapshot[] {
    return activeStrategies(process).map((strategy, index) => {
        const runtime = runtimes.get(strategy.id) || createRuntime(strategy);
        return runtimeSnapshot(process, strategy, runtime, index);
    });
}

function serializeExecutionTraces(traces: Array<string | undefined>): string | undefined {
    const parsed = traces.flatMap(trace => {
        if (!trace?.trim()) return [];
        try {
            return [JSON.parse(trace)];
        } catch {
            return [];
        }
    });
    if (!parsed.length) return undefined;
    // A single agent remains byte-for-byte the native sandbox trace shape.
    // Multiple sub-strategy agents are an array of those same native objects.
    return JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2);
}

function aggregateSubStrategyContent(
    strategy: DeepthinkMainStrategyData,
    select: (subStrategy: DeepthinkSubStrategyData) => string | undefined,
    fallback: string
): string {
    const sections = strategy.subStrategies
        .map(subStrategy => {
            const content = select(subStrategy);
            return content?.trim()
                ? `## ${subStrategy.id}\n\n${content}`
                : '';
        })
        .filter(Boolean);
    return sections.length ? sections.join('\n\n---\n\n') : fallback;
}

/**
 * Build the Result-only context overlay. The backend applies this to a clean
 * copy of the sandbox repository, so none of these rich orchestration files
 * leak into an agent's writable /workspace view.
 */
function buildDeepthinkResultsContextFiles(process: DeepthinkPipelineState): DeepthinkResultsContextFile[] {
    const files: DeepthinkResultsContextFile[] = [];
    const add = (path: string, content: string) => files.push({ path, content });

    activeStrategies(process).forEach((strategy, index) => {
        const strategyDirectory = DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory(index);
        const contextDirectory = `${strategyDirectory}/CurrentBranchContext`;
        const branchVersion = strategy.branchVersion || 1;
        const poolAgent = process.structuredSolutionPoolAgents
            .filter(agent => agent.mainStrategyId === strategy.id && (agent.branchVersion || 1) === branchVersion)
            .sort((left, right) => (right.globalIteration || 0) - (left.globalIteration || 0))[0];
        const memoryAgent = (process.memoryBankAgents || [])
            .filter(agent => agent.mainStrategyId === strategy.id && (agent.branchVersion || 1) === branchVersion)
            .sort((left, right) => right.globalIteration - left.globalIteration)[0];

        // Do not add headers or metadata: this file intentionally contains
        // exactly the current branch strategy text.
        add(`${contextDirectory}/Strategy.md`, strategy.strategyText);

        const hasGeneratedSubStrategy = strategy.subStrategies.some(subStrategy => (
            subStrategy.subStrategyText.trim() && subStrategy.subStrategyText !== strategy.strategyText
        ));
        if (hasGeneratedSubStrategy) {
            add(`${contextDirectory}/Sub-Strategy.md`, aggregateSubStrategyContent(
                strategy,
                subStrategy => subStrategy.subStrategyText,
                'No generated sub-strategy is available.',
            ));
        }

        const hasExecution = strategy.subStrategies.some(subStrategy => !!(subStrategy.solutionAttemptFinal || subStrategy.solutionAttempt));
        if (hasExecution) {
            add(`${contextDirectory}/execution_final_output.md`, aggregateSubStrategyContent(
                strategy,
                subStrategy => subStrategy.solutionAttemptFinal || subStrategy.solutionAttempt,
                '',
            ));
            const trace = serializeExecutionTraces(strategy.subStrategies.map(subStrategy => subStrategy.solutionAttemptExecutionTraceText));
            if (trace) add(`${contextDirectory}/execution_agent_trace.json`, trace);
        }

        const hasCritique = strategy.subStrategies.some(subStrategy => !!(subStrategy.solutionCritiqueFinal || subStrategy.solutionCritique));
        if (hasCritique) {
            add(`${contextDirectory}/critique_final_output.md`, aggregateSubStrategyContent(
                strategy,
                subStrategy => subStrategy.solutionCritiqueFinal || subStrategy.solutionCritique,
                '',
            ));
            const trace = serializeExecutionTraces(strategy.subStrategies.map(subStrategy => subStrategy.solutionCritiqueExecutionTraceText));
            if (trace) add(`${contextDirectory}/critique_agent_trace.json`, trace);
        }

        const hasCorrection = strategy.subStrategies.some(subStrategy => (
            !!subStrategy.requestPromptSelfImprovement && !!(subStrategy.refinedSolutionFinal || subStrategy.refinedSolution)
        ));
        if (hasCorrection) {
            add(`${contextDirectory}/correction_final_output.md`, aggregateSubStrategyContent(
                strategy,
                subStrategy => subStrategy.requestPromptSelfImprovement ? (subStrategy.refinedSolutionFinal || subStrategy.refinedSolution) : undefined,
                '',
            ));
            const trace = serializeExecutionTraces(strategy.subStrategies.map(subStrategy => subStrategy.refinedSolutionExecutionTraceText));
            if (trace) add(`${contextDirectory}/correction_agent_trace.json`, trace);
        }

        if (poolAgent?.status === 'completed' && poolAgent.poolResponse?.trim()) {
            add(`${contextDirectory}/pool_final_output.md`, poolAgent.poolResponse);
            const trace = serializeExecutionTraces([poolAgent.executionTraceText]);
            if (trace) add(`${contextDirectory}/pool_agent_trace.json`, trace);
        }

        const memoryBank = strategy.memoryBank || memoryAgent?.memoryBank;
        if (memoryBank?.trim()) {
            add(`${contextDirectory}/memory_bank.md`, memoryBank);
            add(`${contextDirectory}/memory_bank.json`, JSON.stringify({
                schema: 'deepthink_memory_bank.v1',
                strategy_id: strategy.id,
                branch_version: branchVersion,
                memory_bank: memoryBank,
            }, null, 2));
        }
    });

    const hypotheses = new Map<string, DeepthinkHypothesisData>();
    [...(process.hypothesisHistory || []).flat(), ...process.hypotheses].forEach(hypothesis => hypotheses.set(hypothesis.id, hypothesis));
    hypotheses.forEach(hypothesis => {
        if (!hypothesis.testerAttempt?.trim()) return;
        const round = hypothesis.roundNumber || 1;
        const label = hypothesisDirectoryLabel(hypothesis);
        const contextDirectory = `${DEEPTHINK_SANDBOX_DIRECTORY_POLICY.hypothesisDirectory(round, label)}/CurrentHypothesisContext`;
        add(`${contextDirectory}/hypothesis.md`, hypothesis.hypothesisText);
        add(`${contextDirectory}/hypothesis_testing_final_output.md`, hypothesis.testerAttemptFinal || hypothesis.testerAttempt);
        const trace = serializeExecutionTraces([hypothesis.testerAttemptExecutionTraceText]);
        if (trace) add(`${contextDirectory}/hypothesis_testing_agent_trace.json`, trace);
    });

    const strategySlots = new Map(activeStrategies(process).map((strategy, index) => [strategy.id, index + 1]));
    process.postQualityFilterAgents.forEach(agent => {
        const windowStart = Math.floor((Math.max(agent.iterationNumber, 1) - 1) / MEMORY_INTERVAL) * MEMORY_INTERVAL + 1;
        const windowEnd = windowStart + MEMORY_INTERVAL - 1;
        const slots = (agent.groupStrategyIds || [])
            .map(strategyId => strategySlots.get(strategyId))
            .filter((slot): slot is number => typeof slot === 'number');
        const groupLabel = slots.length ? `S${slots.join('+S')}` : `Group${(agent.groupIndex || 0) + 1}`;
        const directory = `PQF(${windowStart}-${windowEnd})`;
        if (!agent.evaluationResponse?.trim()) return;
        add(`${directory}/PQF_${groupLabel}.md`, agent.evaluationResponseFinal || agent.evaluationResponse);
        const trace = serializeExecutionTraces([agent.executionTraceText]);
        if (trace) add(`${directory}/PQF_${groupLabel}_agent_trace.json`, trace);
    });

    if (process.dissectedObservationsSynthesis?.trim()) {
        add('dissected_observations_synthesis_final_output.md', process.dissectedObservationsSynthesis);
        const trace = serializeExecutionTraces([process.dissectedSynthesisExecutionTraceText]);
        if (trace) add('dissected_observations_synthesis_agent_trace.json', trace);
    }

    if (process.finalJudgingResponseText?.trim()) {
        add('Final_Judge_Final_Output.md', process.finalJudgedBestSolution || process.finalJudgingResponseText);
        const trace = serializeExecutionTraces([process.finalJudgingExecutionTraceText]);
        if (trace) add('Final_Judge_Agent_Trace.json', trace);
    }

    return files;
}

function buildStructuredSolutionPool(process: DeepthinkPipelineState, runtimes: Map<string, BranchRuntime>): string {
    const strategies = activeStrategies(process).map((strategy, index) => {
        const runtime = runtimes.get(strategy.id) || createRuntime(strategy);
        const directSub = ensureDirectSubStrategy(strategy);
        const history = runtime.history.map(entry => ({
            global_iteration: entry.globalIteration,
            branch_iteration: entry.branchIteration,
            label: entry.label,
            critique: entry.critique,
            corrected_solution: entry.solution,
        }));
        const poolAgent = process.structuredSolutionPoolAgents
            .filter(agent => agent.mainStrategyId === strategy.id && (agent.branchVersion || 1) === runtime.branchVersion)
            .sort((a, b) => (b.globalIteration || 0) - (a.globalIteration || 0))[0];
        return {
            strategy_id: strategy.id,
            slot_index: index + 1,
            branch_version: runtime.branchVersion,
            branch_iteration_count: runtime.branchIterationCount,
            strategy_text: strategy.strategyText,
            memory_bank: runtime.memoryBank || strategy.memoryBank || null,
            original_solution: directSub.solutionAttempt || '',
            latest_critique: directSub.solutionCritique || runtime.history[runtime.history.length - 1]?.critique || '',
            iterations: history,
            solution_pool: poolAgent?.parsedPoolResponse || poolAgent?.poolResponse || null,
            pool_history: runtime.poolHistory.map(entry => ({
                global_iteration: entry.globalIteration,
                branch_iteration: entry.branchIteration,
                pool: entry.poolResponse,
            })),
            replaced_branches: (strategy.replacementHistory || []).map(record => ({
                strategy_id: record.strategyId,
                branch_version: record.previousBranchVersion,
                replaced_at_global_iteration: record.replacedAtGlobalIteration,
                strategy_text: record.previousStrategyText,
                replacement_strategy_text: record.replacementStrategyText,
                replacement_reason: record.pqfReasoning,
                memory_bank: record.memoryBank || null,
                latest_solution: record.latestSolution || '',
                latest_critique: record.latestCritique || '',
                iterations: (record.branchHistory || []).map(entry => ({
                    global_iteration: entry.globalIteration,
                    branch_iteration: entry.branchIteration,
                    label: entry.label,
                    critique: entry.critique,
                    corrected_solution: entry.solution,
                })),
                pool_history: (record.poolHistory || []).map(entry => ({
                    global_iteration: entry.globalIteration,
                    branch_iteration: entry.branchIteration,
                    pool: entry.poolResponse,
                })),
            })),
        };
    });

    return JSON.stringify({ schema: 'deepthink-evolving-dfs-solution-pool-v1', strategies }, null, 2);
}

function parsePoolResponse(raw: string, strategyId: string): SolutionPoolParsedResponse | undefined {
    try {
        const parsed = parseJson(raw, `SolutionPool-${strategyId}`);
        if (!parsed || !Array.isArray(parsed.solutions)) return undefined;
        return {
            strategy_id: parsed.strategy_id || strategyId,
            solutions: parsed.solutions.map((solution: any) => ({
                title: String(solution.title || 'Untitled Solution'),
                content: String(solution.content || solution.solution || ''),
                confidence: typeof solution.confidence === 'number' ? solution.confidence : 0.5,
                internal_critique: String(solution.internal_critique || solution.critique || ''),
                key_insights: solution.key_insights ? String(solution.key_insights) : undefined,
            })),
        };
    } catch {
        return undefined;
    }
}

async function generateStrategies(process: DeepthinkPipelineState, parts: Part[], challengeText: string, evolvingDfsMode: boolean): Promise<void> {
    const requestedCount = evolvingDfsMode
        ? Math.min(deps.getSelectedStrategiesCount(), 5)
        : deps.getSelectedStrategiesCount();
    const prompt = buildInitialStrategyPrompt(challengeText, requestedCount);

    process.requestPromptInitialStrategyGen = prompt;
    render();

    const responseOutput = await callAgent({
        process,
        parts: parts.concat([{ text: prompt }]),
        systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_initialStrategy,
        isJson: true,
        stepDescription: 'Initial Strategy Generation',
        target: process,
        retryField: 'retryAttempt',
        critical: true,
        sandboxAccess: createFullRepositorySandboxAccess({
            process,
            kind: 'Main Strategy Generation',
            sessionParts: ['initial'],
        }),
        finalOutputContract: strategyOutputContract(requestedCount),
    });
    const response = responseOutput.contextText;

    const parsed = parseJson(response, 'Initial Strategy Generation');
    const strategies = asStringArray(parsed.strategies || parsed.features || parsed.suggestions).slice(0, requestedCount || undefined);

    if (strategies.length === 0) {
        throw new Error('Initial strategy generation returned no strategies.');
    }

    process.initialStrategies = strategies.map((strategyText, index) => ({
        id: `main${index + 1}`,
        strategyText,
        subStrategies: [],
        status: 'pending',
        isDetailsOpen: false,
        strategyFormat: 'markdown',
        branchVersion: 1,
        branchIterationCount: 0,
        replacementHistory: [],
    }));

    render();
}

async function generateSubStrategies(process: DeepthinkPipelineState, parts: Part[], challengeText: string): Promise<void> {
    if (deps.getSkipSubStrategies() || deps.getEvolvingDfsEnabled()) {
        process.initialStrategies.forEach(strategy => {
            strategy.subStrategies = [{
                id: `${strategy.id}-direct`,
                subStrategyText: strategy.strategyText,
                status: 'pending',
                isDetailsOpen: false,
                subStrategyFormat: 'markdown',
            }];
            strategy.status = 'completed';
        });
        render();
        return;
    }

    await Promise.allSettled(process.initialStrategies.map(async strategy => {
        strategy.status = 'processing';
        render();

        try {
            const otherStrategies = process.initialStrategies
                .filter(candidate => candidate.id !== strategy.id)
                .map((candidate, index) => `Strategy ${index + 1}: ${candidate.strategyText}`)
                .join('\n\n') || 'No other strategies.';

            const prompt = buildSubStrategyPrompt({
                challengeText,
                currentMainStrategy: strategy.strategyText,
                otherMainStrategies: otherStrategies,
                subStrategyCount: deps.getSelectedSubStrategiesCount(),
            });

            strategy.requestPromptSubStrategyGen = prompt;
            const responseOutput = await callAgent({
                process,
                parts: parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_subStrategy,
                isJson: true,
                stepDescription: `Sub-Strategy Generation for ${strategy.id}`,
                target: strategy,
                retryField: 'retryAttempt',
                critical: false,
                sandboxAccess: createFullRepositorySandboxAccess({
                    process,
                    kind: 'Sub-Strategy Generation',
                    sessionParts: [strategy.id],
                }),
                finalOutputContract: subStrategyOutputContract(deps.getSelectedSubStrategiesCount()),
            });
            const response = responseOutput.contextText;

            const parsed = parseJson(response, `Sub-Strategy Generation for ${strategy.id}`);
            const subStrategies = asStringArray(parsed.sub_strategies || parsed.subStrategies || parsed.strategies);
            strategy.subStrategies = subStrategies.map((subStrategyText, index) => ({
                id: `${strategy.id}-sub${index + 1}`,
                subStrategyText,
                status: 'pending',
                isDetailsOpen: false,
                subStrategyFormat: 'markdown',
            }));
            if (strategy.subStrategies.length === 0) ensureDirectSubStrategy(strategy);
            strategy.status = 'completed';
        } catch (error: any) {
            strategy.status = 'error';
            strategy.error = error.message || 'Sub-strategy generation failed';
            ensureDirectSubStrategy(strategy);
        }
        render();
    }));
}

function initialHypothesisPrompt(process: DeepthinkPipelineState, challengeText: string, mode: HypothesisInjectionMode, count: number): string {
    const strategyContext = mode === 'parallel'
        ? ''
        : activeStrategies(process).map(strategy => {
            const subText = strategy.subStrategies.map(sub => `- ${sub.id}: ${sub.subStrategyText}`).join('\n');
            return `<Strategy id="${strategy.id}">\n${strategy.strategyText}\n${subText}\n</Strategy>`;
        }).join('\n\n');

    return buildHypothesisGenerationPrompt({
        challengeText,
        count,
        mode,
        strategyContext,
    });
}

async function runHypothesisRound(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    mode: HypothesisInjectionMode;
    roundNumber: number;
    globalIteration: number;
    prompt?: string;
    activeStrategyIdsToFlush?: string[];
}): Promise<void> {
    const count = deps.getSelectedHypothesisCount();
    if (count <= 0) {
        args.process.hypotheses = [];
        args.process.knowledgePacket = '<Full Information Packet>\nHYPOTHESIS EXPLORATION: Disabled.\n</Full Information Packet>';
        args.process.strategySpecificKnowledgePackets = {};
        args.process.hypothesisGenStatus = 'completed';
        args.process.hypothesisExplorerComplete = true;
        render();
        return;
    }

    args.process.hypothesisGenStatus = 'processing';
    const existing = args.process.hypotheses.length ? [...args.process.hypotheses] : [];
    if (existing.length) args.process.hypothesisHistory?.push(existing);
    args.process.hypotheses = [];
    render();

    const prompt = args.prompt || initialHypothesisPrompt(args.process, args.challengeText, args.mode, count);
    args.process.requestPromptHypothesisGen = prompt;

    let systemInstruction = deps.customPromptsDeepthinkState.sys_deepthink_hypothesisGeneration
        .replace(/\{\{NUM_HYPOTHESES\}\}/g, String(count));

    if (args.mode === 'selective_injection') {
        systemInstruction += `\n\nReturn only JSON. Each hypothesis must be an object with "text" and "target_strategies".`;
    }

    try {
        const responseOutput = await callAgent({
            process: args.process,
            parts: args.parts.concat([{ text: prompt }]),
            systemInstruction,
            isJson: true,
            stepDescription: args.roundNumber === 1 ? 'Hypothesis Generation' : `Hypothesis Generation Heartbeat ${args.roundNumber}`,
            target: args.process,
            retryField: 'hypothesisGenRetryAttempt',
            timeoutMs: AGENT_TIMEOUT_MS,
            critical: false,
            sandboxAccess: createFullRepositorySandboxAccess({
                process: args.process,
                kind: 'Hypothesis Generation',
                sessionParts: [`round-${args.roundNumber}`, `global-${args.globalIteration}`],
            }),
            finalOutputContract: hypothesisOutputContract(count, args.mode),
        });
        const response = responseOutput.contextText;

        const parsed = parseJson(response, 'Hypothesis Generation');
        const hypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [];

        args.process.hypotheses = hypotheses.slice(0, count).map((raw: any, index: number) => {
            const isObject = raw && typeof raw === 'object';
            const targetIds = isObject && Array.isArray(raw.target_strategies)
                ? raw.target_strategies.map((value: unknown) => String(value).trim()).filter(Boolean)
                : undefined;
            return {
                id: `hyp${args.roundNumber}-${index + 1}`,
                hypothesisText: isObject ? String(raw.text || '') : String(raw || ''),
                testerStatus: 'pending',
                isDetailsOpen: false,
                targetStrategyIds: args.mode === 'selective_injection' ? targetIds : undefined,
                roundNumber: args.roundNumber,
                globalIteration: args.globalIteration,
            };
        }).filter((hypothesis: DeepthinkHypothesisData) => hypothesis.hypothesisText.trim());

        args.process.hypothesisGenStatus = 'completed';
        render();

        await Promise.allSettled(args.process.hypotheses.map(async hypothesis => {
            hypothesis.testerStatus = 'processing';
            render();

            try {
                const testerPrompt = buildHypothesisTesterPrompt(args.challengeText, hypothesis.hypothesisText);
                hypothesis.testerRequestPrompt = testerPrompt;

                const testerResponse = await callAgent({
                    process: args.process,
                    parts: args.parts.concat([{ text: testerPrompt }]),
                    systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_hypothesisTester,
                    isJson: false,
                    stepDescription: `Hypothesis Testing for ${hypothesis.id}`,
                    target: hypothesis,
                    retryField: 'testerRetryAttempt',
                    timeoutMs: AGENT_TIMEOUT_MS,
                    critical: false,
                    sandboxAccess: createHypothesisSandboxAccess(args.process, hypothesis),
                });

                hypothesis.testerAttempt = testerResponse.contextText;
                hypothesis.testerAttemptDisplay = testerResponse.displayText;
                hypothesis.testerAttemptFinal = testerResponse.finalText;
                hypothesis.testerAttemptTraceText = testerResponse.interactionTraceText;
                hypothesis.testerAttemptExecutionTraceText = testerResponse.executionTraceText;
                hypothesis.testerStatus = 'completed';
            } catch (error: any) {
                hypothesis.testerStatus = 'error';
                hypothesis.testerError = error.message || 'Hypothesis testing failed';
                hypothesis.testerAttempt = 'No testing output available.';
            }
            render();
        }));

        const fullPacket = [
            '<Full Information Packet>',
            ...args.process.hypotheses.map((hypothesis, index) => [
                `<Hypothesis ${index + 1}>`,
                `Hypothesis: ${hypothesis.hypothesisText}`,
                `Target Strategies: ${hypothesis.targetStrategyIds?.join(', ') || 'All'}`,
                `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}`,
                `</Hypothesis ${index + 1}>`,
            ].join('\n')),
            '</Full Information Packet>',
        ].join('\n');

        const strategyPackets: Record<string, string> = {};
        activeStrategies(args.process).forEach(strategy => {
            const relevant = args.mode === 'selective_injection'
                ? args.process.hypotheses.filter(hypothesis => {
                    if (args.activeStrategyIdsToFlush?.includes(strategy.id)) return false;
                    if (!hypothesis.targetStrategyIds || hypothesis.targetStrategyIds.length === 0) return true;
                    return hypothesis.targetStrategyIds.includes(strategy.id);
                })
                : args.process.hypotheses;

            strategyPackets[strategy.id] = [
                `<Strategy-Specific Information Packet for Strategy ${strategy.id}>`,
                relevant.length
                    ? relevant.map(hypothesis => [
                        `<Hypothesis ${hypothesis.id}>`,
                        `Hypothesis: ${hypothesis.hypothesisText}`,
                        `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}`,
                        `</Hypothesis ${hypothesis.id}>`,
                    ].join('\n')).join('\n\n')
                    : 'No active strategy-specific hypotheses are currently available for this strategy.',
                `</Strategy-Specific Information Packet for Strategy ${strategy.id}>`,
            ].join('\n');
        });

        args.process.knowledgePacket = fullPacket;
        args.process.strategySpecificKnowledgePackets = strategyPackets;
        args.process.hypothesisRounds?.push({
            roundNumber: args.roundNumber,
            globalIteration: args.globalIteration,
            packet: fullPacket,
            strategyPackets,
        });
        args.process.hypothesisExplorerComplete = true;
    } catch (error: any) {
        args.process.hypothesisGenStatus = 'error';
        args.process.hypothesisGenError = error.message || 'Hypothesis exploration failed';
    }
    render();
}

async function executeSolutionAttempt(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    subStrategy: DeepthinkSubStrategyData;
    critical: boolean;
}): Promise<void> {
    args.subStrategy.status = 'processing';
    render();

    const injectedPacket = args.process.hypothesisInjectionMode === 'selective_injection'
        ? args.process.strategySpecificKnowledgePackets?.[args.strategy.id] || args.process.knowledgePacket || 'No hypothesis exploration performed.'
        : args.process.knowledgePacket || 'No hypothesis exploration performed.';
    const otherStrategyContext = activeStrategies(args.process)
        .filter(strategy => strategy.id !== args.strategy.id)
        .map(strategy => `<Strategy-${strategy.id} branchVersion="${strategy.branchVersion || 1}">\n${strategy.strategyText}\n</Strategy-${strategy.id}>`)
        .join('\n\n');
    const branchContext = args.strategy.branchVersion
        ? `<BranchIdentity strategy="${args.strategy.id}" branchVersion="${args.strategy.branchVersion}" branchIterationCount="${args.strategy.branchIterationCount || 0}" />`
        : undefined;

    const prompt = buildSolutionAttemptPrompt({
        challengeText: args.challengeText,
        mainStrategy: args.strategy.strategyText,
        subStrategy: args.subStrategy.subStrategyText,
        knowledgePacket: injectedPacket,
        otherStrategyContext,
        branchContext,
    });

    args.subStrategy.requestPromptSolutionAttempt = prompt;

    try {
        const response = await callAgent({
            process: args.process,
            parts: args.parts.concat([{ text: prompt }]),
            systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_solutionAttempt,
            isJson: false,
            stepDescription: `Solution Attempt for ${args.subStrategy.id}`,
            target: args.subStrategy,
            retryField: 'retryAttempt',
            timeoutMs: AGENT_TIMEOUT_MS,
            critical: args.critical,
            sandboxAccess: createPersistentSandboxAccess({
                process: args.process,
                kind: 'Solution Attempt',
                strategyId: args.strategy.id,
                subStrategyId: args.subStrategy.id,
                branchVersion: args.strategy.branchVersion || 1,
            }),
        });
        args.subStrategy.solutionAttempt = response.contextText;
        args.subStrategy.solutionAttemptDisplay = response.displayText;
        args.subStrategy.solutionAttemptFinal = response.finalText;
        args.subStrategy.solutionAttemptTraceText = response.interactionTraceText;
        args.subStrategy.solutionAttemptExecutionTraceText = response.executionTraceText;
        args.subStrategy.status = 'completed';
    } catch (error: any) {
        args.subStrategy.status = 'error';
        args.subStrategy.error = error.message || 'Solution attempt failed';
        if (args.critical) throw error;
    }
    render();
}

async function critiqueSolution(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    subStrategy: DeepthinkSubStrategyData;
    solution: string;
    runtime?: BranchRuntime;
    globalIteration?: number;
    branchIteration?: number;
}): Promise<string | null> {
    args.subStrategy.solutionCritiqueStatus = 'processing';
    render();

    const prompt = args.runtime && args.globalIteration && args.branchIteration
        ? messageText(buildCritiquePrompt({
            challenge: args.challengeText,
            strategy: runtimeSnapshot(args.process, args.strategy, args.runtime, args.process.initialStrategies.indexOf(args.strategy)),
            solutionToCritique: args.solution,
            globalIteration: args.globalIteration,
            branchIteration: args.branchIteration,
            previousHistory: args.runtime.history,
        }))
        : buildNonIterativeCritiquePrompt({
            challengeText: args.challengeText,
            mainStrategy: args.strategy.strategyText,
            subStrategyId: args.subStrategy.id,
            subStrategyText: args.subStrategy.subStrategyText,
            solution: args.solution,
        });

    args.subStrategy.requestPromptSolutionCritique = prompt;

    const critiqueData: DeepthinkSolutionCritiqueData = {
        id: `critique-${args.strategy.id}-${args.globalIteration || 'initial'}-${nanoid(4)}`,
        subStrategyId: args.subStrategy.id,
        mainStrategyId: args.strategy.id,
        branchVersion: args.runtime?.branchVersion || args.strategy.branchVersion || 1,
        strategyTextSnapshot: args.strategy.strategyText,
        requestPrompt: prompt,
        status: 'processing',
        isDetailsOpen: true,
        globalIteration: args.globalIteration,
        branchIteration: args.branchIteration,
    };
    args.process.solutionCritiques.push(critiqueData);
    render();

    try {
        const response = await callAgent({
            process: args.process,
            parts: args.parts.concat([{ text: prompt }]),
            systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_solutionCritique,
            isJson: false,
            stepDescription: `Solution Critique for ${args.strategy.id}${args.globalIteration ? ` Iteration ${args.globalIteration}` : ''}`,
            target: args.subStrategy,
            retryField: 'solutionCritiqueRetryAttempt',
            timeoutMs: AGENT_TIMEOUT_MS,
            critical: false,
            sandboxAccess: createPersistentSandboxAccess({
                process: args.process,
                kind: 'Solution Critique',
                strategyId: args.strategy.id,
                subStrategyId: args.subStrategy.id,
                branchVersion: args.runtime?.branchVersion || args.strategy.branchVersion || 1,
            }),
        });

        args.subStrategy.solutionCritique = response.contextText;
        args.subStrategy.solutionCritiqueDisplay = response.displayText;
        args.subStrategy.solutionCritiqueFinal = response.finalText;
        args.subStrategy.solutionCritiqueTraceText = response.interactionTraceText;
        args.subStrategy.solutionCritiqueExecutionTraceText = response.executionTraceText;
        args.subStrategy.solutionCritiqueStatus = 'completed';
        critiqueData.critiqueResponse = response.contextText;
        critiqueData.critiqueResponseDisplay = response.displayText;
        critiqueData.critiqueResponseFinal = response.finalText;
        critiqueData.interactionTraceText = response.interactionTraceText;
        critiqueData.executionTraceText = response.executionTraceText;
        critiqueData.status = 'completed';
        return response.contextText;
    } catch (error: any) {
        args.subStrategy.solutionCritiqueStatus = 'error';
        args.subStrategy.solutionCritiqueError = error.message || 'Solution critique failed';
        critiqueData.status = 'error';
        critiqueData.error = args.subStrategy.solutionCritiqueError;
        return null;
    } finally {
        render();
    }
}

async function runInitialExecutionsAndCritiques(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    evolvingDfsMode: boolean;
}): Promise<void> {
    args.process.solutionCritiquesStatus = 'processing';
    render();

    await Promise.allSettled(activeStrategies(args.process).flatMap(strategy => {
        const subs = args.evolvingDfsMode ? [ensureDirectSubStrategy(strategy)] : strategy.subStrategies;
        return subs.map(async subStrategy => {
            await executeSolutionAttempt({
                process: args.process,
                parts: args.parts,
                challengeText: args.challengeText,
                strategy,
                subStrategy,
                critical: false,
            });

            if (!subStrategy.solutionAttempt || !deps.getRefinementEnabled()) {
                subStrategy.refinedSolution = subStrategy.solutionAttempt;
                subStrategy.refinedSolutionDisplay = subStrategy.solutionAttemptDisplay;
                subStrategy.refinedSolutionFinal = subStrategy.solutionAttemptFinal;
                subStrategy.refinedSolutionTraceText = subStrategy.solutionAttemptTraceText;
                subStrategy.selfImprovementStatus = 'completed';
                return;
            }

            const runtime = args.runtimes.get(strategy.id);
            const branchIteration = args.evolvingDfsMode ? 1 : undefined;
            const critique = await critiqueSolution({
                process: args.process,
                parts: args.parts,
                challengeText: args.challengeText,
                strategy,
                subStrategy,
                solution: subStrategy.solutionAttempt,
                runtime,
                globalIteration: args.evolvingDfsMode ? 1 : undefined,
                branchIteration,
            });

            if (args.evolvingDfsMode && runtime && critique) {
                runtime.history.push({
                    globalIteration: 1,
                    branchIteration: 1,
                    branchVersion: runtime.branchVersion,
                    label: 'Initial Execution',
                    solution: subStrategy.solutionAttempt || '',
                    solutionDisplay: subStrategy.solutionAttemptDisplay,
                    solutionFinal: subStrategy.solutionAttemptFinal,
                    critique,
                    critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                    critiqueFinal: subStrategy.solutionCritiqueFinal,
                });
                subStrategy.evolvingDfs = {
                    enabled: true,
                    status: 'processing',
                    iterations: [{
                        iterationNumber: 1,
                        globalIteration: 1,
                        branchIteration: 1,
                        branchVersion: runtime.branchVersion,
                        critique,
                        critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                        critiqueFinal: subStrategy.solutionCritiqueFinal,
                        correctedSolution: subStrategy.solutionAttempt || '',
                        correctedSolutionDisplay: subStrategy.solutionAttemptDisplay,
                        correctedSolutionFinal: subStrategy.solutionAttemptFinal,
                        correctedSolutionTraceText: subStrategy.solutionAttemptTraceText,
                        timestamp: Date.now(),
                        label: 'Initial Execution',
                    }],
                };
                subStrategy.refinedSolution = subStrategy.solutionAttempt;
                subStrategy.refinedSolutionDisplay = subStrategy.solutionAttemptDisplay;
                subStrategy.refinedSolutionFinal = subStrategy.solutionAttemptFinal;
                subStrategy.refinedSolutionTraceText = subStrategy.solutionAttemptTraceText;
                subStrategy.selfImprovementStatus = 'completed';
            }
        });
    }));

    args.process.solutionCritiquesStatus = 'completed';
    render();
}

async function runSolutionPools(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
}): Promise<void> {
    args.process.structuredSolutionPoolEnabled = true;
    args.process.structuredSolutionPoolStatus = 'processing';
    args.process.structuredSolutionPool = buildStructuredSolutionPool(args.process, args.runtimes);
    render();

    const solutionPoolDisabled = deps.getSolutionPoolDisabled();
    const snapshots = allSnapshots(args.process, args.runtimes);

    await Promise.allSettled(activeStrategies(args.process).map(async strategy => {
        const runtime = args.runtimes.get(strategy.id);
        if (!runtime) return;

        const currentSnapshot = runtimeSnapshot(args.process, strategy, runtime, args.process.initialStrategies.indexOf(strategy));
        const branchIteration = Math.max(1, runtime.branchIterationCount);
        const agent: DeepthinkStructuredSolutionPoolAgentData = {
            id: `pool-${strategy.id}-v${runtime.branchVersion}-g${args.globalIteration}`,
            mainStrategyId: strategy.id,
            branchVersion: runtime.branchVersion,
            poolResponse: solutionPoolDisabled ? NO_SOLUTION_POOL_AVAILABLE : undefined,
            status: solutionPoolDisabled ? 'skipped' : 'processing',
            isDetailsOpen: true,
            globalIteration: args.globalIteration,
            branchIteration,
        };
        args.process.structuredSolutionPoolAgents.push(agent);

        if (solutionPoolDisabled) {
            runtime.poolHistory.push({
                globalIteration: args.globalIteration,
                branchIteration,
                poolResponse: NO_SOLUTION_POOL_AVAILABLE,
            });
            runtime.branchIterationCount = Math.max(runtime.branchIterationCount, runtime.history.length);
            strategy.branchIterationCount = runtime.branchIterationCount;
            directSubFor(strategy)!.branchIterationCount = runtime.branchIterationCount;
            render();
            return;
        }

        render();

        const repository = buildSolutionPoolRepository({
            current: currentSnapshot,
            currentHistory: runtime.history,
            currentPoolHistory: runtime.poolHistory,
            allStrategies: deps.getIsolateBranchesEnabled() ? [currentSnapshot] : snapshots,
            maxPoolHistoryEntries: POOL_HISTORY_WINDOW,
        });

        const prompt = messageText(buildSolutionPoolPrompt({
            challenge: args.challengeText,
            current: currentSnapshot,
            repository,
            hypothesisPacket: args.process.strategySpecificKnowledgePackets?.[strategy.id],
            globalIteration: args.globalIteration,
            branchIteration,
        }));
        agent.requestPrompt = prompt;

        try {
            const responseOutput = await callAgent({
                process: args.process,
                parts: args.parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_structuredSolutionPool,
                isJson: true,
                stepDescription: `Structured Solution Pool for ${strategy.id} Iteration ${args.globalIteration}`,
                target: agent,
                retryField: 'retryAttempt',
                timeoutMs: AGENT_TIMEOUT_MS,
                critical: false,
                sandboxAccess: createSolutionPoolSandboxAccess({
                    process: args.process,
                    strategyId: strategy.id,
                    branchVersion: runtime.branchVersion,
                    globalIteration: args.globalIteration,
                }),
                finalOutputContract: solutionPoolOutputContract(strategy.id),
            });
            const response = responseOutput.contextText;

            agent.poolResponse = response;
            agent.parsedPoolResponse = parsePoolResponse(response, strategy.id);
            agent.interactionTraceText = responseOutput.interactionTraceText;
            agent.executionTraceText = responseOutput.executionTraceText;
            agent.status = 'completed';
            runtime.poolHistory.push({
                globalIteration: args.globalIteration,
                branchIteration,
                poolResponse: response,
            });
            runtime.branchIterationCount = Math.max(runtime.branchIterationCount, runtime.history.length);
            strategy.branchIterationCount = runtime.branchIterationCount;
            directSubFor(strategy)!.branchIterationCount = runtime.branchIterationCount;
        } catch (error: any) {
            agent.status = 'error';
            agent.error = error.message || 'Solution pool generation failed';
        }
        render();
    }));

    args.process.structuredSolutionPool = buildStructuredSolutionPool(args.process, args.runtimes);
    addSolutionPoolVersion(args.process.id, args.process.structuredSolutionPool, args.globalIteration);
    args.process.structuredSolutionPoolStatus = 'completed';
    render();
}

async function runCorrectionIteration(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
}): Promise<void> {
    const snapshots = allSnapshots(args.process, args.runtimes);

    await Promise.allSettled(activeStrategies(args.process).map(async strategy => {
        const runtime = args.runtimes.get(strategy.id);
        const subStrategy = ensureDirectSubStrategy(strategy);
        if (!runtime) return;

        const nextBranchIteration = runtime.history.length + 1;
        const currentSnapshot = runtimeSnapshot(args.process, strategy, runtime, args.process.initialStrategies.indexOf(strategy));
        const repository = buildCorrectionRepository({
            current: currentSnapshot,
            currentHistory: runtime.history,
            currentPoolHistory: runtime.poolHistory,
            allStrategies: deps.getIsolateBranchesEnabled() ? [currentSnapshot] : snapshots,
            maxHistoryEntries: CORRECTION_HISTORY_WINDOW,
        });

        const prompt = messageText(buildCorrectionPrompt({
            challenge: args.challengeText,
            current: currentSnapshot,
            repository,
            hypothesisPacket: args.process.strategySpecificKnowledgePackets?.[strategy.id],
            globalIteration: args.globalIteration,
            branchIteration: nextBranchIteration,
        }));

        subStrategy.requestPromptSelfImprovement = prompt;
        subStrategy.selfImprovementStatus = 'processing';
        render();

        try {
            const corrected = await callAgent({
                process: args.process,
                parts: args.parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_selfImprovement,
                isJson: false,
                stepDescription: `Solution Correction for ${strategy.id} Iteration ${args.globalIteration}`,
                target: subStrategy,
                retryField: 'selfImprovementRetryAttempt',
                timeoutMs: AGENT_TIMEOUT_MS,
                critical: false,
                sandboxAccess: createPersistentSandboxAccess({
                    process: args.process,
                    kind: 'Solution Correction',
                    strategyId: strategy.id,
                    subStrategyId: subStrategy.id,
                    branchVersion: runtime.branchVersion,
                }),
            });

            subStrategy.refinedSolution = corrected.contextText;
            subStrategy.refinedSolutionDisplay = corrected.displayText;
            subStrategy.refinedSolutionFinal = corrected.finalText;
            subStrategy.refinedSolutionTraceText = corrected.interactionTraceText;
            subStrategy.refinedSolutionExecutionTraceText = corrected.executionTraceText;
            subStrategy.selfImprovementStatus = 'completed';

            const critique = await critiqueSolution({
                process: args.process,
                parts: args.parts,
                challengeText: args.challengeText,
                strategy,
                subStrategy,
                solution: corrected.contextText,
                runtime,
                globalIteration: args.globalIteration,
                branchIteration: nextBranchIteration,
            });

            runtime.history.push({
                globalIteration: args.globalIteration,
                branchIteration: nextBranchIteration,
                branchVersion: runtime.branchVersion,
                label: `Correction ${nextBranchIteration}`,
                solution: corrected.contextText,
                solutionDisplay: corrected.displayText,
                solutionFinal: corrected.finalText,
                critique: critique || 'No critique output available.',
                critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                critiqueFinal: subStrategy.solutionCritiqueFinal,
            });
            runtime.globalIteration = args.globalIteration;
            runtime.branchIterationCount = runtime.history.length;
            strategy.branchIterationCount = runtime.branchIterationCount;
            strategy.memoryBank = runtime.memoryBank;
            subStrategy.branchIterationCount = runtime.branchIterationCount;
            subStrategy.evolvingDfs = subStrategy.evolvingDfs || { enabled: true, status: 'processing', iterations: [] };
            subStrategy.evolvingDfs.iterations.push({
                iterationNumber: args.globalIteration,
                globalIteration: args.globalIteration,
                branchIteration: nextBranchIteration,
                branchVersion: runtime.branchVersion,
                critique: critique || 'No critique output available.',
                critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                critiqueFinal: subStrategy.solutionCritiqueFinal,
                correctedSolution: corrected.contextText,
                correctedSolutionDisplay: corrected.displayText,
                correctedSolutionFinal: corrected.finalText,
                correctedSolutionTraceText: corrected.interactionTraceText,
                timestamp: Date.now(),
                label: `Correction ${nextBranchIteration}`,
            });
        } catch (error: any) {
            subStrategy.selfImprovementStatus = 'error';
            subStrategy.selfImprovementError = error.message || 'Correction failed';
        }
        render();
    }));
}

async function runMemoryAgents(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    strategies: DeepthinkMainStrategyData[];
    globalIteration: number;
}): Promise<void> {
    await Promise.allSettled(args.strategies.map(async strategy => {
        const runtime = args.runtimes.get(strategy.id);
        if (!runtime) return;
        const newHistory = runtime.history.slice(runtime.lastMemoryHistoryCount, runtime.lastMemoryHistoryCount + MEMORY_INTERVAL);
        if (newHistory.length < MEMORY_INTERVAL) return;

        const agent: DeepthinkMemoryBankAgentData = {
            id: `memory-${strategy.id}-g${args.globalIteration}`,
            mainStrategyId: strategy.id,
            branchVersion: runtime.branchVersion,
            status: 'processing',
            globalIteration: args.globalIteration,
            branchIterationStart: newHistory[0].branchIteration,
            branchIterationEnd: newHistory[newHistory.length - 1].branchIteration,
        };
        args.process.memoryBankAgents?.push(agent);
        render();

        const prompt = messageText(buildMemoryBankPrompt({
            challenge: args.challengeText,
            strategy: runtimeSnapshot(args.process, strategy, runtime, args.process.initialStrategies.indexOf(strategy)),
            previousMemoryBank: runtime.memoryBank,
            historyWindow: newHistory,
            windowStartBranchIteration: newHistory[0].branchIteration,
            windowEndBranchIteration: newHistory[newHistory.length - 1].branchIteration,
        }));
        agent.requestPrompt = prompt;

        try {
            const responseOutput = await callAgent({
                process: args.process,
                parts: args.parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_memoryBank,
                isJson: false,
                stepDescription: `Memory Bank for ${strategy.id} Iteration ${args.globalIteration}`,
                target: agent,
                retryField: 'retryAttempt',
                timeoutMs: AGENT_TIMEOUT_MS,
                critical: false,
                sandboxAccess: createMemoryBankSandboxAccess({
                    process: args.process,
                    strategyId: strategy.id,
                    branchVersion: runtime.branchVersion,
                    globalIteration: args.globalIteration,
                }),
            });
            const response = responseOutput.contextText;
            agent.memoryBank = response;
            agent.status = 'completed';
            runtime.memoryBank = response;
            runtime.lastMemoryHistoryCount += newHistory.length;
            strategy.memoryBank = response;
        } catch (error: any) {
            agent.status = 'error';
            agent.error = error.message || 'Memory bank generation failed';
        }
        render();
    }));
}

function grouped<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
    return result;
}

function pqfAggressivenessText(mode: string): string {
    if (mode === 'very_aggressive') {
        return 'Very aggressive: update strategies whenever the branch shows persistent conceptual weakness, repeated unresolved critique classes, domain-inappropriate execution, or low-value exploration.';
    }
    return 'Balanced: update only strategies with evidence of fundamental strategic failure. Keep strategies whose issues can plausibly be handled by correction.';
}

async function runPqfAgents(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    strategies: DeepthinkMainStrategyData[];
    globalIteration: number;
}): Promise<PqfDecision[]> {
    const groups = grouped(args.strategies, PQF_GROUP_SIZE);
    const decisions: PqfDecision[] = [];
    const allActive = allSnapshots(args.process, args.runtimes);
    const historyByStrategy = Object.fromEntries(args.strategies.map(strategy => {
        const runtime = args.runtimes.get(strategy.id);
        return [strategy.id, runtime?.history.slice(-MEMORY_INTERVAL) || []];
    }));

    args.process.postQualityFilterStatus = 'processing';
    args.process.postQualityFilterIterationCount = args.globalIteration;
    render();

    await Promise.all(groups.map(async (group, groupIndex) => {
        const groupSnapshots = group.map(strategy => {
            const runtime = args.runtimes.get(strategy.id) || createRuntime(strategy);
            return runtimeSnapshot(args.process, strategy, runtime, args.process.initialStrategies.indexOf(strategy));
        });

        const prompt = messageText(buildPqfPrompt({
            challenge: args.challengeText,
            groupIndex,
            groupCount: groups.length,
            strategiesInGroup: groupSnapshots,
            allActiveStrategies: allActive,
            historyByStrategy,
            aggressiveness: pqfAggressivenessText(deps.getSelectedPqfAggressiveness()),
        }));

        const agent: DeepthinkPostQualityFilterData = {
            id: `postqf-g${args.globalIteration}-${groupIndex + 1}`,
            iterationNumber: args.globalIteration,
            requestPrompt: prompt,
            prunedStrategyIds: [],
            continuedStrategyIds: [],
            status: 'processing',
            isDetailsOpen: true,
            groupIndex,
            groupStrategyIds: group.map(strategy => strategy.id),
        };
        args.process.postQualityFilterAgents.push(agent);
        render();

        try {
            const responseOutput = await callAgent({
                process: args.process,
                parts: args.parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_postQualityFilter,
                isJson: true,
                stepDescription: `PostQualityFilter Group ${groupIndex + 1} Iteration ${args.globalIteration}`,
                target: agent,
                retryField: 'retryAttempt',
                critical: true,
                sandboxAccess: createPqfSandboxAccess({
                    process: args.process,
                    groupIndex,
                    globalIteration: args.globalIteration,
                    strategyIds: group.map(strategy => strategy.id),
                }),
                finalOutputContract: pqfOutputContract(group.map(strategy => strategy.id)),
            });
            const response = responseOutput.contextText;

            const parsed = parseJson(response, `PostQualityFilter Group ${groupIndex + 1}`);
            const validIds = new Set(group.map(strategy => strategy.id));
            const parsedDecisions = Array.isArray(parsed.strategies) ? parsed.strategies : [];
            parsedDecisions.forEach((item: any) => {
                const strategyId = String(item.strategy_id || item.id || '').trim();
                const decision = String(item.decision || '').toLowerCase() === 'update' ? 'update' : 'keep';
                if (!validIds.has(strategyId)) return;
                decisions.push({
                    strategyId,
                    decision,
                    reasoning: String(item.reasoning || item.reason || 'No reasoning provided.'),
                });
            });

            agent.evaluationResponse = response;
            agent.evaluationResponseDisplay = responseOutput.displayText;
            agent.evaluationResponseFinal = responseOutput.finalText;
            agent.interactionTraceText = responseOutput.interactionTraceText;
            agent.executionTraceText = responseOutput.executionTraceText;
            agent.rawResponse = response;
            agent.reasoning = JSON.stringify(parsed, null, 2);
            agent.prunedStrategyIds = decisions.filter(decision => decision.decision === 'update' && validIds.has(decision.strategyId)).map(decision => decision.strategyId);
            agent.continuedStrategyIds = decisions.filter(decision => decision.decision === 'keep' && validIds.has(decision.strategyId)).map(decision => decision.strategyId);
            agent.status = 'completed';
        } catch (error: any) {
            agent.status = 'error';
            agent.error = error.message || 'PostQualityFilter failed';
            throw error;
        } finally {
            render();
        }
    }));

    args.process.postQualityFilterStatus = 'completed';
    render();
    return decisions;
}

async function updateStrategiesFromPqf(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    decisions: PqfDecision[];
    globalIteration: number;
}): Promise<string[]> {
    const updateDecisions = args.decisions.filter(decision => decision.decision === 'update');
    if (updateDecisions.length === 0) return [];

    const currentSnapshots = allSnapshots(args.process, args.runtimes);
    const previousSnapshots: StrategySnapshot[] = [];
    activeStrategies(args.process).forEach((strategy, index) => {
        (strategy.replacementHistory || []).forEach(record => {
            previousSnapshots.push({
                id: record.strategyId,
                strategyText: record.previousStrategyText,
                slotIndex: index,
                branchVersion: record.previousBranchVersion,
                branchIterationCount: 0,
                globalIteration: record.replacedAtGlobalIteration,
                latestSolution: record.latestSolution,
                latestCritique: record.latestCritique,
                memoryBank: record.memoryBank,
                replacedAtGlobalIteration: record.replacedAtGlobalIteration,
                replacementReason: record.pqfReasoning,
            });
        });
    });

    const updateRequests: StrategyUpdateRequest[] = updateDecisions.map(decision => {
        const strategy = args.process.initialStrategies.find(candidate => candidate.id === decision.strategyId)!;
        const runtime = args.runtimes.get(strategy.id)!;
        const latest = runtime.history[runtime.history.length - 1];
        const directSub = directSubFor(strategy);
        return {
            strategyId: strategy.id,
            oldStrategyText: strategy.strategyText,
            latestSolution: latest?.solution || directSub?.solutionAttempt || '',
            latestSolutionDisplay: latest?.solutionDisplay || directSub?.solutionAttemptDisplay,
            latestSolutionFinal: latest?.solutionFinal || directSub?.solutionAttemptFinal,
            latestCritique: latest?.critique || directSub?.solutionCritique || '',
            latestCritiqueDisplay: latest?.critiqueDisplay || directSub?.solutionCritiqueDisplay,
            latestCritiqueFinal: latest?.critiqueFinal || directSub?.solutionCritiqueFinal,
            memoryBank: runtime.memoryBank,
            pqfReasoning: decision.reasoning,
        };
    });

    const prompt = messageText(buildStrategyUpdatePrompt({
        challenge: args.challengeText,
        decisionVector: args.decisions,
        allCurrentStrategies: currentSnapshots,
        previousStrategies: previousSnapshots,
        updateRequests,
    }));

    const responseOutput = await callAgent({
        process: args.process,
        parts: args.parts.concat([{ text: prompt }]),
        systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_initialStrategy,
        isJson: true,
        stepDescription: `Strategy Updates after PQF Iteration ${args.globalIteration}`,
        target: args.process,
        retryField: 'retryAttempt',
        critical: true,
        sandboxAccess: createFullRepositorySandboxAccess({
            process: args.process,
            kind: 'Main Strategy Generation',
            sessionParts: ['strategy-updates', `global-${args.globalIteration}`],
        }),
        finalOutputContract: strategyOutputContract(updateRequests.length, 'update'),
    });
    const response = responseOutput.contextText;

    const parsed = parseJson(response, 'Strategy Updates');
    const replacementItems = Array.isArray(parsed.strategies) ? parsed.strategies : [];
    const updatedIds: string[] = [];

    for (const [index, request] of updateRequests.entries()) {
        const replacement = replacementItems.find((item: any) => String(item.strategy_id || item.id || '').trim() === request.strategyId) || replacementItems[index];
        const replacementText = typeof replacement === 'string'
            ? replacement
            : String(replacement?.strategy || replacement?.strategyText || replacement?.text || '');
        if (!replacementText.trim()) continue;

        const strategy = args.process.initialStrategies.find(candidate => candidate.id === request.strategyId);
        const runtime = strategy ? args.runtimes.get(strategy.id) : undefined;
        if (!strategy || !runtime) continue;

        await archiveSandboxRepositoryStrategy(
            args.process.id,
            DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory(strategySlotIndex(args.process, strategy.id)),
        );

        const previousVersion = runtime.branchVersion;
        const record: DeepthinkStrategyReplacementRecord = {
            strategyId: strategy.id,
            previousStrategyText: strategy.strategyText,
            replacementStrategyText: replacementText,
            replacedAtGlobalIteration: args.globalIteration,
            previousBranchVersion: previousVersion,
            newBranchVersion: previousVersion + 1,
            pqfReasoning: request.pqfReasoning,
            memoryBank: runtime.memoryBank,
            latestSolution: request.latestSolution,
            latestSolutionDisplay: request.latestSolutionDisplay,
            latestSolutionFinal: request.latestSolutionFinal,
            latestCritique: request.latestCritique,
            latestCritiqueDisplay: request.latestCritiqueDisplay,
            latestCritiqueFinal: request.latestCritiqueFinal,
            branchHistory: runtime.history.map(entry => ({ ...entry })),
            poolHistory: runtime.poolHistory.map(entry => ({ ...entry })),
        };

        strategy.replacementHistory = [...(strategy.replacementHistory || []), record];
        strategy.strategyText = replacementText;
        strategy.updatedByPostQualityFilter = true;
        strategy.postQualityFilterIteration = args.globalIteration;
        strategy.branchVersion = previousVersion + 1;
        strategy.branchIterationCount = 0;
        strategy.memoryBank = undefined;

        const sub = ensureDirectSubStrategy(strategy);
        sub.subStrategyText = replacementText;
        sub.solutionAttempt = undefined;
        sub.solutionAttemptDisplay = undefined;
        sub.solutionAttemptFinal = undefined;
        sub.refinedSolution = undefined;
        sub.refinedSolutionDisplay = undefined;
        sub.refinedSolutionFinal = undefined;
        sub.solutionCritique = undefined;
        sub.solutionCritiqueDisplay = undefined;
        sub.solutionCritiqueFinal = undefined;
        sub.status = 'pending';
        sub.selfImprovementStatus = 'pending';
        sub.solutionCritiqueStatus = 'pending';
        sub.evolvingDfs = { enabled: true, status: 'processing', iterations: [] };
        sub.branchIterationCount = 0;

        runtime.branchVersion += 1;
        runtime.branchIterationCount = 0;
        runtime.history = [];
        runtime.poolHistory = [];
        runtime.memoryBank = undefined;
        runtime.lastMemoryHistoryCount = 0;
        runtime.lastHypothesisFlushGlobalIteration = args.globalIteration;

        if (args.process.strategySpecificKnowledgePackets) {
            args.process.strategySpecificKnowledgePackets[strategy.id] = `<Strategy-Specific Information Packet for Strategy ${strategy.id}>\nThis strategy branch was replaced at global iteration ${args.globalIteration}. Previous selective hypothesis packets for this slot were flushed. Fresh hypotheses will be injected after the next hypothesis heartbeat.\n</Strategy-Specific Information Packet for Strategy ${strategy.id}>`;
        }

        updatedIds.push(strategy.id);
    }

    if (updatedIds.length > 0) {
        await snapshotSandboxRepositoryById(args.process.id, `Deepthink iteration ${args.globalIteration} PQF branch replacement archive`);
    }
    render();
    return updatedIds;
}

async function runPostFiveIterationMaintenance(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
}): Promise<string[]> {
    const dueStrategies = activeStrategies(args.process).filter(strategy => {
        const runtime = args.runtimes.get(strategy.id);
        if (!runtime) return false;
        return runtime.history.length - runtime.lastMemoryHistoryCount >= MEMORY_INTERVAL;
    });

    if (dueStrategies.length === 0) return [];

    const memoryPromise = runMemoryAgents({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        runtimes: args.runtimes,
        strategies: dueStrategies,
        globalIteration: args.globalIteration,
    });

    const pqfPromise = runPqfAgents({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        runtimes: args.runtimes,
        strategies: dueStrategies,
        globalIteration: args.globalIteration,
    });

    const [pqfResult] = await Promise.all([pqfPromise, memoryPromise]);
    const updatedIds = await updateStrategiesFromPqf({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        runtimes: args.runtimes,
        decisions: pqfResult,
        globalIteration: args.globalIteration,
    });

    await Promise.allSettled(updatedIds.map(async strategyId => {
        const strategy = args.process.initialStrategies.find(candidate => candidate.id === strategyId);
        const runtime = strategy ? args.runtimes.get(strategy.id) : undefined;
        const subStrategy = strategy ? ensureDirectSubStrategy(strategy) : undefined;
        if (!strategy || !runtime || !subStrategy) return;

        await executeSolutionAttempt({
            process: args.process,
            parts: args.parts,
            challengeText: args.challengeText,
            strategy,
            subStrategy,
            critical: true,
        });
        if (!subStrategy.solutionAttempt) return;
        const critique = await critiqueSolution({
            process: args.process,
            parts: args.parts,
            challengeText: args.challengeText,
            strategy,
            subStrategy,
            solution: subStrategy.solutionAttempt,
            runtime,
            globalIteration: args.globalIteration,
            branchIteration: 1,
        });
        subStrategy.solutionCritique = critique || 'No critique output available.';
        subStrategy.solutionCritiqueDisplay = subStrategy.solutionCritiqueDisplay || critique || 'No critique output available.';
        subStrategy.refinedSolution = subStrategy.solutionAttempt;
        subStrategy.refinedSolutionDisplay = subStrategy.solutionAttemptDisplay;
        subStrategy.refinedSolutionFinal = subStrategy.solutionAttemptFinal;
        subStrategy.refinedSolutionTraceText = subStrategy.solutionAttemptTraceText;
        subStrategy.selfImprovementStatus = 'completed';

        runtime.history.push({
            globalIteration: args.globalIteration,
            branchIteration: 1,
            branchVersion: runtime.branchVersion,
            label: `Branch v${runtime.branchVersion} Initial Execution`,
            solution: subStrategy.solutionAttempt || '',
            solutionDisplay: subStrategy.solutionAttemptDisplay,
            solutionFinal: subStrategy.solutionAttemptFinal,
            critique: critique || 'No critique output available.',
            critiqueDisplay: subStrategy.solutionCritiqueDisplay,
            critiqueFinal: subStrategy.solutionCritiqueFinal,
        });
        runtime.globalIteration = args.globalIteration;
        runtime.branchIterationCount = 1;
        strategy.branchIterationCount = 1;
        strategy.memoryBank = runtime.memoryBank;
        subStrategy.branchIterationCount = 1;
        subStrategy.evolvingDfs = {
            enabled: true,
            status: 'processing',
            iterations: [{
                iterationNumber: args.globalIteration,
                globalIteration: args.globalIteration,
                branchIteration: 1,
                branchVersion: runtime.branchVersion,
                critique: critique || 'No critique output available.',
                critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                critiqueFinal: subStrategy.solutionCritiqueFinal,
                correctedSolution: subStrategy.solutionAttempt || '',
                correctedSolutionDisplay: subStrategy.solutionAttemptDisplay,
                correctedSolutionFinal: subStrategy.solutionAttemptFinal,
                correctedSolutionTraceText: subStrategy.solutionAttemptTraceText,
                timestamp: Date.now(),
                label: `Branch v${runtime.branchVersion} Initial Execution`,
            }],
        };
    }));

    if (updatedIds.length > 0) {
        args.process.structuredSolutionPool = buildStructuredSolutionPool(args.process, args.runtimes);
        render();
    }

    return updatedIds;
}

async function runHypothesisHeartbeatIfDue(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
    updatedStrategyIds: string[];
}): Promise<void> {
    if (deps.getSelectedHypothesisCount() <= 0) return;
    if (args.globalIteration % HYPOTHESIS_HEARTBEAT_INTERVAL !== 0) return;

    const snapshots = allSnapshots(args.process, args.runtimes);
    const recentHistoryByStrategy = Object.fromEntries(snapshots.map(snapshot => {
        const runtime = args.runtimes.get(snapshot.id);
        return [snapshot.id, runtime?.history.slice(-2) || []];
    }));

    const prompt = messageText(buildHypothesisRefreshPrompt({
        challenge: args.challengeText,
        hypothesisCount: deps.getSelectedHypothesisCount(),
        completedGlobalIteration: args.globalIteration,
        previousRounds: args.process.hypothesisRounds || [],
        currentStrategies: snapshots,
        recentHistoryByStrategy,
        updatedStrategyIds: args.updatedStrategyIds,
    }));

    await runHypothesisRound({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        mode: 'selective_injection',
        roundNumber: (args.process.hypothesisRounds?.length || 0) + 1,
        globalIteration: args.globalIteration,
        prompt,
    });
}

/** The global iteration is the only meaningful Deepthink repository boundary.
 * Agent directories remain isolated while running, but one shared commit keeps
 * every branch's completed work together for the explorer and history view. */
async function snapshotDeepthinkRepositoryState(process: DeepthinkPipelineState, commitMessage: string): Promise<void> {
    const sandboxEnabled = deps.getDeepthinkCodeExecutionEnabled()
        || globalState.directContextFiles.length > 0
        || globalState.filesystemContextFiles.length > 0;
    if (!sandboxEnabled) return;

    try {
        await snapshotSandboxRepositoryById(process.id, commitMessage);
        await snapshotDeepthinkResultsRepository(
            process.id,
            commitMessage,
            buildDeepthinkResultsContextFiles(process),
        );
    } catch (error) {
        console.warn(`Failed to snapshot Deepthink Results repository (${commitMessage}):`, error);
    }
}

export async function snapshotDeepthinkIteration(process: DeepthinkPipelineState, globalIteration: number): Promise<void> {
    await snapshotDeepthinkRepositoryState(process, `Deepthink iteration ${globalIteration}`);
}

async function runEvolvingDepthFirstSearch(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
}): Promise<void> {
    args.process.structuredSolutionPoolEnabled = true;
    args.process.postQualityFilterStatus = 'pending';
    args.process.hypothesisInjectionMode = 'selective_injection';
    render();

    const runtimes = new Map<string, BranchRuntime>();
    activeStrategies(args.process).forEach(strategy => {
        ensureDirectSubStrategy(strategy);
        strategy.branchVersion = 1;
        strategy.branchIterationCount = 0;
        runtimes.set(strategy.id, createRuntime(strategy));
    });

    await runHypothesisRound({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        mode: 'selective_injection',
        roundNumber: 1,
        globalIteration: 0,
    });

    await runInitialExecutionsAndCritiques({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        runtimes,
        evolvingDfsMode: true,
    });

    await runSolutionPools({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        runtimes,
        globalIteration: 1,
    });
    await snapshotDeepthinkIteration(args.process, 1);

    const evolvingDfsDepth = Math.min(Math.max(deps.getEvolvingDfsDepth(), 1), 10);
    let recentlyUpdatedStrategyIds: string[] = [];

    for (let globalIteration = 2; globalIteration <= evolvingDfsDepth; globalIteration++) {
        if (args.process.isStopRequested) throw new PipelineStopRequestedError('Evolving DFS stopped by user.');

        await runCorrectionIteration({
            process: args.process,
            parts: args.parts,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
        });

        const poolPromise = runSolutionPools({
            process: args.process,
            parts: args.parts,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
        });

        const hypothesisPromise = runHypothesisHeartbeatIfDue({
            process: args.process,
            parts: args.parts,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
            updatedStrategyIds: recentlyUpdatedStrategyIds,
        });

        await Promise.all([poolPromise, hypothesisPromise]);
        recentlyUpdatedStrategyIds = await runPostFiveIterationMaintenance({
            process: args.process,
            parts: args.parts,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
        });
        // Capture the completed iteration after its PQF/memory maintenance so
        // this commit is the whole branch state users actually observed.
        await snapshotDeepthinkIteration(args.process, globalIteration);
    }

    activeStrategies(args.process).forEach(strategy => {
        const sub = ensureDirectSubStrategy(strategy);
        if (sub.evolvingDfs) sub.evolvingDfs.status = 'completed';
    });
    args.process.structuredSolutionPool = buildStructuredSolutionPool(args.process, runtimes);
    args.process.structuredSolutionPoolStatus = 'completed';
    render();
}

async function runNonIterativeRefinement(args: {
    process: DeepthinkPipelineState;
    parts: Part[];
    challengeText: string;
}): Promise<void> {
    await runInitialExecutionsAndCritiques({
        process: args.process,
        parts: args.parts,
        challengeText: args.challengeText,
        runtimes: new Map(),
        evolvingDfsMode: false,
    });

    if (!deps.getRefinementEnabled()) {
        activeStrategies(args.process).forEach(strategy => {
            strategy.subStrategies.forEach(sub => {
                if (sub.solutionAttempt) {
                    sub.refinedSolution = sub.solutionAttempt;
                    sub.refinedSolutionDisplay = sub.solutionAttemptDisplay;
                    sub.refinedSolutionFinal = sub.solutionAttemptFinal;
                    sub.selfImprovementStatus = 'completed';
                }
            });
        });
        render();
        return;
    }

    if (deps.getDissectedObservationsEnabled()) {
        args.process.dissectedSynthesisStatus = 'processing';
        render();

        try {
            const solutionsWithCritiques = activeStrategies(args.process).map(strategy => {
                const subs = strategy.subStrategies.filter(sub => sub.solutionAttempt);
                if (subs.length === 0) return '';
                return [
                    `<Strategy id="${strategy.id}">`,
                    strategy.strategyText,
                    ...subs.map(sub => [
                        `<SubStrategy id="${sub.id}">`,
                        sub.subStrategyText,
                        '<SolutionAttempt>',
                        sub.solutionAttempt || '',
                        '</SolutionAttempt>',
                        '<Critique>',
                        sub.solutionCritique || 'No critique available.',
                        '</Critique>',
                        '</SubStrategy>',
                    ].join('\n')),
                    `</Strategy>`,
                ].join('\n');
            }).filter(Boolean).join('\n\n');

            const packet = deps.getShareHypothesesToDissected()
                ? args.process.knowledgePacket || 'No hypothesis exploration performed.'
                : 'Hypothesis exploration sharing is disabled for dissected observations.';
            const prompt = buildDissectedSynthesisPrompt({
                challengeText: args.challengeText,
                knowledgePacket: packet,
                solutionsWithCritiques,
            });
            args.process.dissectedSynthesisRequestPrompt = prompt;

            const synthesisResponse = await callAgent({
                process: args.process,
                parts: args.parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_dissectedSynthesis,
                isJson: false,
                stepDescription: 'Dissected Observations Synthesis',
                target: args.process,
                retryField: 'dissectedSynthesisRetryAttempt',
                critical: false,
                sandboxAccess: createFullRepositorySandboxAccess({
                    process: args.process,
                    kind: 'Dissected Observations Synthesis',
                    sessionParts: ['non-iterative'],
                }),
            });
            args.process.dissectedObservationsSynthesis = synthesisResponse.contextText;
            args.process.dissectedSynthesisTraceText = synthesisResponse.interactionTraceText;
            args.process.dissectedSynthesisExecutionTraceText = synthesisResponse.executionTraceText;
            args.process.dissectedSynthesisStatus = 'completed';
        } catch (error: any) {
            args.process.dissectedSynthesisStatus = 'error';
            args.process.dissectedSynthesisError = error.message || 'Dissected synthesis failed';
        }
        render();
    }

    await Promise.allSettled(activeStrategies(args.process).flatMap(strategy => strategy.subStrategies.map(async subStrategy => {
        if (!subStrategy.solutionAttempt) return;

        subStrategy.selfImprovementStatus = 'processing';
        render();

        const allSolutions = deps.getProvideAllSolutionsToCorrectors()
            ? activeStrategies(args.process).flatMap(strategyItem => strategyItem.subStrategies.map(sub => [
                `<Candidate strategy="${strategyItem.id}" subStrategy="${sub.id}" assigned="${sub.id === subStrategy.id}">`,
                strategyItem.strategyText,
                sub.subStrategyText,
                sub.solutionAttempt || '',
                sub.solutionCritique || '',
                '</Candidate>',
            ].join('\n'))).join('\n\n')
            : '';

        const solutionSection = [
            subStrategy.solutionCritique || 'No critique available.',
            args.process.dissectedObservationsSynthesis ? `\n\n<Dissected Observations Synthesis>\n${args.process.dissectedObservationsSynthesis}\n</Dissected Observations Synthesis>` : '',
            allSolutions ? `\n\n<All Solutions Context>\n${allSolutions}\n</All Solutions Context>` : '',
        ].join('');

        const prompt = buildSelfImprovementPrompt({
            challengeText: args.challengeText,
            mainStrategy: strategy.strategyText,
            subStrategy: subStrategy.subStrategyText,
            solutionAttempt: subStrategy.solutionAttempt || '',
            solutionSection,
        });
        subStrategy.requestPromptSelfImprovement = prompt;

        try {
            const response = await callAgent({
                process: args.process,
                parts: args.parts.concat([{ text: prompt }]),
                systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_selfImprovement,
                isJson: false,
                stepDescription: `Self-Improvement for ${subStrategy.id}`,
                target: subStrategy,
                retryField: 'selfImprovementRetryAttempt',
                timeoutMs: AGENT_TIMEOUT_MS,
                critical: false,
                sandboxAccess: createPersistentSandboxAccess({
                    process: args.process,
                    kind: 'Self-Improvement',
                    strategyId: strategy.id,
                    subStrategyId: subStrategy.id,
                    branchVersion: strategy.branchVersion || 1,
                    includeAllSolutionContextDirectories: deps.getProvideAllSolutionsToCorrectors(),
                }),
            });
            subStrategy.refinedSolution = response.contextText;
            subStrategy.refinedSolutionDisplay = response.displayText;
            subStrategy.refinedSolutionFinal = response.finalText;
            subStrategy.refinedSolutionTraceText = response.interactionTraceText;
            subStrategy.refinedSolutionExecutionTraceText = response.executionTraceText;
            subStrategy.selfImprovementStatus = 'completed';
        } catch (error: any) {
            subStrategy.selfImprovementStatus = 'error';
            subStrategy.selfImprovementError = error.message || 'Self-improvement failed';
        }
        render();
    })));
}

async function finalJudge(process: DeepthinkPipelineState, parts: Part[], challengeText: string): Promise<void> {
    process.finalJudgingStatus = 'processing';
    render();

    const allSolutions = activeStrategies(process).flatMap(strategy => strategy.subStrategies.map(subStrategy => ({
        id: subStrategy.id,
        solution: subStrategy.refinedSolutionFinal || subStrategy.solutionAttemptFinal || subStrategy.refinedSolution || subStrategy.solutionAttempt || '',
        mainStrategyId: strategy.id,
        subStrategyText: subStrategy.subStrategyText,
    }))).filter(item => item.solution.trim());

    if (allSolutions.length === 0) {
        process.finalJudgingStatus = 'error';
        process.finalJudgingError = 'No completed solutions available for final review.';
        render();
        return;
    }

    const finalSolutionsText = allSolutions.map((solution, index) => [
        `<SOLUTION_${index + 1}>`,
        `ID: ${solution.id}`,
        `Main Strategy: ${solution.mainStrategyId}`,
        `Sub-Strategy: ${solution.subStrategyText}`,
        'Solution Text:',
        solution.solution,
        `</SOLUTION_${index + 1}>`,
    ].join('\n')).join('\n\n');

    const prompt = `Original Challenge:
${challengeText}

Below are ${allSolutions.length} candidate solutions from different strategic approaches. Select the single overall best solution.

Return JSON:
{"best_solution_id":"ID of the winning solution","final_reasoning":"Detailed comparison based only on provided texts"}

${finalSolutionsText}`;

    process.finalJudgingRequestPrompt = prompt;

    try {
        const responseOutput = await callAgent({
            process,
            parts: parts.concat([{ text: prompt }]),
            systemInstruction: deps.customPromptsDeepthinkState.sys_deepthink_finalJudge,
            isJson: true,
            stepDescription: 'Final Judging',
            target: process,
            retryField: 'finalJudgingRetryAttempt',
            timeoutMs: AGENT_TIMEOUT_MS,
            critical: false,
            sandboxAccess: createFullRepositorySandboxAccess({
                process,
                kind: 'Final Judge',
                sessionParts: ['final'],
            }),
            finalOutputContract: finalJudgeOutputContract(),
        });
        const response = responseOutput.contextText;
        process.finalJudgingResponseText = response;
        process.finalJudgingTraceText = responseOutput.interactionTraceText;
        process.finalJudgingExecutionTraceText = responseOutput.executionTraceText;
        const parsed = parseJson(response, 'Final Judge');
        if (!parsed.best_solution_id || !parsed.final_reasoning) {
            throw new Error('Final Judge response is missing best_solution_id or final_reasoning.');
        }

        const winningSolution = allSolutions.find(solution => solution.id === parsed.best_solution_id);
        process.finalJudgedBestStrategyId = winningSolution?.id || parsed.best_solution_id;
        process.finalJudgedBestSolution = `**Solution ID:** <span class="sub-strategy-purple-id">${parsed.best_solution_id}</span>

**Origin:** ${winningSolution ? `${winningSolution.subStrategyText} from ${winningSolution.mainStrategyId}` : `Solution ${parsed.best_solution_id}`}

**Final Reasoning:**
${parsed.final_reasoning}

---

**Definitive Solution:**
${winningSolution?.solution || parsed.final_solution_text || 'Solution not found'}`;
        process.finalJudgingStatus = 'completed';
    } catch (error: any) {
        process.finalJudgingStatus = 'error';
        process.finalJudgingError = error.message || 'Failed to perform final judging.';
    }
    render();
}

export async function startDeepthinkAnalysisProcess(challengeText: string, imageBase64?: string | null, imageMimeType?: string | null) {
    const currentAIProvider = deps.getAIProvider();
    if (!currentAIProvider) {
        alert('AI provider not initialized. Please check your API key configuration.');
        return;
    }

    activeDeepthinkPipeline = createPipeline(challengeText, imageBase64, imageMimeType);
    if (setActiveDeepthinkPipeline) setActiveDeepthinkPipeline(activeDeepthinkPipeline);
    deps.updateControlsState({ isGenerating: true });
    addLiveEvent(activeDeepthinkPipeline, 'Orchestrator', 'Initializing Deepthink pipeline', 'info');
    render();

    const process = activeDeepthinkPipeline;
    const parts = buildImageParts(imageBase64, imageMimeType);
    const modelChallengeText = `${challengeText}${getDirectTextContext()}`;
    const evolvingDfsMode = deps.getRefinementEnabled() && deps.getEvolvingDfsEnabled();
    process.hypothesisInjectionMode = evolvingDfsMode ? 'selective_injection' : deps.getHypothesisInjectionMode();

    const sandboxEnabled = deps.getDeepthinkCodeExecutionEnabled()
        || globalState.directContextFiles.length > 0
        || globalState.filesystemContextFiles.length > 0;
    if (sandboxEnabled) {
        try {
            await ensureDeepthinkResultsRepository(process.id);
        } catch (error) {
            // A failed archival mirror must never prevent the actual model run.
            console.warn('Failed to initialize Deepthink Results repository:', error);
        }
    }

    try {
        await generateStrategies(process, parts, modelChallengeText, evolvingDfsMode);
        await generateSubStrategies(process, parts, modelChallengeText);

        if (!evolvingDfsMode) {
            await runHypothesisRound({
                process,
                parts,
                challengeText: modelChallengeText,
                mode: process.hypothesisInjectionMode || 'selective_injection',
                roundNumber: 1,
                globalIteration: 0,
            });
            await runNonIterativeRefinement({ process, parts, challengeText: modelChallengeText });
        } else {
            await runEvolvingDepthFirstSearch({ process, parts, challengeText: modelChallengeText });
        }

        if (process.isStopRequested) throw new PipelineStopRequestedError('Stopped before final judging.');

        process.strategicSolverComplete = true;
        await finalJudge(process, parts, modelChallengeText);
        await snapshotDeepthinkRepositoryState(process, 'Deepthink final judge');
        process.status = 'completed';
    } catch (error: any) {
        if (error instanceof PipelineStopRequestedError) {
            process.status = 'stopped';
        } else {
            process.status = 'error';
            process.error = error.message || String(error);
        }
    } finally {
        deps.updateControlsState({ isGenerating: false });
        render();
    }
}
