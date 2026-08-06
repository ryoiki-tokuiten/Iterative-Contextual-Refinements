/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

type ToolCall = {
    type: string;
    rawType?: string;
    args?: any;
};

export type ResponseSegment =
    | { kind: 'text'; text: string }
    | { kind: 'tool'; tool: ToolCall };

export type SystemBlock =
    | { kind: 'error'; message: string }
    | { kind: 'tool_result'; tool: string; result: string; toolCall?: ToolCall };

export interface AdaptiveMessage {
    id: string;
    role: 'agent' | 'system' | 'user';
    sender?: string;
    content: string;
    timestamp: number;
    status?: 'success' | 'error' | 'processing';
    segments?: ResponseSegment[];
    blocks?: SystemBlock[];
}
