/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ContextualState, ContextualMessage } from './ContextualCore';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import { openEmbeddedModal } from '../Styles/Components/EmbeddedModal';
import { Icon, setIconSlot } from '../UI/Icons';
import { AgentActivityPanel as SharedAgentActivityPanel } from '../Styles/Components/AgentActivity/AgentActivityPanel';

// Track React roots to prevent creating multiple roots on the same container
const rootMap = new WeakMap<HTMLElement, Root>();

interface ContextualUIProps {
    state: ContextualState;
    onStop: () => void;
}

export function ContextualUI({ state, onStop }: ContextualUIProps) {
    // Update evolution viewer when content history changes
    useEffect(() => {
        const updateViewer = async () => {
            const { updateEvolutionViewerIfOpen } = await import('../Styles/Components/DiffModal/EvolutionViewer');
            updateEvolutionViewerIfOpen(state.id, state.contentHistory);
        };
        updateViewer();
    }, [state.contentHistory.length, state.id]);

    return (
        <div className="contextual-ui-container" style={{
            display: 'flex',
            height: '100%',
            padding: '6px',
            gap: '8px',
            boxSizing: 'border-box',
            width: '100%',
            maxWidth: '100%',
            overflow: 'hidden'
        }}>
            <CurrentBestGenerationPanel
                content={state.currentBestGeneration}
                originalContent={state.initialMainGeneration}
                state={state}
            />
            <AgentActivityPanel state={state} onStop={onStop} />
        </div>
    );
}

// Hook to encapsulate vanilla DOM sidebar interaction
function useSidebar() {
    const [isCollapsed, setIsCollapsed] = useState(false);

    useEffect(() => {
        const checkSidebarState = () => {
            const sidebar = document.getElementById('controls-sidebar');
            setIsCollapsed(sidebar?.classList.contains('collapsed') || false);
        };

        checkSidebarState();

        const sidebar = document.getElementById('controls-sidebar');
        if (!sidebar) return;

        const observer = new MutationObserver(checkSidebarState);
        observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });

        return () => observer.disconnect();
    }, []);

    const expandSidebar = useCallback(() => {
        const sidebar = document.getElementById('controls-sidebar');
        const expandButton = document.getElementById('sidebar-expand-button');
        if (sidebar) {
            sidebar.classList.remove('collapsed');
            if (expandButton) {
                expandButton.style.display = 'none';
            }
        }
    }, []);

    return { isCollapsed, expandSidebar };
}

// Left Panel - Current Best Generation
const CurrentBestGenerationPanel: React.FC<{ content: string; originalContent: string; state: ContextualState }> = ({ content, state }) => {
    const { isCollapsed: sidebarCollapsed, expandSidebar } = useSidebar();

    const renderContent = () => {
        if (!content) {
            return (
                <div className="empty-state">
                    <Icon name="smart_toy" className="empty-icon" />
                    <p>Waiting for generation...</p>
                </div>
            );
        }

        return <RenderMathMarkdown content={content} />;
    };

    return (
        <div className="contextual-text-panel" style={{
            flex: '1 1 0%',
            minWidth: 0,
            maxWidth: 'unset'
        }}>
            <div className="text-panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {sidebarCollapsed && (
                        <>
                            <button
                                onClick={expandSidebar}
                                title="Expand Sidebar"
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--text-color)',
                                    opacity: 0.7,
                                    transition: 'opacity 0.2s ease',
                                    alignSelf: 'center',
                                    marginLeft: '0.5rem'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                            >
                                <Icon name="dock_to_left" style={{ fontSize: '1.1rem', lineHeight: 1 }} />
                            </button>
                            <div
                                style={{
                                    width: '1px',
                                    alignSelf: 'stretch',
                                    background: 'linear-gradient(180deg, transparent 0%, rgba(var(--accent-purple-rgb), 0.35) 20%, rgba(var(--accent-purple-rgb), 0.35) 80%, transparent 100%)',
                                    opacity: 1,
                                    margin: '0 0.4rem'
                                }}
                            />
                        </>
                    )}
                    <h3 style={{ margin: 0, lineHeight: 1, display: 'flex', alignItems: 'center' }}>Current Artifact</h3>
                </div>
                <div className="text-panel-actions">
                    <button
                        className="action-btn"
                        onClick={async () => {
                            const { openEvolutionViewerFromHistory } = await import('../Styles/Components/DiffModal/EvolutionViewer');
                            openEvolutionViewerFromHistory(state.contentHistory, state.id);
                        }}
                        title="View content evolution timeline (updates live)"
                    >
                        <Icon name="movie" />
                        Evolutions
                    </button>
                    {state.id !== 'evolving-dfs' && (
                        <>
                            <button
                                className="action-btn"
                                onClick={() => openEmbeddedModal('Current Memory Document', state.currentMemory)}
                                title="View current memory document"
                                disabled={!state.currentMemory}
                            >
                                <Icon name="pending" />
                                Memory
                            </button>
                            <button
                                className="action-btn"
                                onClick={() => openEmbeddedModal('Solution Pool', state.currentStrategicPool)}
                                title="View current solution pool"
                                disabled={!state.currentStrategicPool}
                            >
                                <Icon name="database" />
                                Solution Pool
                            </button>
                            <button
                                className="action-btn"
                                onClick={() => openEmbeddedModal('Current Critique', state.currentBestSuggestions)}
                                title="View current critique"
                                disabled={!state.currentBestSuggestions}
                            >
                                <Icon name="manage_search" />
                                Critique
                            </button>
                        </>
                    )}
                    <button
                        className="action-btn"
                        onClick={() => window.dispatchEvent(new CustomEvent('openVirtualEnvironment', {
                            detail: state.id === 'evolving-dfs' ? undefined : { repositoryId: state.id },
                        }))}
                        title="Open Sandbox Virtual Environment Explorer"
                    >
                        <Icon name="terminal" />
                        Virtual Env
                    </button>
                    <button
                        className="action-btn"
                        onClick={async (e) => {
                            const button = e.currentTarget;
                            const icon = button.querySelector('.icon-slot');

                            try {
                                await navigator.clipboard.writeText(content);

                                if (icon) {
                                    const originalIcon = (icon as HTMLElement).dataset.iconName || 'content_copy';
                                    setIconSlot(icon, 'check');

                                    setTimeout(() => {
                                        setIconSlot(icon, originalIcon);
                                    }, 1500);
                                }
                            } catch (err) {
                                console.error('Failed to copy:', err);
                            }
                        }}
                        title="Copy current text"
                        disabled={!content}
                    >
                        <Icon name="content_copy" />
                    </button>
                </div>
            </div>
            <div className="text-content-container custom-scrollbar">
                {renderContent()}
            </div>
        </div>
    );
};

