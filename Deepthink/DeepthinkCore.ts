/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink Core - Evolving Depth First Search implementation.
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
    type HypothesisInjectionMode,
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

export type { DeepthinkRunConfig, HypothesisInjectionMode } from './DeepthinkContext';

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

export interface DeepthinkSubStrategyData {
    id: string;
    subStrategyText: string;
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
    selfImprovementStatus?: AgentStatus | 'skipped';
    status: AgentStatus;
    error?: string;
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
            correctedSolution: string;
            correctedSolutionDisplay?: string;
            correctedSolutionExecutionTraceText?: string;
            critiqueExecutionTraceText?: string;
            timestamp: number;
            label?: string;
        }>;
        status: 'idle' | 'processing' | 'completed' | 'error';
    };
}

export interface DeepthinkHypothesisData {
    id: string;
    hypothesisText: string;
    testerAttempt?: string;
    testerAttemptDisplay?: string;
    testerAttemptFinal?: string;
    testerAttemptExecutionTraceText?: string;
    testerStatus: AgentStatus;
    targetStrategyIds?: string[];
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

export interface DeepthinkMainStrategyData {
    id: string;
    strategyText: string;
    subStrategies: DeepthinkSubStrategyData[];
    status: AgentStatus;
    error?: string;
    updatedByPostQualityFilter?: boolean;
    postQualityFilterIteration?: number;
    branchVersion?: number;
    branchIterationCount?: number;
    memoryBank?: string;
    replacementHistory?: DeepthinkStrategyReplacementRecord[];
    awaitingFreshHypotheses?: boolean;
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
    dissectedObservationsSynthesis?: string;
    dissectedSynthesisExecutionTraceText?: string;
    dissectedSynthesisStatus?: AgentStatus;
    dissectedSynthesisError?: string;
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
    getSelectedSubStrategiesCount: () => number;
    getStrategyProximityLoops: () => number;
    getRefinementEnabled: () => boolean;
    getSelectedHypothesisCount: () => number;
    getHypothesisProximityLoops: () => number;
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
    updateControlsState: (newState: any) => void;
    getSelectedThinkingLevel?: () => 'low' | 'medium' | 'high' | 'minimal';
    getCustomPromptsDeepthinkState: () => CustomizablePromptsDeepthink;
}

let deps: DeepthinkCoreDeps = null!;
const runAttachments = new Map<string, DeepthinkAttachmentRoute[]>();

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

function captureRunConfig(): DeepthinkRunConfig {
    const refinementEnabled = deps.getRefinementEnabled();
    const evolvingDfsEnabled = refinementEnabled && deps.getEvolvingDfsEnabled();
    const prompts = Object.freeze({ ...deps.getCustomPromptsDeepthinkState() });
    return Object.freeze({
        selectedModel: deps.getSelectedModel(),
        thinkingLevel: deps.getSelectedThinkingLevel?.() || 'high',
        strategyCount: evolvingDfsEnabled
            ? Math.min(deps.getSelectedStrategiesCount(), 5)
            : deps.getSelectedStrategiesCount(),
        subStrategyCount: deps.getSelectedSubStrategiesCount(),
        strategyProximityLoops: deps.getStrategyProximityLoops(),
        refinementEnabled,
        hypothesisCount: deps.getSelectedHypothesisCount(),
        hypothesisProximityLoops: deps.getHypothesisProximityLoops(),
        hypothesisInjectionMode: evolvingDfsEnabled
            ? 'selective_injection'
            : deps.getHypothesisInjectionMode(),
        skipSubStrategies: evolvingDfsEnabled || deps.getSkipSubStrategies(),
        dissectedObservationsEnabled: !evolvingDfsEnabled && deps.getDissectedObservationsEnabled(),
        shareHypothesesToDissected: !evolvingDfsEnabled && deps.getShareHypothesesToDissected(),
        evolvingDfsEnabled,
        evolvingDfsDepth: Math.min(Math.max(deps.getEvolvingDfsDepth(), 1), 10),
        isolateBranches: deps.getIsolateBranchesEnabled(),
        solutionPoolDisabled: deps.getSolutionPoolDisabled(),
        provideAllSolutionsToCorrectors: !evolvingDfsEnabled && deps.getProvideAllSolutionsToCorrectors(),
        postQualityFilterEnabled: evolvingDfsEnabled || deps.getPostQualityFilterEnabled(),
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
        return `<Strategy-Specific Information Packet for Strategy ${strategyId}>
This replacement branch is awaiting a successful fresh hypothesis heartbeat. No earlier selective hypotheses are available.
</Strategy-Specific Information Packet for Strategy ${strategyId}>`;
    }
    return [
        `<Strategy-Specific Information Packet for Strategy ${strategyId}>`,
        hypotheses.length
            ? hypotheses.map(hypothesis => [
                `<Hypothesis ${hypothesis.id}>`,
                `Hypothesis: ${hypothesis.hypothesisText}`,
                `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}`,
                `</Hypothesis ${hypothesis.id}>`,
            ].join('\n')).join('\n\n')
            : 'No active strategy-specific hypotheses are currently available for this strategy.',
        `</Strategy-Specific Information Packet for Strategy ${strategyId}>`,
    ].join('\n');
}

function renderFullHypothesisPacket(hypotheses: readonly DeepthinkHypothesisData[]): string {
    return [
        '<Full Information Packet>',
        ...hypotheses.map((hypothesis, index) => [
            `<Hypothesis ${index + 1}>`,
            `Hypothesis: ${hypothesis.hypothesisText}`,
            `Target Strategies: ${hypothesis.targetStrategyIds?.join(', ') || 'All'}`,
            `Hypothesis Testing: ${hypothesis.testerAttempt || 'No testing output available'}`,
            `</Hypothesis ${index + 1}>`,
        ].join('\n')),
        '</Full Information Packet>',
    ].join('\n');
}

interface StrategyHypothesisRoute {
    packetText: string;
    fullPacketText: string;
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
        fullPacketText: strategy.awaitingFreshHypotheses
            ? renderStrategyHypothesisPacket(strategy.id, [], true)
            : hypotheses.length
                ? renderFullHypothesisPacket(hypotheses)
                : process.knowledgePacket || renderFullHypothesisPacket([]),
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
        '- Strategy, hypothesis, synthesis, and final-judge roles receive a full read-only repository view; PQF and memory roles receive only their explicitly assigned branch directories read-only.',
        '- Branch isolation removes peer prompt sections and peer directory mounts. Full Solution Context controls peer mounts for single-pass correction.',
        '- Selective hypothesis directories remain visible only to branches whose text context receives those same tested packets.',
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

function buildSubStrategyAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
}): DeepthinkAgentContextManifest {
    const count = configFor(args.process).subStrategyCount;
    const otherStrategies = args.process.initialStrategies
        .filter(candidate => candidate.id !== args.strategy.id)
        .map((candidate, index) => `Strategy ${index + 1}: ${candidate.strategyText}`)
        .join('\n\n') || 'No other strategies.';
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'subStrategy',
        promptText: buildSubStrategyPrompt({
            challengeText: args.challengeText,
            currentMainStrategy: args.strategy.strategyText,
            otherMainStrategies: otherStrategies,
            subStrategyCount: count,
        }),
        sessionParts: ['subStrategy', args.strategy.id],
        outputContract: subStrategyOutputContract(count),
    });
}

