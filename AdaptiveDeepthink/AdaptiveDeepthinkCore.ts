/**
 * Adaptive Deepthink's pass-oriented orchestration tools.
 *
 * This mode intentionally reuses the independent Deepthink agents. The only
 * orchestration-specific behaviour lives here: strategy/hypothesis proximity
 * loops, pass compaction, saved branch immutability, and branch rollback.
 */

import { Part, GenerateContentResponse } from '@google/genai';
import { HumanMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import {
    correctedSolutionsAgent,
    executeStrategiesAgent,
    generateHypothesesAgent,
    generateStrategiesAgent,
    hypothesesProximityAgent,
    solutionCritiqueAgent,
    strategiesProximityAgent,
    testHypothesesAgent,
    type AgentExecutionContext,
} from '../Deepthink/DeepthinkAgents';
import {
    normalizeProximityHistory,
    refineWithProximity,
    type ProximityTurn,
} from '../Deepthink/DeepthinkProximity';
import type {
    DeepthinkHypothesisData,
    DeepthinkLiveEvent,
    DeepthinkMainStrategyData,
    DeepthinkPipelineState,
    DeepthinkSolutionCritiqueData,
} from '../Deepthink/DeepthinkCore';
import {
    buildDeepthinkSandboxRepositoryAccess,
    DEEPTHINK_SANDBOX_DIRECTORY_POLICY,
    type DeepthinkSandboxRole,
} from '../Deepthink/DeepthinkSandboxAccess';
import {
    ensureDeepthinkResultsRepository,
    expandInlineReferenceMarkers,
    restoreSandboxRepositoryStrategy,
    runSandboxToolAgent,
    runVirtualEnvironmentCommand,
    snapshotDeepthinkResultsRepository,
    snapshotSandboxRepositoryById,
    type SandboxRepositoryAccess,
    type SeedFile,
} from '../Core/SandboxToolRuntime';
import { describeProviderError } from '../Core/ProviderError';
import { globalState } from '../Core/State';

export type AdaptiveAgentRole =
    | 'strategy-generator'
    | 'strategy-proximity'
    | 'hypothesis-generator'
    | 'hypothesis-proximity'
    | 'hypothesis-testing'
    | 'execution'
    | 'critique'
    | 'correction';

export type AdaptiveDeepthinkToolCall =
    | { type: 'generate_strategies'; count: number; proximityLoops?: number; specialContext?: string; replaceStrategyIds?: string[] }
    | { type: 'generate_hypothesis'; count: number; proximityLoops?: number; specialContext?: string }
    | { type: 'test_hypothesis'; hypothesisIds: string[] }
    | { type: 'execute'; executions: AdaptiveExecutionRequest[]; specialContext?: string }
    | { type: 'save'; strategyIds: string[] }
    | { type: 'finalize_pass_and_execute'; executions: AdaptiveExecutionRequest[]; specialContext?: string }
    | { type: 'read_files'; paths: string[] }
    | { type: 'virtual_environment'; command: string; timeoutMs?: number }
    | { type: 'submit_final_output'; response: string };

interface AdaptiveExecutionRequest {
    strategyId: string;
    hypothesisIds: string[];
    /** Branch-local instructions. Never forwarded to critique or correction. */
    specialContext?: string;
}

export interface AdaptiveDeepthinkToolPrompts {
    sys_deepthink_initialStrategy: string;
    sys_deepthink_strategyProximity: string;
    sys_deepthink_hypothesisGeneration: string;
    sys_deepthink_hypothesisProximity: string;
    sys_deepthink_hypothesisTester: string;
    sys_deepthink_solutionAttempt: string;
    sys_deepthink_solutionCritique: string;
    sys_deepthink_solutionCorrection: string;
}

interface AdaptiveStrategy {
    id: string;
    text: string;
    slotIndex: number;
    saved: boolean;
    createdPass: number;
    updatedPass: number;
    preCorrectionSnapshot?: { commit: string; passNumber: number };
}

interface AdaptiveHypothesis {
    id: string;
    text: string;
    passNumber: number;
}

interface AdaptiveHypothesisTesting {
    hypothesis: string;
    testing: string;
    passNumber: number;
}

interface AdaptiveExecutionRecord {
    id: string;
    passNumber: number;
    strategyId: string;
    strategy: string;
    hypothesisIds: string[];
    execution: string;
    critique: string;
    correction: string;
}

export interface AdaptivePassRecord {
    passNumber: number;
    finalized: boolean;
    compactedFiles: string[];
    completedAt?: number;
}

interface AdaptiveArtifact {
    path: string;
    content: string;
}

export interface AdaptiveDeepthinkState {
    id: string;
    question: string;
    status: 'idle' | 'processing' | 'completed' | 'error';
    error?: string;
    passNumber: number;
    strategies: Map<string, AdaptiveStrategy>;
    hypotheses: Map<string, AdaptiveHypothesis>;
    hypothesisTestings: Map<string, AdaptiveHypothesisTesting>;
    executions: Map<string, AdaptiveExecutionRecord>;
    passes: Map<number, AdaptivePassRecord>;
    artifacts: Map<string, AdaptiveArtifact>;
    strategyGenerationHistory: ProximityTurn[];
    hypothesisGenerationHistory: ProximityTurn[];
    compactedContextLinks: string[];
    compactionBoundary?: number;
    selectedSolution?: string;
}

export interface AdaptiveDeepthinkToolExecutionContext {
    pipeline: DeepthinkPipelineState;
    callAI: (parts: Part[], modelToUse: string, systemInstruction?: string, isJson?: boolean) => Promise<GenerateContentResponse>;
    cleanOutputByType: (raw: string, type?: string) => string;
    parseJsonSafe: (raw: string, context: string) => any;
    getSelectedModel: () => string;
    getModelFor: (role: AdaptiveAgentRole) => string;
    sandboxEnabled: boolean;
    images?: Array<{ base64: string; mimeType: string }>;
    notifyUpdate?: () => void;
    abortSignal?: AbortSignal;
}

const MAX_BATCH_SIZE = 5;
const DEFAULT_PROXIMITY_LOOPS = 2;

/**
 * Adaptive owns its embedded React tree. Mutating the shared pipeline without
 * invoking DeepthinkCore's renderer keeps that tree intact while still feeding
 * the exact event shape consumed by DeepthinkLiveTab on the next state sync.
 */
function addAdaptiveLiveEvent(
    context: AdaptiveDeepthinkToolExecutionContext,
    agentName: string,
    stepDescription: string,
    eventType: DeepthinkLiveEvent['eventType'],
    details: Partial<DeepthinkLiveEvent> = {}
): void {
    const pipeline = context.pipeline;
    if (!pipeline.liveEvents) pipeline.liveEvents = [];
    pipeline.liveEvents.push({
        id: `adaptive-ev-${nanoid(8)}`,
        timestamp: Date.now(),
        agentName,
        stepDescription,
        eventType,
        ...details,
    });
    if (context.notifyUpdate) {
        context.notifyUpdate();
    }
}

function seedFiles(): SeedFile[] {
    return globalState.directContextFiles.map((file, index) => ({
        name: file.name || `adaptive-upload-${index + 1}`,
        mimeType: file.mimeType,
        base64: file.base64,
    }));
}

function roleLabel(role: AdaptiveAgentRole): string {
    return {
        'strategy-generator': 'Strategy Generator',
        'strategy-proximity': 'Strategies Proximity',
        'hypothesis-generator': 'Hypothesis Generator',
        'hypothesis-proximity': 'Hypothesis Proximity',
        'hypothesis-testing': 'Test Hypothesis',
        execution: 'Execution',
        critique: 'Critique',
        correction: 'Correction',
    }[role];
}

function sandboxRole(role: AdaptiveAgentRole): DeepthinkSandboxRole {
    switch (role) {
        case 'strategy-generator':
        case 'strategy-proximity':
            return 'Main Strategy Generation';
        case 'hypothesis-generator':
        case 'hypothesis-proximity':
            return 'Hypothesis Generation';
        case 'hypothesis-testing':
            return 'Hypothesis Testing';
        case 'execution':
            return 'Solution Attempt';
        case 'critique':
            return 'Solution Critique';
        case 'correction':
            return 'Solution Correction';
    }
}

function safeSegment(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'run';
}

function pathFor(state: AdaptiveDeepthinkState, strategyId: string | undefined, role: AdaptiveAgentRole, suffix = ''): string {
    const pass = String(state.passNumber).padStart(2, '0');
    const agent = roleLabel(role).replace(/\s+/g, '-');
    return `Pass-${pass}${strategyId ? `-${strategyId}` : ''}-${agent}${suffix}`;
}

function recordArtifact(state: AdaptiveDeepthinkState, path: string, content: string): void {
    state.artifacts.set(path, { path, content });
}

function nextArtifactPath(state: AdaptiveDeepthinkState, basePath: string): string {
    if (!state.artifacts.has(basePath)) return basePath;
    const extensionIndex = basePath.lastIndexOf('.');
    const stem = extensionIndex >= 0 ? basePath.slice(0, extensionIndex) : basePath;
    const extension = extensionIndex >= 0 ? basePath.slice(extensionIndex) : '';
    let version = 2;
    while (state.artifacts.has(`${stem}-v${version}${extension}`)) version++;
    return `${stem}-v${version}${extension}`;
}

function artifactOutputPath(state: AdaptiveDeepthinkState, strategyId: string | undefined, role: AdaptiveAgentRole): string {
    return `${pathFor(state, strategyId, role)}.md`;
}

function strategyDirectory(strategy: AdaptiveStrategy): string {
    return DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory(strategy.slotIndex);
}

function hypothesisLabel(id: string): string {
    return id.replace(/^H/i, '') || '1';
}

function repositoryAccess(
    state: AdaptiveDeepthinkState,
    role: AdaptiveAgentRole,
    strategy?: AdaptiveStrategy,
    hypothesisId?: string,
    selectedHypothesisIds: string[] = []
): SandboxRepositoryAccess {
    const sandboxAgentRole = sandboxRole(role);
    if (role === 'hypothesis-testing') {
        return buildDeepthinkSandboxRepositoryAccess({
            repositoryId: state.id,
            role: sandboxAgentRole,
            hypothesisLabel: hypothesisLabel(hypothesisId || '1'),
            hypothesisRoundNumber: state.passNumber,
        });
    }

    if (strategy) {
        return buildDeepthinkSandboxRepositoryAccess({
            repositoryId: state.id,
            role: sandboxAgentRole,
            strategySlotIndex: strategy.slotIndex,
            selectedHypothesisLabels: selectedHypothesisIds.map(hypothesisLabel),
            selectedHypothesisRoundNumber: state.passNumber,
            peerStrategySlotIndexes: role === 'correction'
                ? Array.from(state.strategies.values()).filter(candidate => candidate.id !== strategy.id).map(candidate => candidate.slotIndex)
                : [],
        });
    }

    return buildDeepthinkSandboxRepositoryAccess({ repositoryId: state.id, role: sandboxAgentRole });
}

function syncAgentContext(
    state: AdaptiveDeepthinkState,
    context: AdaptiveDeepthinkToolExecutionContext,
    role: AdaptiveAgentRole,
    systemPrompt: string,
    strategy?: AdaptiveStrategy,
    hypothesisId?: string,
    selectedHypothesisIds: string[] = [],
    executionGroupId?: string,
    executionGroupName?: string
): AgentExecutionContext {
    const modelName = context.getModelFor(role);
    const agentName = roleLabel(role);
    const access = repositoryAccess(state, role, strategy, hypothesisId, selectedHypothesisIds);
    const strategyId = strategy?.id;

    return {
        callAI: context.callAI,
        cleanOutputByType: context.cleanOutputByType,
        parseJsonSafe: context.parseJsonSafe,
        getSelectedModel: () => modelName,
        runPrompt: async ({ promptText, isJson, images }) => {
            const executionId = nanoid(8);
            addAdaptiveLiveEvent(context, agentName, `Invoking ${agentName} agent`, 'agent_start', {
                systemInstruction: systemPrompt,
                prompt: promptText,
                modelName,
                codeExecutionEnabled: context.sandboxEnabled,
                executionId,
                executionGroupId,
                executionGroupName,
            });
            try {
                if (context.abortSignal?.aborted) throw new Error('Adaptive Deepthink process was stopped.');

                if (!context.sandboxEnabled) {
                    const response = await context.callAI(
                        [...images.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })), { text: promptText }],
                        modelName,
                        systemPrompt,
                        isJson,
                    );
                    const output = context.cleanOutputByType(response.text || '', isJson ? 'json' : undefined);
                    const outputPath = nextArtifactPath(state, artifactOutputPath(state, strategyId, role));
                    recordArtifact(state, outputPath, output);
                    recordArtifact(state, outputPath.replace(/\.md$/, '.trace.json'), JSON.stringify({
                         schema: 'adaptive_deepthink_native_agent_trace.v1',
                         agent: agentName,
                         model: modelName,
                         prompt: promptText,
                         response: output,
                    }, null, 2));
                    addAdaptiveLiveEvent(context, agentName, `${agentName} agent completed`, 'agent_complete', {
                        response: output,
                        modelName,
                        codeExecutionEnabled: false,
                        executionId,
                        executionGroupId,
                        executionGroupName,
                    });
                    return output;
                }
                const result = await runSandboxToolAgent({
                    agentName,
                    sessionId: `adaptive-${safeSegment(state.id)}-${safeSegment(agentName)}-${safeSegment(strategyId || hypothesisId || `pass-${state.passNumber}`)}`,
                    messages: [new HumanMessage(promptText)],
                    systemPrompt,
                    modelName,
                    seedFiles: seedFiles(),
                    runScopeDescription: 'same Adaptive Deepthink run',
                    repositoryAccess: access,
                    agentFilesystemRules: [
                        '- This agent is one independent role in Adaptive Deepthink.',
                        '- Its submitted final_output is passed only through the orchestration contract described in the prompt.',
                    ],
                });
                const output = isJson ? result.finalText : (result.promptText || result.finalText || result.text);
                const outputPath = nextArtifactPath(state, artifactOutputPath(state, strategyId, role));
                recordArtifact(state, outputPath, output);
                recordArtifact(state, outputPath.replace(/\.md$/, '.trace.json'), result.executionTraceText || JSON.stringify({
                    schema: 'adaptive_deepthink_sandbox_agent_trace.v1',
                    agent: agentName,
                    model: modelName,
                    prompt: promptText,
                    response: output,
                }, null, 2));
                addAdaptiveLiveEvent(context, agentName, `${agentName} agent completed`, 'agent_complete', {
                    response: result.text,
                    executionTraceText: result.executionTraceText,
                    modelName,
                    codeExecutionEnabled: true,
                    executionId,
                    executionGroupId,
                    executionGroupName,
                });
                return output;
            } catch (error) {
                const message = describeProviderError(error);
                addAdaptiveLiveEvent(context, agentName, `${agentName} agent failed: ${message}`, 'agent_error', {
                    error: message,
                    modelName,
                    codeExecutionEnabled: context.sandboxEnabled,
                    executionId,
                    executionGroupId,
                    executionGroupName,
                });
                throw error;
            }
        },
    };
}