// Right Panel - Agent Activity
const AgentActivityPanel: React.FC<{ state: ContextualState; onStop: () => void }> = ({ state, onStop }) => {
    return (
        <SharedAgentActivityPanel
            title="Agent Activity"
            isProcessing={state.isProcessing}
            error={null}
            onStop={onStop}
            headerExtra={<span className="iteration-badge">{state.iterationCount}</span>}
            className="contextual-agent-panel"
            style={{
                flex: '0 0 32%',
                minWidth: 0,
                maxWidth: '32%'
            }}
        >
            {state.messages.map((message) => (
                <MinimalMessageCard key={message.id} message={message} allMessages={state.messages} />
            ))}
        </SharedAgentActivityPanel>
    );
};

// Minimal Message Card (similar to verification report in Adaptive mode)
const MinimalMessageCard: React.FC<{ message: ContextualMessage; allMessages: ContextualMessage[] }> = ({ message, allMessages }) => {
    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'main_generator': return 'Execution';
            case 'iterative_agent': return 'Solution Critique';
            case 'memory_agent': return 'Memory';
            case 'strategic_pool_agent': return 'Solution Pool';
            case 'system': return 'System';
            default: return role;
        }
    };

    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'main_generator': return <Icon name="check" className="card-icon" />;
            case 'iterative_agent': return <Icon name="manage_search" className="card-icon" />;
            case 'memory_agent': return <Icon name="pending" className="card-icon" />;
            case 'strategic_pool_agent': return <Icon name="database" className="card-icon" />;
            case 'system': return <Icon name="smart_toy" className="card-icon" />;
            default: return <Icon name="smart_toy" className="card-icon" />;
        }
    };

    const getRoleClass = (role: string) => {
        const baseClass = (() => {
            switch (role) {
                case 'main_generator': return 'main-generator-card';
                case 'iterative_agent': return 'iterative-agent-card';
                case 'memory_agent': return 'memory-agent-card';
                case 'strategic_pool_agent': return 'strategic-pool-agent-card';
                case 'system': return 'system-card';
                default: return '';
            }
        })();

        // Add status class if present
        const statusClass = message.status ? ` status-${message.status}` : '';
        return baseClass + statusClass;
    };

    return (
        <div className={`minimal-message-card ${getRoleClass(message.role)}`}>
            <div className="minimal-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {getRoleIcon(message.role)}
                    <span className="card-title">{getRoleLabel(message.role)}</span>
                    <span className="card-iteration">{message.iterationNumber}</span>
                </div>
                <button
                    className="action-btn"
                    onClick={() => openEmbeddedModal(getRoleLabel(message.role), message.content, message, allMessages)}
                    title="View full response"
                >
                    <Icon name="visibility" />
                    View
                </button>
            </div>
            <div className="minimal-card-content scrollbar-compact">
                <RenderMathMarkdown content={message.content} />
            </div>
        </div>
    );
};

