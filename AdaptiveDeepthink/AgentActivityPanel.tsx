/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AdaptiveMessage } from './AdaptiveTypes';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import {
    getAdaptiveDeepthinkAgentDisplayName,
    getAdaptiveDeepthinkAgentIcon,
    isAdaptiveDeepthinkAgentTool
} from './AdaptiveDeepthinkAgentMeta';
import { Icon } from '../UI/Icons';
import { AgentActivityPanel as SharedAgentActivityPanel } from '../Styles/Components/AgentActivity/AgentActivityPanel';

function getToolResultSummary(toolName: string, result: string): string {
    switch (toolName) {
        case 'GenerateStrategies': {
            const strategyMatches = result.match(/<Strategy ID: strategy-\d+-\d+>/g);
            const count = strategyMatches ? strategyMatches.length : 0;
            return count > 0 ? `Generated ${count} strategic ${count === 1 ? 'approach' : 'approaches'}` : 'Generated strategic approaches';
        }
        case 'GenerateHypotheses': {
            const hypothesisMatches = result.match(/<Hypothesis ID: hypothesis-\d+-\d+>/g);
            const count = hypothesisMatches ? hypothesisMatches.length : 0;
            return count > 0 ? `Created ${count} ${count === 1 ? 'hypothesis' : 'hypotheses'}` : 'Created hypotheses for testing';
        }
        case 'TestHypotheses': {
            const testMatches = result.match(/<hypothesis-\d+-\d+>/g);
            const count = testMatches ? testMatches.length : 0;
            return count > 0 ? `Evaluated ${count} ${count === 1 ? 'hypothesis' : 'hypotheses'}` : 'Evaluated hypotheses and gathered evidence';
        }
        case 'ExecuteStrategies': {
            const executionMatches = result.match(/<Execution ID: execution-strategy-\d+-\d+>/g);
            const count = executionMatches ? executionMatches.length : 0;
            return count > 0 ? `Executed ${count} ${count === 1 ? 'strategy' : 'strategies'} and generated solutions` : 'Executed strategies';
        }
        case 'SolutionCritique': {
            return 'Analyzed and critiqued proposed solutions';
        }
        case 'CorrectedSolutions': {
            const correctedMatches = result.match(/<execution-strategy-\d+-\d+:Corrected>/g);
            const count = correctedMatches ? correctedMatches.length : 0;
            return count > 0 ? `Refined ${count} ${count === 1 ? 'solution' : 'solutions'} based on feedback` : 'Refined solutions';
        }
        case 'SelectBestSolution': {
            return 'Selected optimal solution from candidates';
        }
        default:
            return 'Tool execution completed';
    }
}

// Collapsible content component for large outputs
const CollapsibleContent: React.FC<{ content: string; maxLines: number }> = ({ content, maxLines }) => {
    const [expanded, setExpanded] = React.useState(false);
    const lines = content.split('\n');
    const needsCollapse = lines.length > maxLines;

    if (!needsCollapse || expanded) {
        return (
            <div className="tool-result-content">
                <RenderMathMarkdown content={content} />
                {needsCollapse && (
                    <button className="action-btn" onClick={() => setExpanded(false)}>
                        Show less
                    </button>
                )}
            </div>
        );
    }

    const preview = lines.slice(0, maxLines).join('\n');
    return (
        <div className="tool-result-content">
            <RenderMathMarkdown content={preview} />
            <div className="content-truncated">... {lines.length - maxLines} more lines ...</div>
            <button className="action-btn" onClick={() => setExpanded(true)}>
                Show all
            </button>
        </div>
    );
};

