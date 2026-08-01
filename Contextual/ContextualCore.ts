/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { callAI, getSelectedModel, getSelectedTemperature, getSelectedTopP } from '../Routing';
import { updateControlsState } from '../UI/Controls';
import { globalState } from '../Core/State';
import { CustomizablePromptsContextual } from './ContextualPrompts';
import { isContextualSandboxToolEnabled, runContextualSandboxToolAgent, snapshotSandboxRepositoryById, type SandboxRepositoryAccess } from '../Core/SandboxToolRuntime';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { messageContentToText } from '../Core/LangGraphToolRuntime';
import { describeProviderError } from '../Core/ProviderError';

export interface ContentHistoryEntry {
    content: string;
    title: string;
    timestamp: number;
}

export interface HistoryMessage {
    role: 'system' | 'assistant' | 'user';
    content: string;
    rawParts?: any[];
}

export interface ContextualState {
    id: string;
    initialUserRequest: string;
    initialMainGeneration: string;
    currentBestGeneration: string;
    currentBestSuggestions: string;
    allIterativeSuggestions: string[];
    mainGeneratorHistory: HistoryMessage[];
    iterativeAgentHistory: HistoryMessage[];
    memoryAgentHistory: HistoryMessage[];
    strategicPoolAgentHistory: HistoryMessage[];
    currentMemory: string;
    memorySnapshots: MemorySnapshot[];
    currentStrategicPool: string;
    allStrategicPools: string[];
    iterationCount: number;
    isProcessing: boolean;
    isRunning: boolean;
    messages: ContextualMessage[];
    contentHistory: ContentHistoryEntry[];
}

export type ContextualSystemBlock =
    | { kind: 'error'; message: string }
    | { kind: 'info'; message: string };

export interface CodeExecutionPart {
    code: string;
    language: string;
    output?: string;
}

export interface ContextualMessage {
    id: string;
    role: 'main_generator' | 'iterative_agent' | 'memory_agent' | 'strategic_pool_agent' | 'system';
    content: string;
    timestamp: number;
    iterationNumber: number;
    status?: 'success' | 'error' | 'processing';
    blocks?: ContextualSystemBlock[];
    codeExecution?: CodeExecutionPart[];
    executionTraceText?: string;
}

interface ContextualAgentCallResult {
    text: string;
    promptText?: string;
    finalText: string;
    geminiContent?: any;
    executionTraceText?: string;
}

export interface MemorySnapshot {
    memory: string;
    finalGeneration: string;
    condensePoint: number;
}

