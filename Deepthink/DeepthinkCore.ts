/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink Core - Evolving Depth First Search implementation.
 */

import { GenerateContentResponse, Part } from "@google/genai";
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { AIProvider, ThinkingConfig } from '../Routing/AIProvider';
import { runPythonToolAgent, type SeedImage } from '../Contextual/ContextualPythonToolRuntime';
import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';
import { addSolutionPoolVersion } from './SolutionPool';
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
    status: AgentStatus;
    error?: string;
    retryAttempt?: number;
    isDetailsOpen?: boolean;
    globalIteration?: number;
    branchIteration?: number;
}

export interface DeepthinkSubStrategyData {
    id: string;
    subStrategyText: string;
    requestPromptSolutionAttempt?: string;
    solutionAttempt?: string;
    solutionAttemptDisplay?: string;
    solutionAttemptFinal?: string;
    requestPromptSolutionCritique?: string;
    solutionCritique?: string;
    solutionCritiqueDisplay?: string;
    solutionCritiqueFinal?: string;
    solutionCritiqueStatus?: AgentStatus;
    solutionCritiqueError?: string;
    solutionCritiqueRetryAttempt?: number;
    requestPromptSelfImprovement?: string;
    refinedSolution?: string;
    refinedSolutionDisplay?: string;
    refinedSolutionFinal?: string;
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

const MAX_API_ATTEMPTS = 4;
const INITIAL_RETRY_DELAY_MS = 20000;
const BACKOFF_FACTOR = 2;
const AGENT_TIMEOUT_MS = 15 * 60 * 1000;
const POOL_HISTORY_WINDOW = 5;
const CORRECTION_HISTORY_WINDOW = 5;
const MEMORY_INTERVAL = 5;
const PQF_GROUP_SIZE = 2;
const HYPOTHESIS_HEARTBEAT_INTERVAL = 2;

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

const PYTHON_TOOL_AGENTS = new Set<DeepthinkPythonAgentKind>([
    'Hypothesis Testing',
    'Solution Attempt',
    'Solution Critique',
    'Self-Improvement',
    'Solution Correction',
]);

type DeepthinkPythonAgentKind =
    | 'Hypothesis Testing'
    | 'Solution Attempt'
    | 'Solution Critique'
    | 'Self-Improvement'
    | 'Solution Correction';

interface DeepthinkPythonAgentAccess {
    kind: DeepthinkPythonAgentKind;
    agentName: string;
    sessionId: string;
    historyKey?: string;
}

interface DeepthinkAgentCallOutput {
    contextText: string;
    displayText: string;
    finalText: string;
}

const deepthinkPythonHistories = new Map<string, BaseMessage[]>();

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
    return (imageBase64 && imageMimeType)
        ? [{ inlineData: { mimeType: imageMimeType, data: imageBase64 } }]
        : [];
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

function getDeepthinkSeedImages(process: DeepthinkPipelineState): SeedImage[] {
    if (!process.challengeImageBase64 || !process.challengeImageMimeType?.startsWith('image/')) return [];
    return [{
        name: `deepthink-uploaded-image${extensionForMimeType(process.challengeImageMimeType)}`,
        mimeType: process.challengeImageMimeType,
        base64: process.challengeImageBase64,
    }];
}

function safeSessionSegment(value: string | number | undefined, fallback: string): string {
    const normalized = String(value ?? fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return (normalized || fallback).slice(0, 28);
}

function buildDeepthinkPythonSessionId(process: DeepthinkPipelineState, parts: Array<string | number | undefined>): string {
    const segments = [
        'dtpy',
        safeSessionSegment(process.id, 'run'),
        ...parts.map((part, index) => safeSessionSegment(part, `p${index + 1}`)),
    ];
    return segments.join('-').slice(0, 80);
}

function getDeepthinkPythonFilesystemRules(): string[] {
    return [
        '- Deepthink Python access is available only to Hypothesis Testing, Solution Attempt, Solution Critique, Self-Improvement, and Solution Correction agents.',
        '- Solution Attempt agents keep isolated Python memory and virtual filesystems by assigned strategy/sub-strategy branch version.',
        '- Solution Critique agents keep isolated Python memory and virtual filesystems by assigned strategy/sub-strategy branch version.',
        '- Self-Improvement and Solution Correction agents keep isolated Python memory and virtual filesystems by assigned strategy/sub-strategy branch version across correction iterations.',
        '- Strategy branches that survive post-quality filtering keep the same Python memory and virtual filesystem.',
        '- Updated/replaced strategies start as new agents with fresh Python memory and a fresh virtual filesystem because their branch version changes.',
        '- Hypothesis Testing agents receive isolated per-hypothesis sessions; do not assume files or Python variables persist across hypothesis refresh rounds.',
    ];
}

function createPersistentPythonAccess(args: {
    process: DeepthinkPipelineState;
    kind: Exclude<DeepthinkPythonAgentKind, 'Hypothesis Testing'>;
    strategyId: string;
    subStrategyId?: string;
    branchVersion?: number;
}): DeepthinkPythonAgentAccess {
    const sessionId = buildDeepthinkPythonSessionId(args.process, [
        args.kind,
        args.strategyId,
        args.subStrategyId || 'direct',
        `v${args.branchVersion || 1}`,
    ]);
    return {
        kind: args.kind,
        agentName: `${args.kind} Agent`,
        sessionId,
        historyKey: sessionId,
    };
}

function createHypothesisPythonAccess(process: DeepthinkPipelineState, hypothesis: DeepthinkHypothesisData): DeepthinkPythonAgentAccess {
    return {
        kind: 'Hypothesis Testing',
        agentName: 'Hypothesis Testing Agent',
        sessionId: buildDeepthinkPythonSessionId(process, [
            'hypothesis-testing',
            hypothesis.id,
            `round-${hypothesis.roundNumber || 1}`,
            `global-${hypothesis.globalIteration || 0}`,
        ]),
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

function isPythonToolEnabledFor(access: DeepthinkPythonAgentAccess | undefined): boolean {
    return !!access && PYTHON_TOOL_AGENTS.has(access.kind) && deps.getDeepthinkCodeExecutionEnabled();
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

async function callDeepthinkPythonToolAgent(args: {
    process: DeepthinkPipelineState;
    promptText: string;
    systemInstruction: string;
    modelName: string;
    temperature: number;
    topP?: number;
    access: DeepthinkPythonAgentAccess;
}): Promise<DeepthinkAgentCallOutput> {
    const previousMessages = args.access.historyKey
        ? deepthinkPythonHistories.get(args.access.historyKey) || []
        : [];
    const promptMessage = new HumanMessage(args.promptText);

    const result = await runPythonToolAgent({
        agentName: args.access.agentName,
        sessionId: args.access.sessionId,
        messages: [...previousMessages, promptMessage],
        systemPrompt: args.systemInstruction,
        modelName: args.modelName,
        temperature: args.temperature,
        topP: args.topP,
        seedImages: getDeepthinkSeedImages(args.process),
        runScopeDescription: 'same Deepthink run',
        agentFilesystemRules: getDeepthinkPythonFilesystemRules(),
    });

    if (args.access.historyKey) {
        deepthinkPythonHistories.set(args.access.historyKey, [
            ...previousMessages,
            promptMessage,
            ...(result.loopMessages || [new AIMessage(result.finalText || result.text)]),
        ]);
    }

    return {
        contextText: result.executionTraceText || result.finalText || result.promptText || result.text,
        displayText: result.text,
        finalText: result.finalText || result.promptText || result.text,
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
    pythonAccess?: DeepthinkPythonAgentAccess;
}): Promise<DeepthinkAgentCallOutput> {
    const promptText = args.parts.map(part => part.text || (part.inlineData ? `[Attached Image: ${part.inlineData.mimeType}]` : '')).join('\n');
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
        if (args.process.isStopRequested) throw new PipelineStopRequestedError(`Stop requested before API call: ${args.stepDescription}`);

        const agentModel = modelFor(args.stepDescription);
        const temperature = deps.getSelectedTemperature();
        const topP = deps.getSelectedTopP();
        const pythonToolEnabled = isPythonToolEnabledFor(args.pythonAccess);
        const thinkingConfig: ThinkingConfig = {
            thinkingLevel: deps.getSelectedThinkingLevel ? deps.getSelectedThinkingLevel() : 'high',
        };

        args.target[args.retryField] = attempt - 1;
        render();

        addLiveEvent(args.process, args.stepDescription, `Invoking agent model (Attempt ${attempt}/${MAX_API_ATTEMPTS})`, 'agent_start', {
            systemInstruction: args.systemInstruction,
            prompt: promptText,
            attempt,
            modelName: agentModel,
            temperature,
            topP,
            codeExecutionEnabled: pythonToolEnabled,
        });

        try {
            const call = pythonToolEnabled
                ? callDeepthinkPythonToolAgent({
                    process: args.process,
                    promptText,
                    systemInstruction: args.systemInstruction,
                    modelName: agentModel,
                    temperature,
                    topP,
                    access: args.pythonAccess!,
                })
                : deps.callGemini(args.parts, temperature, agentModel, args.systemInstruction, args.isJson, topP, thinkingConfig)
                    .then(response => {
                        const text = response.text || '';
                        return textAgentOutput(text);
                    });
            const remaining = args.timeoutMs ? Math.max(1, args.timeoutMs - (Date.now() - startedAt)) : undefined;
            const responseOutput = remaining ? await withTimeout(call, remaining, args.stepDescription) : await call;
            const responseText = responseOutput.contextText;

            if (!responseText.trim()) throw new Error('Empty response from API');

            addLiveEvent(args.process, args.stepDescription, 'Agent completed successfully', 'agent_complete', {
                response: responseOutput.displayText,
                systemInstruction: args.systemInstruction,
                prompt: promptText,
                modelName: agentModel,
                temperature,
                topP,
                codeExecutionEnabled: pythonToolEnabled,
            });

            return responseOutput;
        } catch (error: any) {
            lastError = error;
            addLiveEvent(args.process, args.stepDescription, `Agent attempt failed: ${error.message || String(error)}`, attempt === MAX_API_ATTEMPTS ? 'agent_error' : 'agent_retry', {
                error: error.message || String(error),
                attempt,
                systemInstruction: args.systemInstruction,
                prompt: promptText,
                modelName: agentModel,
                temperature,
                topP,
                codeExecutionEnabled: pythonToolEnabled,
            });

            if (attempt === MAX_API_ATTEMPTS) break;

            if (args.timeoutMs && Date.now() - startedAt >= args.timeoutMs) break;

            if ('status' in args.target) args.target.status = 'retrying';
            args.target[args.retryField] = attempt;
            render();

            const delay = INITIAL_RETRY_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
            const deadlineRemaining = args.timeoutMs ? args.timeoutMs - (Date.now() - startedAt) : delay;
            await sleep(Math.max(0, Math.min(delay, deadlineRemaining)));

            if ('status' in args.target) args.target.status = 'processing';
            render();
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError || 'Unknown API failure');
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
                    pythonAccess: createHypothesisPythonAccess(args.process, hypothesis),
                });

                hypothesis.testerAttempt = testerResponse.contextText;
                hypothesis.testerAttemptDisplay = testerResponse.displayText;
                hypothesis.testerAttemptFinal = testerResponse.finalText;
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
            pythonAccess: createPersistentPythonAccess({
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
            pythonAccess: createPersistentPythonAccess({
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
        args.subStrategy.solutionCritiqueStatus = 'completed';
        critiqueData.critiqueResponse = response.contextText;
        critiqueData.critiqueResponseDisplay = response.displayText;
        critiqueData.critiqueResponseFinal = response.finalText;
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
                        timestamp: Date.now(),
                        label: 'Initial Execution',
                    }],
                };
                subStrategy.refinedSolution = subStrategy.solutionAttempt;
                subStrategy.refinedSolutionDisplay = subStrategy.solutionAttemptDisplay;
                subStrategy.refinedSolutionFinal = subStrategy.solutionAttemptFinal;
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

    const snapshots = allSnapshots(args.process, args.runtimes);

    await Promise.allSettled(activeStrategies(args.process).map(async strategy => {
        const runtime = args.runtimes.get(strategy.id);
        if (!runtime) return;

        const currentSnapshot = runtimeSnapshot(args.process, strategy, runtime, args.process.initialStrategies.indexOf(strategy));
        const agent: DeepthinkStructuredSolutionPoolAgentData = {
            id: `pool-${strategy.id}-v${runtime.branchVersion}-g${args.globalIteration}`,
            mainStrategyId: strategy.id,
            branchVersion: runtime.branchVersion,
            status: 'processing',
            isDetailsOpen: true,
            globalIteration: args.globalIteration,
            branchIteration: runtime.branchIterationCount || 1,
        };
        args.process.structuredSolutionPoolAgents.push(agent);
        render();

        const repository = buildSolutionPoolRepository({
            current: currentSnapshot,
            currentHistory: runtime.history,
            currentPoolHistory: runtime.poolHistory,
            allStrategies: snapshots,
            maxPoolHistoryEntries: POOL_HISTORY_WINDOW,
        });

        const prompt = messageText(buildSolutionPoolPrompt({
            challenge: args.challengeText,
            current: currentSnapshot,
            repository,
            hypothesisPacket: args.process.strategySpecificKnowledgePackets?.[strategy.id],
            globalIteration: args.globalIteration,
            branchIteration: Math.max(1, runtime.branchIterationCount),
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
            });
            const response = responseOutput.contextText;

            agent.poolResponse = response;
            agent.parsedPoolResponse = parsePoolResponse(response, strategy.id);
            agent.status = 'completed';
            runtime.poolHistory.push({
                globalIteration: args.globalIteration,
                branchIteration: Math.max(1, runtime.branchIterationCount),
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
            allStrategies: snapshots,
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
                pythonAccess: createPersistentPythonAccess({
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
    });
    const response = responseOutput.contextText;

    const parsed = parseJson(response, 'Strategy Updates');
    const replacementItems = Array.isArray(parsed.strategies) ? parsed.strategies : [];
    const updatedIds: string[] = [];

    updateRequests.forEach((request, index) => {
        const replacement = replacementItems.find((item: any) => String(item.strategy_id || item.id || '').trim() === request.strategyId) || replacementItems[index];
        const replacementText = typeof replacement === 'string'
            ? replacement
            : String(replacement?.strategy || replacement?.strategyText || replacement?.text || '');
        if (!replacementText.trim()) return;

        const strategy = args.process.initialStrategies.find(candidate => candidate.id === request.strategyId);
        const runtime = strategy ? args.runtimes.get(strategy.id) : undefined;
        if (!strategy || !runtime) return;

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
    });

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
            });
            args.process.dissectedObservationsSynthesis = synthesisResponse.contextText;
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
                pythonAccess: createPersistentPythonAccess({
                    process: args.process,
                    kind: 'Self-Improvement',
                    strategyId: strategy.id,
                    subStrategyId: subStrategy.id,
                    branchVersion: strategy.branchVersion || 1,
                }),
            });
            subStrategy.refinedSolution = response.contextText;
            subStrategy.refinedSolutionDisplay = response.displayText;
            subStrategy.refinedSolutionFinal = response.finalText;
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
        });
        const response = responseOutput.contextText;
        process.finalJudgingResponseText = response;
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
    deepthinkPythonHistories.clear();
    if (setActiveDeepthinkPipeline) setActiveDeepthinkPipeline(activeDeepthinkPipeline);
    deps.updateControlsState({ isGenerating: true });
    addLiveEvent(activeDeepthinkPipeline, 'Orchestrator', 'Initializing Deepthink pipeline', 'info');
    render();

    const process = activeDeepthinkPipeline;
    const parts = buildImageParts(imageBase64, imageMimeType);
    const evolvingDfsMode = deps.getRefinementEnabled() && deps.getEvolvingDfsEnabled();
    process.hypothesisInjectionMode = evolvingDfsMode ? 'selective_injection' : deps.getHypothesisInjectionMode();

    try {
        await generateStrategies(process, parts, challengeText, evolvingDfsMode);
        await generateSubStrategies(process, parts, challengeText);

        if (!evolvingDfsMode) {
            await runHypothesisRound({
                process,
                parts,
                challengeText,
                mode: process.hypothesisInjectionMode || 'selective_injection',
                roundNumber: 1,
                globalIteration: 0,
            });
            await runNonIterativeRefinement({ process, parts, challengeText });
        } else {
            await runEvolvingDepthFirstSearch({ process, parts, challengeText });
        }

        if (process.isStopRequested) throw new PipelineStopRequestedError('Stopped before final judging.');

        process.strategicSolverComplete = true;
        await finalJudge(process, parts, challengeText);
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