function firstError(response: { success: boolean; error?: string }): string | null {
    return response.success ? null : (response.error || 'Agent call failed.');
}


function recentExecutionCritiques(state: AdaptiveDeepthinkState): string {
    const latestPass = Math.max(0, ...Array.from(state.executions.values()).map(record => record.passNumber));
    const records = Array.from(state.executions.values())
        .filter(record => record.passNumber === latestPass && !state.strategies.get(record.strategyId)?.saved)
        .map(record => `<Execution-Critique strategy="${record.strategyId}">\n<Execution>\n${record.execution}\n</Execution>\n<Critique>\n${record.critique}\n</Critique>\n</Execution-Critique>`);
    return records.join('\n\n') || 'No execution-critique packet exists yet.';
}

function previousExecutionCritiqueForStrategy(state: AdaptiveDeepthinkState, strategyId: string): string {
    const previous = Array.from(state.executions.values())
        .filter(record => record.strategyId === strategyId && record.passNumber < state.passNumber)
        .sort((left, right) => right.passNumber - left.passNumber)[0];
    if (!previous) return '';
    return [
        '<Previous Pass Execution-Critique>',
        '<Original Execution>',
        previous.execution,
        '</Original Execution>',
        '<Critique>',
        previous.critique,
        '</Critique>',
        '</Previous Pass Execution-Critique>',
        'Use this as diagnostic evidence. Do not reuse its correction or assume its files remain valid.',
    ].join('\n');
}

