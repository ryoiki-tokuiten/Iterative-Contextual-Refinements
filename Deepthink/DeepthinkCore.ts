/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink Core - the fixed iterative Deepthink implementation.
 */

import { GenerateContentResponse, Part } from "@google/genai";
import { HumanMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { ThinkingConfig } from '../Routing/AIProvider';
import { archiveSandboxRepositoryStrategy, ensureDeepthinkResultsRepository, runSandboxToolAgent, snapshotDeepthinkResultsRepository, snapshotSandboxRepositoryById, type DeepthinkResultsContextFile, type SandboxFinalOutputContract } from '../Core/SandboxToolRuntime';
import { describeProviderError } from '../Core/ProviderError';
import { globalState } from '../Core/State';
import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';
import {
    DEEPTHINK_AGENT_REGISTRY,
    deepthinkAgentModel,
    deepthinkAgentSystemInstruction,
    type DeepthinkAgentKind,
} from './DeepthinkAgentRegistry';
import {
    buildAttachmentSeedFiles,
    buildDeepthinkAttachments,
    buildFilesystemAttachmentFiles,
    buildProviderParts,
    buildTextAttachmentContext,
    selectRoutedHypotheses,
    validateAllowedUniqueIds,
    validateExactUniqueIdSet,
    type DeepthinkAgentContextManifest,
    type DeepthinkAttachmentRoute,
    type DeepthinkRunConfig,
} from './DeepthinkContext';
import {
    normalizeProximityHistory,
    refineWithProximity,
    type ProximityTurn,
} from './DeepthinkProximity';
import {
    buildDeepthinkSandboxRepositoryAccess,
    DEEPTHINK_SANDBOX_DIRECTORY_POLICY,
    type DeepthinkSandboxAccessInput,
} from './DeepthinkSandboxAccess';
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

export type { DeepthinkRunConfig } from './DeepthinkContext';

type AgentStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';

export interface DeepthinkSolutionCritiqueData {
    id: string;
    mainStrategyId: string;
    branchVersion?: number;
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
    branchVersion?: number;
    poolResponse?: string;
    parsedPoolResponse?: SolutionPoolParsedResponse;
    status: AgentStatus | 'skipped';
    globalIteration?: number;
    branchIteration?: number;
    executionTraceText?: string;
}

export interface DeepthinkBranchIteration {
    iterationNumber: number;
    globalIteration?: number;
    branchIteration?: number;
    branchVersion?: number;
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
    updatedByPostQualityFilter?: boolean;
    postQualityFilterIteration?: number;
    branchVersion?: number;
    memoryBank?: string;
    replacementHistory?: DeepthinkStrategyReplacementRecord[];
    awaitingFreshHypotheses?: boolean;
}

export interface DeepthinkHypothesisData {
    id: string;
    hypothesisText: string;
    testerAttempt?: string;
    testerAttemptDisplay?: string;
    testerAttemptFinal?: string;
    testerAttemptExecutionTraceText?: string;
    testerStatus: AgentStatus;
    targetBranchIds?: string[];
    roundNumber?: number;
    globalIteration?: number;
}

export interface DeepthinkPostQualityFilterData {
    id: string;
    iterationNumber: number;
    evaluationResponse?: string;
    evaluationResponseFinal?: string;
    executionTraceText?: string;
    prunedStrategyIds: string[];
    continuedStrategyIds: string[];
    reasoning?: string;
    status: AgentStatus;
    groupIndex?: number;
    groupStrategyIds?: string[];
}

interface DeepthinkMemoryBankAgentData {
    mainStrategyId: string;
    branchVersion?: number;
    memoryBank?: string;
    globalIteration: number;
}

interface DeepthinkStrategyReplacementRecord {
    strategyId: string;
    previousStrategyText: string;
    replacementStrategyText: string;
    replacedAtGlobalIteration: number;
    previousBranchVersion: number;
    pqfReasoning: string;
    memoryBank?: string;
    latestSolution?: string;
    latestSolutionDisplay?: string;
    latestCritique?: string;
    latestCritiqueDisplay?: string;
    branchHistory?: BranchHistoryEntry[];
    poolHistory?: PoolHistoryEntry[];
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
    postQualityFilterAgents: DeepthinkPostQualityFilterData[];
    postQualityFilterStatus?: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
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
    /** Immutable settings and prompts that produced this run. */
    runConfig?: DeepthinkRunConfig;
    /** Current committed repository baseline used for read-only agent views. */
    repositoryRevision?: string;
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
    getSelectedPqfAggressiveness: () => string;
    getDeepthinkDepth: () => number;
    getIsolateBranchesEnabled: () => boolean;
    getSolutionPoolDisabled: () => boolean;
    getDeepthinkCodeExecutionEnabled: () => boolean;
    updateControlsState: (newState: any) => void;
    getSelectedThinkingLevel?: () => 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | string;
    getCustomPromptsDeepthinkState: () => CustomizablePromptsDeepthink;
}

let deps: DeepthinkCoreDeps = null!;
const runAttachments = new Map<string, DeepthinkAttachmentRoute[]>();

const RETRY_DELAYS_MS = [30_000, 60_000, 5 * 60_000] as const;
const MAX_API_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const SANDBOX_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const POOL_HISTORY_WINDOW = 5;
const CORRECTION_HISTORY_WINDOW = 5;
const MEMORY_INTERVAL = 5;
const PQF_GROUP_SIZE = 2;
const HYPOTHESIS_HEARTBEAT_INTERVAL = 2;
const NO_SOLUTION_POOL_AVAILABLE = 'No solution pool available';

function captureRunConfig(): DeepthinkRunConfig {
    const prompts = Object.freeze({ ...deps.getCustomPromptsDeepthinkState() });
    return Object.freeze({
        selectedModel: deps.getSelectedModel(),
        thinkingLevel: deps.getSelectedThinkingLevel?.() || 'high',
        strategyCount: Math.min(deps.getSelectedStrategiesCount(), 5),
        strategyProximityLoops: deps.getStrategyProximityLoops(),
        hypothesisCount: deps.getSelectedHypothesisCount(),
        hypothesisProximityLoops: deps.getHypothesisProximityLoops(),
        depth: Math.min(Math.max(deps.getDeepthinkDepth(), 1), 10),
        isolateBranches: deps.getIsolateBranchesEnabled(),
        solutionPoolDisabled: deps.getSolutionPoolDisabled(),
        pqfAggressiveness: deps.getSelectedPqfAggressiveness(),
        codeExecutionEnabled: deps.getDeepthinkCodeExecutionEnabled(),
        prompts,
    });
}

function configFor(process: DeepthinkPipelineState): DeepthinkRunConfig {
    if (!process.runConfig) {
        throw new Error('This Deepthink run has no immutable run configuration.');
    }
    return process.runConfig;
}

function attachmentsFor(process: DeepthinkPipelineState): DeepthinkAttachmentRoute[] {
    return runAttachments.get(process.id) || [];
}

interface DeepthinkAgentCallOutput {
    contextText: string;
    displayText: string;
    finalText: string;
    executionTraceText?: string;
}

interface BranchRuntime {
    branchVersion: number;
    branchIterationCount: number;
    globalIteration: number;
    history: BranchHistoryEntry[];
    poolHistory: PoolHistoryEntry[];
    memoryBank?: string;
    lastMemoryHistoryCount: number;
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
    const index = activeStrategies(process).findIndex(strategy => strategy.id === strategyId);
    if (index < 0) throw new Error(`Unknown active Deepthink strategy ID: ${strategyId}`);
    return index;
}

function hypothesisDirectoryLabel(hypothesis: DeepthinkHypothesisData): string {
    return hypothesis.id.match(/hyp\d+-(\d+)/)?.[1] || hypothesis.id.replace(/^hyp/i, '');
}

function currentHypothesisRoundNumber(process: DeepthinkPipelineState): number | undefined {
    return process.hypotheses[0]?.roundNumber;
}

function renderStrategyHypothesisPacket(
    strategyId: string,
    hypotheses: readonly DeepthinkHypothesisData[],
    awaitingFreshHypotheses = false,
): string {
    if (awaitingFreshHypotheses) {
        return `<Branch-Hypothesis-Packet branch="${strategyId}">
This replacement branch is awaiting a successful fresh hypothesis heartbeat. Earlier hypothesis findings are intentionally unavailable.
</Branch-Hypothesis-Packet>`;
    }
    return [
        `<Branch-Hypothesis-Packet branch="${strategyId}">`,
        hypotheses.length
            ? hypotheses.map(hypothesis => [
                `<Hypothesis ${hypothesis.id}>`,
                `Hypothesis: ${hypothesis.hypothesisText}`,
                `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}`,
                `</Hypothesis ${hypothesis.id}>`,
            ].join('\n')).join('\n\n')
            : 'No active hypotheses are currently routed to this branch.',
        '</Branch-Hypothesis-Packet>',
    ].join('\n');
}

function renderHypothesisTestingPacket(hypotheses: readonly DeepthinkHypothesisData[]): string {
    return [
        '<Hypothesis-Testing-Packet>',
        ...hypotheses.map((hypothesis, index) => [
            `<Hypothesis ${index + 1}>`,
            `Hypothesis: ${hypothesis.hypothesisText}`,
            `Target Branches: ${hypothesis.targetBranchIds?.join(', ') || 'All'}`,
            `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}`,
            `</Hypothesis ${index + 1}>`,
        ].join('\n')),
        '</Hypothesis-Testing-Packet>',
    ].join('\n');
}

interface StrategyHypothesisRoute {
    packetText: string;
    directoryLabels: string[];
    roundNumber?: number;
}

function getStrategyHypothesisRoute(
    process: DeepthinkPipelineState,
    strategyId: string,
): StrategyHypothesisRoute {
    const strategy = activeStrategies(process).find(candidate => candidate.id === strategyId);
    if (!strategy) throw new Error(`Cannot route hypotheses to unknown strategy ID: ${strategyId}`);
    const hypotheses = selectRoutedHypotheses(
        process.hypotheses,
        strategyId,
        strategy.awaitingFreshHypotheses,
    );
    return {
        packetText: renderStrategyHypothesisPacket(
            strategy.id,
            hypotheses,
            strategy.awaitingFreshHypotheses,
        ),
        directoryLabels: hypotheses.map(hypothesisDirectoryLabel),
        roundNumber: currentHypothesisRoundNumber(process),
    };
}

function peerStrategySlotIndexes(process: DeepthinkPipelineState, strategyId: string): number[] {
    return activeStrategies(process)
        .map((strategy, index) => strategy.id === strategyId ? -1 : index)
        .filter(index => index >= 0);
}

function getDeepthinkSandboxFilesystemRules(): string[] {
    return [
        '- Repository and attachment transport is role-scoped. Terminal commands are available only when Code Execution was explicitly enabled for the run.',
        '- Deepthink runs use one shared repository view rooted at /workspace.',
        '- A strategy branch is Strategy-N with direct work files at its root, a Critique child, and a SolutionPool child. Execution and correction workers write only direct branch files; child directories are role-owned mounts.',
        '- Critique workers write only inside Strategy-N/Critique and can read the matching branch except its SolutionPool child directory.',
        '- Hypothesis testers write only inside Hypothesis-vN/Hypothesis-M and never receive earlier hypothesis rounds or strategy directories.',
        '- Strategy generation, hypothesis generation, and final-judge roles receive a full read-only repository view; PQF and memory roles receive only their explicitly assigned branch directories read-only.',
        '- Branch isolation removes peer prompt sections and peer directory mounts from correction and solution-pool agents.',
        '- Hypothesis directories remain visible only to branches whose text context receives those same tested packets.',
        '- Read-only repository context is pinned to the orchestration barrier revision. Only the assigned writable directory and a critique\'s just-completed parent branch can use live worktree state.',
        '- Directories outside the current role-specific context contract are not mounted or visible.',
    ];
}

type RepositoryScope = Omit<
    DeepthinkSandboxAccessInput,
    'repositoryId' | 'role' | 'repositoryRevision'
>;

function finalizeAgentContext(args: {
    process: DeepthinkPipelineState;
    agentKind: DeepthinkAgentKind;
    promptText: string;
    sessionParts: Array<string | number | undefined>;
    repositoryScope?: RepositoryScope;
    outputContract?: SandboxFinalOutputContract;
    systemInstruction?: string;
}): DeepthinkAgentContextManifest {
    const config = configFor(args.process);
    const metadata = DEEPTHINK_AGENT_REGISTRY[args.agentKind];
    return {
        agentKind: args.agentKind,
        agentName: `${metadata.label} Agent`,
        sandboxSessionId: buildDeepthinkSandboxSessionId(args.process, args.sessionParts),
        systemInstruction: args.systemInstruction
            || deepthinkAgentSystemInstruction(args.agentKind, config.prompts),
        promptText: args.promptText,
        attachments: attachmentsFor(args.process),
        repositoryAccess: buildDeepthinkSandboxRepositoryAccess({
            repositoryId: args.process.id,
            role: metadata.sandboxRole,
            repositoryRevision: args.process.repositoryRevision,
            ...args.repositoryScope,
        }),
        outputContract: args.outputContract,
    };
}

function buildStrategyGenerationAgentContext(args: {
    process: DeepthinkPipelineState;
    taskPrompt: string;
    conversationText: string;
    strategyIds: string[];
    revision: boolean;
    isUpdate: boolean;
}): DeepthinkAgentContextManifest {
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'initialStrategy',
        promptText: withGeneratorProximityConversation(
            args.taskPrompt,
            args.conversationText,
            args.revision
                ? (args.isUpdate
                    ? 'Revise every proposed replacement against the latest proximity critique. Keep each requested strategy_id and return one genuinely new, orthogonal branch per slot.'
                    : 'Revise the strategy set against the latest proximity critique. Preserve orthogonal coverage and return the requested number of strategies.')
                : undefined,
        ),
        sessionParts: ['initialStrategy', 'generator-proximity', 'generator'],
        outputContract: strategyOutputContract(
            args.strategyIds.length,
            args.isUpdate ? 'update' : 'initial',
            args.isUpdate ? args.strategyIds : [],
        ),
    });
}

function buildStrategyProximityAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    taskPrompt: string;
    conversationText: string;
}): DeepthinkAgentContextManifest {
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'strategyProximity',
        promptText: buildProximityReviewPrompt(
            'strategy',
            args.challengeText,
            args.taskPrompt,
            args.conversationText,
        ),
        sessionParts: ['strategyProximity', 'generator-proximity', 'proximity'],
    });
}

function buildHypothesisGenerationAgentContext(args: {
    process: DeepthinkPipelineState;
    taskPrompt: string;
    conversationText: string;
    revision: boolean;
}): DeepthinkAgentContextManifest {
    const config = configFor(args.process);
    const count = config.hypothesisCount;
    let systemInstruction = deepthinkAgentSystemInstruction('hypothesisGeneration', config.prompts)
        .replace(/\{\{NUM_HYPOTHESES\}\}/g, String(count));
    systemInstruction += '\n\nReturn only JSON. Each hypothesis must be an object with "text" and "target_branches".';
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'hypothesisGeneration',
        promptText: withGeneratorProximityConversation(
            args.taskPrompt,
            args.conversationText,
            args.revision
                ? 'Revise the most recent hypothesis set in direct response to the latest proximity critique. Keep the same count and preserve only hypotheses that are orthogonal, falsifiable, and useful for the current generation task.'
                : undefined,
        ),
        sessionParts: ['hypothesisGeneration', 'generator-proximity', 'generator'],
        outputContract: hypothesisOutputContract(
            count,
            activeStrategies(args.process).map(strategy => strategy.id),
        ),
        systemInstruction,
    });
}

function buildHypothesisProximityAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    taskPrompt: string;
    conversationText: string;
}): DeepthinkAgentContextManifest {
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'hypothesisProximity',
        promptText: buildProximityReviewPrompt(
            'hypothesis',
            args.challengeText,
            args.taskPrompt,
            args.conversationText,
        ),
        sessionParts: ['hypothesisProximity', 'generator-proximity', 'proximity'],
    });
}

function buildHypothesisTesterAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    hypothesis: DeepthinkHypothesisData;
}): DeepthinkAgentContextManifest {
    const roundNumber = args.hypothesis.roundNumber || 1;
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'hypothesisTester',
        promptText: buildHypothesisTesterPrompt(args.challengeText, args.hypothesis.hypothesisText),
        sessionParts: [
            'hypothesis-testing',
            args.hypothesis.id,
            `round-${roundNumber}`,
            `global-${args.hypothesis.globalIteration || 0}`,
        ],
        repositoryScope: {
            hypothesisLabel: hypothesisDirectoryLabel(args.hypothesis),
            hypothesisRoundNumber: roundNumber,
        },
    });
}

function buildSolutionAttemptAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
}): DeepthinkAgentContextManifest {
    const route = getStrategyHypothesisRoute(args.process, args.strategy.id);
    const otherStrategyContext = activeStrategies(args.process)
        .filter(strategy => strategy.id !== args.strategy.id)
        .map(strategy => `<Strategy-${strategy.id} branchVersion="${strategy.branchVersion || 1}">\n${strategy.strategyText}\n</Strategy-${strategy.id}>`)
        .join('\n\n');
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'solutionAttempt',
        promptText: buildSolutionAttemptPrompt({
            challengeText: args.challengeText,
            mainStrategy: args.strategy.strategyText,
            knowledgePacket: route.packetText,
            otherStrategyContext,
            branchContext: args.strategy.branchVersion
                ? `<BranchIdentity strategy="${args.strategy.id}" branchVersion="${args.strategy.branchVersion}" branchIterationCount="${args.strategy.branchIterationCount || 0}" />`
                : undefined,
        }),
        sessionParts: [
            'solutionAttempt',
            args.strategy.id,
            `v${args.strategy.branchVersion || 1}`,
        ],
        repositoryScope: {
            strategySlotIndex: strategySlotIndex(args.process, args.strategy.id),
            selectedHypothesisLabels: route.directoryLabels,
            selectedHypothesisRoundNumber: route.roundNumber,
        },
    });
}

function buildSolutionCritiqueAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    solution: string;
    runtime: BranchRuntime;
    globalIteration: number;
    branchIteration: number;
}): DeepthinkAgentContextManifest {
    const promptText = messageText(buildCritiquePrompt({
        challenge: args.challengeText,
        strategy: runtimeSnapshot(args.strategy, args.runtime),
        solutionToCritique: args.solution,
        globalIteration: args.globalIteration,
        branchIteration: args.branchIteration,
        previousHistory: args.runtime.history,
    }));
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'solutionCritique',
        promptText,
        sessionParts: [
            'solutionCritique',
            args.strategy.id,
            `v${args.runtime.branchVersion}`,
        ],
        repositoryScope: {
            strategySlotIndex: strategySlotIndex(args.process, args.strategy.id),
        },
    });
}

function buildCorrectionAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    runtime: BranchRuntime;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
    branchIteration: number;
}): DeepthinkAgentContextManifest {
    const includePeers = !configFor(args.process).isolateBranches;
    const current = runtimeSnapshot(args.strategy, args.runtime);
    const route = getStrategyHypothesisRoute(args.process, args.strategy.id);
    const context = buildCorrectionRepository({
        current,
        currentHistory: args.runtime.history,
        currentPoolHistory: args.runtime.poolHistory,
        allStrategies: includePeers ? allSnapshots(args.process, args.runtimes) : [current],
        maxHistoryEntries: CORRECTION_HISTORY_WINDOW,
    });
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'solutionCorrection',
        promptText: messageText(buildCorrectionPrompt({
            challenge: args.challengeText,
            current,
            context,
            hypothesisPacket: route.packetText,
            globalIteration: args.globalIteration,
            branchIteration: args.branchIteration,
        })),
        sessionParts: [
            'solutionCorrection',
            args.strategy.id,
            `v${args.runtime.branchVersion}`,
        ],
        repositoryScope: {
            strategySlotIndex: strategySlotIndex(args.process, args.strategy.id),
            selectedHypothesisLabels: route.directoryLabels,
            selectedHypothesisRoundNumber: route.roundNumber,
            peerStrategySlotIndexes: includePeers
                ? peerStrategySlotIndexes(args.process, args.strategy.id)
                : [],
        },
    });
}

function buildSolutionPoolAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    runtime: BranchRuntime;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
    branchIteration: number;
}): DeepthinkAgentContextManifest {
    const includePeers = !configFor(args.process).isolateBranches;
    const current = runtimeSnapshot(args.strategy, args.runtime);
    const route = getStrategyHypothesisRoute(args.process, args.strategy.id);
    const context = buildSolutionPoolRepository({
        current,
        currentHistory: args.runtime.history,
        currentPoolHistory: args.runtime.poolHistory,
        allStrategies: includePeers ? allSnapshots(args.process, args.runtimes) : [current],
        maxPoolHistoryEntries: POOL_HISTORY_WINDOW,
    });
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'structuredSolutionPool',
        promptText: messageText(buildSolutionPoolPrompt({
            challenge: args.challengeText,
            current,
            context,
            hypothesisPacket: route.packetText,
            globalIteration: args.globalIteration,
            branchIteration: args.branchIteration,
        })),
        sessionParts: [
            'solution-pool',
            args.strategy.id,
            `v${args.runtime.branchVersion}`,
            `global-${args.globalIteration}`,
        ],
        repositoryScope: {
            strategySlotIndex: strategySlotIndex(args.process, args.strategy.id),
            selectedHypothesisLabels: route.directoryLabels,
            selectedHypothesisRoundNumber: route.roundNumber,
            peerStrategySlotIndexes: includePeers
                ? peerStrategySlotIndexes(args.process, args.strategy.id)
                : [],
        },
        outputContract: solutionPoolOutputContract(args.strategy.id),
    });
}

function buildMemoryBankAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    runtime: BranchRuntime;
    historyWindow: BranchHistoryEntry[];
    globalIteration: number;
}): DeepthinkAgentContextManifest {
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'memoryBank',
        promptText: messageText(buildMemoryBankPrompt({
            challenge: args.challengeText,
            strategy: runtimeSnapshot(args.strategy, args.runtime),
            previousMemoryBank: args.runtime.memoryBank,
            historyWindow: args.historyWindow,
            windowStartBranchIteration: args.historyWindow[0].branchIteration,
            windowEndBranchIteration: args.historyWindow[args.historyWindow.length - 1].branchIteration,
        })),
        sessionParts: [
            'memory-bank',
            args.strategy.id,
            `v${args.runtime.branchVersion}`,
            `global-${args.globalIteration}`,
        ],
        repositoryScope: {
            strategySlotIndex: strategySlotIndex(args.process, args.strategy.id),
        },
    });
}

function buildPqfAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    maintenanceStrategies: DeepthinkMainStrategyData[];
    group: DeepthinkMainStrategyData[];
    groupIndex: number;
    groupCount: number;
    globalIteration: number;
}): DeepthinkAgentContextManifest {
    const strategyIds = args.group.map(strategy => strategy.id);
    const groupSnapshots = args.group.map(strategy =>
        runtimeSnapshot(strategy, args.runtimes.get(strategy.id) || createRuntime(strategy)));
    const historyByStrategy = Object.fromEntries(args.maintenanceStrategies.map(strategy => [
        strategy.id,
        args.runtimes.get(strategy.id)?.history.slice(-MEMORY_INTERVAL) || [],
    ]));
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'postQualityFilter',
        promptText: messageText(buildPqfPrompt({
            challenge: args.challengeText,
            groupIndex: args.groupIndex,
            groupCount: args.groupCount,
            strategiesInGroup: groupSnapshots,
            allActiveStrategies: allSnapshots(args.process, args.runtimes),
            historyByStrategy,
            aggressiveness: pqfAggressivenessText(configFor(args.process).pqfAggressiveness),
        })),
        sessionParts: ['pqf', args.groupIndex + 1, `global-${args.globalIteration}`],
        repositoryScope: {
            assignedStrategySlotIndexes: strategyIds.map(strategyId =>
                strategySlotIndex(args.process, strategyId)),
        },
        outputContract: pqfOutputContract(strategyIds),
    });
}

interface FinalSolutionCandidate {
    id: string;
    solution: string;
    mainStrategyId: string;
    strategyText: string;
}

function buildFinalJudgeAgentContext(
    process: DeepthinkPipelineState,
    challengeText: string,
    candidates: FinalSolutionCandidate[],
): DeepthinkAgentContextManifest {
    const candidateText = candidates.map((candidate, index) => [
        `<SOLUTION_${index + 1}>`,
        `ID: ${candidate.id}`,
        `Main Strategy: ${candidate.mainStrategyId}`,
        `Strategy: ${candidate.strategyText}`,
        'Solution Text:',
        candidate.solution,
        `</SOLUTION_${index + 1}>`,
    ].join('\n')).join('\n\n');
    return finalizeAgentContext({
        process,
        agentKind: 'finalJudge',
        promptText: `Original Challenge:
${challengeText}

Below are ${candidates.length} candidate solutions from different strategic approaches. Select the single overall best solution.

Return JSON:
{"best_solution_id":"ID of the winning solution","final_reasoning":"Detailed comparison based only on provided texts"}

${candidateText}`,
        sessionParts: ['finalJudge', 'final'],
        outputContract: finalJudgeOutputContract(candidates.map(candidate => candidate.id)),
    });
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

function strategyOutputContract(
    count: number,
    mode: 'initial' | 'update' = 'initial',
    requestedIds: string[] = [],
): SandboxFinalOutputContract {
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
            validateExactUniqueIdSet(
                root.strategies.map((strategy, index) => {
                    const entry = asJsonObject(strategy, `Strategy Update response.strategies[${index}]`);
                    return entry.strategy_id as string;
                }),
                requestedIds,
                'Strategy Update response.strategies',
            );
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

function hypothesisOutputContract(
    count: number,
    activeBranchIds: string[],
): SandboxFinalOutputContract {
    const hypothesisSchema = {
            type: 'object',
            properties: {
                text: STRING_SCHEMA,
                target_branches: { type: 'array', items: STRING_SCHEMA },
            },
            required: ['text', 'target_branches'],
            additionalProperties: false,
        };

    return structuredContract('Hypothesis Generation', {
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
            const entry = asJsonObject(hypothesis, `Hypothesis Generation response.hypotheses[${index}]`);
            requireExactKeys(entry, `Hypothesis Generation response.hypotheses[${index}]`, ['text', 'target_branches']);
            requireString(entry.text, `Hypothesis Generation response.hypotheses[${index}].text`);
            requireStringArray(entry.target_branches, `Hypothesis Generation response.hypotheses[${index}].target_branches`);
            validateAllowedUniqueIds(
                entry.target_branches,
                activeBranchIds,
                `Hypothesis Generation response.hypotheses[${index}].target_branches`,
                { allowEmpty: true },
            );
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
        },
        required: ['title', 'content', 'confidence'],
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
            requireExactKeys(entry, `Structured Solution Pool response.solutions[${index}]`, ['title', 'content', 'confidence']);
            requireString(entry.title, `Structured Solution Pool response.solutions[${index}].title`);
            requireString(entry.content, `Structured Solution Pool response.solutions[${index}].content`);
            if (typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
                throw new Error(`Structured Solution Pool response.solutions[${index}].confidence must be a number from 0 to 1.`);
            }
        });
    });
}

