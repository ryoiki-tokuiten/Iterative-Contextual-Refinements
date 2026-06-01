/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adaptive Deepthink - Main orchestration logic and state management
 */

import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { AgenticMessage, ResponseSegment, SystemBlock } from '../Agentic/AgenticCore';
import { messageContentToText } from '../Core/LangGraphToolRuntime';
import { globalState } from '../Core/State';
import type {
    DeepthinkPipelineState,
    DeepthinkMainStrategyData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData
} from '../Deepthink/Deepthink';
import type { AgentExecutionContext } from '../Deepthink/DeepthinkAgents';
import {
    callAI,
    getSelectedModel,
    getSelectedTemperature,
    getSelectedTopP
} from '../Routing';
import { updateControlsState } from '../UI/Controls';
import {
    createAdaptiveDeepthinkState,
    type AdaptiveDeepthinkState,
    type AdaptiveDeepthinkToolCall,
    type AdaptiveDeepthinkToolExecutionContext,
    type AdaptiveDeepthinkToolPrompts
} from './AdaptiveDeepthinkCore';
import { CustomizablePromptsAdaptiveDeepthink } from './AdaptiveDeepthinkPrompt';
import {
    createAdaptiveDeepthinkGraph,
    normalizeAdaptiveDeepthinkToolCall,
    type AdaptiveDeepthinkGraphState,
    type AdaptiveDeepthinkToolResultArtifact
} from './AdaptiveDeepthinkToolGraph';

export interface AdaptiveDeepthinkStoreState {
    id: string;
    coreState: AdaptiveDeepthinkState;
    messages: AgenticMessage[];
    isProcessing: boolean;
    isComplete: boolean;
    error?: string;
    deepthinkPipelineState: DeepthinkPipelineState;
    navigationState: {
        currentTab: string;
    };
}

let activeAdaptiveDeepthinkState: AdaptiveDeepthinkStoreState | null = null;
let abortController: AbortController | null = null;
const listeners = new Set<(state: AdaptiveDeepthinkStoreState | null) => void>();

const TOOL_MODEL_MAP: Partial<Record<AdaptiveDeepthinkToolCall['type'], keyof CustomizablePromptsAdaptiveDeepthink>> = {
    GenerateStrategies: 'model_strategyGeneration',
    GenerateHypotheses: 'model_hypothesisGeneration',
    TestHypotheses: 'model_hypothesisTesting',
    ExecuteStrategies: 'model_execution',
    SolutionCritique: 'model_solutionCritique',
    CorrectedSolutions: 'model_corrector',
    SelectBestSolution: 'model_finalJudge'
};

export function subscribeToAdaptiveDeepthinkState(listener: (state: AdaptiveDeepthinkStoreState | null) => void) {
    listeners.add(listener);
    listener(activeAdaptiveDeepthinkState);
    return () => { listeners.delete(listener); };
}

export function notifyAdaptiveDeepthinkListeners() {
    if (activeAdaptiveDeepthinkState) {
        listeners.forEach(listener => listener({ ...activeAdaptiveDeepthinkState! }));
        return;
    }

    listeners.forEach(listener => listener(null));
}

export function updateAdaptiveDeepthinkTab(tabId: string) {
    if (!activeAdaptiveDeepthinkState) {
        return;
    }

    activeAdaptiveDeepthinkState.navigationState.currentTab = tabId;
    activeAdaptiveDeepthinkState.deepthinkPipelineState.activeTabId = tabId;
    notifyAdaptiveDeepthinkListeners();
}

export function updateAdaptiveDeepthinkStrategyTab(strategyIndex: number) {
    if (!activeAdaptiveDeepthinkState) {
        return;
    }

    activeAdaptiveDeepthinkState.deepthinkPipelineState.activeStrategyTab = strategyIndex;
    notifyAdaptiveDeepthinkListeners();
}

function newMsgId(prefix = 'msg'): string {
    return `${prefix}-${nanoid(8)}`;
}

