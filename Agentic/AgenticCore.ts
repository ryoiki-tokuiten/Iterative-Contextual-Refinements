/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { nanoid } from 'nanoid';
import { globalState } from '../Core/State';
import { describeProviderError } from '../Core/ProviderError';
import { getSelectedModel, getSelectedTemperature, getSelectedTopP } from '../Routing';
import { updateControlsState } from '../UI/Controls';
import { AGENTIC_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT } from './AgenticModePrompt';
import { createAgenticGraph, messageContentToText, normalizeToolCall, type AgenticGraphState, type ToolResultArtifact } from './AgenticToolGraph';
import type {
    AgenticMessage,
    AgenticState,
    ContentHistoryEntry,
    ResponseSegment,
    SystemBlock
} from './AgenticTypes';

export type {
    AgenticMessage,
    AgenticState,
    ContentHistoryEntry,
    DiffCommand,
    ResponseSegment,
    SystemBlock
} from './AgenticTypes';

function newMsgId(prefix = 'msg'): string {
    return `${prefix}-${nanoid(8)}`;
}

function createInitialUserMessage(): AgenticMessage {
    return {
        id: newMsgId('user'),
        role: 'user',
        content: 'Started agentic refinement run.',
        timestamp: Date.now()
    };
}

function createInitialHistoryEntry(initialContent: string): ContentHistoryEntry {
    return {
        content: initialContent,
        title: 'Initial Content',
        timestamp: Date.now()
    };
}

export function createInitialState(initialContent: string): AgenticState {
    return {
        id: `agentic-${nanoid(10)}`,
        originalContent: initialContent,
        currentContent: initialContent,
        messages: [createInitialUserMessage()],
        isProcessing: false,
        isComplete: false,
        contentHistory: [createInitialHistoryEntry(initialContent)]
    };
}