function nextStrategyId(state: AdaptiveDeepthinkState): { id: string; slotIndex: number } | null {
    for (let slotIndex = 0; slotIndex < MAX_BATCH_SIZE; slotIndex++) {
        const id = `S${slotIndex + 1}`;
        if (!state.strategies.has(id)) return { id, slotIndex };
    }
    return null;
}

function setStrategies(
    state: AdaptiveDeepthinkState,
    candidates: string[],
    replaceStrategyIds?: string[]
): string[] {
    const replacements = replaceStrategyIds?.length
        ? replaceStrategyIds
        : Array.from(state.strategies.values()).filter(strategy => !strategy.saved).map(strategy => strategy.id);
    const replacementSet = new Set(replacements);
    const oldById = new Map(state.strategies);
    replacements.forEach(id => {
        const strategy = state.strategies.get(id);
        if (strategy?.saved) throw new Error(`Saved strategy ${id} is immutable and cannot be replaced.`);
        state.strategies.delete(id);
    });

    const assigned: string[] = [];
    candidates.forEach((text, index) => {
        const replacementId = replacements[index];
        const previous = replacementId ? oldById.get(replacementId) : undefined;
        const next = previous
            ? { id: previous.id, slotIndex: previous.slotIndex }
            : nextStrategyId(state);
        if (!next) return;
        state.strategies.set(next.id, {
            id: next.id,
            text,
            slotIndex: next.slotIndex,
            saved: false,
            createdPass: previous?.createdPass || state.passNumber,
            updatedPass: state.passNumber,
        });
        assigned.push(next.id);
    });

    // Explicit replacements preserve untouched ongoing strategies. An initial
    // generation intentionally discards every unsaved candidate it replaced.
    if (!replaceStrategyIds?.length) {
        for (const [id, strategy] of state.strategies) {
            if (!strategy.saved && !assigned.includes(id) && !replacementSet.has(id)) state.strategies.delete(id);
        }
    }
    return assigned;
}

