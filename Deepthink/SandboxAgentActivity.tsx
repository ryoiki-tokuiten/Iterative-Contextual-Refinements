import React, { useMemo } from 'react';
import type { SandboxToolExecutionTrace, SandboxToolExecutionTraceMessage } from '../Core/SandboxToolRuntime';
import { MessageCard } from '../AdaptiveDeepthink/AgentActivityPanel';
import type { AdaptiveMessage, ResponseSegment, SystemBlock } from '../AdaptiveDeepthink/AdaptiveTypes';
import { AgentActivityPanel } from '../Styles/Components/AgentActivity/AgentActivityPanel';

type TraceToolCall = {
    id?: string;
    name?: string;
    args?: unknown;
};

function traceContentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content, null, 2);

    return content.map(part => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.redacted === 'string') return record.redacted;
        return '';
    }).filter(Boolean).join('\n').trim();
}

function traceToolCalls(value: unknown): TraceToolCall[] {
    return Array.isArray(value)
        ? value.filter(call => !!call && typeof call === 'object') as TraceToolCall[]
        : [];
}

function toolResultContent(message: SandboxToolExecutionTraceMessage, content: string): string {
    const output = [
        '<!-- EXECUTION_OUTPUT_START -->',
        '```',
        content,
        '```',
        '<!-- EXECUTION_OUTPUT_END -->',
    ].join('\n');
    const images = (message.images || [])
        .map(image => `![${image.filename.replace(/[\]\n\r]/g, ' ')}](${image.url})`)
        .join('\n\n');
    return images ? `${output}\n\n${images}` : output;
}

function activityMessages(executionTraceText?: string): AdaptiveMessage[] {
    if (!executionTraceText) return [];

    let trace: SandboxToolExecutionTrace;
    try {
        trace = JSON.parse(executionTraceText) as SandboxToolExecutionTrace;
    } catch {
        return [];
    }
    if (trace.schema !== 'sandbox_tool_execution_trace.v1' || !Array.isArray(trace.messages)) return [];

    const toolResults = new Set(trace.messages
        .filter(message => message.role === 'tool' && message.tool_call_id)
        .map(message => message.tool_call_id));
    const activity: AdaptiveMessage[] = [];

    trace.messages.forEach((message, index) => {
        const id = message.id || `sandbox-activity-${index}`;
        const content = traceContentText(message.content);

        if (message.role === 'assistant') {
            const calls = traceToolCalls(message.tool_calls);
            const segments: ResponseSegment[] = [];
            if (content) segments.push({ kind: 'text', text: content });
            calls.forEach(call => {
                const name = call.name || 'tool';
                segments.push({ kind: 'tool', tool: { type: `${name}()`, rawType: name, args: call.args } });
            });
            if (segments.length) {
                activity.push({ id, role: 'agent', sender: trace.agent.name, content, timestamp: index, status: 'success', segments });
            }
            calls.forEach(call => {
                if ((call.name === 'final_output' || call.name === 'submit_final_output') && (!call.id || !toolResults.has(call.id))) {
                    activity.push({
                        id: `${id}-submitted`,
                        role: 'system',
                        content: 'Submitted',
                        timestamp: index,
                        status: 'success',
                        blocks: [{ kind: 'tool_result', tool: call.name, result: 'Submitted' }],
                    });
                }
            });
            return;
        }

        if (message.role === 'tool') {
            const tool = message.name || 'tool';
            const isError = message.status === 'error';
            const isFinalOutput = tool === 'final_output' || tool === 'submit_final_output';
            const blocks: SystemBlock[] = isError && isFinalOutput
                ? [{ kind: 'error', message: content }]
                : isFinalOutput
                    ? [{ kind: 'tool_result', tool, result: 'Submitted' }]
                : [{ kind: 'tool_result', tool, result: toolResultContent(message, content) }];
            activity.push({ id, role: 'system', content, timestamp: index, status: isError ? 'error' : 'success', blocks });
            return;
        }

        if (content) {
            activity.push({
                id,
                role: 'system',
                content,
                timestamp: index,
                status: 'success',
            });
        }
    });

    return activity;
}

export const SandboxAgentActivity: React.FC<{
    executionTraceText?: string;
    headerExtra?: React.ReactNode;
}> = ({ executionTraceText, headerExtra }) => {
    const messages = useMemo(() => activityMessages(executionTraceText), [executionTraceText]);

    return (
        <AgentActivityPanel title="Agent Activity" headerExtra={headerExtra} className="deepthink-sandbox-activity">
            {messages.length
                ? messages.map(message => <MessageCard key={message.id} message={message} />)
                : <div className="timeline-empty">No sandbox activity is available for this response.</div>}
        </AgentActivityPanel>
    );
};