function formatToolCallDisplay(toolCall: AdaptiveDeepthinkToolCall): string {
    switch (toolCall.type) {
        case 'GenerateStrategies':
            return `GenerateStrategies(${toolCall.numStrategies})`;
        case 'GenerateHypotheses':
            return `GenerateHypotheses(${toolCall.numHypotheses})`;
        case 'TestHypotheses':
            return `TestHypotheses([${toolCall.hypothesisIds.length} hypotheses])`;
        case 'ExecuteStrategies':
            return `ExecuteStrategies([${toolCall.executions.length} strategies])`;
        case 'SolutionCritique':
            return `SolutionCritique([${toolCall.executionIds.length} solutions])`;
        case 'CorrectedSolutions':
            return `CorrectedSolutions([${toolCall.executionIds.length} solutions])`;
        case 'SelectBestSolution':
            return `SelectBestSolution([${toolCall.solutionIds.length} solutions])`;
        case 'Exit':
            return 'Exit()';
        default:
            return (toolCall as any).type;
    }
}

function buildAgentSegments(message: AIMessage): ResponseSegment[] {
    const segments: ResponseSegment[] = [];
    const narrative = messageContentToText(message.content);

    if (narrative) {
        segments.push({ kind: 'text', text: narrative });
    }

    for (const toolInvocation of message.tool_calls ?? []) {
        const toolCall = normalizeAdaptiveDeepthinkToolCall(toolInvocation.name, toolInvocation.args);
        const rawType = toolCall?.type ?? toolInvocation.name;
        const label = toolCall ? formatToolCallDisplay(toolCall) : rawType;

        segments.push({
            kind: 'tool',
            tool: {
                type: label,
                rawType
            } as any
        });
    }

    return segments;
}

function buildAgentMessage(message: AIMessage): AgenticMessage | null {
    const segments = buildAgentSegments(message);
    if (segments.length === 0) {
        return null;
    }

    const content = segments
        .filter(segment => segment.kind === 'text')
        .map(segment => segment.text)
        .join('\n')
        .trim();

    return {
        id: newMsgId('agent'),
        role: 'agent',
        content,
        timestamp: Date.now(),
        status: 'success',
        segments
    };
}

function buildSystemMessage(message: ToolMessage): AgenticMessage {
    const content = messageContentToText(message.content);
    const artifact = (message.artifact ?? undefined) as AdaptiveDeepthinkToolResultArtifact | undefined;
    const tool = artifact?.tool ?? message.name ?? 'tool';
    const isError = message.status === 'error';

    const blocks: SystemBlock[] = isError
        ? [{ kind: 'error', message: content }]
        : [{ kind: 'tool_result', tool, result: content }];

    return {
        id: newMsgId('system'),
        role: 'system',
        content,
        timestamp: Date.now(),
        status: isError ? 'error' : 'success',
        blocks
    };
}

function toAdaptiveMessage(
    message: AIMessage | ToolMessage
): AgenticMessage | null {
    if (message instanceof AIMessage) {
        return buildAgentMessage(message);
    }

    if (message instanceof ToolMessage) {
        return buildSystemMessage(message);
    }

    return null;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted');
}

function createInitialDeepthinkPipelineState(question: string): DeepthinkPipelineState {
    return {
        id: `deepthink-embedded-${Date.now()}`,
        challenge: question,
        status: 'processing',
        activeTabId: 'strategic-solver',
        challengeText: '',
        activeStrategyTab: 0,
        initialStrategies: [],
        hypotheses: [],
        solutionCritiques: [],
        redTeamEvaluations: [],
        postQualityFilterAgents: [],
        structuredSolutionPoolAgents: [],
        strategicSolverComplete: false,
        hypothesisExplorerComplete: false,
        redTeamComplete: false,
        knowledgePacket: '',
        finalJudgingStatus: 'pending',
        isStopRequested: false,
        hypothesisGenStatus: 'pending',
        dissectedSynthesisStatus: 'pending',
        solutionCritiquesStatus: 'pending'
    };
}

