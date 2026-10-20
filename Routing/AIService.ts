/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerateContentResponse, Part } from "@google/genai";
import { ApiKeyManager } from './ApiConfig';
import { ThinkingConfig } from './AIProvider';
import {
    executeWithInferenceRetry,
    withSilenceWatchdog,
} from '../Core/ProviderError';

let apiKeyManager: ApiKeyManager | null = null;

export function setApiKeyManager(manager: ApiKeyManager) {
    apiKeyManager = manager;
}

interface StructuredMessage {
    role: 'system' | 'assistant' | 'user';
    content: string;
    /** Optional: raw Gemini Parts for model turns with native function calling.
     *  When set, AIProvider passes these directly to the API as the model history
     *  instead of stringifying content, preserving inlineData images, function
     *  calls/responses, and thought_signature fields. */
    rawParts?: any[];
}

export interface CallAIOptions {
    abortSignal?: AbortSignal;
    retryDelaysMs?: readonly number[];
    silenceTimeoutMs?: number;
    label?: string;
    onRetry?: (attempt: number, maxRetries: number, delayMs: number, error: unknown) => void;
}

export async function callAI(
    promptOrParts: string | Part[] | StructuredMessage[], 
    modelToUse: string, 
    systemInstruction?: string, 
    isJsonOutput: boolean = false, 
    thinkingConfig?: ThinkingConfig,
    options?: CallAIOptions
): Promise<GenerateContentResponse> {
    if (!apiKeyManager) throw new Error("API key manager not initialized.");
    
    const providerManager = apiKeyManager.getProviderManager();
    const aiProvider = providerManager.getProviderForModel(modelToUse);
    
    if (!aiProvider) {
        throw new Error(`No configured provider found for model: ${modelToUse}`);
    }

    const actualModelId = providerManager.getModelIdForSelection(modelToUse);
    const label = options?.label || `${aiProvider.getProviderName()}:${actualModelId}`;

    return await executeWithInferenceRetry(
        {
            label,
            retryDelaysMs: options?.retryDelaysMs,
            externalSignal: options?.abortSignal,
            onRetry: options?.onRetry,
        },
        async () => {
            return await withSilenceWatchdog(
                {
                    label,
                    silenceTimeoutMs: options?.silenceTimeoutMs,
                    externalSignal: options?.abortSignal,
                },
                async ({ signal, touch }) => {
                    return await aiProvider.generateContent(
                        promptOrParts,
                        actualModelId,
                        systemInstruction,
                        isJsonOutput,
                        thinkingConfig,
                        {
                            abortSignal: signal,
                            onChunkActivity: touch,
                        }
                    );
                }
            );
        }
    );
}

