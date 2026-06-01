/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, GenerateContentResponse, Part, ThinkingLevel } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { globalState } from "../Core/State";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface StructuredMessage {
    role: 'system' | 'assistant' | 'user';
    content: string;
    /** Optional: raw Gemini Parts for model turns from code execution.
     *  Passed directly to the API to preserve inlineData images, executableCode,
     *  codeExecutionResult, and thought_signature for correct multi-turn context. */
    rawParts?: any[];
}

export interface ThinkingConfig {
    thinkingBudget?: number;  // -1 for dynamic, 0 to disable, or specific token count
    thinkingLevel?: 'low' | 'medium' | 'high' | 'minimal';  // Gemini 3 thinking level control
    tools?: any[];  // Function declarations to enable thought signatures
    codeExecution?: boolean;  // Enable Gemini native code execution tool
}



// ============================================================================
// Thinking Config
// ============================================================================

/*
 * Thinking config may change for providers and models over the time. Current config are according
 * to May 2026. For updating the thinking config in the future, tag this file to your AI Agent and
 * ask it to search the web and figure out exactly what updates are needed. Because this is
 * literally the best we can do for something that changes so fast every month. Like I configured
 * Gemini 2.5 models and 3 models differently because of different thinking budget rules Google has
 * set for these different model families. I had to hardcode a specific rule for the Sonnet 3.7
 * because Anthropic changed their approach after that. Another hurdle is keeping track of
 * Model-IDs. OpenAI o series models were the thinking models for a long time and are detected
 * dynamically as soon as you enter the api key, but I can't just go about adding cases for
 * everything. That's the purpose of this comment. If your use case is specifically a given specific
 * model, then tag your agent in this file, let it read the docs and search the web for that model
 * and change the config.
 */
export type ThinkingType = 'level' | 'budget' | 'openai_effort' | 'anthropic_effort' | 'none';

export function getModelThinkingType(modelId: string): ThinkingType {
    const name = modelId.toLowerCase();

    if (name.startsWith('gpt-')) {
        const match = name.match(/gpt-(\d+)/);
        if (match && parseInt(match[1]) >= 5) return 'openai_effort';
        return 'none';
    }
    if (/^o[1-9]/.test(name)) return 'openai_effort';

    if (name.startsWith('claude-') || name.includes('claude')) return 'anthropic_effort';

    if (name.includes('gemma-')) return 'level';
    if (name.includes('gemini-')) {
        const match = name.match(/gemini-(\d+(?:\.\d+)?)/);
        if (match) {
            const version = parseFloat(match[1]);
            if (version >= 3.0) return 'level';
            if (version >= 2.0) return 'budget';
        }
    }

    return 'none';
}



export interface AIProvider {
    initialize(apiKey: string): boolean;
    generateContent(
        promptOrParts: string | Part[] | StructuredMessage[],
        temperature: number,
        modelToUse: string,
        systemInstruction?: string,
        isJsonOutput?: boolean,
        topP?: number,
        thinkingConfig?: any
    ): Promise<GenerateContentResponse>;
    isInitialized(): boolean;
    getProviderName(): string;
    listModels?(): Promise<string[]>;
}

// Helper to check if input is structured messages
function isStructuredMessages(input: any): input is StructuredMessage[] {
    return Array.isArray(input) && input.length > 0 && 'role' in input[0] && 'content' in input[0];
}

// Supported image MIME types for vision APIs (OpenAI and Anthropic)
const VISION_SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Helper to check if a Part contains inline image data
function hasInlineData(part: any): part is { inlineData: { mimeType: string; data: string } } {
    return part && part.inlineData && part.inlineData.mimeType && part.inlineData.data;
}

// ============================================================================
// Shared Utilities
// ============================================================================

function hasText(part: any): part is { text: string } {
    return part && typeof part.text === 'string';
}

/** Wraps plain text into the Gemini-compatible response shape used by all non-Gemini providers. */
function wrapAsGeminiResponse(text: string): any {
    return {
        text,
        response: {
            text: () => text,
            candidates: [{ content: { parts: [{ text }] } }]
        }
    };
}

/**
 * Builds an OpenAI-compatible messages array from our unified input types.
 * Shared by OpenAI, OpenRouter, and Local providers.
 * When visionSupport is true, Part[] with inlineData is converted to image_url format.
 */