export function getDirectTextContext(): string {
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

async function executeWithRetry<T extends { success: boolean; error?: string }>(
    agentCall: () => Promise<T>,
    context: AdaptiveDeepthinkToolExecutionContext,
    agentRole: string,
    maxRetries = 2
): Promise<T> {
    let lastResponse: T | null = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        if (context.abortSignal?.aborted) {
            throw new Error('Adaptive Deepthink process was stopped.');
        }
        try {
            const response = await agentCall();
            if (response.success && (response as any).data) {
                return response;
            }
            lastResponse = response;
            const errorMsg = response.error || 'Unknown agent error';
            console.warn(`[Retry Warning] Agent ${agentRole} attempt ${attempt} failed: ${errorMsg}`);
            addAdaptiveLiveEvent(context, 'Orchestrator' as any, `Agent ${agentRole} attempt ${attempt} failed internally. Retrying... (Error: ${errorMsg})`, 'info');
        } catch (err: any) {
            const errorMsg = err?.message || String(err);
            console.warn(`[Retry Warning] Agent ${agentRole} attempt ${attempt} threw error: ${errorMsg}`);
            addAdaptiveLiveEvent(context, 'Orchestrator' as any, `Agent ${agentRole} attempt ${attempt} threw error internally. Retrying... (Error: ${errorMsg})`, 'info');
            lastResponse = { success: false, error: errorMsg } as unknown as T;
        }
    }
    return lastResponse || ({ success: false, error: 'Internal retry loop failed to complete' } as unknown as T);
}

async function generateStrategyBatch(
    state: AdaptiveDeepthinkState,
    toolCall: Extract<AdaptiveDeepthinkToolCall, { type: 'generate_strategies' }>,
    context: AdaptiveDeepthinkToolExecutionContext,
    prompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string; mimeType: string }>
): Promise<string> {
    const replaceCount = toolCall.replaceStrategyIds?.length
        ? toolCall.replaceStrategyIds.filter(id => !state.strategies.get(id)?.saved).length
        : Array.from(state.strategies.values()).filter(strategy => !strategy.saved).length;
    const occupiedAfterReplacement = state.strategies.size - replaceCount;
    const count = Math.min(toolCall.count, MAX_BATCH_SIZE - occupiedAfterReplacement);
    if (count < 1) return '[ERROR: All five strategy slots are permanently saved.]';

    const executionGroupId = `group-${nanoid(8)}`;
    const executionGroupName = 'Strategy Generation Loop';
    const taskContext = toolCall.specialContext || 'Generate the requested strategy batch.';
    state.strategyGenerationHistory = normalizeProximityHistory(state.strategyGenerationHistory);
    const generatorContext = syncAgentContext(state, context, 'strategy-generator', prompts.sys_deepthink_initialStrategy, undefined, undefined, [], executionGroupId, executionGroupName);
    const proximityContext = syncAgentContext(state, context, 'strategy-proximity', prompts.sys_deepthink_strategyProximity, undefined, undefined, [], executionGroupId, executionGroupName);
    const result = await refineWithProximity<string>({
        loops: toolCall.proximityLoops ?? DEFAULT_PROXIMITY_LOOPS,
        history: state.strategyGenerationHistory,
        generate: async (conversationHistory, revision) => {
            const generationContext = [
                taskContext,
                conversationHistory,
                revision
                    ? 'Revise the current strategies in response to the latest proximity review. Preserve valuable coverage, replace convergent or structurally weak ideas, and return the same number of distinct strategies.'
                    : '',
            ].filter(Boolean).join('\n\n');
            const response = await executeWithRetry(
                () => generateStrategiesAgent(state.question + getDirectTextContext(), count, generationContext, prompts.sys_deepthink_initialStrategy, generatorContext, images),
                context,
                'strategy-generator'
            );
            const error = firstError(response);
            if (error || !response.data) throw new Error(error || 'Strategy generator returned no data.');
            const candidates = (response.data.strategies as unknown[]).slice(0, count).map(value => String(value));
            if (!candidates.length) throw new Error('Strategy generator returned no strategies.');
            return {
                candidates,
                output: JSON.stringify({ strategies: candidates }, null, 2),
            };
        },
        review: async (candidates, conversationHistory, round) => {
            if (context.abortSignal?.aborted) throw new Error('Adaptive Deepthink process was stopped.');
            const response = await executeWithRetry(
                () => strategiesProximityAgent(
                    state.question + getDirectTextContext(),
                    candidates,
                    conversationHistory,
                    taskContext,
                    prompts.sys_deepthink_strategyProximity,
                    proximityContext,
                    images,
                ),
                context,
                'strategy-proximity'
            );
            const error = firstError(response);
            if (error || !response.data) throw new Error(error || 'Strategies proximity returned no data.');
            const review = String(response.data.review);
            recordArtifact(state, `${pathFor(state, undefined, 'strategy-proximity', `-Round-${round}`)}.md`, review);
            return review;
        },
        onHistory: history => {
            state.strategyGenerationHistory = history;
            context.notifyUpdate?.();
        },
    });

    const candidates = result.candidates;
    const assigned = setStrategies(state, candidates, toolCall.replaceStrategyIds);
    state.strategyGenerationHistory = result.history;
    recordArtifact(state, `${pathFor(state, undefined, 'strategy-generator', '-Final-Strategies')}.md`, candidates.map((strategy, index) => `## ${assigned[index] || `S${index + 1}`}\n\n${strategy}`).join('\n\n'));
    return `<Strategies pass="${state.passNumber}">\n${assigned.map(id => `<Strategy id="${id}">\n${state.strategies.get(id)?.text}\n</Strategy>`).join('\n\n')}\n</Strategies>`;
}