function buildAgentSegments(message: AIMessage): ResponseSegment[] {
    const segments: ResponseSegment[] = [];
    const narrative = messageContentToText(message.content);

    if (narrative) {
        segments.push({ kind: 'text', text: narrative });
    }

    for (const toolInvocation of message.tool_calls ?? []) {
        const toolCall = normalizeToolCall(toolInvocation.name, toolInvocation.args);
        if (toolCall) {
            segments.push({ kind: 'tool', tool: toolCall });
        }
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
    const artifact = (message.artifact ?? undefined) as ToolResultArtifact | undefined;
    const tool = artifact?.tool ?? message.name ?? 'tool';
    const toolCall = artifact?.toolCall;
    const isError = message.status === 'error';

    const blocks: SystemBlock[] = isError
        ? [{ kind: 'error', message: content }]
        : [{ kind: 'tool_result', tool, result: content, toolCall }];

    return {
        id: newMsgId('system'),
        role: 'system',
        content,
        timestamp: Date.now(),
        status: isError ? 'error' : 'success',
        blocks
    };
}

function toAgenticMessage(message: BaseMessage): AgenticMessage | null {
    if (message instanceof HumanMessage) {
        return null;
    }

    if (message instanceof AIMessage) {
        return buildAgentMessage(message);
    }

    if (message instanceof ToolMessage) {
        return buildSystemMessage(message);
    }

    return null;
}

function isAbortError(error: unknown): boolean {
    if (error instanceof Error) {
        return error.name === 'AbortError' || error.message === 'Aborted';
    }
    return false;
}

export interface AgenticEngineCallbacks {
    onStateChange: (state: AgenticState) => void;
    onContentUpdated?: (content: string, isComplete?: boolean) => void;
    onForceRender?: () => Promise<void>;
}

export class AgenticEngine {
    private state: AgenticState;
    private abortController: AbortController | null = null;
    private callbacks: AgenticEngineCallbacks;
    private promptsManager: { getAgenticPrompts: () => { systemPrompt?: string; verifierPrompt?: string; model?: string } } | null;

    constructor(
        initialContent: string,
        callbacks: AgenticEngineCallbacks,
        promptsManager?: { getAgenticPrompts: () => { systemPrompt?: string; verifierPrompt?: string; model?: string } }
    ) {
        this.state = createInitialState(initialContent);
        this.callbacks = callbacks;
        this.promptsManager = promptsManager ?? null;
    }

    public getState(): AgenticState {
        return this.state;
    }

    private updateState(newStateSubset: Partial<AgenticState>) {
        this.state = { ...this.state, ...newStateSubset };
        this.callbacks.onStateChange(this.state);
    }

    public stop() {
        globalState.isAgenticRunning = false;
        globalState.isGenerating = false;
        this.abortController?.abort();
        this.abortController = null;
        updateControlsState();
        this.updateState({ isProcessing: false, isComplete: true });
    }

    public async start() {
        if (!this.state.currentContent || globalState.isAgenticRunning) {
            return;
        }

        globalState.isAgenticRunning = true;
        globalState.isGenerating = true;
        updateControlsState();
        this.abortController = new AbortController();
        this.updateState({ isProcessing: true, isComplete: false, error: undefined });

        if (this.callbacks.onContentUpdated) {
            this.callbacks.onContentUpdated(this.state.currentContent, false);
        }

        await this.runGraph();
    }

    private async flushUI() {
        if (this.callbacks.onForceRender) {
            await this.callbacks.onForceRender();
        }
    }

    private async syncGraphState(graphState: AgenticGraphState, processedMessages: number) {
        const nextMessages = [...this.state.messages];

        for (const message of graphState.messages.slice(processedMessages)) {
            const mapped = toAgenticMessage(message);
            if (mapped) {
                nextMessages.push(mapped);
            }
        }

        const nextState: Partial<AgenticState> = {
            messages: nextMessages,
            currentContent: graphState.currentContent,
            contentHistory: graphState.contentHistory
        };

        this.updateState(nextState);

        if (this.callbacks.onContentUpdated) {
            this.callbacks.onContentUpdated(graphState.currentContent, false);
        }

        await this.flushUI();
    }

    private async runGraph() {
        let finalGraphState: AgenticGraphState | null = null;

        try {
            let modelName = getSelectedModel();
            const temperature = getSelectedTemperature();
            const topP = getSelectedTopP();

            const prompts = this.promptsManager?.getAgenticPrompts();
            if (prompts?.model) {
                modelName = prompts.model;
            }

            const graph = createAgenticGraph({
                modelName,
                temperature,
                topP,
                systemPrompt: prompts?.systemPrompt || AGENTIC_SYSTEM_PROMPT,
                verifierPrompt: prompts?.verifierPrompt || VERIFIER_SYSTEM_PROMPT
            });

            const initialGraphInput = {
                messages: [new HumanMessage('Refine the current working draft. Read the draft when needed, then make targeted improvements until it is verified and complete.')],
                currentContent: this.state.currentContent,
                contentHistory: this.state.contentHistory,
                verifierReports: [],
                verificationCount: 0,
                lastVerifiedContent: null,
                shouldExit: false
            };

            let processedMessages = 0;
            const stream = await graph.stream(initialGraphInput, {
                streamMode: 'values',
                recursionLimit: 48,
                signal: this.abortController?.signal
            });

            for await (const graphState of stream) {
                finalGraphState = graphState as AgenticGraphState;
                await this.syncGraphState(finalGraphState, processedMessages);
                processedMessages = finalGraphState.messages.length;

                if (this.abortController?.signal.aborted) {
                    break;
                }
            }

            if (finalGraphState) {
                this.updateState({
                    currentContent: finalGraphState.currentContent,
                    contentHistory: finalGraphState.contentHistory,
                    isProcessing: false,
                    isComplete: true
                });

                if (this.callbacks.onContentUpdated) {
                    this.callbacks.onContentUpdated(finalGraphState.currentContent, true);
                }
            } else {
                this.updateState({ isProcessing: false, isComplete: true });
            }
        } catch (error) {
            if (!isAbortError(error) && !this.abortController?.signal.aborted) {
                const message = describeProviderError(error);
                const systemMessage: AgenticMessage = {
                    id: newMsgId('system'),
                    role: 'system',
                    content: message,
                    timestamp: Date.now(),
                    status: 'error',
                    blocks: [{ kind: 'error', message }]
                };

                this.updateState({
                    messages: [...this.state.messages, systemMessage],
                    isProcessing: false,
                    isComplete: true,
                    error: message
                });
                await this.flushUI();
            }
        } finally {
            globalState.isAgenticRunning = false;
            globalState.isGenerating = false;
            updateControlsState();
            this.abortController = null;
        }
    }
}