function parseToolResultAndUpdateState(toolCall: AdaptiveDeepthinkToolCall, toolResult: string) {
    if (!activeAdaptiveDeepthinkState) return;
    const state = activeAdaptiveDeepthinkState.deepthinkPipelineState;

    switch (toolCall.type) {
        case 'GenerateStrategies': {
            state.initialStrategies = [];
            const strategyMatches = toolResult.matchAll(/<Strategy ID: (strategy-\d+-\d+)>\s*([\s\S]*?)\s*<\/Strategy ID: \1>/g);
            for (const match of strategyMatches) {
                const strategyId = match[1];
                const strategyText = match[2].trim();
                const strategy: DeepthinkMainStrategyData = {
                    id: strategyId,
                    strategyText,
                    subStrategies: [],
                    status: 'completed',
                    isDetailsOpen: false,
                    strategyFormat: 'markdown'
                };
                state.initialStrategies.push(strategy);
            }
            break;
        }
        case 'GenerateHypotheses': {
            state.hypotheses = [];
            const hypothesisMatches = toolResult.matchAll(/<Hypothesis ID: (hypothesis-\d+-\d+)>\s*([\s\S]*?)\s*<\/Hypothesis ID: \1>/g);
            for (const match of hypothesisMatches) {
                const hypothesisId = match[1];
                const hypothesisText = match[2].trim();
                const hypothesis: DeepthinkHypothesisData = {
                    id: hypothesisId,
                    hypothesisText,
                    testerStatus: 'pending',
                    isDetailsOpen: false
                };
                state.hypotheses.push(hypothesis);
            }
            state.hypothesisGenStatus = 'completed';
            break;
        }
        case 'TestHypotheses': {
            const testMatches = toolResult.matchAll(/<(hypothesis-\d+-\d+)>\s*<Actual Hypothesis>([\s\S]*?)<\/Actual Hypothesis>\s*<Hypothesis Testing>([\s\S]*?)<\/Hypothesis Testing>\s*<\/\1>/g);
            for (const match of testMatches) {
                const hypothesisId = match[1];
                const testing = match[3].trim();
                const hypothesis = state.hypotheses.find(h => h.id === hypothesisId);
                if (hypothesis) {
                    hypothesis.testerAttempt = testing;
                    hypothesis.testerStatus = 'completed';
                }
            }
            if (state.hypotheses.length > 0) {
                let knowledgePacket = '<Full Information Packet>\n\n';
                state.hypotheses.forEach((hyp, idx) => {
                    if (hyp.testerAttempt) {
                        knowledgePacket += `<Hypothesis ${idx + 1}>\nHypothesis: ${hyp.hypothesisText}\n\nHypothesis Testing: ${hyp.testerAttempt}\n</Hypothesis ${idx + 1}>\n\n`;
                    }
                });
                knowledgePacket += '</Full Information Packet>';
                state.knowledgePacket = knowledgePacket;
                state.hypothesisExplorerComplete = true;
            }
            break;
        }
        case 'ExecuteStrategies': {
            state.initialStrategies.forEach(strategy => {
                strategy.subStrategies.forEach(sub => {
                    sub.solutionAttempt = undefined;
                    sub.refinedSolution = undefined;
                });
            });
            const executionMatches = toolResult.matchAll(/<Execution ID: (execution-strategy-\d+-\d+)>\s*([\s\S]*?)\s*<\/Execution ID: \1>/g);
            for (const match of executionMatches) {
                const executionId = match[1];
                const execution = match[2].trim();
                const strategyIdMatch = executionId.match(/execution-(strategy-\d+-\d+)/);
                if (strategyIdMatch) {
                    const strategyId = strategyIdMatch[1];
                    const strategy = state.initialStrategies.find(s => s.id === strategyId);
                    if (strategy) {
                        let subStrategy = strategy.subStrategies[0];
                        if (!subStrategy) {
                            subStrategy = {
                                id: `${strategyId}-sub1`,
                                subStrategyText: strategy.strategyText,
                                status: 'completed',
                                isDetailsOpen: false,
                                subStrategyFormat: 'markdown'
                            } as DeepthinkSubStrategyData;
                            strategy.subStrategies.push(subStrategy);
                        }
                        subStrategy.solutionAttempt = execution;
                        subStrategy.status = 'completed';
                    }
                }
            }
            break;
        }
        case 'SolutionCritique': {
            const critiqueContent = toolResult.replace(/<Solution Critiques>|<\/Solution Critiques>/g, '').trim();
            if (critiqueContent) {
                state.dissectedObservationsSynthesis = critiqueContent;
                state.dissectedSynthesisStatus = 'completed';
                state.solutionCritiquesStatus = 'completed';
                state.solutionCritiques = [];
                state.initialStrategies.forEach((strategy) => {
                    strategy.subStrategies.forEach((subStrategy) => {
                        if (subStrategy.solutionAttempt) {
                            state.solutionCritiques.push({
                                id: `critique-${subStrategy.id}`,
                                subStrategyId: subStrategy.id,
                                mainStrategyId: strategy.id,
                                critiqueResponse: critiqueContent,
                                status: 'completed'
                            });
                        }
                    });
                });
            }
            break;
        }
        case 'CorrectedSolutions': {
            state.initialStrategies.forEach(strategy => {
                strategy.subStrategies.forEach(sub => {
                    sub.refinedSolution = undefined;
                    sub.selfImprovementStatus = undefined;
                });
            });
            const correctedMatches = toolResult.matchAll(/<(execution-strategy-\d+-\d+):Corrected>\s*([\s\S]*?)\s*<\/\1:Corrected>/g);
            for (const match of correctedMatches) {
                const executionId = match[1];
                const correctedSolution = match[2].trim();
                const strategyIdMatch = executionId.match(/execution-(strategy-\d+-\d+)/);
                if (strategyIdMatch) {
                    const strategyId = strategyIdMatch[1];
                    const strategy = state.initialStrategies.find(s => s.id === strategyId);
                    if (strategy && strategy.subStrategies[0]) {
                        strategy.subStrategies[0].refinedSolution = correctedSolution;
                        strategy.subStrategies[0].selfImprovementStatus = 'completed';
                    }
                }
            }
            break;
        }
        case 'SelectBestSolution': {
            const solutionMatch = toolResult.match(/<Best Solution Selected>\s*([\s\S]*?)\s*<\/Best Solution Selected>/);
            if (solutionMatch) {
                let selectedText = solutionMatch[1].trim();
                selectedText = selectedText.replace(/<Solution \d+ ID:.*?>/g, '');
                selectedText = selectedText.replace(/<\/Solution \d+>/g, '');
                selectedText = selectedText.replace(/Strategy:.*?\n\n/g, '');
                selectedText = selectedText.replace(/Corrected Solution:/g, '');
                selectedText = selectedText.trim();

                state.finalJudgedBestSolution = selectedText;
                state.finalJudgingStatus = 'completed';
                state.finalJudgingResponseText = selectedText;
                state.status = 'completed';

                const strategyIdMatch = toolResult.match(/strategy-(\d+-\d+)/);
                if (strategyIdMatch) {
                    state.finalJudgedBestStrategyId = strategyIdMatch[0];
                }
            }
            break;
        }
        case 'Exit':
            state.status = 'completed';
            break;
    }
}