function buildHypothesisGenerationAgentContext(args: {
    process: DeepthinkPipelineState;
    taskPrompt: string;
    conversationText: string;
    mode: HypothesisInjectionMode;
    revision: boolean;
}): DeepthinkAgentContextManifest {
    const config = configFor(args.process);
    const count = config.hypothesisCount;
    let systemInstruction = deepthinkAgentSystemInstruction('hypothesisGeneration', config.prompts)
        .replace(/\{\{NUM_HYPOTHESES\}\}/g, String(count));
    if (args.mode === 'selective_injection') {
        systemInstruction += '\n\nReturn only JSON. Each hypothesis must be an object with "text" and "target_strategies".';
    }
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
            args.mode,
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
    subStrategy: DeepthinkSubStrategyData;
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
            subStrategy: args.subStrategy.subStrategyText,
            knowledgePacket: configFor(args.process).hypothesisInjectionMode === 'selective_injection'
                ? route.packetText
                : route.fullPacketText,
            otherStrategyContext,
            branchContext: args.strategy.branchVersion
                ? `<BranchIdentity strategy="${args.strategy.id}" branchVersion="${args.strategy.branchVersion}" branchIterationCount="${args.strategy.branchIterationCount || 0}" />`
                : undefined,
        }),
        sessionParts: [
            'solutionAttempt',
            args.strategy.id,
            args.subStrategy.id,
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
    subStrategy: DeepthinkSubStrategyData;
    solution: string;
    runtime?: BranchRuntime;
    globalIteration?: number;
    branchIteration?: number;
}): DeepthinkAgentContextManifest {
    const promptText = args.runtime && args.globalIteration !== undefined && args.branchIteration !== undefined
        ? messageText(buildCritiquePrompt({
            challenge: args.challengeText,
            strategy: runtimeSnapshot(args.strategy, args.runtime),
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
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'solutionCritique',
        promptText,
        sessionParts: [
            'solutionCritique',
            args.strategy.id,
            args.subStrategy.id,
            `v${args.runtime?.branchVersion || args.strategy.branchVersion || 1}`,
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
            ensureDirectSubStrategy(args.strategy).id,
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

function buildSelfImprovementAgentContext(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
    strategy: DeepthinkMainStrategyData;
    subStrategy: DeepthinkSubStrategyData;
}): DeepthinkAgentContextManifest {
    const includePeers = configFor(args.process).provideAllSolutionsToCorrectors;
    const peerContext = includePeers
        ? activeStrategies(args.process).flatMap(strategy => strategy.subStrategies.map(sub => [
            `<Candidate strategy="${strategy.id}" subStrategy="${sub.id}" assigned="${sub.id === args.subStrategy.id}">`,
            strategy.strategyText,
            sub.subStrategyText,
            sub.solutionAttempt || '',
            sub.solutionCritique || '',
            '</Candidate>',
        ].join('\n'))).join('\n\n')
        : '';
    const solutionSection = [
        args.subStrategy.solutionCritique || 'No critique available.',
        args.process.dissectedObservationsSynthesis
            ? `\n\n<Dissected Observations Synthesis>\n${args.process.dissectedObservationsSynthesis}\n</Dissected Observations Synthesis>`
            : '',
        peerContext ? `\n\n<All Solutions Context>\n${peerContext}\n</All Solutions Context>` : '',
    ].join('');
    return finalizeAgentContext({
        process: args.process,
        agentKind: 'selfImprovement',
        promptText: buildSelfImprovementPrompt({
            challengeText: args.challengeText,
            mainStrategy: args.strategy.strategyText,
            subStrategy: args.subStrategy.subStrategyText,
            solutionAttempt: args.subStrategy.solutionAttempt || '',
            solutionSection,
        }),
        sessionParts: [
            'selfImprovement',
            args.strategy.id,
            args.subStrategy.id,
            `v${args.strategy.branchVersion || 1}`,
        ],
        repositoryScope: {
            strategySlotIndex: strategySlotIndex(args.process, args.strategy.id),
            peerStrategySlotIndexes: includePeers
                ? peerStrategySlotIndexes(args.process, args.strategy.id)
                : [],
        },
    });
}

function buildDissectedSynthesisAgentContext(
    process: DeepthinkPipelineState,
    challengeText: string,
): DeepthinkAgentContextManifest {
    const solutionsWithCritiques = activeStrategies(process).map(strategy => {
        const subStrategies = strategy.subStrategies.filter(sub => sub.solutionAttempt);
        if (!subStrategies.length) return '';
        return [
            `<Strategy id="${strategy.id}">`,
            strategy.strategyText,
            ...subStrategies.map(sub => [
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
            '</Strategy>',
        ].join('\n');
    }).filter(Boolean).join('\n\n');
    const config = configFor(process);
    return finalizeAgentContext({
        process,
        agentKind: 'dissectedSynthesis',
        promptText: buildDissectedSynthesisPrompt({
            challengeText,
            knowledgePacket: config.shareHypothesesToDissected
                ? process.knowledgePacket || 'No hypothesis exploration performed.'
                : 'Hypothesis exploration sharing is disabled for dissected observations.',
            solutionsWithCritiques,
        }),
        sessionParts: ['dissectedSynthesis', 'non-iterative'],
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
    subStrategyText: string;
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
        `Sub-Strategy: ${candidate.subStrategyText}`,
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

function hypothesisOutputContract(
    count: number,
    mode: HypothesisInjectionMode,
    activeStrategyIds: string[],
): SandboxFinalOutputContract {
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
            validateAllowedUniqueIds(
                entry.target_strategies,
                activeStrategyIds,
                `Hypothesis Generation response.hypotheses[${index}].target_strategies`,
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
    targetStrategyIds: string[];
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
            target_strategies: candidate.targetStrategyIds,
        })),
    }, null, 2);
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
    const outputExample = args.mode === 'selective_injection'
        ? `{
  "hypotheses": [
    {
      "text": "Hypothesis text",
      "target_strategies": ["main1"]
    }
  ]
}`
        : `{
  "hypotheses": [
    "Hypothesis text"
  ]
}`;

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
        };
        strategy.subStrategies = [sub];
    }
    return sub;
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
    const directSub = ensureDirectSubStrategy(strategy);
    const latestHistory = runtime.history[runtime.history.length - 1];
    const latestPool = runtime.poolHistory[runtime.poolHistory.length - 1];
    return {
        id: strategy.id,
        strategyText: strategy.strategyText,
        branchVersion: runtime.branchVersion,
        latestSolution: directSub.solutionAttempt,
        latestCorrection: latestHistory?.solution || directSub.refinedSolution,
        latestCritique: latestHistory?.critique || directSub.solutionCritique,
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
            subStrategy.selfImprovementStatus === 'completed'
            && !!(subStrategy.refinedSolutionFinal || subStrategy.refinedSolution)
        ));
        if (hasCorrection) {
            add(`${contextDirectory}/correction_final_output.md`, aggregateSubStrategyContent(
                strategy,
                subStrategy => subStrategy.selfImprovementStatus === 'completed'
                    ? (subStrategy.refinedSolutionFinal || subStrategy.refinedSolution)
                    : undefined,
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
        subStrategies: [],
        status: 'pending',
        branchVersion: 1,
        branchIterationCount: 0,
        replacementHistory: [],
        awaitingFreshHypotheses: false,
    }));

    render();
}

async function generateSubStrategies(process: DeepthinkPipelineState, challengeText: string): Promise<void> {
    const config = configFor(process);
    if (config.skipSubStrategies || config.evolvingDfsEnabled) {
        process.initialStrategies.forEach(strategy => {
            strategy.subStrategies = [{
                id: `${strategy.id}-direct`,
                subStrategyText: strategy.strategyText,
                status: 'pending',
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
            const responseOutput = await callAgent({
                process,
                manifest: buildSubStrategyAgentContext({
                    process,
                    challengeText,
                    strategy,
                }),
                stepDescription: `Sub-Strategy Generation for ${strategy.id}`,
            });
            const response = responseOutput.contextText;

            const parsed = parseJson(response, `Sub-Strategy Generation for ${strategy.id}`);
            const subStrategies = parsed.sub_strategies as string[];
            strategy.subStrategies = subStrategies.map((subStrategyText, index) => ({
                id: `${strategy.id}-sub${index + 1}`,
                subStrategyText,
                status: 'pending',
            }));
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
    challengeText: string;
    mode: HypothesisInjectionMode;
    roundNumber: number;
    globalIteration: number;
    prompt?: string;
}): Promise<void> {
    const config = configFor(args.process);
    const count = config.hypothesisCount;
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
    const previousHypotheses = args.process.hypotheses.length
        ? [...args.process.hypotheses]
        : [];
    render();

    const taskPrompt = args.prompt || initialHypothesisPrompt(args.process, args.challengeText, args.mode, count);
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
                        mode: args.mode,
                        revision,
                    }),
                    stepDescription: !revision
                        ? (args.roundNumber === 1 ? 'Hypothesis Generation Seed' : `Hypothesis Generation Heartbeat ${args.roundNumber} Seed`)
                        : `Hypothesis Generation Revision ${round} for Heartbeat ${args.roundNumber}`,
                    timeoutMs: AGENT_TIMEOUT_MS,
                });
                const parsed = parseJson(responseOutput.contextText, 'Hypothesis Generation');
                const hypotheses: HypothesisGenerationCandidate[] = args.mode === 'selective_injection'
                    ? (parsed.hypotheses as Array<{ text: string; target_strategies: string[] }>)
                        .map(hypothesis => ({
                            text: hypothesis.text,
                            targetStrategyIds: hypothesis.target_strategies,
                        }))
                    : (parsed.hypotheses as string[])
                        .map(text => ({ text, targetStrategyIds: [] }));
                return {
                    candidates: hypotheses,
                    output: args.mode === 'selective_injection'
                        ? formatHypothesisGeneratorSubmission(hypotheses)
                        : JSON.stringify({ hypotheses: hypotheses.map(hypothesis => hypothesis.text) }, null, 2),
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
            targetStrategyIds: args.mode === 'selective_injection' ? candidate.targetStrategyIds : undefined,
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

        const fullPacket = renderFullHypothesisPacket(nextHypotheses);

        const strategyPackets: Record<string, string> = {};
        activeStrategies(args.process).forEach(strategy => {
            const relevant = args.mode === 'selective_injection'
                ? selectRoutedHypotheses(nextHypotheses, strategy.id)
                : nextHypotheses;
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
    subStrategy: DeepthinkSubStrategyData;
}): Promise<void> {
    args.subStrategy.status = 'processing';
    render();

    try {
        const response = await callAgent({
            process: args.process,
            manifest: buildSolutionAttemptAgentContext(args),
            stepDescription: `Solution Attempt for ${args.subStrategy.id}`,
            timeoutMs: AGENT_TIMEOUT_MS,
        });
        args.subStrategy.solutionAttempt = response.contextText;
        args.subStrategy.solutionAttemptDisplay = response.displayText;
        args.subStrategy.solutionAttemptFinal = response.finalText;
        args.subStrategy.solutionAttemptExecutionTraceText = response.executionTraceText;
        args.subStrategy.status = 'completed';
    } catch (error: any) {
        args.subStrategy.status = 'error';
        args.subStrategy.error = error.message || 'Solution attempt failed';
    }
    render();
}

async function critiqueSolution(args: {
    process: DeepthinkPipelineState;
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

    const critiqueData: DeepthinkSolutionCritiqueData = {
        id: `critique-${args.strategy.id}-${args.globalIteration || 'initial'}-${nanoid(4)}`,
        mainStrategyId: args.strategy.id,
        branchVersion: args.runtime?.branchVersion || args.strategy.branchVersion || 1,
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

        args.subStrategy.solutionCritique = response.contextText;
        args.subStrategy.solutionCritiqueDisplay = response.displayText;
        args.subStrategy.solutionCritiqueFinal = response.finalText;
        args.subStrategy.solutionCritiqueExecutionTraceText = response.executionTraceText;
        args.subStrategy.solutionCritiqueStatus = 'completed';
        critiqueData.critiqueResponse = response.contextText;
        critiqueData.critiqueResponseDisplay = response.displayText;
        critiqueData.status = 'completed';
        return response.contextText;
    } catch (error: any) {
        args.subStrategy.solutionCritiqueStatus = 'error';
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
    evolvingDfsMode: boolean;
}): Promise<void> {
    args.process.solutionCritiquesStatus = 'processing';
    render();

    await Promise.allSettled(activeStrategies(args.process).flatMap(strategy => {
        const subs = args.evolvingDfsMode ? [ensureDirectSubStrategy(strategy)] : strategy.subStrategies;
        return subs.map(async subStrategy => {
            await executeSolutionAttempt({
                process: args.process,
                challengeText: args.challengeText,
                strategy,
                subStrategy,
            });

            if (!subStrategy.solutionAttempt || !configFor(args.process).refinementEnabled) {
                subStrategy.refinedSolution = subStrategy.solutionAttempt;
                subStrategy.refinedSolutionDisplay = subStrategy.solutionAttemptDisplay;
                subStrategy.refinedSolutionFinal = subStrategy.solutionAttemptFinal;
                subStrategy.selfImprovementStatus = 'skipped';
                return;
            }

            const runtime = args.runtimes.get(strategy.id);
            const branchIteration = args.evolvingDfsMode ? 1 : undefined;
            const critique = await critiqueSolution({
                process: args.process,
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
                    solutionExecutionTraceText: subStrategy.solutionAttemptExecutionTraceText,
                    critique,
                    critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                    critiqueExecutionTraceText: subStrategy.solutionCritiqueExecutionTraceText,
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
                        correctedSolution: subStrategy.solutionAttempt || '',
                        correctedSolutionDisplay: subStrategy.solutionAttemptDisplay,
                        correctedSolutionExecutionTraceText: subStrategy.solutionAttemptExecutionTraceText,
                        critiqueExecutionTraceText: subStrategy.solutionCritiqueExecutionTraceText,
                        timestamp: Date.now(),
                        label: 'Initial Execution',
                    }],
                };
                subStrategy.refinedSolution = subStrategy.solutionAttempt;
                subStrategy.refinedSolutionDisplay = subStrategy.solutionAttemptDisplay;
                subStrategy.refinedSolutionFinal = subStrategy.solutionAttemptFinal;
                subStrategy.selfImprovementStatus = 'skipped';
            }
        });
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
            directSubFor(strategy)!.branchIterationCount = runtime.branchIterationCount;
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
            directSubFor(strategy)!.branchIterationCount = runtime.branchIterationCount;
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
        const subStrategy = ensureDirectSubStrategy(strategy);
        if (!runtime) return;

        const nextBranchIteration = runtime.history.length + 1;

        subStrategy.selfImprovementStatus = 'processing';
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

            subStrategy.refinedSolution = corrected.contextText;
            subStrategy.refinedSolutionDisplay = corrected.displayText;
            subStrategy.refinedSolutionFinal = corrected.finalText;
            subStrategy.refinedSolutionExecutionTraceText = corrected.executionTraceText;
            subStrategy.selfImprovementStatus = 'completed';

            const critique = await critiqueSolution({
                process: args.process,
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
                solutionExecutionTraceText: corrected.executionTraceText,
                critique: critique || 'No critique output available.',
                critiqueDisplay: subStrategy.solutionCritiqueDisplay,
                critiqueExecutionTraceText: subStrategy.solutionCritiqueExecutionTraceText,
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
                correctedSolution: corrected.contextText,
                correctedSolutionDisplay: corrected.displayText,
                correctedSolutionExecutionTraceText: corrected.executionTraceText,
                critiqueExecutionTraceText: subStrategy.solutionCritiqueExecutionTraceText,
                timestamp: Date.now(),
                label: `Correction ${nextBranchIteration}`,
            });
        } catch {
            subStrategy.selfImprovementStatus = 'error';
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
        const directSub = directSubFor(strategy);
        return {
            strategyId: strategy.id,
            oldStrategyText: strategy.strategyText,
            latestSolution: latest?.solution || directSub?.solutionAttempt || '',
            latestSolutionDisplay: latest?.solutionDisplay || directSub?.solutionAttemptDisplay,
            latestCritique: latest?.critique || directSub?.solutionCritique || '',
            latestCritiqueDisplay: latest?.critiqueDisplay || directSub?.solutionCritiqueDisplay,
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
    if (!configFor(args.process).postQualityFilterEnabled) return [];

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
        const subStrategy = strategy ? ensureDirectSubStrategy(strategy) : undefined;
        if (!strategy || !runtime || !subStrategy) return;

        await executeSolutionAttempt({
            process: args.process,
            challengeText: args.challengeText,
            strategy,
            subStrategy,
        });
        if (!subStrategy.solutionAttempt) return;
        const critique = await critiqueSolution({
            process: args.process,
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
        subStrategy.selfImprovementStatus = 'skipped';

        runtime.history.push({
            globalIteration: args.globalIteration,
            branchIteration: 1,
            branchVersion: runtime.branchVersion,
            label: `Branch v${runtime.branchVersion} Initial Execution`,
            solution: subStrategy.solutionAttempt || '',
            solutionDisplay: subStrategy.solutionAttemptDisplay,
            solutionExecutionTraceText: subStrategy.solutionAttemptExecutionTraceText,
            critique: critique || 'No critique output available.',
            critiqueDisplay: subStrategy.solutionCritiqueDisplay,
            critiqueExecutionTraceText: subStrategy.solutionCritiqueExecutionTraceText,
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
                correctedSolution: subStrategy.solutionAttempt || '',
                correctedSolutionDisplay: subStrategy.solutionAttemptDisplay,
                correctedSolutionExecutionTraceText: subStrategy.solutionAttemptExecutionTraceText,
                critiqueExecutionTraceText: subStrategy.solutionCritiqueExecutionTraceText,
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
            targetStrategyIds: hypothesis.targetStrategyIds || [],
            testerOutput: hypothesis.testerAttempt || 'No testing output available.',
            testerStatus: hypothesis.testerStatus,
        })),
    }));

    await runHypothesisRound({
        process: args.process,
        challengeText: args.challengeText,
        mode: 'selective_injection',
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

async function runEvolvingDepthFirstSearch(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
}): Promise<void> {
    args.process.structuredSolutionPoolEnabled = true;
    args.process.postQualityFilterStatus = 'pending';
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
        challengeText: args.challengeText,
        mode: 'selective_injection',
        roundNumber: 1,
        globalIteration: 0,
    });
    await captureAgentRepositoryBarrier(args.process, 'Deepthink initial hypothesis round');

    await runInitialExecutionsAndCritiques({
        process: args.process,
        challengeText: args.challengeText,
        runtimes,
        evolvingDfsMode: true,
    });
    await captureAgentRepositoryBarrier(args.process, 'Deepthink iteration 1 execution and critique barrier');

    await runSolutionPools({
        process: args.process,
        challengeText: args.challengeText,
        runtimes,
        globalIteration: 1,
    });
    await snapshotDeepthinkIteration(args.process, 1);

    const evolvingDfsDepth = configFor(args.process).evolvingDfsDepth;
    let recentlyUpdatedStrategyIds: string[] = [];

    for (let globalIteration = 2; globalIteration <= evolvingDfsDepth; globalIteration++) {
        if (args.process.isStopRequested) throw new PipelineStopRequestedError('Evolving DFS stopped by user.');

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
        const sub = ensureDirectSubStrategy(strategy);
        if (sub.evolvingDfs) sub.evolvingDfs.status = 'completed';
    });
    args.process.structuredSolutionPoolStatus = 'completed';
    render();
}

async function runNonIterativeRefinement(args: {
    process: DeepthinkPipelineState;
    challengeText: string;
}): Promise<void> {
    await runInitialExecutionsAndCritiques({
        process: args.process,
        challengeText: args.challengeText,
        runtimes: new Map(),
        evolvingDfsMode: false,
    });
    await captureAgentRepositoryBarrier(args.process, 'Deepthink single-pass execution and critique barrier');

    const config = configFor(args.process);
    if (!config.refinementEnabled) {
        activeStrategies(args.process).forEach(strategy => {
            strategy.subStrategies.forEach(sub => {
                if (sub.solutionAttempt) {
                    sub.refinedSolution = sub.solutionAttempt;
                    sub.refinedSolutionDisplay = sub.solutionAttemptDisplay;
                    sub.refinedSolutionFinal = sub.solutionAttemptFinal;
                    sub.selfImprovementStatus = 'skipped';
                }
            });
        });
        render();
        return;
    }

    if (config.dissectedObservationsEnabled) {
        args.process.dissectedSynthesisStatus = 'processing';
        render();

        try {
            const synthesisResponse = await callAgent({
                process: args.process,
                manifest: buildDissectedSynthesisAgentContext(args.process, args.challengeText),
                stepDescription: 'Dissected Observations Synthesis',
            });
            args.process.dissectedObservationsSynthesis = synthesisResponse.contextText;
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

        try {
            const response = await callAgent({
                process: args.process,
                manifest: buildSelfImprovementAgentContext({
                    process: args.process,
                    challengeText: args.challengeText,
                    strategy,
                    subStrategy,
                }),
                stepDescription: `Self-Improvement for ${subStrategy.id}`,
                timeoutMs: AGENT_TIMEOUT_MS,
            });
            subStrategy.refinedSolution = response.contextText;
            subStrategy.refinedSolutionDisplay = response.displayText;
            subStrategy.refinedSolutionFinal = response.finalText;
            subStrategy.refinedSolutionExecutionTraceText = response.executionTraceText;
            subStrategy.selfImprovementStatus = 'completed';
        } catch {
            subStrategy.selfImprovementStatus = 'error';
        }
        render();
    })));
}

async function finalJudge(process: DeepthinkPipelineState, challengeText: string): Promise<void> {
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
        process.finalJudgedBestSolution = `**Solution ID:** <span class="sub-strategy-purple-id">${parsed.best_solution_id}</span>

**Origin:** ${winningSolution.subStrategyText} from ${winningSolution.mainStrategyId}

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
    const evolvingDfsMode = runConfig.evolvingDfsEnabled;

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
        await generateSubStrategies(process, modelChallengeText);

        if (!evolvingDfsMode) {
            await runHypothesisRound({
                process,
                challengeText: modelChallengeText,
                mode: runConfig.hypothesisInjectionMode,
                roundNumber: 1,
                globalIteration: 0,
            });
            await captureAgentRepositoryBarrier(process, 'Deepthink initial hypothesis round');
            await runNonIterativeRefinement({ process, challengeText: modelChallengeText });
        } else {
            await runEvolvingDepthFirstSearch({ process, challengeText: modelChallengeText });
        }

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
