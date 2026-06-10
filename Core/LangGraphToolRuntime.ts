/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDefinition } from '@langchain/core/language_models/base';
import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { type Content as GeminiContent, type Part as GeminiPart } from '@google/genai';
import { ChatOpenAI } from '@langchain/openai';
import { nanoid } from 'nanoid';
import { getRoutingManager, type ProviderConfig, callAI } from '../Routing';

export interface ToolCallingAgentOptions {
    modelName: string;
    temperature: number;
    topP?: number;
}

export type ResolvedProvider = {
    providerName: 'gemini' | 'openai' | 'openrouter' | 'local' | 'anthropic';
    providerConfig: ProviderConfig;
};

export type ToolCallingChatModel = ChatAnthropic | ChatOpenAI;

export function resolveProviderForModel(modelName: string): ResolvedProvider {
    const providerManager = getRoutingManager().getApiKeyManager().getProviderManager();
    const providerConfig = providerManager.getProviderConfigForModel(modelName);
    if (!providerConfig) {
        throw new Error(`No configured provider found for model: ${modelName}`);
    }

    return {
        providerName: (providerConfig.name === 'google' ? 'gemini' : providerConfig.name) as ResolvedProvider['providerName'],
        providerConfig
    };
}

function normalizeLocalEndpoint(endpoint: string): string {
    if (endpoint.endsWith('/v1')) {
        return endpoint;
    }

    if (endpoint.endsWith('/')) {
        return `${endpoint}v1`;
    }

    return `${endpoint}/v1`;
}

function getAgentModelOptions(options: ToolCallingAgentOptions) {
    return {
        model: options.modelName,
        temperature: options.temperature,
        ...(options.topP != null ? { topP: options.topP } : {})
    };
}

function createOpenAICompatibleAgentModel(
    options: ToolCallingAgentOptions,
    apiKey: string,
    configuration: NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>['configuration']
): ChatOpenAI {
    return new ChatOpenAI({
        ...getAgentModelOptions(options),
        apiKey,
        configuration
    });
}

export function createToolCallingAgentModel(
    providerName: Exclude<ResolvedProvider['providerName'], 'gemini'>,
    providerConfig: ProviderConfig,
    options: ToolCallingAgentOptions
): ToolCallingChatModel {
    const commonOptions = getAgentModelOptions(options);
    const browserSafeConfig = {
        dangerouslyAllowBrowser: true
    };

    switch (providerName) {
        case 'openai':
            return createOpenAICompatibleAgentModel(options, providerConfig.apiKey!, browserSafeConfig);

        case 'openrouter':
            return createOpenAICompatibleAgentModel(options, providerConfig.apiKey!, {
                ...browserSafeConfig,
                baseURL: 'https://openrouter.ai/api/v1',
                defaultHeaders: {
                    'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://iterative.studio',
                    'X-Title': 'Iterative Studio'
                }
            });

        case 'local':
            return createOpenAICompatibleAgentModel(options, 'not-needed', {
                ...browserSafeConfig,
                baseURL: normalizeLocalEndpoint(providerConfig.apiKey!)
            });

        case 'anthropic':
            return new ChatAnthropic({
                ...commonOptions,
                apiKey: providerConfig.apiKey!,
                maxTokens: 4096,
                clientOptions: {
                    dangerouslyAllowBrowser: true
                }
            });

        default:
            throw new Error(`Unsupported tool-calling provider: ${providerName}`);
    }
}

function cloneGeminiPart(part: GeminiPart): GeminiPart {
    return JSON.parse(JSON.stringify(part)) as GeminiPart;
}

function isGeminiPart(value: unknown): value is GeminiPart {
    return !!value && typeof value === 'object';
}

function pushGeminiContent(contents: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]) {
    if (parts.length === 0) {
        return;
    }

    const lastContent = contents[contents.length - 1];
    if (lastContent?.role === role) {
        lastContent.parts = [...(lastContent.parts ?? []), ...parts];
        return;
    }

    contents.push({ role, parts });
}

function buildGeminiFunctionDeclarations(tools: ToolDefinition[]) {
    return tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parametersJsonSchema: tool.function.parameters
    }));
}

function getGeminiToolResponse(message: ToolMessage) {
    if (message.status === 'error') {
        return { error: { details: messageContentToText(message.content) } };
    }

    return { result: messageContentToText(message.content) };
}

function getGeminiPartsFromMessage(message: BaseMessage): GeminiPart[] {
    if (message instanceof ToolMessage) {
        if (!message.name) {
            throw new Error('Gemini tool responses require the originating tool name.');
        }

        return [{
            functionResponse: {
                name: message.name,
                response: getGeminiToolResponse(message),
                ...(message.tool_call_id ? { id: message.tool_call_id } : {})
            }
        }];
    }

    const parts: GeminiPart[] = [];

    if (Array.isArray(message.content)) {
        for (const part of message.content) {
            if (!isGeminiPart(part)) {
                continue;
            }

            if ('thoughtSignature' in part || 'functionCall' in part || 'functionResponse' in part || 'thought' in part) {
                parts.push(cloneGeminiPart(part));
                continue;
            }

            if ('text' in part && typeof part.text === 'string') {
                parts.push({ text: part.text });
            }

            if (
                'inlineData' in part &&
                part.inlineData &&
                typeof part.inlineData === 'object' &&
                'mimeType' in part.inlineData &&
                'data' in part.inlineData
            ) {
                parts.push(cloneGeminiPart(part));
            }
        }
    }

    if (parts.length === 0) {
        const text = messageContentToText(message.content);
        if (text) {
            parts.push({ text });
        }
    }

    if (message instanceof AIMessage && message.tool_calls?.length && !parts.some(part => !!part.functionCall)) {
        parts.push(...message.tool_calls.map(toolCall => ({
            functionCall: {
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.args ?? {}
            }
        })));
    }

    return parts;
}

function buildGeminiContents(messages: BaseMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (const message of messages) {
        pushGeminiContent(contents, message instanceof AIMessage ? 'model' : 'user', getGeminiPartsFromMessage(message));
    }

    return contents;
}

function createGeminiAiMessage(response: any): AIMessage {
    const parts: GeminiPart[] = Array.isArray(response?.candidates?.[0]?.content?.parts)
        ? response.candidates[0].content.parts.map((part: GeminiPart) => cloneGeminiPart(part))
        : [];

    const toolCalls = parts
        .filter(part => !!part.functionCall?.name)
        .map(part => ({
            id: part.functionCall?.id ?? nanoid(8),
            type: 'tool_call' as const,
            name: part.functionCall!.name!,
            args: part.functionCall?.args ?? {}
        }));

    return new AIMessage({
        content: parts,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    });
}

export async function invokeGeminiToolAgentTurn(
    _providerConfig: ProviderConfig,
    messages: BaseMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    options: ToolCallingAgentOptions
): Promise<AIMessage> {
    const contents = buildGeminiContents(messages);
    const response = await callAI(
        contents as any,
        options.temperature,
        options.modelName,
        systemPrompt,
        false,
        options.topP,
        {
            tools: [{
                functionDeclarations: buildGeminiFunctionDeclarations(tools)
            }]
        }
    );

    return createGeminiAiMessage(response);
}

export function messageContentToText(content: BaseMessage['content']): string {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return String(content ?? '');
    }

    return content
        .map(part => {
            if (typeof part === 'string') {
                return part;
            }
            if (
                part &&
                typeof part === 'object' &&
                'text' in part &&
                typeof part.text === 'string' &&
                (!('thought' in part) || part.thought !== true)
            ) {
                return part.text;
            }
            return '';
        })
        .join('')
        .trim();
}