function createDeepthinkPrompts(customPrompts: CustomizablePromptsAdaptiveDeepthink): AdaptiveDeepthinkToolPrompts {
    return {
        sys_deepthink_initialStrategy: customPrompts.sys_adaptiveDeepthink_strategyGeneration,
        user_deepthink_initialStrategy: '',
        sys_deepthink_hypothesisGeneration: customPrompts.sys_adaptiveDeepthink_hypothesisGeneration,
        user_deepthink_hypothesisGeneration: '',
        sys_deepthink_hypothesisTester: customPrompts.sys_adaptiveDeepthink_hypothesisTesting,
        user_deepthink_hypothesisTester: '',
        sys_deepthink_solutionAttempt: customPrompts.sys_adaptiveDeepthink_execution,
        user_deepthink_solutionAttempt: '',
        sys_deepthink_solutionCritique: customPrompts.sys_adaptiveDeepthink_solutionCritique,
        user_deepthink_solutionCritique: '',
        sys_deepthink_selfImprovement: customPrompts.sys_adaptiveDeepthink_corrector,
        user_deepthink_selfImprovement: '',
        sys_deepthink_finalJudge: customPrompts.sys_adaptiveDeepthink_finalJudge
    };
}

function createBaseExecutionContext(): AgentExecutionContext {
    return {
        callAI: callAI as any,
        cleanOutputByType: (raw: string) => raw,
        parseJsonSafe: (raw: string) => {
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        },
        getSelectedTemperature,
        getSelectedModel,
        getSelectedTopP
    };
}

function createToolExecutionContext(
    baseContext: AgentExecutionContext,
    customPrompts: CustomizablePromptsAdaptiveDeepthink,
    toolCall: AdaptiveDeepthinkToolCall
): AdaptiveDeepthinkToolExecutionContext {
    const modelKey = TOOL_MODEL_MAP[toolCall.type];
    const selectedModelOverride = modelKey ? customPrompts[modelKey] : null;

    return {
        ...baseContext,
        getSelectedModel: () => selectedModelOverride || getSelectedModel()
    };
}

