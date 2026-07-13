import React, { useEffect, useState, useRef } from 'react';
import { DeepthinkPipelineState, DeepthinkLiveEvent } from './DeepthinkCore';
import { Icon as MIcon } from '../UI/Icons';
import { ActionButton } from '../Styles/Components/ActionButton';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import { PromptStylingEditor } from '../Styles/Components/PromptStyling';
import { updateControlsState } from '../UI/Controls';
import './DeepthinkLiveTab.css';

interface DeepthinkLiveTabProps {
    process: DeepthinkPipelineState;
    hideStopButton?: boolean;
}

export const DeepthinkLiveTab: React.FC<DeepthinkLiveTabProps> = ({ process, hideStopButton }) => {
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'agents' | 'info' | 'errors'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [timeElapsed, setTimeElapsed] = useState('00:00');
    const [isSystemInstructionExpanded, setIsSystemInstructionExpanded] = useState(false);
    const [responseViewMode, setResponseViewMode] = useState<'submitted' | 'trace'>('submitted');
    const [, setForceUpdate] = useState(0);

    const terminalEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number>(Date.now());

    // A selection is intentional user state. Reset it only for a different
    // Deepthink run, never just because another agent produces an event.
    useEffect(() => {
        setSelectedEventId(null);
        setSelectedAgentName(null);
    }, [process.id]);

    // Timer logic for execution duration
    useEffect(() => {
        if (process.status === 'processing') {
            const firstEvent = process.liveEvents?.[0];
            const baseTime = firstEvent ? firstEvent.timestamp : Date.now();
            startTimeRef.current = baseTime;

            const updateTimer = () => {
                const diff = Date.now() - startTimeRef.current;
                const secs = Math.floor((diff / 1000) % 60);
                const mins = Math.floor((diff / 1000 / 60) % 60);
                setTimeElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            };

            updateTimer();
            timerRef.current = setInterval(updateTimer, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }

            const events = process.liveEvents || [];
            if (events.length > 1) {
                const diff = events[events.length - 1].timestamp - events[0].timestamp;
                const totalSecs = Math.floor(diff / 1000);
                const secs = totalSecs % 60;
                const mins = Math.floor(totalSecs / 60) % 60;
                setTimeElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            } else {
                setTimeElapsed('00:00');
            }
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [process.status, process.liveEvents?.length]);

    // Auto scroll logic (always auto-scroll to bottom of terminal console on new event)
    useEffect(() => {
        if (terminalEndRef.current) {
            terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [process.liveEvents?.length]);

    const events = process.liveEvents || [];

    // The first displayed agent is a selection as well. Without persisting it,
    // each pipeline update falls back to the newest event and steals focus.
    useEffect(() => {
        if (selectedEventId || selectedAgentName) return;
        const firstAgentEvent = events.find(event => (
            !!event.agentName && (event.eventType === 'agent_start' || event.eventType === 'agent_complete')
        ));
        if (!firstAgentEvent) return;
        setSelectedEventId(firstAgentEvent.id);
        setSelectedAgentName(firstAgentEvent.agentName);
    }, [process.id, process.liveEvents?.length, selectedEventId, selectedAgentName]);

    // Helper to determine agent category for color mapping
    const getAgentCategory = (agentName: string, stepDescription: string): string => {
        const name = (agentName || '').toLowerCase();
        const desc = (stepDescription || '').toLowerCase();

        // Critique / Criticism
        if (name.includes('critique') || desc.includes('critique') || name.includes('critic') || desc.includes('critic')) {
            return 'critique'; // Yellow
        }
        // Evolution filter / adversarial review
        if (name.includes('evolution filter') || desc.includes('evolution filter') || name.includes('postqualityfilter') || desc.includes('postqualityfilter') || name.includes('attack') || desc.includes('attack')) {
            return 'redteam'; // Red
        }
        // Correction / Refinement / Dissect / Quality filter / PostQF
        if (
            name.includes('correction') || desc.includes('correction') || 
            name.includes('refinement') || desc.includes('refinement') ||
            name.includes('dissect') || desc.includes('dissect') || 
            name.includes('quality filter') || desc.includes('quality filter') || 
            name.includes('postqf')
        ) {
            return 'dissected'; // Green
        }
        // Strategy / Sub-Strategy / Execution / Attempt / Solver
        if (
            name.includes('strategy') || desc.includes('strategy') || 
            name.includes('attempt') || desc.includes('attempt') || 
            name.includes('execution') || desc.includes('execution') ||
            name.includes('solver') || desc.includes('solver')
        ) {
            return 'strategy'; // Purple
        }
        // Hypothesis
        if (name.includes('hypothesis') || desc.includes('hypothesis')) {
            return 'hypothesis'; // Blue
        }
        // Solution Pool
        if (name.includes('pool') || desc.includes('pool')) {
            return 'solutionpool'; // Orange
        }
        return 'general';
    };

    // Find currently running agents to determine parallel execution
    const activeAgents: string[] = [];
    events.forEach(ev => {
        const key = ev.executionId || ev.agentName;
        if (ev.eventType === 'agent_start') {
            if (!activeAgents.includes(key)) {
                activeAgents.push(key);
            }
        } else if (ev.eventType === 'agent_complete' || ev.eventType === 'agent_error') {
            const idx = activeAgents.indexOf(key);
            if (idx !== -1) {
                activeAgents.splice(idx, 1);
            }
        }
    });


    // Filtered events for the terminal log console
    const filteredEvents = events.filter(ev => {
        if (filterType === 'agents' && !['agent_start', 'agent_complete', 'agent_error', 'agent_retry'].includes(ev.eventType)) return false;
        if (filterType === 'info' && ev.eventType !== 'info') return false;
        if (filterType === 'errors' && ev.eventType !== 'agent_error') return false;

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
                ev.agentName.toLowerCase().includes(query) ||
                ev.stepDescription.toLowerCase().includes(query) ||
                (ev.prompt && ev.prompt.toLowerCase().includes(query)) ||
                (ev.response && ev.response.toLowerCase().includes(query)) ||
                (ev.error && ev.error.toLowerCase().includes(query))
            );
        }
        return true;
    });

    // Unique agents list for the timeline: only show Start and Done. Do not show info, error, retry.
    const agentEventsMap = new Map<string, DeepthinkLiveEvent>();
    events.forEach(ev => {
        if (ev.agentName) {
            const key = ev.executionId || ev.agentName;
            if (ev.eventType === 'agent_start' || ev.eventType === 'agent_complete') {
                agentEventsMap.set(key, ev);
            } else if (ev.eventType === 'agent_error') {
                // If the agent failed/errored, remove it from the timeline
                agentEventsMap.delete(key);
            }
        }
    });
    const allTimelineAgents = Array.from(agentEventsMap.values());

    // Follow a selected agent from start to completion, but never replace a
    // deliberate selection with whichever agent happened to run most recently.
    const selectedEventById = selectedEventId ? events.find(event => event.id === selectedEventId) : undefined;
    let selectedEvent = selectedAgentName
        ? agentEventsMap.get(selectedAgentName) || selectedEventById
        : selectedEventById;

    if (!selectedEvent && !selectedAgentName && allTimelineAgents.length > 0) {
        const firstAgent = allTimelineAgents[0];
        if (firstAgent && firstAgent.agentName) {
            const key = firstAgent.executionId || firstAgent.agentName;
            const latestAgentEvent = agentEventsMap.get(key);
            if (latestAgentEvent) {
                selectedEvent = latestAgentEvent;
            }
        }
    }

    if (!selectedEvent) {
        selectedEvent = events[events.length - 1];
    }

    const selectEvent = (event: DeepthinkLiveEvent) => {
        setSelectedEventId(event.id);
        setSelectedAgentName(event.executionId || event.agentName || null);
    };

    useEffect(() => {
        setResponseViewMode('submitted');
    }, [selectedEvent?.id]);

    const renderTimelineNode = (agent: DeepthinkLiveEvent) => {
        const isActive = selectedEvent ? (
            (selectedEvent.executionId && selectedEvent.executionId === agent.executionId) ||
            (!selectedEvent.executionId && selectedEvent.agentName === agent.agentName)
        ) : false;
        const category = getAgentCategory(agent.agentName, agent.stepDescription);
        let statusClass = 'pending';
        let statusIcon = 'hourglass_empty';

        if (agent.eventType === 'agent_complete') {
            statusClass = 'completed';
            statusIcon = 'check';
        } else if (agent.eventType === 'agent_start' || agent.eventType === 'agent_retry') {
            statusClass = 'running';
            statusIcon = 'sync';
        }

        return (
            <div 
                key={agent.id} 
                className={`timeline-node ${statusClass} ${isActive ? 'active' : ''} category-${statusClass === 'completed' ? category : 'general'}`}
                onClick={() => selectEvent(agent)}
            >
                <div className="node-connector-line"></div>
                <div className="node-icon-wrapper">
                    <MIcon name={statusIcon} className="node-status-icon" />
                </div>
                <div className="node-content">
                    <div className="node-header">
                        <span className="node-name font-mono">{agent.agentName}</span>
                        <span className="node-time font-mono">
                            {new Date(agent.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                    </div>
                    <div className="node-description truncate">
                        {agent.stepDescription?.toLowerCase().includes('completed successfully') ? null : agent.stepDescription}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="deepthink-live-container">
            {/* Split Screen Workspace */}
            <div className="live-workspace" style={{ flexDirection: 'row-reverse' }}>
                {/* Left Side: Agent Timeline */}
                <div className="live-sidebar">
                    <div className="timeline-header-panel">
                        <div className="timeline-stats-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                            <div className={`status-pill status-${process.status} compact-status`}>
                                <span className="pulse-indicator"></span>
                                <span className="status-text">{process.status.toUpperCase()}</span>
                            </div>
                            <div className="duration-pill font-mono">
                                <MIcon name="timer" className="duration-pill-icon" />
                                <span>{timeElapsed}</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-label">INVOKED:</span>
                                <span className="stat-value font-mono">{allTimelineAgents.length}</span>
                            </div>
                            {!hideStopButton && (process.status === 'processing' || process.status === 'retrying') && (
                                <button
                                    className="stop-button"
                                    onClick={() => {
                                        process.isStopRequested = true;
                                        process.status = 'stopping';
                                        updateControlsState();
                                        setForceUpdate(prev => prev + 1);
                                        window.dispatchEvent(new CustomEvent('deepthinkPipelineUpdated'));
                                    }}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        padding: '0.25rem 0.6rem',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        color: '#f87171',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        borderRadius: '4px',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        marginLeft: 'auto',
                                        transition: 'all 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                                        e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                                        e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                                    }}
                                >
                                    <MIcon name="stop_circle" style={{ fontSize: '0.9rem' }} />
                                    Stop
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="agent-timeline custom-scrollbar">
                        {allTimelineAgents.length === 0 ? (
                            <div className="timeline-empty">Waiting for agent execution...</div>
                        ) : (
                            (() => {
                                const sortedAgents = [...allTimelineAgents].sort((a, b) => a.timestamp - b.timestamp);
                                const blocks: Array<
                                    | { type: 'single'; agent: DeepthinkLiveEvent }
                                    | { type: 'group'; id: string; name: string; agents: DeepthinkLiveEvent[] }
                                > = [];
                                
                                sortedAgents.forEach(agent => {
                                    if (agent.executionGroupId) {
                                        const existingGroup = blocks.find(b => b.type === 'group' && b.id === agent.executionGroupId);
                                        if (existingGroup && existingGroup.type === 'group') {
                                            existingGroup.agents.push(agent);
                                        } else {
                                            blocks.push({ type: 'group', id: agent.executionGroupId, name: agent.executionGroupName || 'Execution Loop', agents: [agent] });
                                        }
                                    } else {
                                        blocks.push({ type: 'single', agent });
                                    }
                                });

                                // Check if we have multiple generic running agents to group into a "Parallel" block
                                return blocks.map((block) => {
                                    if (block.type === 'single') {
                                        return renderTimelineNode(block.agent);
                                    } else {
                                        const isRunning = block.agents.some(a => a.eventType === 'agent_start' || a.eventType === 'agent_retry');
                                        return (
                                            <div key={block.id} className={`parallel-active-window ${isRunning ? 'running' : 'completed'}`} style={{
                                                border: isRunning ? '1px solid rgba(var(--accent-blue-rgb, 0, 210, 255), 0.25)' : '1px solid rgba(0, 230, 118, 0.25)',
                                                background: isRunning ? 'rgba(var(--accent-blue-rgb, 0, 210, 255), 0.03)' : 'rgba(0, 230, 118, 0.03)',
                                                borderRadius: '12px',
                                                padding: '0.5rem',
                                                marginBottom: '0.5rem'
                                            }}>
                                                <div className="parallel-window-header" style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.5rem 0.75rem',
                                                    color: isRunning ? 'var(--accent-blue, #00d2ff)' : '#00e676',
                                                    fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase'
                                                }}>
                                                    <MIcon name={isRunning ? "sync" : "check_circle"} className={isRunning ? "parallel-icon spin" : "parallel-icon"} style={{ fontSize: '1rem', animation: isRunning ? 'spin 4s linear infinite' : 'none' }} />
                                                    <span>{block.name}</span>
                                                </div>
                                                <div className="parallel-window-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    {block.agents.map(renderTimelineNode)}
                                                </div>
                                            </div>
                                        );
                                    }
                                });
                            })()
                        )}
                    </div>
                    
                    <div className="timeline-footer" style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
                        <button
                            className="vfs-explorer-trigger-btn full-width"
                            onClick={() => window.dispatchEvent(new CustomEvent('openVirtualEnvironment'))}
                            title="Open Sandbox Virtual Environment Explorer"
                            style={{
                                background: 'rgba(var(--accent-blue-rgb, 0, 210, 255), 0.08)',
                                border: '1px solid rgba(var(--accent-blue-rgb, 0, 210, 255), 0.25)',
                                color: 'var(--accent-blue, #00d2ff)',
                                padding: '0.5rem',
                                borderRadius: '12px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                outline: 'none',
                                fontFamily: 'inherit',
                                width: '100%'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(var(--accent-blue-rgb, 0, 210, 255), 0.18)';
                                e.currentTarget.style.borderColor = 'rgba(var(--accent-blue-rgb, 0, 210, 255), 0.5)';
                                e.currentTarget.style.boxShadow = '0 0 6px rgba(var(--accent-blue-rgb, 0, 210, 255), 0.2)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(var(--accent-blue-rgb, 0, 210, 255), 0.08)';
                                e.currentTarget.style.borderColor = 'rgba(var(--accent-blue-rgb, 0, 210, 255), 0.25)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                        >
                            <MIcon name="terminal" style={{ fontSize: '0.9rem' }} />
                            <span>Virtual Env Workspace</span>
                        </button>
                    </div>
                </div>

                {/* Right Side: Terminal Log & Prompt Inspector */}
                <div className="live-main-content">
                    {/* Top Right: Inspector */}
                    <div className="live-inspector-panel">

                        <div className="inspector-content">
                            {!selectedEvent ? (
                                <div className="inspector-empty">
                                    <MIcon name="info" className="empty-icon" />
                                    <p>Select an agent in the timeline or logs to inspect its inputs and outputs.</p>
                                </div>
                            ) : (
                                <div className="inspector-two-columns">
                                    {/* Left Column: System & User Prompts */}
                                    <div className="inspector-column left-column" style={{ paddingRight: '0.75rem' }}>
                                        <div className="unified-prompt-panel">
                                            {selectedEvent.systemInstruction && (
                                                <div className={`system-instruction-section ${isSystemInstructionExpanded ? 'expanded' : 'collapsed'}`}>
                                                    <div 
                                                        className="system-instruction-pill"
                                                        onClick={() => setIsSystemInstructionExpanded(!isSystemInstructionExpanded)}
                                                    >
                                                        <MIcon name={isSystemInstructionExpanded ? "expand_less" : "expand_more"} />
                                                        <span>System Instruction</span>
                                                    </div>
                                                    {isSystemInstructionExpanded && (
                                                        <div className="system-prompt-wrapper custom-scrollbar">
                                                            <PromptStylingEditor 
                                                                value={selectedEvent.systemInstruction} 
                                                                readOnly={true} 
                                                                className="inspector-prompt-display"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {selectedEvent.prompt && (
                                                <div className="user-prompt-section">
                                                    <div className="section-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                                                        <span className="card-title">
                                                            <MIcon name="description" /> User Prompt (Injected Context)
                                                        </span>
                                                    </div>
                                                    <div className="prompt-editor-wrapper custom-scrollbar user-prompt-wrapper">
                                                        <PromptStylingEditor 
                                                            value={selectedEvent.prompt} 
                                                            readOnly={true} 
                                                            className="inspector-prompt-display"
                                                        />
                                                    </div>
                                                    <div className="full-prompt-action" style={{ paddingTop: '0.5rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', display: 'flex' }}>
                                                        <ActionButton
                                                            type="copy"
                                                            content={(selectedEvent.systemInstruction ? selectedEvent.systemInstruction + '\n\n' : '') + selectedEvent.prompt}
                                                            icon="content_copy"
                                                            text="Copy Full Prompt (System + User)"
                                                            className="full-width-copy-btn"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="vertical-divider"></div>

                                    {/* Right Column: Model Response / Errors */}
                                    <div className="inspector-column right-column" style={{ paddingLeft: '0.75rem' }}>
                                        {selectedEvent.response && (
                                            <div className="borderless-card">
                                                <div className="section-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', marginBottom: '0.5rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span className="card-title">
                                                            <MIcon name="smart_toy" /> {responseViewMode === 'trace' ? 'Multi-turn Interaction' : 'Submitted Artifact'}
                                                        </span>
                                                        <div className="code-actions response-actions">
                                                            {selectedEvent.interactionTraceText && (
                                                                <div className="response-view-toggle" aria-label="Response view">
                                                                    <button
                                                                        className={`response-toggle-option ${responseViewMode === 'submitted' ? 'active' : ''}`}
                                                                        onClick={() => setResponseViewMode('submitted')}
                                                                    >
                                                                        Artifact
                                                                    </button>
                                                                    <button
                                                                        className={`response-toggle-option ${responseViewMode === 'trace' ? 'active' : ''}`}
                                                                        onClick={() => setResponseViewMode('trace')}
                                                                    >
                                                                        Trace
                                                                    </button>
                                                                </div>
                                                            )}
                                                            <ActionButton
                                                                type="copy"
                                                                content={responseViewMode === 'trace' ? (selectedEvent.interactionTraceText || selectedEvent.response) : selectedEvent.response}
                                                                icon="content_copy"
                                                                text="Copy"
                                                                title="Copy"
                                                                className="copy-btn-action icon-only-action"
                                                            />
                                                            <ActionButton
                                                                type="download"
                                                                content={responseViewMode === 'trace' ? (selectedEvent.interactionTraceText || selectedEvent.response) : selectedEvent.response}
                                                                filename={responseViewMode === 'trace' ? 'multi-turn-interaction.md' : 'submitted-artifact.md'}
                                                                icon="download"
                                                                text="Download"
                                                                title="Download"
                                                                className="download-btn-action icon-only-action"
                                                            />
                                                        </div>
                                                    </div>
                                                    {selectedEvent && (selectedEvent.modelName || selectedEvent.temperature !== undefined) && (
                                                        <div className="selected-agent-config font-mono" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                                            {selectedEvent.modelName && (
                                                                <span className="config-badge model" title="Model Name">
                                                                    <MIcon name="smart_toy" /> {selectedEvent.modelName}
                                                                </span>
                                                            )}
                                                            {selectedEvent.temperature !== undefined && (
                                                                <span className="config-badge temp" title="Temperature">
                                                                    Temp: {selectedEvent.temperature}
                                                                </span>
                                                            )}
                                                            {selectedEvent.topP !== undefined && (
                                                                <span className="config-badge topp" title="Top-P">
                                                                    Top-P: {selectedEvent.topP}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={`response-math-wrapper custom-scrollbar ${responseViewMode === 'submitted' ? 'submitted-artifact-surface' : 'interaction-trace-surface'}`}>
                                                    <RenderMathMarkdown content={responseViewMode === 'trace' ? (selectedEvent.interactionTraceText || 'No multi-turn interaction trace is available for this response.') : selectedEvent.response} />
                                                </div>
                                            </div>
                                        )}

                                        {selectedEvent.error && (
                                            <div className="borderless-card">
                                                <div className="section-header">
                                                    <span className="card-title" style={{ color: '#ff1744' }}>
                                                        <MIcon name="report_problem" /> Error Log
                                                    </span>
                                                </div>
                                                <div className="error-wrapper custom-scrollbar font-mono">
                                                    {selectedEvent.error}
                                                </div>
                                            </div>
                                        )}

                                        {!selectedEvent.response && !selectedEvent.error && (
                                            <div className="borderless-card pending">
                                                <div className="waiting-wrapper">
                                                    <MIcon name="sync" className="waiting-spinner" />
                                                    <span>Agent is processing, waiting for response...</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bottom Right: Terminal Log Console */}
                    <div className="live-terminal-panel">
                        <div className="terminal-header">
                            <div className="terminal-actions-left">
                                <div className="terminal-dot red"></div>
                                <div className="terminal-dot yellow"></div>
                                <div className="terminal-dot green"></div>
                                <span className="terminal-title font-mono">deepthink-agent-console.log</span>
                            </div>
                            <div className="terminal-actions-right">
                                <div className="console-filter-tabs">
                                    {(['all', 'agents', 'info', 'errors'] as const).map(type => (
                                        <button 
                                            key={type}
                                            className={`tab-button console-tab-button tab-${type} ${filterType === type ? 'active' : ''}`}
                                            onClick={() => setFilterType(type)}
                                        >
                                            {type.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                                <div className="search-box">
                                    <MIcon name="search" className="search-icon" />
                                    <input 
                                        type="text" 
                                        placeholder="Search logs..." 
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="search-input"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="terminal-body font-mono custom-scrollbar">
                            {filteredEvents.length === 0 ? (
                                <div className="terminal-row empty">Console is silent. Awaiting execution stream...</div>
                            ) : (
                                filteredEvents.map((ev) => {
                                    const category = getAgentCategory(ev.agentName, ev.stepDescription);
                                    let lineClass = 'log-info';
                                    let badge = '[INFO]';

                                    if (ev.eventType === 'agent_start') {
                                        lineClass = 'log-start';
                                        badge = '[START]';
                                    } else if (ev.eventType === 'agent_complete') {
                                        lineClass = 'log-complete';
                                        badge = '[DONE]';
                                    } else if (ev.eventType === 'agent_error') {
                                        lineClass = 'log-error';
                                        badge = '[FAIL]';
                                    } else if (ev.eventType === 'agent_retry') {
                                        lineClass = 'log-retry';
                                        badge = '[RETRY]';
                                    }

                                    return (
                                        <div 
                                            key={ev.id} 
                                            className={`terminal-row ${lineClass} ${selectedEvent?.id === ev.id ? 'highlighted' : ''} category-${category}`}
                                            onClick={() => selectEvent(ev)}
                                        >
                                            <span className="log-time">
                                                {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false })}
                                            </span>
                                            <span className="log-badge">{badge}</span>
                                            <span className="log-agent">[{ev.agentName}]</span>
                                            <span className="log-message">{ev.stepDescription}</span>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={terminalEndRef} />
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};
