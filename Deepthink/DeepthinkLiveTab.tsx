import React, { useEffect, useState, useRef } from 'react';
import { DeepthinkPipelineState, DeepthinkLiveEvent } from './DeepthinkCore';
import { Icon as MIcon } from '../UI/Icons';
import { ActionButton } from '../Styles/Components/ActionButton';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import { PromptStylingEditor } from '../Styles/Components/PromptStyling';
import './DeepthinkLiveTab.css';

interface DeepthinkLiveTabProps {
    process: DeepthinkPipelineState;
}

export const DeepthinkLiveTab: React.FC<DeepthinkLiveTabProps> = ({ process }) => {
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<'all' | 'agents' | 'info' | 'errors'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [timeElapsed, setTimeElapsed] = useState('00:00');
    const [isSystemInstructionExpanded, setIsSystemInstructionExpanded] = useState(false);

    const terminalEndRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number>(Date.now());

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
        if (ev.eventType === 'agent_start') {
            if (!activeAgents.includes(ev.agentName)) {
                activeAgents.push(ev.agentName);
            }
        } else if (ev.eventType === 'agent_complete' || ev.eventType === 'agent_error') {
            const idx = activeAgents.indexOf(ev.agentName);
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
            if (ev.eventType === 'agent_start' || ev.eventType === 'agent_complete') {
                agentEventsMap.set(ev.agentName, ev);
            } else if (ev.eventType === 'agent_error') {
                // If the agent failed/errored, remove it from the timeline
                agentEventsMap.delete(ev.agentName);
            }
        }
    });
    const allTimelineAgents = Array.from(agentEventsMap.values());
    const completedAgents = allTimelineAgents.filter(a => a.eventType === 'agent_complete').sort((a, b) => a.timestamp - b.timestamp);
    const runningAgents = allTimelineAgents.filter(a => a.eventType === 'agent_start').sort((a, b) => a.timestamp - b.timestamp);

    // Selected event details: Auto-track state transition of selected agent (e.g. from start to complete)
    let selectedEvent = events.find(e => e.id === selectedEventId);
    if (selectedEvent && selectedEvent.agentName && ['agent_start', 'agent_retry'].includes(selectedEvent.eventType)) {
        const latestAgentEvent = agentEventsMap.get(selectedEvent.agentName);
        if (latestAgentEvent) {
            selectedEvent = latestAgentEvent;
        }
    }

    if (!selectedEvent && allTimelineAgents.length > 0) {
        const latestAgent = allTimelineAgents[allTimelineAgents.length - 1];
        if (latestAgent && latestAgent.agentName) {
            const latestAgentEvent = agentEventsMap.get(latestAgent.agentName);
            if (latestAgentEvent) {
                selectedEvent = latestAgentEvent;
            }
        }
    }

    if (!selectedEvent) {
        selectedEvent = events[events.length - 1];
    }

    const renderTimelineNode = (agent: DeepthinkLiveEvent) => {
        const isActive = selectedEvent?.agentName === agent.agentName;
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
                onClick={() => setSelectedEventId(agent.id)}
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
                        {agent.stepDescription}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="deepthink-live-container">
            {/* Split Screen Workspace */}
            <div className="live-workspace">
                {/* Left Side: Agent Timeline */}
                <div className="live-sidebar">
                    <div className="timeline-header-panel">
                        <div className="panel-header-top">
                            <div className="panel-title-left">
                                <MIcon name="lan" className="panel-title-icon" />
                                <span>Execution Timeline</span>
                            </div>
                        </div>
                        <div className="timeline-stats-row">
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
                        </div>
                    </div>

                    <div className="agent-timeline custom-scrollbar">
                        {allTimelineAgents.length === 0 ? (
                            <div className="timeline-empty">Waiting for agent execution...</div>
                        ) : (
                            <>
                                {completedAgents.map(renderTimelineNode)}
                                {runningAgents.length > 1 ? (
                                    <div className="parallel-active-window">
                                        <div className="parallel-window-header">
                                            <MIcon name="bolt" className="parallel-icon" />
                                            <span>Executing in Parallel</span>
                                        </div>
                                        <div className="parallel-window-body">
                                            {runningAgents.map(renderTimelineNode)}
                                        </div>
                                    </div>
                                ) : (
                                    runningAgents.map(renderTimelineNode)
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Right Side: Terminal Log & Prompt Inspector */}
                <div className="live-main-content">
                    {/* Top Right: Inspector */}
                    <div className="live-inspector-panel">
                        <div className="panel-header">
                            <div className="panel-title-left">
                                <MIcon name="search" className="panel-title-icon" />
                                <span>Agent Inspector</span>
                            </div>
                            
                            {selectedEvent && (selectedEvent.modelName || selectedEvent.temperature !== undefined) && (
                                <div className="selected-agent-config font-mono">
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
                                    {selectedEvent.codeExecutionEnabled && (
                                        <span className="config-badge exec" title="Python Tool Enabled">
                                            PythonTool
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="inspector-content">
                            {!selectedEvent ? (
                                <div className="inspector-empty">
                                    <MIcon name="info" className="empty-icon" />
                                    <p>Select an agent in the timeline or logs to inspect its inputs and outputs.</p>
                                </div>
                            ) : (
                                <div className="inspector-two-columns">
                                    {/* Left Column: System & User Prompts */}
                                    <div className="inspector-column left-column">
                                        {/* System Instruction */}
                                        {selectedEvent.systemInstruction && (
                                            <div className={`inspector-card system-instruction-card ${isSystemInstructionExpanded ? 'expanded' : 'collapsed'}`}>
                                                <div 
                                                    className="inspector-card-header collapsible-header"
                                                    onClick={() => setIsSystemInstructionExpanded(!isSystemInstructionExpanded)}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <span className="card-title">
                                                        <MIcon name={isSystemInstructionExpanded ? "expand_less" : "expand_more"} />
                                                        System Instruction
                                                    </span>
                                                    <div className="code-actions" onClick={e => e.stopPropagation()}>
                                                        <ActionButton
                                                            type="copy"
                                                            content={selectedEvent.systemInstruction}
                                                            icon="content_copy"
                                                            text="Copy"
                                                            className="copy-btn-action"
                                                        />
                                                    </div>
                                                </div>
                                                {isSystemInstructionExpanded && (
                                                    <div className="inspector-card-body prompt-editor-wrapper custom-scrollbar">
                                                        <PromptStylingEditor 
                                                            value={selectedEvent.systemInstruction} 
                                                            readOnly={true} 
                                                            className="inspector-prompt-display"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* User Prompt */}
                                        {selectedEvent.prompt && (
                                            <div className="inspector-card user-prompt-card">
                                                <div className="inspector-card-header">
                                                    <span className="card-title">
                                                        <MIcon name="description" /> User Prompt (Injected Context)
                                                    </span>
                                                    <div className="code-actions">
                                                        <ActionButton
                                                            type="copy"
                                                            content={selectedEvent.prompt}
                                                            icon="content_copy"
                                                            text="Copy"
                                                            className="copy-btn-action"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="inspector-card-body prompt-editor-wrapper custom-scrollbar">
                                                    <PromptStylingEditor 
                                                        value={selectedEvent.prompt} 
                                                        readOnly={true} 
                                                        className="inspector-prompt-display"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right Column: Model Response / Errors */}
                                    <div className="inspector-column right-column">
                                        {selectedEvent.response && (
                                            <div className="inspector-card">
                                                <div className="inspector-card-header">
                                                    <span className="card-title">
                                                        <MIcon name="smart_toy" /> Model Response
                                                    </span>
                                                    <div className="code-actions">
                                                        <ActionButton
                                                            type="copy"
                                                            content={selectedEvent.response}
                                                            icon="content_copy"
                                                            text="Copy"
                                                            className="copy-btn-action"
                                                        />
                                                        <ActionButton
                                                            type="download"
                                                            content={selectedEvent.response}
                                                            filename="model-response.md"
                                                            icon="download"
                                                            text="Download"
                                                            className="download-btn-action"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="inspector-card-body response-math-wrapper custom-scrollbar">
                                                    <RenderMathMarkdown content={selectedEvent.response} />
                                                </div>
                                            </div>
                                        )}

                                        {selectedEvent.error && (
                                            <div className="inspector-card">
                                                <div className="inspector-card-header">
                                                    <span className="card-title">
                                                        <MIcon name="report_problem" /> Error Log
                                                    </span>
                                                </div>
                                                <div className="inspector-card-body error-wrapper custom-scrollbar font-mono">
                                                    {selectedEvent.error}
                                                </div>
                                            </div>
                                        )}

                                        {!selectedEvent.response && !selectedEvent.error && (
                                            <div className="inspector-card pending">
                                                <div className="inspector-card-body waiting-wrapper">
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
                                <span className="terminal-title font-mono">deepthink-agentic-console.log</span>
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
                                            onClick={() => setSelectedEventId(ev.id)}
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