async function generateHypothesisBatch(
    state: AdaptiveDeepthinkState,
    toolCall: Extract<AdaptiveDeepthinkToolCall, { type: 'generate_hypothesis' }>,
    context: AdaptiveDeepthinkToolExecutionContext,
    prompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string; mimeType: string }>
): Promise<string> {
    if (!Array.from(state.executions.values()).some(record => !state.strategies.get(record.strategyId)?.saved)) {
        return '[ERROR: Hypotheses must be critique-driven. Execute and critique at least one strategy before generating hypotheses.]';
    }
    const count = Math.min(toolCall.count, MAX_BATCH_SIZE);
    const critiquePacket = recentExecutionCritiques(state);
    const baseContext = [
        toolCall.specialContext || '',
        '<Latest Execution-Critique Packet>',
        critiquePacket,
        '</Latest Execution-Critique Packet>',
        'Generate critique-driven hypotheses only. Do not inspect strategies, prior hypothesis packets, or correction output.',
    ].filter(Boolean).join('\n\n');
    const executionGroupId = `group-${nanoid(8)}`;
    const executionGroupName = 'Hypothesis Generation Loop';
    state.hypothesisGenerationHistory = normalizeProximityHistory(state.hypothesisGenerationHistory);
    const generatorContext = syncAgentContext(state, context, 'hypothesis-generator', prompts.sys_deepthink_hypothesisGeneration, undefined, undefined, [], executionGroupId, executionGroupName);
    const proximityContext = syncAgentContext(state, context, 'hypothesis-proximity', prompts.sys_deepthink_hypothesisProximity, undefined, undefined, [], executionGroupId, executionGroupName);
    const result = await refineWithProximity<string>({
        loops: toolCall.proximityLoops ?? DEFAULT_PROXIMITY_LOOPS,
        history: state.hypothesisGenerationHistory,
        version: state.passNumber,
        generate: async (conversationHistory, revision) => {
            const generationContext = [
                baseContext,
                conversationHistory,
                revision
                    ? 'Revise hypotheses against the latest proximity review. Keep them falsifiable, orthogonal, and critique-driven.'
                    : '',
            ].filter(Boolean).join('\n\n');
            const response = await executeWithRetry(
                () => generateHypothesesAgent(
                    state.question + getDirectTextContext(),
                    count,
                    generationContext,
                    prompts.sys_deepthink_hypothesisGeneration,
                    generatorContext,
                    images,
                    true,
                ),
                context,
                'hypothesis-generator'
            );
            const error = firstError(response);
            if (error || !response.data) throw new Error(error || 'Hypothesis generator returned no data.');
            const candidates = (response.data.hypotheses as unknown[]).slice(0, count).map(value => String(value));
            if (!candidates.length) throw new Error('Hypothesis generator returned no hypotheses.');
            return {
                candidates,
                output: JSON.stringify({ hypotheses: candidates }, null, 2),
            };
        },
        review: async (candidates, conversationHistory, round) => {
            if (context.abortSignal?.aborted) throw new Error('Adaptive Deepthink process was stopped.');
            const response = await executeWithRetry(
                () => hypothesesProximityAgent(
                    state.question + getDirectTextContext(),
                    candidates,
                    conversationHistory,
                    baseContext,
                    prompts.sys_deepthink_hypothesisProximity,
                    proximityContext,
                    images,
                ),
                context,
                'hypothesis-proximity'
            );
            const error = firstError(response);
            if (error || !response.data) throw new Error(error || 'Hypothesis proximity returned no data.');
            const review = String(response.data.review);
            recordArtifact(state, `${pathFor(state, undefined, 'hypothesis-proximity', `-Round-${round}`)}.md`, review);
            return review;
        },
        onHistory: history => {
            state.hypothesisGenerationHistory = history;
            context.notifyUpdate?.();
        },
    });
    const candidates = result.candidates;

    // Hypotheses are intentionally ephemeral. A new batch deletes the entire
    // previous batch and its tests; no stale corrective local minima survive.
    state.hypotheses.clear();
    state.hypothesisTestings.clear();
    state.hypothesisGenerationHistory = result.history;
    const ids = candidates.map((text, index) => {
        const id = `H${index + 1}`;
        state.hypotheses.set(id, { id, text, passNumber: state.passNumber });
        return id;
    });
    recordArtifact(state, `${pathFor(state, undefined, 'hypothesis-generator', '-Final-Hypotheses')}.md`, candidates.map((hypothesis, index) => `## ${ids[index]}\n\n${hypothesis}`).join('\n\n'));
    return `<Hypotheses pass="${state.passNumber}">\n${ids.map(id => `<Hypothesis id="${id}">\n${state.hypotheses.get(id)?.text}\n</Hypothesis>`).join('\n\n')}\n</Hypotheses>`;
}