function finalJudgeOutputContract(candidateIds: string[]): SandboxFinalOutputContract {
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
        validateAllowedUniqueIds(
            [root.best_solution_id],
            candidateIds,
            'Final Judge response.best_solution_id',
        );
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

function withGeneratorProximityConversation(
    taskPrompt: string,
    conversationText: string,
    revisionInstruction?: string,
): string {
    return [
        taskPrompt,
        conversationText,
        revisionInstruction || '',
    ].filter(Boolean).join('\n\n');
}

function buildProximityReviewPrompt(
    kind: 'strategy' | 'hypothesis',
    challengeText: string,
    taskPrompt: string,
    conversationText: string,
): string {
    const label = kind === 'strategy' ? 'strategies' : 'hypotheses';
    return [
        `Core Challenge:\n${challengeText}`,
        `Current ${kind} generation task:\n${taskPrompt}`,
        conversationText,
        `Review the most recent generator submission as the ${kind === 'strategy' ? 'Strategies' : 'Hypothesis'} Proximity Agent. Diagnose convergence, repetition, structural blind spots, and missing orthogonal coverage. The next generator turn will receive this complete conversation. Do not rewrite the ${label}; submit only the proximity critique.`,
    ].join('\n\n');
}

interface StrategyGenerationCandidate {
    id: string;
    text: string;
}

interface HypothesisGenerationCandidate {
    text: string;
    targetBranchIds: string[];
}

function formatStrategyGeneratorSubmission(candidates: StrategyGenerationCandidate[]): string {
    return JSON.stringify({
        strategies: candidates.map(candidate => ({
            strategy_id: candidate.id,
            strategy: candidate.text,
        })),
    }, null, 2);
}

function formatHypothesisGeneratorSubmission(candidates: HypothesisGenerationCandidate[]): string {
    return JSON.stringify({
        hypotheses: candidates.map(candidate => ({
            text: candidate.text,
            target_branches: candidate.targetBranchIds,
        })),
    }, null, 2);
}

function buildHypothesisGenerationPrompt(args: {
    challengeText: string;
    count: number;
    strategyContext: string;
}): string {
    const outputExample = `{
  "hypotheses": [
    {
      "text": "Hypothesis text",
      "target_branches": ["main1"]
    }
  ]
}`;

    return `Core Challenge:
${args.challengeText}

<Current Strategies>
${args.strategyContext}
</Current Strategies>

<Hypothesis Generation Request>
Generate exactly ${args.count} hypotheses to investigate before execution. Each hypothesis must include "target_branches" as an array of branch IDs. Use an empty array only when the tested finding is relevant to every branch.
Do not solve the Core Challenge and do not include final answers.
Return only JSON:
${outputExample}
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
<Branch Hypothesis Packet>
${args.knowledgePacket}
</Branch Hypothesis Packet>

<Execution Request>
Execute the assigned framework completely and faithfully. Do not switch strategies. Produce the full solution attempt for this assigned framework.
</Execution Request>

-------------------------------------------------------------------------------
<Relevant Context For Your Current Strategy>
This is all the relevant context related to your current strategy. Treat this as your primary identity, constraint set, and final context anchor.

<Assigned Strategy>
${args.mainStrategy}
</Assigned Strategy>

${args.branchContext || 'No prior branch-local execution context exists yet.'}
</Relevant Context For Your Current Strategy>`;
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

async function callDeepthinkSandboxToolAgent(args: {
    process: DeepthinkPipelineState;
    manifest: DeepthinkAgentContextManifest;
    modelName: string;
}): Promise<DeepthinkAgentCallOutput> {
    const promptMessage = new HumanMessage(args.manifest.promptText);

    const result = await runSandboxToolAgent({
        agentName: args.manifest.agentName,
        sessionId: args.manifest.sandboxSessionId,
        messages: [promptMessage],
        systemPrompt: args.manifest.systemInstruction,
        modelName: args.modelName,
        seedFiles: buildAttachmentSeedFiles(args.manifest.attachments),
        filesystemFiles: buildFilesystemAttachmentFiles(args.manifest.attachments),
        runScopeDescription: 'same Deepthink run',
        agentFilesystemRules: getDeepthinkSandboxFilesystemRules(),
        repositoryAccess: args.manifest.repositoryAccess,
        finalOutputContract: args.manifest.outputContract,
    });

    return {
        // Structured contracts must be parsed from the raw final tool payload,
        // not from UI-rendered text that may include artifact links.
        contextText: args.manifest.outputContract ? result.finalText : (result.promptText || result.finalText || result.text),
        displayText: result.text,
        finalText: args.manifest.outputContract ? result.finalText : (result.promptText || result.finalText || result.text),
        executionTraceText: result.executionTraceText,
    };
}

async function callAgent(args: {
    process: DeepthinkPipelineState;
    manifest: DeepthinkAgentContextManifest;
    stepDescription: string;
    timeoutMs?: number;
}): Promise<DeepthinkAgentCallOutput> {
    const config = configFor(args.process);
    const promptText = args.manifest.promptText;
    const startedAt = Date.now();
    const executionId = `inv-${nanoid(10)}`;
    const agentModel = deepthinkAgentModel(args.manifest.agentKind, config.prompts, config.selectedModel);
    const sandboxTransport = usesSandboxTransportForRun(args.process);
    const nativeJsonOutput = !sandboxTransport && !!args.manifest.outputContract;
    const thinkingConfig: ThinkingConfig = { thinkingLevel: config.thinkingLevel };
    const agentTimeoutMs = args.timeoutMs
        ? (sandboxTransport ? SANDBOX_AGENT_TIMEOUT_MS : args.timeoutMs)
        : undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
        if (args.process.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${args.stepDescription}`);

        if (attempt === 1) {
            addLiveEvent(args.process, args.manifest.agentName, args.stepDescription, 'agent_start', {
                systemInstruction: args.manifest.systemInstruction,
                prompt: promptText,
                attempt,
                modelName: agentModel,
                codeExecutionEnabled: config.codeExecutionEnabled,
                executionId,
            });
        }

        try {
            const call = sandboxTransport
                ? callDeepthinkSandboxToolAgent({
                    process: args.process,
                    manifest: args.manifest,
                    modelName: agentModel,
                })
                // Tool-calling providers cannot combine native structured output
                // with this role-specific final_output contract. The contract
                // validates the tool payload instead.
                : deps.callAI(
                    buildProviderParts(promptText, args.manifest.attachments),
                    agentModel,
                    args.manifest.systemInstruction,
                    nativeJsonOutput,
                    thinkingConfig,
                )
                    .then(response => {
                        const text = response.text || '';
                        return textAgentOutput(text);
                    });
            const remaining = agentTimeoutMs ? Math.max(1, agentTimeoutMs - (Date.now() - startedAt)) : undefined;
            const responseOutput = remaining ? await withTimeout(call, remaining, args.stepDescription) : await call;
            const responseText = responseOutput.contextText;

            if (!responseText.trim()) throw new Error('Empty response from API');
            if (args.manifest.outputContract && !sandboxTransport) {
                args.manifest.outputContract.validate(parseJson(
                    responseText,
                    args.manifest.outputContract.name,
                ));
            }

            addLiveEvent(args.process, args.manifest.agentName, `${args.stepDescription} completed`, 'agent_complete', {
                response: responseOutput.displayText,
                executionTraceText: responseOutput.executionTraceText,
                modelName: agentModel,
                codeExecutionEnabled: config.codeExecutionEnabled,
                executionId,
            });

            return responseOutput;
        } catch (error: any) {
            lastError = error;
            const errorMessage = describeProviderError(error);
            const shouldRetry = attempt < MAX_API_ATTEMPTS;
            addLiveEvent(args.process, args.manifest.agentName, `${args.stepDescription}: ${errorMessage}`, shouldRetry ? 'agent_retry' : 'agent_error', {
                error: errorMessage,
                attempt,
                modelName: agentModel,
                codeExecutionEnabled: config.codeExecutionEnabled,
                executionId,
            });

            if (!shouldRetry) break;

            if (agentTimeoutMs && Date.now() - startedAt >= agentTimeoutMs) break;

            const delay = RETRY_DELAYS_MS[attempt - 1] ?? 0;
            const deadlineRemaining = agentTimeoutMs ? agentTimeoutMs - (Date.now() - startedAt) : delay;
            await sleep(Math.max(0, Math.min(delay, deadlineRemaining)));
        }
    }

    throw new Error(describeProviderError(lastError));
}

function createPipeline(
    challengeText: string,
    runConfig: DeepthinkRunConfig,
): DeepthinkPipelineState {
    return {
        id: `deepthink-${nanoid(12)}`,
        challenge: challengeText,
        strategyGenerationHistory: [],
        initialStrategies: [],
        hypothesisGenerationHistory: [],
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
        hypothesisExplorerComplete: false,
        knowledgePacket: '',
        finalJudgingStatus: 'pending',
        structuredSolutionPoolEnabled: false,
        structuredSolutionPoolStatus: 'pending',
        liveEvents: [],
        runConfig,
    };
}

function activeStrategies(process: DeepthinkPipelineState): DeepthinkMainStrategyData[] {
    return process.initialStrategies;
}

function createRuntime(strategy: DeepthinkMainStrategyData): BranchRuntime {
    return {
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
    strategy: DeepthinkMainStrategyData,
    runtime: BranchRuntime,
): StrategySnapshot {
    const latestHistory = runtime.history[runtime.history.length - 1];
    const latestPool = runtime.poolHistory[runtime.poolHistory.length - 1];
    return {
        id: strategy.id,
        strategyText: strategy.strategyText,
        branchVersion: runtime.branchVersion,
        latestSolution: strategy.solutionAttempt,
        latestCorrection: latestHistory?.solution || strategy.refinedSolution,
        latestCritique: latestHistory?.critique || strategy.solutionCritique,
        latestPool: latestPool?.poolResponse,
        memoryBank: runtime.memoryBank,
    };
}

function allSnapshots(process: DeepthinkPipelineState, runtimes: Map<string, BranchRuntime>): StrategySnapshot[] {
    return activeStrategies(process).map(strategy => {
        const runtime = runtimes.get(strategy.id) || createRuntime(strategy);
        return runtimeSnapshot(strategy, runtime);
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
    return JSON.stringify(parsed.length === 1 ? parsed[0] : parsed, null, 2);
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

        const hasExecution = !!(strategy.solutionAttemptFinal || strategy.solutionAttempt);
        if (hasExecution) {
            add(`${contextDirectory}/execution_final_output.md`, strategy.solutionAttemptFinal || strategy.solutionAttempt || '');
            const trace = serializeExecutionTraces([strategy.solutionAttemptExecutionTraceText]);
            if (trace) add(`${contextDirectory}/execution_agent_trace.json`, trace);
        }

        const hasCritique = !!(strategy.solutionCritiqueFinal || strategy.solutionCritique);
        if (hasCritique) {
            add(`${contextDirectory}/critique_final_output.md`, strategy.solutionCritiqueFinal || strategy.solutionCritique || '');
            const trace = serializeExecutionTraces([strategy.solutionCritiqueExecutionTraceText]);
            if (trace) add(`${contextDirectory}/critique_agent_trace.json`, trace);
        }

        const hasCorrection = strategy.correctionStatus === 'completed'
            && !!(strategy.refinedSolutionFinal || strategy.refinedSolution);
        if (hasCorrection) {
            add(`${contextDirectory}/correction_final_output.md`, strategy.refinedSolutionFinal || strategy.refinedSolution || '');
            const trace = serializeExecutionTraces([strategy.refinedSolutionExecutionTraceText]);
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

    if (process.finalJudgingResponseText?.trim()) {
        add('Final_Judge_Final_Output.md', process.finalJudgedBestSolution || process.finalJudgingResponseText);
        const trace = serializeExecutionTraces([process.finalJudgingExecutionTraceText]);
        if (trace) add('Final_Judge_Agent_Trace.json', trace);
    }

    return files;
}

async function generateStrategyCandidates(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    taskPrompt: string;
    strategyIds: string[];
    updateIteration?: number;
}): Promise<StrategyGenerationCandidate[]> {
    const isUpdate = args.updateIteration !== undefined;
    const config = configFor(args.process);
    const result = await refineWithProximity<StrategyGenerationCandidate>({
        loops: config.strategyProximityLoops,
        history: args.process.strategyGenerationHistory,
        generate: async (conversationText, revision, round) => {
            const response = await callAgent({
                process: args.process,
                manifest: buildStrategyGenerationAgentContext({
                    process: args.process,
                    taskPrompt: args.taskPrompt,
                    conversationText,
                    strategyIds: args.strategyIds,
                    revision,
                    isUpdate,
                }),
                stepDescription: isUpdate
                    ? `Strategy Updates ${revision ? `Revision ${round}` : 'Seed'} after PQF Iteration ${args.updateIteration}`
                    : `Initial Strategy Generation ${revision ? `Revision ${round}` : 'Seed'}`,
            });
            const parsed = parseJson(response.contextText, isUpdate ? 'Strategy Updates' : 'Initial Strategy Generation');
            const items = parsed.strategies as Array<string | { strategy_id: string; strategy: string }>;
            const candidates = isUpdate
                ? (() => {
                    const replacementsById = new Map((items as Array<{ strategy_id: string; strategy: string }>).map(item => [
                        item.strategy_id as string,
                        item.strategy as string,
                    ]));
                    return args.strategyIds.map(id => ({ id, text: replacementsById.get(id)! }));
                })()
                : (items as string[])
                    .map((text, index) => ({ id: args.strategyIds[index], text }));
            return {
                candidates,
                output: isUpdate
                    ? formatStrategyGeneratorSubmission(candidates)
                    : JSON.stringify({ strategies: candidates.map(candidate => candidate.text) }, null, 2),
            };
        },
        review: async (_candidates, conversationText, round) => {
            const response = await callAgent({
                process: args.process,
                manifest: buildStrategyProximityAgentContext({
                    process: args.process,
                    challengeText: args.challengeText,
                    taskPrompt: args.taskPrompt,
                    conversationText,
                }),
                stepDescription: `Strategies Proximity Round ${round}${isUpdate ? ` after PQF Iteration ${args.updateIteration}` : ''}`,
            });
            return response.contextText;
        },
        onHistory: history => {
            args.process.strategyGenerationHistory = history;
            render();
        },
    });
    return result.candidates;
}

async function generateStrategies(process: DeepthinkPipelineState, challengeText: string): Promise<void> {
    const requestedCount = configFor(process).strategyCount;
    const taskPrompt = buildInitialStrategyPrompt(challengeText, requestedCount);

    process.strategyGenerationHistory = normalizeProximityHistory(process.strategyGenerationHistory);
    render();

    const strategies = await generateStrategyCandidates({
        process,
        challengeText,
        taskPrompt,
        strategyIds: Array.from({ length: requestedCount }, (_, index) => `main${index + 1}`),
    });

    process.initialStrategies = strategies.map(candidate => ({
        id: candidate.id,
        strategyText: candidate.text,
        status: 'pending',
        branchVersion: 1,
        branchIterationCount: 0,
        replacementHistory: [],
        awaitingFreshHypotheses: false,
    }));

    render();
}

function initialHypothesisPrompt(process: DeepthinkPipelineState, challengeText: string, count: number): string {
    const strategyContext = activeStrategies(process)
        .map(strategy => `<Branch id="${strategy.id}">\n${strategy.strategyText}\n</Branch>`)
        .join('\n\n');

    return buildHypothesisGenerationPrompt({
        challengeText,
        count,
        strategyContext,
    });
}

async function runHypothesisRound(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    roundNumber: number;
    globalIteration: number;
    prompt?: string;
}): Promise<void> {
    const config = configFor(args.process);
    const count = config.hypothesisCount;
    if (count <= 0) {
        args.process.hypotheses = [];
        args.process.knowledgePacket = '<Hypothesis-Testing-Packet>\nHYPOTHESIS EXPLORATION: Disabled.\n</Hypothesis-Testing-Packet>';
        args.process.strategySpecificKnowledgePackets = {};
        args.process.hypothesisGenStatus = 'completed';
        args.process.hypothesisExplorerComplete = true;
        render();
        return;
    }

    args.process.hypothesisGenStatus = 'processing';
    const previousHypotheses = args.process.hypotheses.length
        ? [...args.process.hypotheses]
        : [];
    render();

    const taskPrompt = args.prompt || initialHypothesisPrompt(args.process, args.challengeText, count);
    const previousGenerationHistory = normalizeProximityHistory(args.process.hypothesisGenerationHistory);

    try {
        const result = await refineWithProximity<HypothesisGenerationCandidate>({
            loops: config.hypothesisProximityLoops,
            history: previousGenerationHistory,
            version: args.roundNumber,
            generate: async (conversationText, revision, round) => {
                const responseOutput = await callAgent({
                    process: args.process,
                    manifest: buildHypothesisGenerationAgentContext({
                        process: args.process,
                        taskPrompt,
                        conversationText,
                        revision,
                    }),
                    stepDescription: !revision
                        ? (args.roundNumber === 1 ? 'Hypothesis Generation Seed' : `Hypothesis Generation Heartbeat ${args.roundNumber} Seed`)
                        : `Hypothesis Generation Revision ${round} for Heartbeat ${args.roundNumber}`,
                    timeoutMs: AGENT_TIMEOUT_MS,
                });
                const parsed = parseJson(responseOutput.contextText, 'Hypothesis Generation');
                const hypotheses = (parsed.hypotheses as Array<{ text: string; target_branches: string[] }>)
                    .map(hypothesis => ({
                        text: hypothesis.text,
                        targetBranchIds: hypothesis.target_branches,
                    }));
                return {
                    candidates: hypotheses,
                    output: formatHypothesisGeneratorSubmission(hypotheses),
                };
            },
            review: async (_candidates, conversationText, round) => {
                const response = await callAgent({
                    process: args.process,
                    manifest: buildHypothesisProximityAgentContext({
                        process: args.process,
                        challengeText: args.challengeText,
                        taskPrompt,
                        conversationText,
                    }),
                    stepDescription: `Hypothesis Proximity Round ${round} for Heartbeat ${args.roundNumber}`,
                    timeoutMs: AGENT_TIMEOUT_MS,
                });
                return response.contextText;
            },
        });

        const nextHypotheses: DeepthinkHypothesisData[] = result.candidates.map((candidate, index) => ({
            id: `hyp${args.roundNumber}-${index + 1}`,
            hypothesisText: candidate.text,
            testerStatus: 'pending',
            targetBranchIds: candidate.targetBranchIds,
            roundNumber: args.roundNumber,
            globalIteration: args.globalIteration,
        }));

        await Promise.allSettled(nextHypotheses.map(async hypothesis => {
            hypothesis.testerStatus = 'processing';

            try {
                const testerResponse = await callAgent({
                    process: args.process,
                    manifest: buildHypothesisTesterAgentContext({
                        process: args.process,
                        challengeText: args.challengeText,
                        hypothesis,
                    }),
                    stepDescription: `Hypothesis Testing for ${hypothesis.id}`,
                    timeoutMs: AGENT_TIMEOUT_MS,
                });

                hypothesis.testerAttempt = testerResponse.contextText;
                hypothesis.testerAttemptDisplay = testerResponse.displayText;
                hypothesis.testerAttemptFinal = testerResponse.finalText;
                hypothesis.testerAttemptExecutionTraceText = testerResponse.executionTraceText;
                hypothesis.testerStatus = 'completed';
            } catch (error: any) {
                hypothesis.testerStatus = 'error';
                hypothesis.testerAttempt = 'No testing output available.';
            }
        }));

        const fullPacket = renderHypothesisTestingPacket(nextHypotheses);

        const strategyPackets: Record<string, string> = {};
        activeStrategies(args.process).forEach(strategy => {
            const relevant = selectRoutedHypotheses(nextHypotheses, strategy.id);
            strategyPackets[strategy.id] = renderStrategyHypothesisPacket(strategy.id, relevant);
        });

        if (previousHypotheses.length) {
            args.process.hypothesisHistory = [
                ...(args.process.hypothesisHistory || []),
                previousHypotheses,
            ];
        }
        args.process.hypothesisGenerationHistory = result.history;
        args.process.hypotheses = nextHypotheses;
        args.process.knowledgePacket = fullPacket;
        args.process.strategySpecificKnowledgePackets = strategyPackets;
        args.process.hypothesisRounds?.push({
            roundNumber: args.roundNumber,
            packet: fullPacket,
        });
        activeStrategies(args.process).forEach(strategy => {
            strategy.awaitingFreshHypotheses = false;
        });
        args.process.hypothesisGenStatus = 'completed';
        args.process.hypothesisExplorerComplete = true;
    } catch {
        args.process.hypothesisGenStatus = 'error';
    }
    render();
}

async function executeSolutionAttempt(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
}): Promise<void> {
    args.strategy.status = 'processing';
    render();

    try {
        const response = await callAgent({
            process: args.process,
            manifest: buildSolutionAttemptAgentContext(args),
            stepDescription: `Solution Attempt for ${args.strategy.id}`,
            timeoutMs: AGENT_TIMEOUT_MS,
        });
        args.strategy.solutionAttempt = response.contextText;
        args.strategy.solutionAttemptDisplay = response.displayText;
        args.strategy.solutionAttemptFinal = response.finalText;
        args.strategy.solutionAttemptExecutionTraceText = response.executionTraceText;
        args.strategy.status = 'completed';
    } catch (error: any) {
        args.strategy.status = 'error';
        args.strategy.error = error.message || 'Solution attempt failed';
    }
    render();
}

async function critiqueSolution(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    solution: string;
    runtime: BranchRuntime;
    globalIteration: number;
    branchIteration: number;
}): Promise<string | null> {
    args.strategy.solutionCritiqueStatus = 'processing';
    render();

    const critiqueData: DeepthinkSolutionCritiqueData = {
        id: `critique-${args.strategy.id}-${args.globalIteration || 'initial'}-${nanoid(4)}`,
        mainStrategyId: args.strategy.id,
        branchVersion: args.runtime.branchVersion,
        status: 'processing',
        globalIteration: args.globalIteration,
        branchIteration: args.branchIteration,
    };
    args.process.solutionCritiques.push(critiqueData);
    render();

    try {
        const response = await callAgent({
            process: args.process,
            manifest: buildSolutionCritiqueAgentContext(args),
            stepDescription: `Solution Critique for ${args.strategy.id}${args.globalIteration ? ` Iteration ${args.globalIteration}` : ''}`,
            timeoutMs: AGENT_TIMEOUT_MS,
        });

        args.strategy.solutionCritique = response.contextText;
        args.strategy.solutionCritiqueDisplay = response.displayText;
        args.strategy.solutionCritiqueFinal = response.finalText;
        args.strategy.solutionCritiqueExecutionTraceText = response.executionTraceText;
        args.strategy.solutionCritiqueStatus = 'completed';
        critiqueData.critiqueResponse = response.contextText;
        critiqueData.critiqueResponseDisplay = response.displayText;
        critiqueData.status = 'completed';
        return response.contextText;
    } catch (error: any) {
        args.strategy.solutionCritiqueStatus = 'error';
        critiqueData.status = 'error';
        critiqueData.error = error.message || 'Solution critique failed';
        return null;
    } finally {
        render();
    }
}

async function runInitialExecutionsAndCritiques(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
}): Promise<void> {
    args.process.solutionCritiquesStatus = 'processing';
    render();

    await Promise.allSettled(activeStrategies(args.process).map(async strategy => {
            await executeSolutionAttempt({
                process: args.process,
                challengeText: args.challengeText,
                strategy,
            });

            if (!strategy.solutionAttempt) {
                return;
            }

            const runtime = args.runtimes.get(strategy.id);
            if (!runtime) return;
            const critique = await critiqueSolution({
                process: args.process,
                challengeText: args.challengeText,
                strategy,
                solution: strategy.solutionAttempt,
                runtime,
                globalIteration: 1,
                branchIteration: 1,
            });

            if (critique) {
                runtime.history.push({
                    globalIteration: 1,
                    branchIteration: 1,
                    branchVersion: runtime.branchVersion,
                    label: 'Initial Execution',
                    solution: strategy.solutionAttempt,
                    solutionDisplay: strategy.solutionAttemptDisplay,
                    solutionExecutionTraceText: strategy.solutionAttemptExecutionTraceText,
                    critique,
                    critiqueDisplay: strategy.solutionCritiqueDisplay,
                    critiqueExecutionTraceText: strategy.solutionCritiqueExecutionTraceText,
                });
                strategy.iterationHistory = {
                    status: 'processing',
                    iterations: [{
                        iterationNumber: 1,
                        globalIteration: 1,
                        branchIteration: 1,
                        branchVersion: runtime.branchVersion,
                        critique,
                        critiqueDisplay: strategy.solutionCritiqueDisplay,
                        correctedSolution: strategy.solutionAttempt,
                        correctedSolutionDisplay: strategy.solutionAttemptDisplay,
                        correctedSolutionExecutionTraceText: strategy.solutionAttemptExecutionTraceText,
                        critiqueExecutionTraceText: strategy.solutionCritiqueExecutionTraceText,
                        timestamp: Date.now(),
                        label: 'Initial Execution',
                    }],
                };
                strategy.refinedSolution = strategy.solutionAttempt;
                strategy.refinedSolutionDisplay = strategy.solutionAttemptDisplay;
                strategy.refinedSolutionFinal = strategy.solutionAttemptFinal;
                strategy.correctionStatus = 'skipped';
                runtime.branchIterationCount = 1;
                strategy.branchIterationCount = 1;
            }
    }));

    args.process.solutionCritiquesStatus = 'completed';
    render();
}

async function runSolutionPools(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
}): Promise<void> {
    args.process.structuredSolutionPoolEnabled = true;
    args.process.structuredSolutionPoolStatus = 'processing';
    render();

    const config = configFor(args.process);
    const solutionPoolDisabled = config.solutionPoolDisabled;

    await Promise.allSettled(activeStrategies(args.process).map(async strategy => {
        const runtime = args.runtimes.get(strategy.id);
        if (!runtime) return;

        const branchIteration = Math.max(1, runtime.branchIterationCount);
        const agent: DeepthinkStructuredSolutionPoolAgentData = {
            mainStrategyId: strategy.id,
            branchVersion: runtime.branchVersion,
            poolResponse: solutionPoolDisabled ? NO_SOLUTION_POOL_AVAILABLE : undefined,
            status: solutionPoolDisabled ? 'skipped' : 'processing',
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
            render();
            return;
        }

        render();

        try {
            const responseOutput = await callAgent({
                process: args.process,
                manifest: buildSolutionPoolAgentContext({
                    process: args.process,
                    challengeText: args.challengeText,
                    strategy,
                    runtime,
                    runtimes: args.runtimes,
                    globalIteration: args.globalIteration,
                    branchIteration,
                }),
                stepDescription: `Structured Solution Pool for ${strategy.id} Iteration ${args.globalIteration}`,
                timeoutMs: AGENT_TIMEOUT_MS,
            });
            const response = responseOutput.contextText;

            agent.poolResponse = response;
            agent.parsedPoolResponse = parseJson(
                response,
                `SolutionPool-${strategy.id}`,
            ) as SolutionPoolParsedResponse;
            agent.executionTraceText = responseOutput.executionTraceText;
            agent.status = 'completed';
            runtime.poolHistory.push({
                globalIteration: args.globalIteration,
                branchIteration,
                poolResponse: response,
            });
            runtime.branchIterationCount = Math.max(runtime.branchIterationCount, runtime.history.length);
            strategy.branchIterationCount = runtime.branchIterationCount;
        } catch {
            agent.status = 'error';
        }
        render();
    }));

    args.process.structuredSolutionPoolStatus = 'completed';
    render();
}

async function runCorrectionIteration(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
}): Promise<void> {
    await Promise.allSettled(activeStrategies(args.process).map(async strategy => {
        const runtime = args.runtimes.get(strategy.id);
        if (!runtime) return;

        const nextBranchIteration = runtime.history.length + 1;

        strategy.correctionStatus = 'processing';
        render();

        try {
            const corrected = await callAgent({
                process: args.process,
                manifest: buildCorrectionAgentContext({
                    process: args.process,
                    challengeText: args.challengeText,
                    strategy,
                    runtime,
                    runtimes: args.runtimes,
                    globalIteration: args.globalIteration,
                    branchIteration: nextBranchIteration,
                }),
                stepDescription: `Solution Correction for ${strategy.id} Iteration ${args.globalIteration}`,
                timeoutMs: AGENT_TIMEOUT_MS,
            });

            strategy.refinedSolution = corrected.contextText;
            strategy.refinedSolutionDisplay = corrected.displayText;
            strategy.refinedSolutionFinal = corrected.finalText;
            strategy.refinedSolutionExecutionTraceText = corrected.executionTraceText;
            strategy.correctionStatus = 'completed';

            const critique = await critiqueSolution({
                process: args.process,
                challengeText: args.challengeText,
                strategy,
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
                solutionExecutionTraceText: corrected.executionTraceText,
                critique: critique || 'No critique output available.',
                critiqueDisplay: strategy.solutionCritiqueDisplay,
                critiqueExecutionTraceText: strategy.solutionCritiqueExecutionTraceText,
            });
            runtime.globalIteration = args.globalIteration;
            runtime.branchIterationCount = runtime.history.length;
            strategy.branchIterationCount = runtime.branchIterationCount;
            strategy.memoryBank = runtime.memoryBank;
            strategy.iterationHistory = strategy.iterationHistory || { status: 'processing', iterations: [] };
            strategy.iterationHistory.iterations.push({
                iterationNumber: args.globalIteration,
                globalIteration: args.globalIteration,
                branchIteration: nextBranchIteration,
                branchVersion: runtime.branchVersion,
                critique: critique || 'No critique output available.',
                critiqueDisplay: strategy.solutionCritiqueDisplay,
                correctedSolution: corrected.contextText,
                correctedSolutionDisplay: corrected.displayText,
                correctedSolutionExecutionTraceText: corrected.executionTraceText,
                critiqueExecutionTraceText: strategy.solutionCritiqueExecutionTraceText,
                timestamp: Date.now(),
                label: `Correction ${nextBranchIteration}`,
            });
        } catch {
            strategy.correctionStatus = 'error';
        }
        render();
    }));
}

async function runMemoryAgents(args: {
    process: DeepthinkPipelineState;
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
            mainStrategyId: strategy.id,
            branchVersion: runtime.branchVersion,
            globalIteration: args.globalIteration,
        };
        args.process.memoryBankAgents?.push(agent);

        try {
            const responseOutput = await callAgent({
                process: args.process,
                manifest: buildMemoryBankAgentContext({
                    process: args.process,
                    challengeText: args.challengeText,
                    strategy,
                    runtime,
                    historyWindow: newHistory,
                    globalIteration: args.globalIteration,
                }),
                stepDescription: `Memory Bank for ${strategy.id} Iteration ${args.globalIteration}`,
                timeoutMs: AGENT_TIMEOUT_MS,
            });
            const response = responseOutput.contextText;
            agent.memoryBank = response;
            runtime.memoryBank = response;
            runtime.lastMemoryHistoryCount += newHistory.length;
            strategy.memoryBank = response;
        } catch {}
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
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    strategies: DeepthinkMainStrategyData[];
    globalIteration: number;
}): Promise<PqfDecision[]> {
    const groups = grouped(args.strategies, PQF_GROUP_SIZE);
    const decisions: PqfDecision[] = [];

    args.process.postQualityFilterStatus = 'processing';
    render();

    await Promise.all(groups.map(async (group, groupIndex) => {
        const agent: DeepthinkPostQualityFilterData = {
            id: `postqf-g${args.globalIteration}-${groupIndex + 1}`,
            iterationNumber: args.globalIteration,
            prunedStrategyIds: [],
            continuedStrategyIds: [],
            status: 'processing',
            groupIndex,
            groupStrategyIds: group.map(strategy => strategy.id),
        };
        args.process.postQualityFilterAgents.push(agent);
        render();

        try {
            const responseOutput = await callAgent({
                process: args.process,
                manifest: buildPqfAgentContext({
                    process: args.process,
                    challengeText: args.challengeText,
                    runtimes: args.runtimes,
                    maintenanceStrategies: args.strategies,
                    group,
                    groupIndex,
                    groupCount: groups.length,
                    globalIteration: args.globalIteration,
                }),
                stepDescription: `PostQualityFilter Group ${groupIndex + 1} Iteration ${args.globalIteration}`,
            });
            const response = responseOutput.contextText;

            const parsed = parseJson(response, `PostQualityFilter Group ${groupIndex + 1}`);
            const groupDecisions = (parsed.strategies as Array<{
                strategy_id: string;
                decision: 'keep' | 'update';
                reasoning: string;
            }>).map(item => ({
                strategyId: item.strategy_id,
                decision: item.decision,
                reasoning: item.reasoning,
            }));
            decisions.push(...groupDecisions);

            agent.evaluationResponse = response;
            agent.evaluationResponseFinal = responseOutput.finalText;
            agent.executionTraceText = responseOutput.executionTraceText;
            agent.reasoning = JSON.stringify(parsed, null, 2);
            agent.prunedStrategyIds = groupDecisions.filter(decision => decision.decision === 'update').map(decision => decision.strategyId);
            agent.continuedStrategyIds = groupDecisions.filter(decision => decision.decision === 'keep').map(decision => decision.strategyId);
            agent.status = 'completed';
        } catch (error: any) {
            agent.status = 'error';
            throw error;
        } finally {
            render();
        }
    }));

    args.process.postQualityFilterStatus = 'completed';
    render();
    return args.strategies.map(strategy =>
        decisions.find(candidate => candidate.strategyId === strategy.id)!);
}

async function updateStrategiesFromPqf(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    decisions: PqfDecision[];
    globalIteration: number;
}): Promise<string[]> {
    const updateDecisions = args.decisions.filter(decision => decision.decision === 'update');
    if (updateDecisions.length === 0) return [];

    const updateRequests: StrategyUpdateRequest[] = updateDecisions.map(decision => {
        const strategy = args.process.initialStrategies.find(candidate => candidate.id === decision.strategyId)!;
        const runtime = args.runtimes.get(strategy.id)!;
        const latest = runtime.history[runtime.history.length - 1];
        return {
            strategyId: strategy.id,
            oldStrategyText: strategy.strategyText,
            latestSolution: latest?.solution || strategy.solutionAttempt || '',
            latestSolutionDisplay: latest?.solutionDisplay || strategy.solutionAttemptDisplay,
            latestCritique: latest?.critique || strategy.solutionCritique || '',
            latestCritiqueDisplay: latest?.critiqueDisplay || strategy.solutionCritiqueDisplay,
            memoryBank: runtime.memoryBank,
            pqfReasoning: decision.reasoning,
        };
    });

    const taskPrompt = messageText(buildStrategyUpdatePrompt({
        challenge: args.challengeText,
        decisionVector: args.decisions,
        updateRequests,
        currentStrategies: activeStrategies(args.process).map(strategy => ({
            id: strategy.id,
            strategyText: strategy.strategyText,
        })),
        previouslyUsedStrategies: activeStrategies(args.process).flatMap(strategy =>
            (strategy.replacementHistory || []).map(record => ({
                id: strategy.id,
                strategyText: record.previousStrategyText,
            }))),
    }));
    args.process.strategyGenerationHistory = normalizeProximityHistory(args.process.strategyGenerationHistory);

    const replacements = await generateStrategyCandidates({
        process: args.process,
        challengeText: args.challengeText,
        taskPrompt,
        strategyIds: updateRequests.map(request => request.strategyId),
        updateIteration: args.globalIteration,
    });
    const updatedIds: string[] = [];

    for (const request of updateRequests) {
        const replacementText = replacements.find(candidate => candidate.id === request.strategyId)!.text;
        const strategy = args.process.initialStrategies.find(candidate => candidate.id === request.strategyId)!;
        const runtime = args.runtimes.get(strategy.id)!;

        if (usesSandboxTransportForRun(args.process)) {
            await archiveSandboxRepositoryStrategy(
                args.process.id,
                DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory(strategySlotIndex(args.process, strategy.id)),
            );
        }

        const previousVersion = runtime.branchVersion;
        const record: DeepthinkStrategyReplacementRecord = {
            strategyId: strategy.id,
            previousStrategyText: strategy.strategyText,
            replacementStrategyText: replacementText,
            replacedAtGlobalIteration: args.globalIteration,
            previousBranchVersion: previousVersion,
            pqfReasoning: request.pqfReasoning,
            memoryBank: runtime.memoryBank,
            latestSolution: request.latestSolution,
            latestSolutionDisplay: request.latestSolutionDisplay,
            latestCritique: request.latestCritique,
            latestCritiqueDisplay: request.latestCritiqueDisplay,
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
        strategy.awaitingFreshHypotheses = configFor(args.process).hypothesisCount > 0;

        strategy.solutionAttempt = undefined;
        strategy.solutionAttemptDisplay = undefined;
        strategy.solutionAttemptFinal = undefined;
        strategy.refinedSolution = undefined;
        strategy.refinedSolutionDisplay = undefined;
        strategy.refinedSolutionFinal = undefined;
        strategy.solutionCritique = undefined;
        strategy.solutionCritiqueDisplay = undefined;
        strategy.solutionCritiqueFinal = undefined;
        strategy.status = 'pending';
        strategy.correctionStatus = 'pending';
        strategy.solutionCritiqueStatus = 'pending';
        strategy.iterationHistory = { status: 'processing', iterations: [] };

        runtime.branchVersion += 1;
        runtime.branchIterationCount = 0;
        runtime.history = [];
        runtime.poolHistory = [];
        runtime.memoryBank = undefined;
        runtime.lastMemoryHistoryCount = 0;

        args.process.strategySpecificKnowledgePackets = {
            ...(args.process.strategySpecificKnowledgePackets || {}),
            [strategy.id]: getStrategyHypothesisRoute(args.process, strategy.id).packetText,
        };

        updatedIds.push(strategy.id);
    }

    if (updatedIds.length > 0 && usesSandboxTransportForRun(args.process)) {
        args.process.repositoryRevision = await snapshotSandboxRepositoryById(
            args.process.id,
            `Deepthink iteration ${args.globalIteration} PQF branch replacement archive`,
        );
    }
    render();
    return updatedIds;
}

async function runPostFiveIterationMaintenance(args: {
    process: DeepthinkPipelineState;
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
        challengeText: args.challengeText,
        runtimes: args.runtimes,
        strategies: dueStrategies,
        globalIteration: args.globalIteration,
    });

    const pqfPromise = runPqfAgents({
        process: args.process,
        challengeText: args.challengeText,
        runtimes: args.runtimes,
        strategies: dueStrategies,
        globalIteration: args.globalIteration,
    });

    const [pqfResult] = await Promise.all([pqfPromise, memoryPromise]);
    const updatedIds = await updateStrategiesFromPqf({
        process: args.process,
        challengeText: args.challengeText,
        runtimes: args.runtimes,
        decisions: pqfResult,
        globalIteration: args.globalIteration,
    });

    await Promise.allSettled(updatedIds.map(async strategyId => {
        const strategy = args.process.initialStrategies.find(candidate => candidate.id === strategyId);
        const runtime = strategy ? args.runtimes.get(strategy.id) : undefined;
        if (!strategy || !runtime) return;

        await executeSolutionAttempt({
            process: args.process,
            challengeText: args.challengeText,
            strategy,
        });
        if (!strategy.solutionAttempt) return;
        const critique = await critiqueSolution({
            process: args.process,
            challengeText: args.challengeText,
            strategy,
            solution: strategy.solutionAttempt,
            runtime,
            globalIteration: args.globalIteration,
            branchIteration: 1,
        });
        strategy.solutionCritique = critique || 'No critique output available.';
        strategy.solutionCritiqueDisplay = strategy.solutionCritiqueDisplay || critique || 'No critique output available.';
        strategy.refinedSolution = strategy.solutionAttempt;
        strategy.refinedSolutionDisplay = strategy.solutionAttemptDisplay;
        strategy.refinedSolutionFinal = strategy.solutionAttemptFinal;
        strategy.correctionStatus = 'skipped';

        runtime.history.push({
            globalIteration: args.globalIteration,
            branchIteration: 1,
            branchVersion: runtime.branchVersion,
            label: `Branch v${runtime.branchVersion} Initial Execution`,
            solution: strategy.solutionAttempt,
            solutionDisplay: strategy.solutionAttemptDisplay,
            solutionExecutionTraceText: strategy.solutionAttemptExecutionTraceText,
            critique: critique || 'No critique output available.',
            critiqueDisplay: strategy.solutionCritiqueDisplay,
            critiqueExecutionTraceText: strategy.solutionCritiqueExecutionTraceText,
        });
        runtime.globalIteration = args.globalIteration;
        runtime.branchIterationCount = 1;
        strategy.branchIterationCount = 1;
        strategy.memoryBank = runtime.memoryBank;
        strategy.iterationHistory = {
            status: 'processing',
            iterations: [{
                iterationNumber: args.globalIteration,
                globalIteration: args.globalIteration,
                branchIteration: 1,
                branchVersion: runtime.branchVersion,
                critique: critique || 'No critique output available.',
                critiqueDisplay: strategy.solutionCritiqueDisplay,
                correctedSolution: strategy.solutionAttempt,
                correctedSolutionDisplay: strategy.solutionAttemptDisplay,
                correctedSolutionExecutionTraceText: strategy.solutionAttemptExecutionTraceText,
                critiqueExecutionTraceText: strategy.solutionCritiqueExecutionTraceText,
                timestamp: Date.now(),
                label: `Branch v${runtime.branchVersion} Initial Execution`,
            }],
        };
    }));

    if (updatedIds.length > 0) {
        render();
    }

    return updatedIds;
}

async function runHypothesisHeartbeatIfDue(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    runtimes: Map<string, BranchRuntime>;
    globalIteration: number;
    updatedStrategyIds: string[];
}): Promise<void> {
    const config = configFor(args.process);
    if (config.hypothesisCount <= 0) return;
    if (args.globalIteration % HYPOTHESIS_HEARTBEAT_INTERVAL !== 0) return;

    const snapshots = allSnapshots(args.process, args.runtimes);
    const recentHistoryByStrategy = Object.fromEntries(snapshots.map(snapshot => {
        const runtime = args.runtimes.get(snapshot.id);
        return [snapshot.id, runtime?.history.slice(-2) || []];
    }));

    const prompt = messageText(buildHypothesisRefreshPrompt({
        challenge: args.challengeText,
        hypothesisCount: config.hypothesisCount,
        completedGlobalIteration: args.globalIteration,
        currentStrategies: snapshots,
        recentHistoryByStrategy,
        updatedStrategyIds: Array.from(new Set([
            ...args.updatedStrategyIds,
            ...activeStrategies(args.process)
                .filter(strategy => strategy.awaitingFreshHypotheses)
                .map(strategy => strategy.id),
        ])),
        previousTestingOutputs: args.process.hypotheses.map(hypothesis => ({
            hypothesisId: hypothesis.id,
            hypothesisText: hypothesis.hypothesisText,
            targetBranchIds: hypothesis.targetBranchIds || [],
            testerOutput: hypothesis.testerAttempt || 'No testing output available.',
            testerStatus: hypothesis.testerStatus,
        })),
    }));

    await runHypothesisRound({
        process: args.process,
        challengeText: args.challengeText,
        roundNumber: (args.process.hypothesisRounds?.length || 0) + 1,
        globalIteration: args.globalIteration,
        prompt,
    });
}

function usesSandboxTransportForRun(process: DeepthinkPipelineState): boolean {
    return configFor(process).codeExecutionEnabled;
}

async function captureAgentRepositoryBarrier(
    process: DeepthinkPipelineState,
    commitMessage: string,
): Promise<void> {
    if (!usesSandboxTransportForRun(process)) return;
    process.repositoryRevision = await snapshotSandboxRepositoryById(process.id, commitMessage);
}

/** Persist the completed barrier for the repository explorer and later calls. */
async function snapshotDeepthinkRepositoryState(process: DeepthinkPipelineState, commitMessage: string): Promise<void> {
    if (!usesSandboxTransportForRun(process)) return;

    try {
        await captureAgentRepositoryBarrier(process, commitMessage);
        await snapshotDeepthinkResultsRepository(
            process.id,
            commitMessage,
            buildDeepthinkResultsContextFiles(process),
        );
    } catch (error) {
        console.warn(`Failed to snapshot Deepthink Results repository (${commitMessage}):`, error);
    }
}

async function snapshotDeepthinkIteration(process: DeepthinkPipelineState, globalIteration: number): Promise<void> {
    await snapshotDeepthinkRepositoryState(process, `Deepthink iteration ${globalIteration}`);
}

async function runDeepthinkSearch(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
}): Promise<void> {
    args.process.structuredSolutionPoolEnabled = true;
    args.process.postQualityFilterStatus = 'pending';
    render();

    const runtimes = new Map<string, BranchRuntime>();
    activeStrategies(args.process).forEach(strategy => {
        strategy.branchVersion = 1;
        strategy.branchIterationCount = 0;
        runtimes.set(strategy.id, createRuntime(strategy));
    });

    await runHypothesisRound({
        process: args.process,
        challengeText: args.challengeText,
        roundNumber: 1,
        globalIteration: 0,
    });
    await captureAgentRepositoryBarrier(args.process, 'Deepthink initial hypothesis round');

    await runInitialExecutionsAndCritiques({
        process: args.process,
        challengeText: args.challengeText,
        runtimes,
    });
    await captureAgentRepositoryBarrier(args.process, 'Deepthink iteration 1 execution and critique barrier');

    await runSolutionPools({
        process: args.process,
        challengeText: args.challengeText,
        runtimes,
        globalIteration: 1,
    });
    await snapshotDeepthinkIteration(args.process, 1);

    const depth = configFor(args.process).depth;
    let recentlyUpdatedStrategyIds: string[] = [];

    for (let globalIteration = 2; globalIteration <= depth; globalIteration++) {
        if (args.process.isStopRequested) throw new PipelineStopRequestedError('Deepthink stopped by user.');

        await runCorrectionIteration({
            process: args.process,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
        });
        await captureAgentRepositoryBarrier(
            args.process,
            `Deepthink iteration ${globalIteration} correction and critique barrier`,
        );

        const poolPromise = runSolutionPools({
            process: args.process,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
        });

        const hypothesisPromise = runHypothesisHeartbeatIfDue({
            process: args.process,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
            updatedStrategyIds: recentlyUpdatedStrategyIds,
        });

        await Promise.all([poolPromise, hypothesisPromise]);
        await captureAgentRepositoryBarrier(
            args.process,
            `Deepthink iteration ${globalIteration} pool and hypothesis barrier`,
        );
        recentlyUpdatedStrategyIds = await runPostFiveIterationMaintenance({
            process: args.process,
            challengeText: args.challengeText,
            runtimes,
            globalIteration,
        });
        // Capture the completed iteration after its PQF/memory maintenance so
        // this commit is the whole branch state users actually observed.
        await snapshotDeepthinkIteration(args.process, globalIteration);
    }

    activeStrategies(args.process).forEach(strategy => {
        if (strategy.iterationHistory) strategy.iterationHistory.status = 'completed';
    });
    args.process.structuredSolutionPoolStatus = 'completed';
    render();
}

async function finalJudge(process: DeepthinkPipelineState, challengeText: string): Promise<void> {
    process.finalJudgingStatus = 'processing';
    render();

    const allSolutions = activeStrategies(process).map(strategy => ({
        id: strategy.id,
        solution: strategy.refinedSolutionFinal || strategy.solutionAttemptFinal || strategy.refinedSolution || strategy.solutionAttempt || '',
        mainStrategyId: strategy.id,
        strategyText: strategy.strategyText,
    })).filter(item => item.solution.trim());

    if (allSolutions.length === 0) {
        process.finalJudgingStatus = 'error';
        process.finalJudgingError = 'No completed solutions available for final review.';
        render();
        return;
    }

    try {
        const responseOutput = await callAgent({
            process,
            manifest: buildFinalJudgeAgentContext(process, challengeText, allSolutions),
            stepDescription: 'Final Judging',
            timeoutMs: AGENT_TIMEOUT_MS,
        });
        const response = responseOutput.contextText;
        process.finalJudgingResponseText = response;
        process.finalJudgingExecutionTraceText = responseOutput.executionTraceText;
        const parsed = parseJson(response, 'Final Judge');
        const winningSolution = allSolutions.find(solution => solution.id === parsed.best_solution_id)!;
        process.finalJudgedBestSolution = `**Solution ID:** <span class="strategy-purple-id">${parsed.best_solution_id}</span>

**Origin:** ${winningSolution.strategyText} (${winningSolution.mainStrategyId})

**Final Reasoning:**
${parsed.final_reasoning}

---

**Definitive Solution:**
${winningSolution.solution}`;
        process.finalJudgingStatus = 'completed';
    } catch (error: any) {
        process.finalJudgingStatus = 'error';
        process.finalJudgingError = error.message || 'Failed to perform final judging.';
    }
    render();
}

export async function startDeepthinkAnalysisProcess(challengeText: string) {
    const runConfig = captureRunConfig();
    activeDeepthinkPipeline = createPipeline(challengeText, runConfig);
    runAttachments.set(activeDeepthinkPipeline.id, buildDeepthinkAttachments({
        directFiles: globalState.directContextFiles,
        filesystemFiles: runConfig.codeExecutionEnabled
            ? globalState.filesystemContextFiles
            : [],
    }));
    if (setActiveDeepthinkPipeline) setActiveDeepthinkPipeline(activeDeepthinkPipeline);
    deps.updateControlsState({ isGenerating: true });
    addLiveEvent(activeDeepthinkPipeline, 'Orchestrator', 'Initializing Deepthink pipeline', 'info');
    render();

    const process = activeDeepthinkPipeline;
    const modelChallengeText = runConfig.codeExecutionEnabled
        ? challengeText
        : `${challengeText}${buildTextAttachmentContext(attachmentsFor(process))}`;
    if (usesSandboxTransportForRun(process)) {
        try {
            await ensureDeepthinkResultsRepository(process.id);
        } catch (error) {
            // A failed archival mirror must never prevent the actual model run.
            console.warn('Failed to initialize Deepthink Results repository:', error);
        }
    }

    try {
        await generateStrategies(process, modelChallengeText);
        await runDeepthinkSearch({ process, challengeText: modelChallengeText });

        if (process.isStopRequested) throw new PipelineStopRequestedError('Stopped before final judging.');

        await captureAgentRepositoryBarrier(process, 'Deepthink final candidate barrier');
        await finalJudge(process, modelChallengeText);
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
        runAttachments.delete(process.id);
        deps.updateControlsState({ isGenerating: false });
        render();
    }
}