async function syncGraphState(graphState: AdaptiveDeepthinkGraphState, processedMessages: number) {
    if (!activeAdaptiveDeepthinkState) {
        return;
    }

    const nextMessages = [...activeAdaptiveDeepthinkState.messages];

    for (const message of graphState.messages.slice(processedMessages)) {
        if (message instanceof ToolMessage) {
            const artifact = (message.artifact ?? undefined) as AdaptiveDeepthinkToolResultArtifact | undefined;
            const content = messageContentToText(message.content);
            if (artifact?.toolCall && message.status !== 'error' && artifact.toolCall.type !== 'Exit') {
                parseToolResultAndUpdateState(artifact.toolCall, content);
            }
        }

        if (message instanceof AIMessage || message instanceof ToolMessage) {
            const mapped = toAdaptiveMessage(message);
            if (mapped) {
                nextMessages.push(mapped);
            }
        }
    }

    activeAdaptiveDeepthinkState.messages = nextMessages;
    activeAdaptiveDeepthinkState.coreState = graphState.coreState;
    notifyAdaptiveDeepthinkListeners();
}

export async function startAdaptiveDeepthinkProcess(
    question: string,
    customPrompts: CustomizablePromptsAdaptiveDeepthink,
    images: Array<{ base64: string, mimeType: string }> = []
) {
    if (activeAdaptiveDeepthinkState) {
        stopAdaptiveDeepthinkProcess();
    }
    if (!question || globalState.isAdaptiveDeepthinkRunning) {
        return;
    }

    const coreState = createAdaptiveDeepthinkState(question);
    coreState.status = 'processing';

    activeAdaptiveDeepthinkState = {
        id: coreState.id,
        coreState,
        messages: [],
        isProcessing: true,
        isComplete: false,
        deepthinkPipelineState: createInitialDeepthinkPipelineState(question),
        navigationState: {
            currentTab: 'strategic-solver'
        }
    };

    globalState.isAdaptiveDeepthinkRunning = true;
    updateControlsState();
    abortController = new AbortController();
    notifyAdaptiveDeepthinkListeners();

    void runAdaptiveDeepthinkGraph(question, customPrompts, images).catch(error => {
        console.error('Adaptive Deepthink Error:', error);
    });
}

async function runAdaptiveDeepthinkGraph(
    question: string,
    customPrompts: CustomizablePromptsAdaptiveDeepthink,
    images: Array<{ base64: string, mimeType: string }>
) {
    if (!activeAdaptiveDeepthinkState || !globalState.isAdaptiveDeepthinkRunning) {
        return;
    }

    let finalGraphState: AdaptiveDeepthinkGraphState | null = null;

    try {
        const deepthinkPrompts = createDeepthinkPrompts(customPrompts);
        const baseContext = createBaseExecutionContext();
        const modelName = customPrompts.model_main || getSelectedModel();
        const temperature = getSelectedTemperature();
        const topP = getSelectedTopP();

        const graph = createAdaptiveDeepthinkGraph({
            modelName,
            temperature,
            topP,
            systemPrompt: customPrompts.sys_adaptiveDeepthink_main,
            deepthinkPrompts,
            images,
            createExecutionContext: toolCall => createToolExecutionContext(baseContext, customPrompts, toolCall)
        });

        const initialGraphInput = {
            messages: [new HumanMessage(`Core Challenge:\n${question}`)],
            coreState: activeAdaptiveDeepthinkState.coreState,
            shouldExit: false
        };

        let processedMessages = 0;
        const stream = await graph.stream(initialGraphInput, {
            streamMode: 'values',
            recursionLimit: 48,
            signal: abortController?.signal
        });

        for await (const graphState of stream) {
            finalGraphState = graphState as AdaptiveDeepthinkGraphState;
            await syncGraphState(finalGraphState, processedMessages);
            processedMessages = finalGraphState.messages.length;

            if (abortController?.signal.aborted || !activeAdaptiveDeepthinkState) {
                break;
            }
        }

        if (!activeAdaptiveDeepthinkState) {
            return;
        }

        if (finalGraphState) {
            activeAdaptiveDeepthinkState.coreState = finalGraphState.coreState;
            activeAdaptiveDeepthinkState.coreState.status = activeAdaptiveDeepthinkState.coreState.error ? 'error' : 'completed';
            activeAdaptiveDeepthinkState.isProcessing = false;
            activeAdaptiveDeepthinkState.isComplete = true;
            activeAdaptiveDeepthinkState.error = undefined;
        } else {
            activeAdaptiveDeepthinkState.isProcessing = false;
            activeAdaptiveDeepthinkState.isComplete = true;
        }

        notifyAdaptiveDeepthinkListeners();
    } catch (error) {
        if (!isAbortError(error) && !abortController?.signal.aborted && activeAdaptiveDeepthinkState) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            activeAdaptiveDeepthinkState.messages = [
                ...activeAdaptiveDeepthinkState.messages,
                {
                    id: newMsgId('system'),
                    role: 'system',
                    content: message,
                    timestamp: Date.now(),
                    status: 'error',
                    blocks: [{ kind: 'error', message }]
                }
            ];
            activeAdaptiveDeepthinkState.coreState.status = 'error';
            activeAdaptiveDeepthinkState.coreState.error = message;
            activeAdaptiveDeepthinkState.isProcessing = false;
            activeAdaptiveDeepthinkState.isComplete = true;
            activeAdaptiveDeepthinkState.error = message;
            notifyAdaptiveDeepthinkListeners();
        }
    } finally {
        globalState.isAdaptiveDeepthinkRunning = false;
        updateControlsState();
        abortController = null;
    }
}