export function renderContextualUI(
    container: HTMLElement,
    state: ContextualState,
    onStop: () => void
): Root {
    let root = rootMap.get(container);
    if (!root) {
        root = createRoot(container);
        rootMap.set(container, root);
    }
    flushSync(() => {
        root.render(<ContextualUI state={state} onStop={onStop} />);
    });
    return root;
}

export function updateContextualUI(
    root: any,
    state: ContextualState,
    onStop: () => void
): void {
    if (!root) return;
    flushSync(() => {
        root.render(<ContextualUI state={state} onStop={onStop} />);
    });
}

/**
 * Render Evolving DFS correction UI (for Deepthink mode)
 * Uses the same UI as Contextual mode
 */
export function cleanupEvolvingDfsRoot() {
    // Root cleanup is handled automatically by WeakMap when containers are GC'd
    // This function is kept for shared timeline rendering
}

export function renderEvolvingDfsUI(
    container: HTMLElement,
    originalSolution: string,
    finalSolution: string,
    iterations: Array<{
        iterationNumber: number;
        critique: string;
        critiqueExecutionTraceText?: string;
        correctedSolution: string;
        correctedSolutionExecutionTraceText?: string;
        timestamp?: number;
    }>,
    isProcessing?: boolean
): any {
    // Transform iterations into ContextualState format
    const messages: ContextualMessage[] = [];

    // Handle case where iterations might be empty or undefined
    const safeIterations = iterations || [];

    safeIterations.forEach((iter, index) => {
        const baseTimestamp = iter.timestamp || (Date.now() + index * 1000);

        // Add critique message
        messages.push({
            id: `critique-iter-${iter.iterationNumber}`,
            role: 'iterative_agent',
            content: iter.critique,
            timestamp: baseTimestamp,
            iterationNumber: iter.iterationNumber,
            executionTraceText: iter.critiqueExecutionTraceText,
        });

        // Add correction message
        messages.push({
            id: `correction-iter-${iter.iterationNumber}`,
            role: 'main_generator',
            content: iter.correctedSolution,
            timestamp: baseTimestamp + 500, // 500ms after critique
            iterationNumber: iter.iterationNumber,
            executionTraceText: iter.correctedSolutionExecutionTraceText,
        });
    });

    // Build content history from iterations for the evolution viewer
    // Start with the original solution as the first entry
    const contentHistory: Array<{ content: string; title: string; timestamp: number }> = [];

    if (originalSolution) {
        contentHistory.push({
            content: originalSolution,
            title: 'Original Solution (Iteration 0)',
            timestamp: safeIterations[0]?.timestamp ? safeIterations[0].timestamp - 1000 : Date.now() - 1000
        });
    }

    safeIterations.forEach((iter, index) => {
        contentHistory.push({
            content: iter.correctedSolution,
            title: `Iteration ${iter.iterationNumber} - Corrected Solution`,
            timestamp: iter.timestamp || (Date.now() + index * 1000)
        });
    });

    // Add final solution if different from last iteration
    if (finalSolution && (safeIterations.length === 0 || finalSolution !== safeIterations[safeIterations.length - 1]?.correctedSolution)) {
        contentHistory.push({
            content: finalSolution,
            title: 'Final Solution',
            timestamp: Date.now()
        });
    }

    const mockState: ContextualState = {
        id: 'evolving-dfs',
        initialUserRequest: '',
        initialMainGeneration: originalSolution || 'Processing...',
        currentBestGeneration: finalSolution || 'Processing Evolving DFS corrections...',
        currentBestSuggestions: '',
        allIterativeSuggestions: [],
        mainGeneratorHistory: [],
        iterativeAgentHistory: [],
        memoryAgentHistory: [],
        strategicPoolAgentHistory: [],
        messages: messages,
        iterationCount: safeIterations.length,
        isRunning: false,
        isProcessing: isProcessing !== undefined ? isProcessing : safeIterations.length === 0,
        contentHistory: contentHistory,
        currentMemory: '',
        memorySnapshots: [],
        currentStrategicPool: '',
        allStrategicPools: []
    };

    // Create or reuse React root using the rootMap to prevent duplicate roots
    let root = rootMap.get(container);
    if (!root) {
        root = createRoot(container);
        rootMap.set(container, root);
    }

    flushSync(() => {
        root.render(<ContextualUI state={mockState} onStop={() => { }} />);
    });

    return root;
}