function buildChatMessages(
    promptOrParts: string | Part[] | StructuredMessage[],
    systemInstruction?: string,
    visionSupport: boolean = false
): any[] {
    const messages: any[] = [];

    if (isStructuredMessages(promptOrParts)) {
        if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
        for (const msg of promptOrParts) messages.push({ role: msg.role, content: msg.content });
        return messages;
    }

    if (visionSupport && Array.isArray(promptOrParts) && promptOrParts.length > 0) {
        if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
        const contentParts: any[] = [];
        for (const part of promptOrParts) {
            if (hasText(part)) {
                contentParts.push({ type: 'text', text: part.text });
            } else if (hasInlineData(part)) {
                if (VISION_SUPPORTED_MIME_TYPES.includes(part.inlineData.mimeType)) {
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
                    });
                }
            }
        }
        if (contentParts.length > 0) messages.push({ role: 'user', content: contentParts });
        return messages;
    }

    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
    const userContent = typeof promptOrParts === 'string'
        ? promptOrParts
        : Array.isArray(promptOrParts)
            ? promptOrParts.map((p: any) => p.text).filter(Boolean).join('\n')
            : String(promptOrParts);
    messages.push({ role: 'user', content: userContent });
    return messages;
}

/**
 * Builds Anthropic-compatible messages and extracts system prompt separately.
 * Anthropic requires system messages in a dedicated field rather than in the messages array,
 * and uses a different vision format (source.type: 'base64' instead of image_url).
 */