async function testHypotheses(
    state: AdaptiveDeepthinkState,
    hypothesisIds: string[],
    context: AdaptiveDeepthinkToolExecutionContext,
    prompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string; mimeType: string }>
): Promise<string> {
    const executionGroupId = `group-${nanoid(8)}`;
    const executionGroupName = 'Hypothesis Testing Phase';

    const results = await Promise.all(hypothesisIds.slice(0, MAX_BATCH_SIZE).map(async id => {
        const hypothesis = state.hypotheses.get(id);
        if (!hypothesis) return { id, error: 'Hypothesis not found.' };
        const localHypotheses = new Map([[id, { text: hypothesis.text }]]);
        const response = await executeWithRetry(
            () => testHypothesesAgent(
                state.question + getDirectTextContext(),
                [id],
                localHypotheses,
                '',
                prompts.sys_deepthink_hypothesisTester,
                syncAgentContext(state, context, 'hypothesis-testing', prompts.sys_deepthink_hypothesisTester, undefined, id, [], executionGroupId, executionGroupName),
                images,
            ),
            context,
            'hypothesis-testing'
        );
        const error = firstError(response);
        const result = response.data?.results?.[0];
        if (error || !result?.success) return { id, error: error || result?.error || 'Hypothesis test failed.' };
        state.hypothesisTestings.set(id, { hypothesis: result.hypothesis, testing: result.testing, passNumber: state.passNumber });
        recordArtifact(state, `${pathFor(state, id, 'hypothesis-testing')}.md`, result.testing);
        return { id, testing: result.testing };
    }));
    return `<HypothesisTests pass="${state.passNumber}">\n${results.map(result => result.error
        ? `<HypothesisTest id="${result.id}" status="error">${result.error}</HypothesisTest>`
        : `<HypothesisTest id="${result.id}">\n${result.testing}\n</HypothesisTest>`).join('\n\n')}\n</HypothesisTests>`;
}

async function restoreUnsavedStrategyIfNeeded(
    state: AdaptiveDeepthinkState,
    strategy: AdaptiveStrategy,
    context: AdaptiveDeepthinkToolExecutionContext
): Promise<void> {
    const checkpoint = strategy.preCorrectionSnapshot;
    if (!context.sandboxEnabled || strategy.saved || !checkpoint || checkpoint.passNumber >= state.passNumber) return;
    await restoreSandboxRepositoryStrategy(state.id, strategyDirectory(strategy), checkpoint.commit);
    strategy.preCorrectionSnapshot = undefined;
    addAdaptiveLiveEvent(context, 'Orchestrator', `Restored ${strategy.id} to its pre-correction snapshot for pass ${state.passNumber}`, 'info');
}

async function executeOneStrategy(
    state: AdaptiveDeepthinkState,
    request: AdaptiveExecutionRequest,
    globalSpecialContext: string,
    context: AdaptiveDeepthinkToolExecutionContext,
    prompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string; mimeType: string }>
): Promise<{ strategyId: string; error?: string; record?: AdaptiveExecutionRecord }> {
    const strategy = state.strategies.get(request.strategyId);
    if (!strategy) return { strategyId: request.strategyId, error: 'Strategy not found.' };
    if (strategy.saved) return { strategyId: request.strategyId, error: 'Saved strategies are permanent and cannot be executed again.' };
    const selectedHypothesisIds = request.hypothesisIds.filter(id => state.hypothesisTestings.has(id));
    await restoreUnsavedStrategyIfNeeded(state, strategy, context);

    const executionGroupId = `group-${nanoid(8)}`;
    const executionGroupName = `Strategy ${strategy.id} Execution Loop`;

    const strategyMap = new Map([[strategy.id, { text: strategy.text }]]);
    const testMap = new Map(selectedHypothesisIds.map(id => {
        const testing = state.hypothesisTestings.get(id)!;
        return [id, { hypothesis: testing.hypothesis, testing: testing.testing }] as const;
    }));
    const execution = await executeWithRetry(
        () => executeStrategiesAgent(
            state.question + getDirectTextContext(),
            [{ strategyId: strategy.id, hypothesisIds: selectedHypothesisIds }],
            strategyMap,
            testMap,
            [
                previousExecutionCritiqueForStrategy(state, strategy.id),
                globalSpecialContext,
                request.specialContext || '',
            ].filter(Boolean).join('\n\n'),
            prompts.sys_deepthink_solutionAttempt,
            syncAgentContext(state, context, 'execution', prompts.sys_deepthink_solutionAttempt, strategy, undefined, selectedHypothesisIds, executionGroupId, executionGroupName),
            images,
        ),
        context,
        'execution'
    );
    const executionError = firstError(execution);
    const executionResult = execution.data?.results?.[0];
    if (executionError || !executionResult?.success) return { strategyId: strategy.id, error: executionError || executionResult?.error || 'Execution failed.' };
    recordArtifact(state, artifactOutputPath(state, strategy.id, 'execution'), executionResult.execution);

    const executionId = `P${state.passNumber}-${strategy.id}`;
    const executionMap = new Map([[executionId, { strategy: strategy.text, execution: executionResult.execution }]]);
    const critique = await executeWithRetry(
        () => solutionCritiqueAgent(
            state.question + getDirectTextContext(),
            [executionId],
            executionMap,
            '',
            prompts.sys_deepthink_solutionCritique,
            // The critique receives no hypothesis packet or branch special context.
            syncAgentContext(state, context, 'critique', prompts.sys_deepthink_solutionCritique, strategy, undefined, [], executionGroupId, executionGroupName),
            images,
        ),
        context,
        'critique'
    );
    const critiqueError = firstError(critique);
    const critiqueResult = critique.data?.results?.[0];
    if (critiqueError || !critiqueResult?.success) return { strategyId: strategy.id, error: critiqueError || critiqueResult?.error || 'Critique failed.' };
    recordArtifact(state, artifactOutputPath(state, strategy.id, 'critique'), critiqueResult.critique);

    if (context.sandboxEnabled) {
        const commit = await snapshotSandboxRepositoryById(state.id, `Adaptive pass ${state.passNumber} ${strategy.id} before correction`);
        if (commit) strategy.preCorrectionSnapshot = { commit, passNumber: state.passNumber };
    }
    const hypothesisEntries = selectedHypothesisIds
        .map((id, idx) => {
            const testing = state.hypothesisTestings.get(id);
            return testing
                ? `<Hypothesis ${idx + 1}>\nHypothesis: ${testing.hypothesis}\nHypothesis Testing: ${testing.testing}\n</Hypothesis ${idx + 1}>\n`
                : '';
        })
        .filter(Boolean)
        .join('\n');
    const hypothesisPacket = hypothesisEntries ? `<Full Information Packet>\n${hypothesisEntries}</Full Information Packet>` : undefined;

    const correction = await executeWithRetry(
        () => correctedSolutionsAgent(
            state.question + getDirectTextContext(),
            [executionId],
            executionMap,
            new Map([[executionId, { critique: critiqueResult.critique, hypothesisPacket }]]),
            prompts.sys_deepthink_solutionCorrection,
            syncAgentContext(state, context, 'correction', prompts.sys_deepthink_solutionCorrection, strategy, undefined, selectedHypothesisIds, executionGroupId, executionGroupName),
            images,
        ),
        context,
        'correction'
    );
    const correctionError = firstError(correction);
    const correctionResult = correction.data?.results?.[0];
    if (correctionError || !correctionResult?.success) return { strategyId: strategy.id, error: correctionError || correctionResult?.error || 'Correction failed.' };
    recordArtifact(state, artifactOutputPath(state, strategy.id, 'correction'), correctionResult.correctedSolution);

    const record: AdaptiveExecutionRecord = {
        id: executionId,
        passNumber: state.passNumber,
        strategyId: strategy.id,
        strategy: strategy.text,
        hypothesisIds: selectedHypothesisIds,
        execution: executionResult.execution,
        critique: critiqueResult.critique,
        correction: correctionResult.correctedSolution,
    };
    state.executions.set(executionId, record);
    return { strategyId: strategy.id, record };
}