export function createInitialContextualState(initialUserRequest: string): ContextualState {
    return {
        id: `contextual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        initialUserRequest,
        initialMainGeneration: '',
        currentBestGeneration: '',
        currentBestSuggestions: '',
        allIterativeSuggestions: [],
        mainGeneratorHistory: [],
        iterativeAgentHistory: [],
        memoryAgentHistory: [],
        strategicPoolAgentHistory: [],
        currentMemory: '',
        memorySnapshots: [],
        currentStrategicPool: '',
        allStrategicPools: [],
        iterationCount: 0,
        isProcessing: false,
        isRunning: false,
        messages: [],
        contentHistory: []
    };
}

let activeContextualState: ContextualState | null = null;
let onStateUpdated: ((state: ContextualState) => void) | null = null;
let abortController: AbortController | null = null;
let contextualCustomPrompts: CustomizablePromptsContextual | null = null;

export function setContextualStateUpdateCallback(cb: ((state: ContextualState) => void) | null) {
    onStateUpdated = cb;
}

function newMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildInitialContextualRequest(initialUserRequest: string): string {
    if (isContextualSandboxToolEnabled()) return `Initial User Request:\n${initialUserRequest}`;
    const textFiles = globalState.directContextFiles.filter(file => file.mimeType.startsWith('text/') || file.mimeType === 'application/json');
    if (!textFiles.length) return `Initial User Request:\n${initialUserRequest}`;
    const decoder = new TextDecoder();
    const directText = textFiles.map(file => {
        try {
            const binary = atob(file.base64);
            return `\n\n--- ${file.name || 'uploaded text file'} ---\n${decoder.decode(Uint8Array.from(binary, char => char.charCodeAt(0)))}\n--- end file ---`;
        } catch {
            return `\n\n--- ${file.name || 'uploaded text file'} ---\n[Unable to decode file]`;
        }
    }).join('');
    return `Initial User Request:\n${initialUserRequest}\n\nDirect context files:${directText}`;
}

function getContextualSandboxSessionId(agentName: string): string {
    if (!activeContextualState) return '';
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `ctx-sess-${activeContextualState.id}-${safeName}`;
}

function getContextualSandboxRepositoryAccess(agentName: string): SandboxRepositoryAccess | undefined {
    if (!activeContextualState) return undefined;

    switch (agentName) {
        case 'Main Generator':
            return {
                repositoryId: activeContextualState.id,
                agentDirectory: 'Correction',
                readableDirectories: ['Critique', 'SolutionPool', 'MemoryBank'],
            };

        case 'Iterative Agent':
            return {
                repositoryId: activeContextualState.id,
                agentDirectory: 'Critique',
                readableDirectories: ['Correction', 'MemoryBank'],
            };

        case 'Strategic Pool Agent':
            return {
                repositoryId: activeContextualState.id,
                agentDirectory: 'SolutionPool',
                readableDirectories: ['Correction', 'Critique', 'MemoryBank'],
            };

        case 'Memory Agent':
            return {
                repositoryId: activeContextualState.id,
                agentDirectory: 'MemoryBank',
                readableDirectories: ['Correction', 'Critique', 'SolutionPool'],
            };

        default:
            return {
                repositoryId: activeContextualState.id,
                agentDirectory: agentName.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'Agent',
                readableDirectories: [],
            };
    }
}

const RETRY_DELAYS_MS = [30_000, 60_000, 5 * 60_000] as const;
const MAX_RETRIES = RETRY_DELAYS_MS.length;
const STANDARD_AGENT_TIMEOUT_MS = 15 * 60_000;
const SANDBOX_AGENT_TIMEOUT_MS = 30 * 60_000;

let mainGeneratorMessages: BaseMessage[] = [];
let iterativeAgentMessages: BaseMessage[] = [];
let strategicPoolMessages: BaseMessage[] = [];
let turnsSinceLastCondense = 0;
let condenseCount = 0;

function getContextualRetryDelay(attempt: number): number {
    return RETRY_DELAYS_MS[attempt] ?? 0;
}

function withContextualTimeout<T>(promise: Promise<T>, timeoutMs: number, agentName: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${Math.round(timeoutMs / 60_000)} minutes: ${agentName}`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

export async function startContextualProcess(
    initialUserRequest: string,
    customPrompts: CustomizablePromptsContextual
): Promise<ContextualAgentCallResult | null> {
    if (!customPrompts) {
        throw new Error('Custom prompts not provided to Contextual Refinement');
    }

    if (!initialUserRequest || globalState.isContextualRunning) return null;

    contextualCustomPrompts = customPrompts;

    activeContextualState = createInitialContextualState(initialUserRequest);
    activeContextualState.isRunning = true;
    globalState.isContextualRunning = true;
    updateControlsState();
    abortController = new AbortController();

    // Initialize the isolated histories
    const initialRequestMessage = buildInitialContextualRequest(initialUserRequest);
    mainGeneratorMessages = [new HumanMessage(initialRequestMessage)];
    iterativeAgentMessages = [new HumanMessage(initialRequestMessage)];
    strategicPoolMessages = [new HumanMessage(initialRequestMessage)];
    
    turnsSinceLastCondense = 0;
    condenseCount = 0;

    if (onStateUpdated) onStateUpdated(activeContextualState);

    await runContextualLoop();
    return null;
}

export function stopContextualProcess() {
    if (abortController) {
        abortController.abort();
    }
    globalState.isContextualRunning = false;
    if (activeContextualState) {
        activeContextualState.isRunning = false;
        activeContextualState.isProcessing = false;
        if (onStateUpdated) onStateUpdated(activeContextualState);
    }
    updateControlsState();
}

export function getContextualState(): ContextualState | null {
    return activeContextualState;
}

export function setContextualStateForImport(state: ContextualState | null) {
    activeContextualState = state;
    if (state) {
        state.isRunning = false;
        state.isProcessing = false;
    }
    globalState.isContextualRunning = false;
    if (onStateUpdated && state) onStateUpdated(state);
}

function getAgentPromptText(result: ContextualAgentCallResult): string {
    return result.promptText || result.text;
}

async function snapshotContextualIteration(iteration: number): Promise<void> {
    if (!activeContextualState || !isContextualSandboxToolEnabled()) return;
    try {
        await snapshotSandboxRepositoryById(activeContextualState.id, `Contextual iteration ${iteration}`);
    } catch (error) {
        console.warn(`Failed to snapshot Contextual iteration ${iteration}:`, error);
    }
}

async function runContextualLoop() {
    if (!activeContextualState || !globalState.isContextualRunning) return;

    while (globalState.isContextualRunning && activeContextualState) {
        try {
            if (!globalState.isContextualRunning || abortController?.signal.aborted) {
                break;
            }

            activeContextualState.isProcessing = true;
            activeContextualState.iterationCount++;
            if (onStateUpdated) onStateUpdated({ ...activeContextualState });

            // ---------------------------------------------------------
            // 1: MAIN GENERATOR AGENT
            // ---------------------------------------------------------
            const mainGenerationResult = await callContextualAgent('Main Generator', mainGeneratorMessages, contextualCustomPrompts!.sys_contextual_mainGenerator);

            if (!mainGenerationResult || abortController?.signal.aborted || !globalState.isContextualRunning) break;

            const mainGeneration = mainGenerationResult.text;
            const mainGenerationPromptText = getAgentPromptText(mainGenerationResult);
            const mainSubmittedMessage = new AIMessage(mainGenerationPromptText);
            
            if (activeContextualState.iterationCount === 1) {
                activeContextualState.initialMainGeneration = mainGeneration;
            }

            activeContextualState.currentBestGeneration = mainGeneration;
            activeContextualState.contentHistory.push({
                content: mainGeneration,
                title: `Iteration ${activeContextualState.iterationCount} - Main Generation`,
                timestamp: Date.now()
            });

            const mainMsg: ContextualMessage = {
                id: newMessageId('main'),
                role: 'main_generator',
                content: mainGeneration,
                timestamp: Date.now(),
                iterationNumber: activeContextualState.iterationCount,
                codeExecution: mainGenerationResult.geminiContent?.parts,
                executionTraceText: mainGenerationResult.executionTraceText
            };
            activeContextualState.messages.push(mainMsg);
            
            // Distribute only the submitted final output, never the private tool trajectory.
            mainGeneratorMessages.push(mainSubmittedMessage);
            iterativeAgentMessages.push(new HumanMessage(`Current Main Generator final output:\n${mainGenerationPromptText}`));
            
            if (onStateUpdated) onStateUpdated({ ...activeContextualState });
            if (abortController?.signal.aborted || !globalState.isContextualRunning) break;

            // ---------------------------------------------------------
            // 2: ITERATIVE AGENT (CRITIQUE)
            // ---------------------------------------------------------
            iterativeAgentMessages.push(new HumanMessage("Please critique the submitted solution above, including any referenced artifacts that are relevant to the critique."));
            
            const suggestionsResult = await callContextualAgent('Iterative Agent', iterativeAgentMessages, contextualCustomPrompts!.sys_contextual_iterativeAgent);

            if (!suggestionsResult || abortController?.signal.aborted || !globalState.isContextualRunning) break;

            const suggestions = suggestionsResult.text;
            const suggestionsPromptText = getAgentPromptText(suggestionsResult);
            const suggestionsSubmittedMessage = new AIMessage(suggestionsPromptText);

            activeContextualState.currentBestSuggestions = suggestions;
            activeContextualState.allIterativeSuggestions.push(suggestions);

            const iterMsg: ContextualMessage = {
                id: newMessageId('iter'),
                role: 'iterative_agent',
                content: suggestions,
                timestamp: Date.now(),
                iterationNumber: activeContextualState.iterationCount,
                executionTraceText: suggestionsResult.executionTraceText
            };
            activeContextualState.messages.push(iterMsg);
            
            // Keep only the submitted critique in the critique agent's own history.
            iterativeAgentMessages.push(suggestionsSubmittedMessage);

            if (onStateUpdated) onStateUpdated({ ...activeContextualState });
            if (abortController?.signal.aborted || !globalState.isContextualRunning) break;

            // ---------------------------------------------------------
            // 3: STRATEGIC POOL AGENT
            // ---------------------------------------------------------
            // Strategic pool receives the generation and critique as text observations
            const stratObservation = [
                `## Observation: Current Main Generation`,
                mainGenerationPromptText,
                '',
                `## Observation: Solution Critique`,
                suggestionsPromptText,
                '',
                `## Deep Analysis Task`,
                "Study the submitted solution, critique, and any referenced artifacts above carefully:",
                '- What unexplored strategic territories remain?',
                '',
                '## Strategic Pool Evolution Task',
                'Based on your deep observation, UPDATE and EVOLVE your strategic pool with N strategies:',
                '- If a strategy was well-explored, replace it with something more orthogonal',
                '- If a strategy was ignored or poorly attempted, keep it but reframe more compellingly',
                "- If they're fixated on one approach, propose radical departures",
                '- Progressively expand into more unexpected domains with each iteration',
                "- Focus on what they HAVEN'T tried, not what they have",
                '',
                'Generate N evolved strategies that push exploration further.'
            ].join('\n');
            
            strategicPoolMessages.push(new HumanMessage(stratObservation));

            const strategicPoolResult = await callContextualAgent('Strategic Pool Agent', strategicPoolMessages, contextualCustomPrompts!.sys_contextual_solutionPoolAgent);

            if (!strategicPoolResult || abortController?.signal.aborted || !globalState.isContextualRunning) break;

            const strategicPool = strategicPoolResult.text;
            const strategicPoolPromptText = getAgentPromptText(strategicPoolResult);
            const stratSubmittedMessage = new AIMessage(strategicPoolPromptText);

            if ((strategicPoolResult.finalText || strategicPool).trim() === '<<<Exit>>>') {
                const exitMsg: ContextualMessage = {
                    id: newMessageId('system'),
                    role: 'system',
                    content: 'Strategic Pool Agent has detected that the Solution Critique found no flaws 3 times consecutively. Process completed successfully.',
                    timestamp: Date.now(),
                    iterationNumber: activeContextualState.iterationCount,
                    status: 'success',
                    blocks: [{ kind: 'info', message: 'Process completed: Solution Critique found no flaws 3 times consecutively.' }]
                };
                activeContextualState.messages.push(exitMsg);
                activeContextualState.isProcessing = false;
                await snapshotContextualIteration(activeContextualState.iterationCount);
                if (onStateUpdated) onStateUpdated({ ...activeContextualState });
                stopContextualProcess();
                break;
            }

            activeContextualState.currentStrategicPool = strategicPool;
            activeContextualState.allStrategicPools.push(strategicPool);

            const stratMsg: ContextualMessage = {
                id: newMessageId('strat'),
                role: 'strategic_pool_agent',
                content: strategicPool,
                timestamp: Date.now(),
                iterationNumber: activeContextualState.iterationCount,
                executionTraceText: strategicPoolResult.executionTraceText
            };
            activeContextualState.messages.push(stratMsg);

            // Keep only the submitted pool output in the pool agent's own history.
            strategicPoolMessages.push(stratSubmittedMessage);

            // ---------------------------------------------------------
            // 4: LOOP PREP & CONDENSATION
            // ---------------------------------------------------------
            // Now, we provide the Critique and Strategies to the Main Generator
            const combinedCritique = [
                suggestionsPromptText,
                '',
                '---',
                '',
                '## Strategic Pool',
                'The following 5 strategies have been generated to expand your solution exploration:',
                '',
                strategicPoolPromptText
            ].join('\n');
            
            mainGeneratorMessages.push(new HumanMessage(combinedCritique));

            turnsSinceLastCondense++;
            if (turnsSinceLastCondense >= 10) {
                // Build a fresh memory agent context
                const completeIterations = activeContextualState.messages.filter(m => m.role === 'main_generator' || m.role === 'iterative_agent');
                // The Memory Agent only sees submitted outputs; private sandbox traces stay out of condensation.
                const memoryPrompt = [
                    `Initial User Request:\n${activeContextualState.initialUserRequest}`,
                    '',
                    ...activeContextualState.memorySnapshots.map((snapshot, idx) => 
                        `Memory V${idx + 1}:\n${snapshot.memory}\n\nFinal Main Generation after Memory V${idx + 1}:\n${snapshot.finalGeneration}`
                    ),
                    '',
                    'Recent Iterations to Analyze:',
                    ...completeIterations.map(m => `[Iteration ${m.iterationNumber}] ${m.role === 'main_generator' ? 'Main Generation' : 'Critique'}:\n${m.content}`),
                    '',
                    'Task: Create an evolving memory document summarizing what worked and what didn\'t based on these iteration texts.'
                ].join('\n');

                const memoryResult = await callContextualAgent('Memory Agent', [new HumanMessage(memoryPrompt)], contextualCustomPrompts!.sys_contextual_memoryAgent);
                
                if (memoryResult && !abortController?.signal.aborted && globalState.isContextualRunning) {
                    const memoryText = memoryResult.text;
                    activeContextualState.currentMemory = memoryText;
                    activeContextualState.memorySnapshots.push({
                        memory: memoryText,
                        finalGeneration: activeContextualState.currentBestGeneration,
                        condensePoint: activeContextualState.iterationCount
                    });
                    
                    const memMsg: ContextualMessage = {
                        id: newMessageId('mem'),
                        role: 'memory_agent',
                        content: memoryText,
                        timestamp: Date.now(),
                        iterationNumber: activeContextualState.iterationCount,
                        executionTraceText: memoryResult.executionTraceText
                    };
                    activeContextualState.messages.push(memMsg);
                    
                    // Condense the isolated arrays
                    const memoryCondenseMessage = new HumanMessage(`Memory Summary (What worked and what didn't):\n${memoryText}`);
                    const initialReqMessage = new HumanMessage(`Initial User Request:\n${activeContextualState.initialUserRequest}`);
                    
                    mainGeneratorMessages = [
                        initialReqMessage,
                        memoryCondenseMessage,
                        new HumanMessage(`Latest Context:\n`),
                        mainSubmittedMessage,
                        new HumanMessage(combinedCritique)
                    ];
                    
                    iterativeAgentMessages = [
                        initialReqMessage,
                        memoryCondenseMessage,
                        new HumanMessage(`Latest Context:\n`),
                        new HumanMessage(`Current Main Generator final output:\n${mainGenerationPromptText}`),
                        suggestionsSubmittedMessage
                    ];
                    
                    // Strategic Pool evaluates the current submitted outputs, so reset to the latest submitted pool state.
                    strategicPoolMessages = [
                        initialReqMessage,
                        memoryCondenseMessage,
                        new HumanMessage(`Latest Strategic Pool Context:\n`),
                        stratSubmittedMessage
                    ];

                    turnsSinceLastCondense = 0;
                    condenseCount++;
                }
            }

            activeContextualState.isProcessing = false;
            await snapshotContextualIteration(activeContextualState.iterationCount);
            if (onStateUpdated) onStateUpdated({ ...activeContextualState });
            if (abortController?.signal.aborted || !globalState.isContextualRunning) break;

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, 1000);
                if (abortController) {
                    abortController.signal.addEventListener('abort', () => {
                        clearTimeout(timeout);
                        reject(new Error('Process stopped by user'));
                    });
                }
            }).catch(() => { return; });

            if (!globalState.isContextualRunning) break;

            // Prepare Main Generator for next iteration
            mainGeneratorMessages.push(new HumanMessage("Now implement the next iteration of the solution based on the critique and the strategies you just generated above. Ensure you fully resolve the issues raised in the critique."));

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            const errorMsg: ContextualMessage = {
                id: newMessageId('system'),
                role: 'system',
                content: `Error: ${errMsg}`,
                timestamp: Date.now(),
                iterationNumber: activeContextualState?.iterationCount || 0,
                status: 'error',
                blocks: [{ kind: 'error', message: errMsg }]
            };
            if (activeContextualState) {
                activeContextualState.messages.push(errorMsg);
                activeContextualState.isProcessing = false;
            }
            if (onStateUpdated && activeContextualState) onStateUpdated({ ...activeContextualState });
            break;
        }
    }
}