function buildAnthropicMessages(
    promptOrParts: string | Part[] | StructuredMessage[],
    systemInstruction?: string
): { messages: any[], systemPrompt: string | undefined } {
    let messages: any[] = [];
    let systemPrompt = systemInstruction;

    if (isStructuredMessages(promptOrParts)) {
        const systemMessages: string[] = [];
        if (systemInstruction) systemMessages.push(systemInstruction);
        for (const msg of promptOrParts) {
            if (msg.role === 'system') {
                systemMessages.push(msg.content);
            } else {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        if (systemMessages.length > 0) systemPrompt = systemMessages.join('\n\n');
    } else if (Array.isArray(promptOrParts) && promptOrParts.length > 0 && !isStructuredMessages(promptOrParts)) {
        const contentParts: any[] = [];
        for (const part of promptOrParts) {
            if (hasText(part)) {
                contentParts.push({ type: 'text', text: part.text });
            } else if (hasInlineData(part)) {
                if (VISION_SUPPORTED_MIME_TYPES.includes(part.inlineData.mimeType)) {
                    contentParts.push({
                        type: 'image',
                        source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data }
                    });
                }
            }
        }
        if (contentParts.length > 0) messages = [{ role: 'user', content: contentParts }];
    } else {
        const userContent = typeof promptOrParts === 'string' ? promptOrParts : String(promptOrParts);
        messages = [{ role: 'user', content: userContent }];
    }

    return { messages, systemPrompt };
}

// ============================================================================
// Gemini Provider
// ============================================================================

/**
 * Sanitize Gemini contents array right before the API call.
 * Walks every content entry and strips embedded base64 image data from text Parts.
 * This is the single chokepoint that prevents token overflow from code execution
 * images, regardless of which mode (Deepthink, Contextual, etc.) produced the text.
 */
function sanitizeContentsForApi(contents: any[]): any[] {
    if (!Array.isArray(contents)) return contents;
    return contents.map((entry: any) => {
        if (!entry?.parts || !Array.isArray(entry.parts)) return entry;
        const sanitizedParts = entry.parts.map((part: any) => {
            // Only sanitize text parts; leave inlineData, executableCode, etc. untouched
            if (part && typeof part.text === 'string' && part.text.includes('<!-- EXECUTION_IMAGE_START -->')) {
                return {
                    ...part,
                    text: part.text.replace(
                        /\n?<!-- EXECUTION_IMAGE_START -->\s*(?:<!-- MIME_TYPE:\s*\S+\s*-->\s*)?[\s\S]*?<!-- EXECUTION_IMAGE_END -->\n?/g,
                        '\n[Code-generated image omitted from prompt]\n'
                    )
                };
            }
            return part;
        });
        return { ...entry, parts: sanitizedParts };
    });
}

interface ParsedGoogleApiError {
    code?: number;
    status?: string;
    message?: string;
    rawMessage: string;
}

function parseGoogleApiError(error: any): ParsedGoogleApiError {
    const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    const parsedFromJson = (input: string): ParsedGoogleApiError | null => {
        try {
            const payload = JSON.parse(input);
            if (payload?.error) {
                return {
                    code: typeof payload.error.code === 'number' ? payload.error.code : undefined,
                    status: typeof payload.error.status === 'string' ? payload.error.status : undefined,
                    message: typeof payload.error.message === 'string' ? payload.error.message : undefined,
                    rawMessage: input,
                };
            }
        } catch {
            // Fall through to alternate parsing strategies.
        }
        return null;
    };

    const direct = parsedFromJson(rawMessage);
    if (direct) return direct;

    const embeddedJsonMatch = rawMessage.match(/(\{[\s\S]*"error"[\s\S]*\})/);
    if (embeddedJsonMatch) {
        const embedded = parsedFromJson(embeddedJsonMatch[1]);
        if (embedded) return embedded;
    }

    return {
        code: typeof error?.status === 'number' ? error.status : undefined,
        rawMessage,
    };
}

function isTransientGoogleApiError(error: ParsedGoogleApiError): boolean {
    return error.code === 500
        || error.code === 503
        || error.status === 'INTERNAL'
        || error.status === 'UNAVAILABLE'
        || error.status === 'DEADLINE_EXCEEDED';
}

function normalizeGoogleApiError(error: any, modelToUse: string, hadCodeExecution: boolean): Error {
    const parsed = parseGoogleApiError(error);
    const code = parsed.code ?? (typeof error?.status === 'number' ? error.status : undefined);
    const status = parsed.status ? ` ${parsed.status}` : '';
    const detail = parsed.message || parsed.rawMessage || 'Request failed.';
    let message = `Gemini API error (${code ?? 'unknown'}${status}) while using ${modelToUse}: ${detail}`;

    if (isTransientGoogleApiError(parsed)) {
        message += ' This is a provider-side failure.';
    }

    if (hadCodeExecution && isTransientGoogleApiError(parsed)) {
        message += ' If this keeps happening, disable Deepthink code execution and retry.';
    } else if (isTransientGoogleApiError(parsed)) {
        message += ' Retry the run, and if it repeats switch to a stable non-preview Gemini model.';
    }

    const normalized = new Error(message);
    (normalized as any).cause = error;
    (normalized as any).status = code;
    (normalized as any).providerStatus = parsed.status;
    (normalized as any).rawProviderMessage = parsed.rawMessage;
    return normalized;
}

export class GoogleAIProvider implements AIProvider {
    private client: GoogleGenAI | null = null;
    private apiKey: string = '';

    initialize(apiKey: string): boolean {
        try {
            this.apiKey = apiKey;
            this.client = new GoogleGenAI({ apiKey });
            return true;
        } catch (e) {
            console.error("Failed to initialize Google AI:", e);
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        if (!this.apiKey) return [];
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            if (!res.ok) {
                throw new Error(`Failed to list models: ${res.statusText}`);
            }
            const data = await res.json();
            const rawModels = data.models || [];

            // Standard suffixes for chat/text models (excludes robotics, image, tts, customtools, etc.)
            const allowedSuffixes = [
                '-pro',
                '-flash',
                '-flash-lite',
                '-pro-preview',
                '-flash-preview',
                '-flash-lite-preview',
                '-it' // gemma
            ];

            const isDatedSnapshot = (modelId: string): boolean => {
                if (modelId.length < 4) return false;
                const lastPart = modelId.slice(-4);
                if (lastPart[0] !== '-') return false;
                const d1 = lastPart[1];
                const d2 = lastPart[2];
                const d3 = lastPart[3];
                return d1 >= '0' && d1 <= '9' && d2 >= '0' && d2 <= '9' && d3 >= '0' && d3 <= '9';
            };

            const filteredModels = rawModels
                .filter((model: any) => {
                    const modelId = model.name.replace(/^models\//, '');
                    const isGeminiOrGemma = modelId.startsWith('gemini-') || modelId.startsWith('gemma-');
                    const supportsGenerate = model.supportedGenerationMethods?.includes('generateContent');

                    const isNotDatedSnapshot = !isDatedSnapshot(modelId);
                    const matchesAllowedSuffix = allowedSuffixes.some(suffix => modelId.endsWith(suffix));

                    return isGeminiOrGemma && supportsGenerate && isNotDatedSnapshot && matchesAllowedSuffix;
                })
                .map((model: any) => model.name.replace(/^models\//, ''));

            return filteredModels;
        } catch (e) {
            console.error("Failed to fetch Gemini models:", e);
            return [];
        }
    }

    async generateContent(
        promptOrParts: string | Part[] | StructuredMessage[],
        temperature: number,
        modelToUse: string,
        systemInstruction?: string,
        isJsonOutput: boolean = false,
        topP?: number,
        thinkingConfig?: any
    ): Promise<GenerateContentResponse> {
        if (!this.client) throw new Error("Google AI client not initialized.");

        // Handle structured messages properly for Gemini
        let contents: any;
        if (Array.isArray(promptOrParts) && promptOrParts.length > 0 && typeof promptOrParts[0] === 'object' && 'role' in promptOrParts[0] && 'parts' in promptOrParts[0]) {
            contents = promptOrParts;
        } else if (isStructuredMessages(promptOrParts)) {
            // Gemini supports multi-turn conversations via contents array
            // Convert structured messages to Gemini's format
            const geminiContents: any[] = [];

            for (const msg of promptOrParts) {
                // Convert all messages to plain text (thought signatures disabled)
                if (msg.role === 'system') {
                    // System messages go to user role in Gemini
                    geminiContents.push({
                        role: 'user',
                        parts: [{ text: String(msg.content) }]
                    });
                } else if (msg.role === 'assistant') {
                    // Assistant messages go to model role
                    // If rawParts are present (code execution turn), pass them directly
                    // This preserves inlineData images, executableCode, codeExecutionResult,
                    // and thought_signature — required for correct multi-turn code execution.
                    if (msg.rawParts && msg.rawParts.length > 0) {
                        geminiContents.push({
                            role: 'model',
                            parts: msg.rawParts
                        });
                    } else {
                        geminiContents.push({
                            role: 'model',
                            parts: [{ text: String(msg.content) }]
                        });
                    }
                } else if (msg.role === 'user') {
                    geminiContents.push({
                        role: 'user',
                        parts: [{ text: String(msg.content) }]
                    });
                }
            }

            // Gemini requires alternating user/model messages
            // If we have consecutive messages of same role, combine them
            const normalizedContents: any[] = [];
            for (let i = 0; i < geminiContents.length; i++) {
                const current = geminiContents[i];
                if (normalizedContents.length === 0) {
                    normalizedContents.push(current);
                } else {
                    const last = normalizedContents[normalizedContents.length - 1];
                    if (last.role === current.role) {
                        // Combine consecutive messages of same role
                        last.parts.push(...current.parts);
                    } else {
                        normalizedContents.push(current);
                    }
                }
            }

            contents = normalizedContents;
        } else {
            // Legacy: single message
            contents = [{
                role: 'user',
                parts: typeof promptOrParts === 'string' ? [{ text: promptOrParts }] : promptOrParts
            }];
        }

        const config: any = { temperature, maxOutputTokens: 65536 };
        if (topP !== undefined) config.topP = topP;
        if (systemInstruction) config.systemInstruction = systemInstruction;
        if (isJsonOutput) config.responseMimeType = "application/json";

        const thinkingType = getModelThinkingType(modelToUse);

        if (thinkingType === 'level') {
            const selectedLevel = thinkingConfig?.thinkingLevel || globalState.thinkingLevel;
            let level = ThinkingLevel.HIGH;
            if (selectedLevel === 'low') level = ThinkingLevel.LOW;
            if (selectedLevel === 'medium') level = ThinkingLevel.MEDIUM;
            if (selectedLevel === 'minimal') level = ThinkingLevel.MINIMAL;
            if (selectedLevel === 'high') level = ThinkingLevel.HIGH;
            
            config.thinkingConfig = { thinkingLevel: level };
            console.log(`[Gemini] Thinking level model (${modelToUse}): thinkingLevel=${config.thinkingConfig.thinkingLevel}`);
        } else if (thinkingType === 'budget') {
            const selectedLevel = thinkingConfig?.thinkingLevel || globalState.thinkingLevel;
            const budgetMap: Record<string, number> = { 'minimal': 1024, 'low': 2048, 'medium': 4096, 'high': -1 };
            config.thinkingConfig = { thinkingBudget: budgetMap[selectedLevel] ?? -1 };
            console.log(`[Gemini] Thinking budget model (${modelToUse}): level=${selectedLevel}, budget=${config.thinkingConfig.thinkingBudget}`);
        } else if (thinkingType !== 'none' && thinkingConfig?.thinkingBudget !== undefined) {
            config.thinkingBudget = thinkingConfig.thinkingBudget;
        }

        // codeExecution and functionDeclarations are mutually exclusive in Gemini.
        if (thinkingConfig?.codeExecution) {
            config.tools = [{ codeExecution: {} }];
            console.log('[Gemini] Code execution enabled (function calling disabled)');
        } else if (thinkingConfig?.tools && thinkingConfig.tools.length > 0) {
            let toolsToPass = thinkingConfig.tools;

            // Strip dummy reasoning tool that conflicts with native thinking on Gemini 2.0+
            if (thinkingType !== 'none') {
                toolsToPass = toolsToPass.filter(
                    (t: any) => !(t.functionDeclarations?.length === 1 && t.functionDeclarations[0].name === "internal_reasoning_continuation")
                );
            }

            if (toolsToPass.length > 0) {
                config.tools = [...toolsToPass];
            }
        }

        const requestOptions: any = {
            model: modelToUse,
            contents: sanitizeContentsForApi(contents),
            config: config
        };



        try {
            const result = await this.client.models.generateContent(requestOptions);

            return result as any;
        } catch (error: any) {
            const parsedError = parseGoogleApiError(error);
            const hadCodeExecution = !!thinkingConfig?.codeExecution;

            if (hadCodeExecution && isTransientGoogleApiError(parsedError)) {
                const fallbackConfig = { ...config };

                if (Array.isArray(fallbackConfig.tools)) {
                    fallbackConfig.tools = fallbackConfig.tools.filter((tool: any) => !tool?.codeExecution);
                    if (fallbackConfig.tools.length === 0) {
                        delete fallbackConfig.tools;
                    }
                }

                console.warn(`[Gemini] ${modelToUse} failed with native code execution enabled. Retrying once without code execution.`, {
                    status: parsedError.status,
                    code: parsedError.code,
                });

                try {
                    const fallbackResult = await this.client.models.generateContent({
                        ...requestOptions,
                        config: fallbackConfig
                    });
                    return fallbackResult as any;
                } catch (fallbackError: any) {
                    throw normalizeGoogleApiError(fallbackError, modelToUse, hadCodeExecution);
                }
            }

            throw normalizeGoogleApiError(error, modelToUse, hadCodeExecution);
        }
    }

    isInitialized(): boolean {
        return this.client !== null;
    }

    getProviderName(): string {
        return 'gemini';
    }

    getClient(): GoogleGenAI | null {
        return this.client;
    }
}

// ============================================================================
// OpenAI Provider
// ============================================================================

export class OpenAIProvider implements AIProvider {
    private client: OpenAI | null = null;

    initialize(apiKey: string): boolean {
        try {
            this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
            return true;
        } catch (e) {
            console.error("Failed to initialize OpenAI:", e);
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        if (!this.client) return [];
        try {
            const response = await this.client.models.list();
            if (!response || !response.data) return [];

            const allowedPrefixes = ['gpt-', 'o1-', 'o3-', 'chatgpt-'];
            return response.data
                .map((m: any) => m.id)
                .filter((id: string) => allowedPrefixes.some(prefix => id.startsWith(prefix)) || id === 'o1');
        } catch (e) {
            console.error("Failed to fetch OpenAI models:", e);
            return [];
        }
    }

    async generateContent(
        promptOrParts: string | Part[] | StructuredMessage[],
        temperature: number,
        modelToUse: string,
        systemInstruction?: string,
        isJsonOutput: boolean = false,
        topP?: number,
        _thinkingConfig?: any  // Not used by OpenAI but maintained for interface consistency
    ): Promise<GenerateContentResponse> {
        if (!this.client) throw new Error("OpenAI client not initialized.");

        const messages = buildChatMessages(promptOrParts, systemInstruction, true);
        const thinkingType = getModelThinkingType(modelToUse);

        const requestOptions: any = { model: modelToUse, messages };

        if (thinkingType === 'openai_effort') {
            const level = _thinkingConfig?.thinkingLevel || 'high';
            const effortMap: Record<string, string> = { 'minimal': 'low', 'low': 'low', 'medium': 'medium', 'high': 'high' };
            requestOptions.reasoning_effort = effortMap[level] || 'medium';
        } else {
            requestOptions.temperature = temperature;
            if (topP !== undefined) requestOptions.top_p = topP;
        }

        if (isJsonOutput) requestOptions.response_format = { type: "json_object" };

        const response = await this.client.chat.completions.create(requestOptions);
        return wrapAsGeminiResponse(response.choices[0]?.message?.content || '');
    }

    isInitialized(): boolean {
        return this.client !== null;
    }

    getProviderName(): string {
        return 'openai';
    }
}

// ============================================================================
// OpenRouter Provider
// ============================================================================

export class OpenRouterProvider implements AIProvider {
    private client: OpenAI | null = null;

    initialize(apiKey: string): boolean {
        try {
            this.client = new OpenAI({
                apiKey,
                baseURL: "https://openrouter.ai/api/v1",
                dangerouslyAllowBrowser: true,
                defaultHeaders: {
                    "HTTP-Referer": window.location.origin || "http://localhost:5173",
                    "X-Title": "Iterative Studio"
                }
            });
            return true;
        } catch (e) {
            console.error("Failed to initialize OpenRouter:", e);
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        if (!this.client) return [];
        try {
            const response = await this.client.models.list();
            if (!response || !response.data) return [];
            return response.data.map((m: any) => m.id);
        } catch (e) {
            console.error("Failed to fetch OpenRouter models:", e);
            return [];
        }
    }

    async generateContent(
        promptOrParts: string | Part[] | StructuredMessage[],
        temperature: number,
        modelToUse: string,
        systemInstruction?: string,
        isJsonOutput: boolean = false,
        topP?: number,
        _thinkingConfig?: any
    ): Promise<GenerateContentResponse> {
        if (!this.client) throw new Error("OpenRouter client not initialized.");

        const messages = buildChatMessages(promptOrParts, systemInstruction);
        const requestOptions: any = { model: modelToUse, messages, temperature };

        if (topP !== undefined) requestOptions.top_p = topP;
        if (isJsonOutput) requestOptions.response_format = { type: "json_object" };

        const response = await this.client.chat.completions.create(requestOptions);
        return wrapAsGeminiResponse(response.choices[0]?.message?.content || '');
    }

    isInitialized(): boolean {
        return this.client !== null;
    }

    getProviderName(): string {
        return 'openrouter';
    }
}

// ============================================================================
// Anthropic Provider
// ============================================================================

export class AnthropicProvider implements AIProvider {
    private client: Anthropic | null = null;

    initialize(apiKey: string): boolean {
        try {
            this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
            return true;
        } catch (e) {
            console.error("Failed to initialize Anthropic:", e);
            return false;
        }
    }

    async listModels(): Promise<string[]> {
        if (!this.client) return [];
        try {
            const response = await this.client.models.list({ limit: 1000 });
            if (!response || !response.data) return [];
            return response.data
                .map((m: any) => m.id)
                .filter((id: string) => id.startsWith('claude-'));
        } catch (e) {
            console.error("Failed to fetch Anthropic models:", e);
            return [];
        }
    }

    async generateContent(
        promptOrParts: string | Part[] | StructuredMessage[],
        temperature: number,
        modelToUse: string,
        systemInstruction?: string,
        isJsonOutput: boolean = false,
        topP?: number,
        _thinkingConfig?: any
    ): Promise<GenerateContentResponse> {
        if (!this.client) throw new Error("Anthropic client not initialized.");

        const { messages, systemPrompt } = buildAnthropicMessages(promptOrParts, systemInstruction);
        const thinkingType = getModelThinkingType(modelToUse);

        const requestOptions: any = { model: modelToUse, max_tokens: 16384, messages };

        if (thinkingType === 'anthropic_effort') {
            const level = _thinkingConfig?.thinkingLevel || 'high';
            const effortMap: Record<string, string> = { 'minimal': 'low', 'low': 'low', 'medium': 'medium', 'high': 'high' };
            requestOptions.thinking = { type: 'adaptive' };
            requestOptions.effort = effortMap[level] || 'high';
            requestOptions.temperature = 1.0;
        } else {
            requestOptions.temperature = temperature;
        }

        if (systemPrompt) requestOptions.system = systemPrompt;
        if (topP !== undefined) requestOptions.top_p = topP;

        // Anthropic has no native JSON mode — inject instruction into system prompt
        if (isJsonOutput && systemPrompt) {
            requestOptions.system = `${systemPrompt}\n\nYou must respond with valid JSON only. Do not include any text outside the JSON structure.`;
        } else if (isJsonOutput) {
            requestOptions.system = 'You must respond with valid JSON only. Do not include any text outside the JSON structure.';
        }

        const response = await this.client.messages.create(requestOptions);
        const textContent = (response.content.find((c: any) => c.type === 'text') as any)?.text || '';
        return wrapAsGeminiResponse(textContent);
    }

    isInitialized(): boolean {
        return this.client !== null;
    }

    getProviderName(): string {
        return 'anthropic';
    }
}

// ============================================================================
// Local Models Provider
// ============================================================================

export class LocalModelsProvider implements AIProvider {
    private client: OpenAI | null = null;
    private endpointUrl: string = '';

    initialize(configString: string): boolean {
        try {
            // Parse the config string which contains endpoint URL
            // Format: "endpoint_url|model1,model2,model3"
            const [endpoint] = configString.split('|');

            // Ensure the endpoint has the /v1 suffix for OpenAI compatibility
            // LM Studio and similar tools expect this format
            this.endpointUrl = endpoint.endsWith('/v1')
                ? endpoint
                : endpoint.endsWith('/')
                    ? endpoint + 'v1'
                    : endpoint + '/v1';

            this.client = new OpenAI({
                apiKey: 'not-needed', // Local models typically don't need API keys
                baseURL: this.endpointUrl,
                dangerouslyAllowBrowser: true
            });
            return true;
        } catch (e) {
            console.error("Failed to initialize Local Models:", e);
            return false;
        }
    }

    async generateContent(
        promptOrParts: string | Part[] | StructuredMessage[],
        temperature: number,
        modelToUse: string,
        systemInstruction?: string,
        isJsonOutput: boolean = false,
        topP?: number,
        _thinkingConfig?: any
    ): Promise<GenerateContentResponse> {
        if (!this.client) throw new Error("Local Models client not initialized.");

        // For local models, we don't rely on response_format. We inject the instruction.
        let effectiveSystemInstruction = systemInstruction;
        if (isJsonOutput) {
            effectiveSystemInstruction = (effectiveSystemInstruction || '') +
                '\n\nIMPORTANT: You must respond with valid JSON only, no other text.';
        }

        const messages = buildChatMessages(promptOrParts, effectiveSystemInstruction);
        const requestOptions: any = { model: modelToUse, messages, temperature };
        if (topP !== undefined) requestOptions.top_p = topP;

        const response = await this.client.chat.completions.create(requestOptions);
        return wrapAsGeminiResponse(response.choices[0]?.message?.content || '');
    }

    isInitialized(): boolean {
        return this.client !== null;
    }

    getProviderName(): string {
        return 'local';
    }
}

// ============================================================================
// Provider Factory
// ============================================================================

export function createAIProvider(provider: string): AIProvider {
    switch (provider) {
        case 'gemini':
        case 'google':
            return new GoogleAIProvider();
        case 'openai':
            return new OpenAIProvider();
        case 'openrouter':
            return new OpenRouterProvider();
        case 'anthropic':
            return new AnthropicProvider();
        case 'local':
            return new LocalModelsProvider();
        default:
            return new GoogleAIProvider();
    }
}