async function executeStrategies(
    state: AdaptiveDeepthinkState,
    requests: AdaptiveExecutionRequest[],
    specialContext: string,
    context: AdaptiveDeepthinkToolExecutionContext,
    prompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string; mimeType: string }>
): Promise<string> {
    const unique = Array.from(new Map(requests.slice(0, MAX_BATCH_SIZE).map(request => [request.strategyId, request])).values());
    const results = await Promise.all(unique.map(request => executeOneStrategy(state, request, specialContext, context, prompts, images)));
    return `<StrategyPass pass="${state.passNumber}">\n${results.map(result => result.error
        ? `<StrategyResult id="${result.strategyId}" status="error">${result.error}</StrategyResult>`
        : `<StrategyResult id="${result.strategyId}">\n<Execution>\n${result.record!.execution}\n</Execution>\n<Critique>\n${result.record!.critique}\n</Critique>\n<Correction>\n${result.record!.correction}\n</Correction>\n</StrategyResult>`).join('\n\n')}\n</StrategyPass>`;
}

async function persistResults(
    state: AdaptiveDeepthinkState,
    context: AdaptiveDeepthinkToolExecutionContext,
    message: string
): Promise<void> {
    if (!context.sandboxEnabled) return;
    await ensureDeepthinkResultsRepository(state.id);
    await snapshotDeepthinkResultsRepository(
        state.id,
        message,
        Array.from(state.artifacts.values()).map(artifact => ({ path: artifact.path, content: artifact.content })),
    );
}

function finalizePass(state: AdaptiveDeepthinkState): string {
    const pass = state.passes.get(state.passNumber) || { passNumber: state.passNumber, finalized: false, compactedFiles: [] };
    const files = Array.from(state.artifacts.keys()).filter(path => path.startsWith(`Pass-${String(state.passNumber).padStart(2, '0')}-`));
    pass.finalized = true;
    pass.compactedFiles = files;
    pass.completedAt = Date.now();
    state.passes.set(state.passNumber, pass);
    state.compactedContextLinks = files;
    state.passNumber += 1;
    state.passes.set(state.passNumber, { passNumber: state.passNumber, finalized: false, compactedFiles: [] });
    return files.length
        ? `Pass ${pass.passNumber} finalized. Its full outputs were compacted into repository files: ${files.map(path => `[${path}]`).join(', ')}.`
        : `Pass ${pass.passNumber} finalized with no agent artifacts.`;
}

function readFiles(state: AdaptiveDeepthinkState, paths: string[]): string {
    return paths.map(path => {
        const artifact = state.artifacts.get(path);
        return artifact
            ? `<File path="${path}">\n${artifact.content}\n</File>`
            : `<File path="${path}" status="error">File not found in Adaptive Deepthink context.</File>`;
    }).join('\n\n');
}