export function stopAdaptiveDeepthinkProcess() {
    globalState.isAdaptiveDeepthinkRunning = false;
    abortController?.abort();
    abortController = null;
    updateControlsState();

    if (!activeAdaptiveDeepthinkState) {
        return;
    }

    activeAdaptiveDeepthinkState.isProcessing = false;
    activeAdaptiveDeepthinkState.isComplete = true;
    activeAdaptiveDeepthinkState.coreState.status = 'completed';
    notifyAdaptiveDeepthinkListeners();
}

export function cleanupAdaptiveDeepthinkMode() {
    stopAdaptiveDeepthinkProcess();
    activeAdaptiveDeepthinkState = null;
    notifyAdaptiveDeepthinkListeners();
}

export function getAdaptiveDeepthinkState(): AdaptiveDeepthinkStoreState | null {
    return activeAdaptiveDeepthinkState;
}

function restoreMap<T>(value: unknown): Map<string, T> {
    if (value instanceof Map) {
        return new Map(value);
    }

    if (Array.isArray(value)) {
        return new Map(value as Array<[string, T]>);
    }

    if (value && typeof value === 'object') {
        return new Map(Object.entries(value as Record<string, T>));
    }

    return new Map();
}

function normalizeImportedAdaptiveState(state: AdaptiveDeepthinkStoreState): AdaptiveDeepthinkStoreState {
    const question = state.coreState?.question || '';
    const coreState = state.coreState ?? createAdaptiveDeepthinkState(question);

    coreState.strategies = restoreMap(coreState.strategies);
    coreState.hypotheses = restoreMap(coreState.hypotheses);
    coreState.hypothesisTestings = restoreMap(coreState.hypothesisTestings);
    coreState.executions = restoreMap(coreState.executions);
    coreState.critiques = restoreMap(coreState.critiques);
    coreState.correctedSolutions = restoreMap(coreState.correctedSolutions);

    return {
        ...state,
        coreState,
        messages: Array.isArray(state.messages) ? state.messages : [],
        deepthinkPipelineState: state.deepthinkPipelineState ?? createInitialDeepthinkPipelineState(question),
        navigationState: state.navigationState ?? {
            currentTab: state.deepthinkPipelineState?.activeTabId || 'strategic-solver'
        },
        isProcessing: false
    };
}

export function setAdaptiveDeepthinkStateForImport(state: AdaptiveDeepthinkStoreState | null) {
    if (state) {
        activeAdaptiveDeepthinkState = normalizeImportedAdaptiveState(state);
        globalState.isAdaptiveDeepthinkRunning = false;
    } else {
        activeAdaptiveDeepthinkState = null;
    }
    notifyAdaptiveDeepthinkListeners();
}
