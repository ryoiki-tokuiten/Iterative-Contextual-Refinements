/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const OPENAI_COMPATIBLE_ENDPOINT_HEADER = 'x-openai-compatible-endpoint';

export function getOpenAICompatibleProxyBaseURL(): string {
    const configuredBase = (import.meta as any).env?.BASE_URL || '/';
    const appBase = configuredBase.endsWith('/') ? configuredBase.slice(0, -1) : configuredBase;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    return `${origin}${appBase}/api/openai-compatible`;
}