export async function executeAdaptiveDeepthinkTool(
    toolCall: AdaptiveDeepthinkToolCall,
    state: AdaptiveDeepthinkState,
    context: AdaptiveDeepthinkToolExecutionContext,
    deepthinkPrompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string; mimeType: string }> = [],
): Promise<string> {
    try {
        let output: string;
        switch (toolCall.type) {
            case 'generate_strategies':
                output = await generateStrategyBatch(state, toolCall, context, deepthinkPrompts, images);
                break;
            case 'generate_hypothesis':
                output = await generateHypothesisBatch(state, toolCall, context, deepthinkPrompts, images);
                break;
            case 'test_hypothesis':
                output = await testHypotheses(state, toolCall.hypothesisIds, context, deepthinkPrompts, images);
                break;
            case 'execute':
                output = await executeStrategies(state, toolCall.executions, toolCall.specialContext || '', context, deepthinkPrompts, images);
                break;
            case 'save': {
                const saved: string[] = [];
                for (const id of toolCall.strategyIds) {
                    const strategy = state.strategies.get(id);
                    if (!strategy) continue;
                    strategy.saved = true;
                    saved.push(id);
                }
                output = saved.length
                    ? `<SavedStrategies>${saved.map(id => `<Strategy id="${id}" />`).join('')}</SavedStrategies>`
                    : '[ERROR: No supplied strategy IDs were available to save.]';
                break;
            }
            case 'finalize_pass_and_execute': {
                const finalized = finalizePass(state);
                await persistResults(state, context, `Adaptive Deepthink pass ${state.passNumber - 1} finalized`);
                output = `${finalized}\n\n${await executeStrategies(state, toolCall.executions, toolCall.specialContext || '', context, deepthinkPrompts, images)}`;
                break;
            }
            case 'read_files':
                output = readFiles(state, toolCall.paths);
                break;
            case 'virtual_environment': {
                if (!context.sandboxEnabled) {
                    output = '[ERROR: Virtual Environment is disabled. Enable Sandbox Terminal Environment in the Deepthink configuration.]';
                    break;
                }
                const result = await runVirtualEnvironmentCommand({
                    sessionId: `adaptive-${safeSegment(state.id)}-orchestrator`,
                    command: toolCall.command,
                    timeoutMs: toolCall.timeoutMs,
                    seedFiles: [...seedFiles(), ...globalState.filesystemContextFiles],
                    repositoryAccess: { repositoryId: state.id, fullRepositoryRead: true, fullRepositoryWrite: true },
                });
                output = `<VirtualEnvironment exitCode="${result.exitCode}" durationMs="${result.durationMs}">\n${result.stdout}${result.stderr ? `\nSTDERR:\n${result.stderr}` : ''}${result.error ? `\nERROR:\n${result.error}` : ''}\n</VirtualEnvironment>`;
                break;
            }
            case 'submit_final_output': {
                const sessionId = `adaptive-${safeSegment(state.id)}-orchestrator`;
                state.selectedSolution = expandInlineReferenceMarkers(
                    toolCall.response,
                    sessionId,
                    { repositoryId: state.id, fullRepositoryRead: true, fullRepositoryWrite: true }
                );
                state.status = 'completed';
                output = '<FinalOutputSubmitted />';
                break;
            }
        }
        await persistResults(state, context, `Adaptive Deepthink pass ${state.passNumber} update`);
        syncAdaptiveDeepthinkPipeline(state, context.pipeline);
        return output;
    } catch (error) {
        return `[ERROR: ${describeProviderError(error)}]`;
    }
}

export function createAdaptiveDeepthinkState(question: string): AdaptiveDeepthinkState {
    return {
        id: `adaptive-deepthink-${Date.now()}`,
        question,
        status: 'idle',
        passNumber: 1,
        strategies: new Map(),
        hypotheses: new Map(),
        hypothesisTestings: new Map(),
        executions: new Map(),
        passes: new Map([[1, { passNumber: 1, finalized: false, compactedFiles: [] }]]),
        artifacts: new Map(),
        strategyGenerationHistory: [],
        hypothesisGenerationHistory: [],
        compactedContextLinks: [],
    };
}

/** Project adaptive state into the existing Deepthink tabs and modals. */
export function syncAdaptiveDeepthinkPipeline(state: AdaptiveDeepthinkState, pipeline: DeepthinkPipelineState): void {
    pipeline.strategyGenerationHistory = normalizeProximityHistory(state.strategyGenerationHistory);
    pipeline.hypothesisGenerationHistory = normalizeProximityHistory(state.hypothesisGenerationHistory);
    const strategies = Array.from(state.strategies.values()).sort((left, right) => left.slotIndex - right.slotIndex);
    pipeline.initialStrategies = strategies.map(strategy => {
        const latest = Array.from(state.executions.values())
            .filter(record => record.strategyId === strategy.id)
            .sort((left, right) => right.passNumber - left.passNumber)[0];
        return {
            id: strategy.id,
            strategyText: `${strategy.text}${strategy.saved ? '\n\n> Permanently saved.' : ''}`,
            status: latest || strategy.saved ? 'completed' : 'pending',
            solutionAttempt: latest?.execution,
            solutionAttemptDisplay: latest?.execution,
            refinedSolution: latest?.correction,
            refinedSolutionDisplay: latest?.correction,
            correctionStatus: latest?.correction ? 'completed' : latest ? 'skipped' : undefined,
            solutionCritique: latest?.critique,
            solutionCritiqueDisplay: latest?.critique,
            branchVersion: 1,
            branchIterationCount: Math.max(0, ...Array.from(state.executions.values()).filter(record => record.strategyId === strategy.id).map(record => record.passNumber)),
        } as DeepthinkMainStrategyData;
    });
    pipeline.hypotheses = Array.from(state.hypotheses.values()).map(hypothesis => {
        const testing = state.hypothesisTestings.get(hypothesis.id);
        return {
            id: hypothesis.id,
            hypothesisText: hypothesis.text,
            testerAttempt: testing?.testing,
            testerAttemptDisplay: testing?.testing,
            testerStatus: testing ? 'completed' : 'pending',
            roundNumber: hypothesis.passNumber,
            globalIteration: hypothesis.passNumber,
        } as DeepthinkHypothesisData;
    });
    pipeline.solutionCritiques = Array.from(state.executions.values()).map(record => ({
        id: `critique-${record.id}`,
        mainStrategyId: record.strategyId,
        critiqueResponse: record.critique,
        critiqueResponseDisplay: record.critique,
        status: 'completed',
    } as DeepthinkSolutionCritiqueData));
    pipeline.hypothesisGenStatus = pipeline.hypotheses.length ? 'completed' : 'pending';
    pipeline.hypothesisExplorerComplete = pipeline.hypotheses.length > 0 && pipeline.hypotheses.every(hypothesis => hypothesis.testerStatus === 'completed');
    pipeline.knowledgePacket = Array.from(state.hypothesisTestings.entries()).map(([id, testing]) => `<Hypothesis id="${id}">\n${testing.hypothesis}\n\n${testing.testing}\n</Hypothesis>`).join('\n\n');
    pipeline.solutionCritiquesStatus = pipeline.solutionCritiques.length ? 'completed' : 'pending';
    if (state.selectedSolution) {
        pipeline.finalJudgedBestSolution = state.selectedSolution;
        pipeline.finalJudgingResponseText = state.selectedSolution;
        pipeline.finalJudgingStatus = 'completed';
        pipeline.status = 'completed';
    }
}
