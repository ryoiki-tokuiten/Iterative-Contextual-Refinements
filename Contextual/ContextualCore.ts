/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { callAI, getSelectedModel, getSelectedTemperature, getSelectedTopP, getSelectedThinkingLevel } from '../Routing';
import { updateControlsState } from '../UI/Controls';
import { globalState } from '../Core/State';
import { CustomizablePromptsContextual } from './ContextualPrompts';
import { isContextualPythonToolEnabled, runContextualPythonToolAgent } from './ContextualPythonToolRuntime';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { messageContentToText } from '../Core/LangGraphToolRuntime';

export interface ContentHistoryEntry {
    content: string;
    title: string;
    timestamp: number;
}

export interface HistoryMessage {
    role: 'system' | 'assistant' | 'user';
    content: string;
    rawParts?: any[];
    loopMessages?: any[];
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
}

export interface IterationData {
    iterationNumber: number;
    iterativeCritique: string;
    mainGeneration: string;
}

interface ContextualAgentCallResult {
    text: string;
    promptText?: string;
    finalText: string;
    geminiContent?: any;
    loopMessages?: any[];
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
let onContentUpdated: ((content: string) => void) | null = null;
let abortController: AbortController | null = null;
let contextualCustomPrompts: CustomizablePromptsContextual | null = null;

export function setContextualStateUpdateCallback(cb: ((state: ContextualState) => void) | null) {
    onStateUpdated = cb;
}

export function setContextualContentUpdateCallback(cb: ((content: string) => void) | null) {
    onContentUpdated = cb;
}

function newMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getContextualPythonSessionId(agentName: string): string {
    if (!activeContextualState) return '';
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `ctx-sess-${activeContextualState.id}-${safeName}`;
}

const MAX_RETRIES = 2;
const INITIAL_DELAY_MS = 2000;
const BACKOFF_FACTOR = 1.5;

let mainGeneratorMessages: BaseMessage[] = [];
let iterativeAgentMessages: BaseMessage[] = [];
let strategicPoolMessages: BaseMessage[] = [];
let turnsSinceLastCondense = 0;
let condenseCount = 0;

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
    mainGeneratorMessages = [
        new HumanMessage(`Initial User Request:\n${initialUserRequest}`)
    ];
    iterativeAgentMessages = [
        new HumanMessage(`Initial User Request:\n${initialUserRequest}`)
    ];
    strategicPoolMessages = [
        new HumanMessage(`Initial User Request:\n${initialUserRequest}`)
    ];
    
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
            const mainLoopMessages = mainGenerationResult.loopMessages || [new AIMessage(mainGenerationResult.text)];
            
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
                codeExecution: mainGenerationResult.geminiContent?.parts
            };
            activeContextualState.messages.push(mainMsg);
            
            // Distribute Main Generator's outputs
            // 1. To its own history
            mainGeneratorMessages.push(...mainLoopMessages);
            // 2. To the Iterative Agent's history (as native messages, so it critiques its "own" work)
            iterativeAgentMessages.push(...mainLoopMessages);
            
            if (onContentUpdated) {
                try { onContentUpdated(mainGeneration); } catch { }
            }
            if (onStateUpdated) onStateUpdated({ ...activeContextualState });
            if (abortController?.signal.aborted || !globalState.isContextualRunning) break;

            // ---------------------------------------------------------
            // 2: ITERATIVE AGENT (CRITIQUE)
            // ---------------------------------------------------------
            iterativeAgentMessages.push(new HumanMessage("Please critique the solution and tool executions you just generated above. If no tools were used, critique the generation text."));
            
            const suggestionsResult = await callContextualAgent('Iterative Agent', iterativeAgentMessages, contextualCustomPrompts!.sys_contextual_iterativeAgent);

            if (!suggestionsResult || abortController?.signal.aborted || !globalState.isContextualRunning) break;

            const suggestions = suggestionsResult.text;
            const suggestionsPromptText = getAgentPromptText(suggestionsResult);
            const suggestionsLoopMessages = suggestionsResult.loopMessages || [new AIMessage(suggestionsResult.text)];

            activeContextualState.currentBestSuggestions = suggestions;
            activeContextualState.allIterativeSuggestions.push(suggestions);

            const iterMsg: ContextualMessage = {
                id: newMessageId('iter'),
                role: 'iterative_agent',
                content: suggestions,
                timestamp: Date.now(),
                iterationNumber: activeContextualState.iterationCount
            };
            activeContextualState.messages.push(iterMsg);
            
            // Distribute Iterative Agent's outputs
            // 1. To its own history
            iterativeAgentMessages.push(...suggestionsLoopMessages);

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
                "Study the solution and tool executions above carefully:",
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
            const stratLoopMessages = strategicPoolResult.loopMessages || [new AIMessage(strategicPoolResult.text)];

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
                iterationNumber: activeContextualState.iterationCount
            };
            activeContextualState.messages.push(stratMsg);

            // Distribute Strategic Pool's outputs
            // 1. To its own history (native messages)
            strategicPoolMessages.push(...stratLoopMessages);

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
                // The Memory Agent doesn't need to see the full raw loop messages, a formatted text summary is sufficient for condensation
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
                        iterationNumber: activeContextualState.iterationCount
                    };
                    activeContextualState.messages.push(memMsg);
                    
                    // Condense the isolated arrays
                    const memoryCondenseMessage = new HumanMessage(`Memory Summary (What worked and what didn't):\n${memoryText}`);
                    const initialReqMessage = new HumanMessage(`Initial User Request:\n${activeContextualState.initialUserRequest}`);
                    
                    mainGeneratorMessages = [
                        initialReqMessage,
                        memoryCondenseMessage,
                        new HumanMessage(`Latest Context:\n`),
                        ...mainLoopMessages,
                        new HumanMessage(combinedCritique)
                    ];
                    
                    iterativeAgentMessages = [
                        initialReqMessage,
                        memoryCondenseMessage,
                        new HumanMessage(`Latest Context:\n`),
                        ...mainLoopMessages,
                        ...suggestionsLoopMessages
                    ];
                    
                    // Strategic Pool doesn't strictly need condensation of old turns as it evaluates the current turn, but we'll reset it to avoid bloat
                    strategicPoolMessages = [
                        initialReqMessage,
                        memoryCondenseMessage,
                        new HumanMessage(`Latest Strategic Pool Context:\n`),
                        ...stratLoopMessages
                    ];

                    turnsSinceLastCondense = 0;
                    condenseCount++;
                }
            }

            activeContextualState.isProcessing = false;
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

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (abortController?.signal.aborted || !globalState.isContextualRunning) {
            throw new Error('Process stopped by user');
        }

        try {
            if (attempt > 0) {
                const delay = INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
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

            if (isContextualPythonToolEnabled()) {
                return await runContextualPythonToolAgent({
                    agentName,
                    sessionId: getContextualPythonSessionId(agentName),
                    messages,
                    systemPrompt,
                    modelName,
                    temperature,
                    topP
                });
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

            const result = await callAI(
                structuredMessages,
                temperature,
                modelName,
                systemPrompt,
                false,
                topP
            );

            const text = result.text || '';
            return {
                text,
                promptText: text,
                finalText: text,
                geminiContent: undefined,
                loopMessages: [new AIMessage(text)]
            };

        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(`${agentName} call attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, lastError.message);

            if (attempt < MAX_RETRIES && activeContextualState) {
                const retryMsg: ContextualMessage = {
                    id: newMessageId('system'),
                    role: 'system',
                    content: `${agentName} call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${lastError.message}. Retrying in ${INITIAL_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt) / 1000}s...`,
                    timestamp: Date.now(),
                    iterationNumber: activeContextualState.iterationCount,
                    status: 'error',
                    blocks: [{ kind: 'error', message: `Retry ${attempt + 1}/${MAX_RETRIES + 1}: ${lastError.message}` }]
                };
                activeContextualState.messages.push(retryMsg);
                if (onStateUpdated) onStateUpdated({ ...activeContextualState });
            }

            if (attempt === MAX_RETRIES) break;
        }
    }

    throw lastError || new Error(`Failed to get response from ${agentName}`);
}