// Component for rendering a single message
export const MessageCard: React.FC<{ message: AdaptiveMessage }> = ({ message }) => {
    const getMessageIcon = () => {
        switch (message.role) {
            case 'agent': return <Icon name="smart_toy" />;
            case 'system': return message.status === 'error' ? <Icon name="warning" /> : <Icon name="check_circle" />;
            case 'user': return <Icon name="person" />;
            default: return <Icon name="person" />;
        }
    };

    const getMessageClass = () => {
        let baseClass = 'adaptive-message-card';
        if (message.role === 'system') {
            baseClass += message.status === 'error' ? ' system-error' : ' system-success';
        } else {
            baseClass += ` ${message.role}-message`;
        }
        return baseClass;
    };

    // Render segments for agent messages
    const renderSegments = () => {
        if (!message.segments) return null;

        return (
            <div className="message-inline-content">
                {message.segments.map((segment, idx) => {
                    if (segment.kind === 'text') {
                        return (
                            <div key={`seg-${idx}`} className="agent-text-segment">
                                <RenderMathMarkdown content={segment.text} />
                            </div>
                        );
                    } else if (segment.kind === 'tool') {
                        const tool = (segment as any).tool;
                        const toolType = tool.type;
                        const rawToolType = tool.rawType;
                        const isDeepthinkTool = !!rawToolType && isAdaptiveDeepthinkAgentTool(rawToolType);
                        const agentIcon = rawToolType ? getAdaptiveDeepthinkAgentIcon(rawToolType) : 'smart_toy';

                        return (
                            <div key={`seg-${idx}`} className={`tool-call-indicator ${isDeepthinkTool ? 'deepthink-tool-indicator' : ''}`}>
                                {isDeepthinkTool && agentIcon && (
                                    <Icon name={agentIcon} className="tool-indicator-icon" />
                                )}
                                <span className="tool-name">{toolType}</span>
                            </div>
                        );
                    }
                    return null;
                })}
            </div>
        );
    };

    // Render system blocks (structured system messages)
    const renderSystemBlocks = () => {
        if (!message.blocks) return null;

        return (
            <div className="system-blocks">
                {message.blocks.map((block, idx) => {
                    if (block.kind === 'error') {
                        return (
                            <div key={`block-${idx}`} className="system-block error">
                                <Icon name="warning" className="block-icon" />
                                <span>{block.message}</span>
                            </div>
                        );
                    } else if (block.kind === 'tool_result') {
                        if (isAdaptiveDeepthinkAgentTool(block.tool)) {
                            return (
                                <div key={`block-${idx}`} className="tool-result deepthink-agent-result concise">
                                    <div className="tool-result-header deepthink-agent-header">
                                        <Icon name="verified_user" className="deepthink-agent-icon" />
                                        <span>{getAdaptiveDeepthinkAgentDisplayName(block.tool)} completed</span>
                                    </div>
                                    <div className="tool-result-summary">
                                        {getToolResultSummary(block.tool, block.result)}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={`block-${idx}`} className="tool-result">
                                <div className="tool-result-header">Tool Result: {block.tool}</div>
                                <CollapsibleContent content={block.result} maxLines={30} />
                            </div>
                        );
                    }
                    return null;
                })}
            </div>
        );
    };

    const formatContent = (content: string) => {
        return <RenderMathMarkdown content={content} />;
    };

    return (
        <div className={getMessageClass()}>
            <div className="message-header">
                <div className="message-avatar">
                    {getMessageIcon()}
                </div>
                <div className="message-sender-info">
                    <span className="message-sender">
                        {message.role === 'agent'
                            ? (message.segments?.[0]?.kind === 'tool' ? getAdaptiveDeepthinkAgentDisplayName(message.segments[0].tool.type) : 'Orchestrator')
                            : message.role === 'system'
                            ? 'Deepthink Agent'
                            : 'User'}
                    </span>
                </div>
            </div>
            <div className="message-content">
                {message.role === 'agent' && message.segments ? (
                    renderSegments()
                ) : message.role === 'system' && message.blocks ? (
                    renderSystemBlocks()
                ) : (
                    formatContent(message.content)
                )}
            </div>
        </div>
    );
};

// Component for the right panel showing agent activity
export interface AgentActivityPanelProps {
    messages: AdaptiveMessage[];
    isProcessing: boolean;
    isComplete: boolean;
    error?: string;
    onStop?: () => void;
}

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({ messages, isProcessing, isComplete, error, onStop }) => {
    return (
        <SharedAgentActivityPanel
            title="Agent Activity"
            isProcessing={isProcessing}
            error={error}
            onStop={onStop}
            headerExtra={isComplete && <span className="status-badge status-completed">Completed</span>}
            className="adaptive-agent-panel"
        >
            {messages.map((message, index) => (
                <MessageCard key={message.id || `idx-${index}`} message={message} />
            ))}
        </SharedAgentActivityPanel>
    );
};