async function callContextualAgent(
    agentName: string,
    messages: BaseMessage[],
    systemPrompt: string
): Promise<ContextualAgentCallResult | null> {
    if (!activeContextualState) return null;

    const modelName = getSelectedModel();
    const temperature = getSelectedTemperature();
    const topP = getSelectedTopP();
    const sandboxEnabled = isContextualSandboxToolEnabled();
    const responseTimeoutMs = sandboxEnabled ? SANDBOX_AGENT_TIMEOUT_MS : STANDARD_AGENT_TIMEOUT_MS;
    const startedAt = Date.now();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (abortController?.signal.aborted || !globalState.isContextualRunning) {
            throw new Error('Process stopped by user');
        }

        try {
            if (attempt > 0) {
                const delay = Math.min(getContextualRetryDelay(attempt - 1), Math.max(0, responseTimeoutMs - (Date.now() - startedAt)));
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(resolve, delay);
                    if (abortController) {
                        abortController.signal.addEventListener('abort', () => {
                            clearTimeout(timeout);
                            reject(new Error('Process stopped by user'));
                        });
                    }
                }).catch(() => { throw new Error('Process stopped by user'); });
            }

            if (!globalState.isContextualRunning) throw new Error('Process stopped by user');

            const remaining = Math.max(1, responseTimeoutMs - (Date.now() - startedAt));
            if (sandboxEnabled) {
                return await withContextualTimeout(runContextualSandboxToolAgent({
                    agentName,
                    sessionId: getContextualSandboxSessionId(agentName),
                    messages,
                    systemPrompt,
                    modelName,
                    temperature,
                    topP,
                    repositoryAccess: getContextualSandboxRepositoryAccess(agentName)
                }), remaining, agentName);
            }

            // Fallback: convert BaseMessage[] to StructuredMessage[] for standard callAI
            const structuredMessages: any[] = messages.map(m => {
                let role: 'user' | 'assistant' | 'system' = 'user';
                if (m instanceof AIMessage) role = 'assistant';
                if (m instanceof SystemMessage) role = 'system';
                return {
                    role,
                    content: typeof m.content === 'string' ? m.content : messageContentToText(m.content)
                };
            });

            const result = await withContextualTimeout(callAI(
                structuredMessages,
                temperature,
                modelName,
                systemPrompt,
                false,
                topP
            ), remaining, agentName);

            const text = result.text || '';
            return {
                text,
                promptText: text,
                finalText: text,
                geminiContent: undefined
            };

        } catch (error) {
            const providerErrorMessage = describeProviderError(error);
            lastError = new Error(providerErrorMessage);
            console.warn(`${agentName} call attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, lastError.message);
            const deadlineReached = Date.now() - startedAt >= responseTimeoutMs;

            if (attempt < MAX_RETRIES && !deadlineReached && activeContextualState) {
                const retryMsg: ContextualMessage = {
                    id: newMessageId('system'),
                    role: 'system',
                    content: `${agentName} call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}. Retrying in ${getContextualRetryDelay(attempt) / 1000}s...`,
                    timestamp: Date.now(),
                    iterationNumber: activeContextualState.iterationCount,
                    status: 'error',
                    blocks: [{ kind: 'error', message: `Retry ${attempt + 1}/${MAX_RETRIES + 1}: ${lastError.message}` }]
                };
                activeContextualState.messages.push(retryMsg);
                if (onStateUpdated) onStateUpdated({ ...activeContextualState });
            }

            if (attempt === MAX_RETRIES || deadlineReached) break;
        }
    }

    throw lastError || new Error(`Failed to get response from ${agentName}`);
}
