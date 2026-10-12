/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Solution pools shown inside Curated Context, with the fullscreen pool viewer.
 * All data management logic lives in SolutionPool.ts.
 */

import React, { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import type {
    DeepthinkPipelineState,
    DeepthinkStructuredSolutionPoolAgentData,
} from '../core/deepthinkCore';
import type {
    SolutionPoolParsedSolution,
    SolutionPoolParsedResponse,
} from '../core/solutionPool';
import RenderMathMarkdown from '../../Styles/Components/RenderMathMarkdown';
import { Icon } from '../../UI/Icons';

import '../styles/SolutionPool.css';

// ═══════════════════════════════════════════════════════════════════════
// Shared Sub-components
// ═══════════════════════════════════════════════════════════════════════

const ConfidenceBadge: React.FC<{ confidence: number }> = ({ confidence }) => {
    const level = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';
    return <span className={`sp-confidence-badge ${level}`}>{(confidence * 100).toFixed(0)}%</span>;
};

// ═══════════════════════════════════════════════════════════════════════
// Solution Card
// ═══════════════════════════════════════════════════════════════════════

const SolutionCard: React.FC<{ solution: SolutionPoolParsedSolution; index: number }> = ({ solution, index }) => (
    <div className="sp-solution-card" style={{ animationDelay: `${index * 0.06}s` }}>
        <div className="sp-card-header">
            <span className="sp-card-number">{index + 1}</span>
            <h3 className="sp-card-title">{solution.title || `Solution ${index + 1}`}</h3>
            <ConfidenceBadge confidence={solution.confidence} />
        </div>

        <div className="sp-card-content-wrapper">
            <RenderMathMarkdown content={solution.content || ''} className="sp-card-content" />
        </div>
    </div>
);

const SolutionCardGrid: React.FC<{ solutions: SolutionPoolParsedSolution[] }> = ({ solutions }) => (
    <div className="sp-cards-grid">
        {solutions.map((solution, index) => (
            <SolutionCard key={index} solution={solution} index={index} />
        ))}
    </div>
);

const RawTextFallback: React.FC<{ content: string }> = ({ content }) => (
    <div className="sp-raw-fallback">
        <div className="sp-raw-notice">
            <Icon name="info" />
            <span>Pool response could not be parsed as structured JSON. Showing raw content.</span>
        </div>
        <pre className="sp-raw-content">{content}</pre>
    </div>
);

// ═══════════════════════════════════════════════════════════════════════
// Full-Screen Panel Shell
// ═══════════════════════════════════════════════════════════════════════

const SolutionPoolPanel: React.FC<{
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}> = ({ title, onClose, children }) => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div className="sp-fullscreen-overlay sp-visible" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sp-fullscreen-panel">
                <div className="sp-fullscreen-header">
                    <div className="sp-fullscreen-header-left">
                        <Icon name="workspaces" className="sp-header-icon" />
                        <h2 className="sp-fullscreen-title">{title}</h2>
                    </div>
                    <button className="sp-close-btn" onClick={onClose}>
                        <Icon name="close" />
                    </button>
                </div>
                <div className="sp-fullscreen-body custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Pool response content
// ═══════════════════════════════════════════════════════════════════════

const SolutionPoolModalContent: React.FC<{
    poolAgent: { poolResponse?: string; parsedPoolResponse?: SolutionPoolParsedResponse };
}> = ({ poolAgent }) => {
    const parsed = poolAgent.parsedPoolResponse;

    if (parsed && parsed.solutions.length > 0) {
        return <SolutionCardGrid solutions={parsed.solutions} />;
    }

    // Fallback: try re-parsing raw response
    if (poolAgent.poolResponse) {
        try {
            const data = JSON.parse(poolAgent.poolResponse);
            if (data && Array.isArray(data.solutions)) {
                const solutions: SolutionPoolParsedSolution[] = data.solutions.map((s: any, i: number) => ({
                    title: s.title || `Solution ${i + 1}`,
                    content: s.content || '',
                    confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
                }));
                return solutions.length > 0
                    ? <SolutionCardGrid solutions={solutions} />
                    : <div className="curated-pools-empty-state">No alternatives were included in this pool.</div>;
            }
        } catch { /* fall through */ }
        return <RawTextFallback content={poolAgent.poolResponse} />;
    }

    return <RawTextFallback content="No pool data available." />;
};

function formatStrategyId(id: string): string {
    if (id.startsWith('main')) return `Strategy ${id.slice(4)}`;
    return id.replace(/-/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function strategyOrder(id: string): number {
    const match = id.match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function hasPoolData(poolAgent: DeepthinkStructuredSolutionPoolAgentData): boolean {
    return !!poolAgent.poolResponse?.trim()
        || !!poolAgent.parsedPoolResponse?.solutions?.length;
}

function poolsForHeartbeat(process: DeepthinkPipelineState, heartbeatNo: number): DeepthinkStructuredSolutionPoolAgentData[] {
    const pools = new Map<string, DeepthinkStructuredSolutionPoolAgentData>();
    const heartbeat = process.heartbeats?.find(item => item.heartbeat_no === heartbeatNo);

    (heartbeat?.pools || []).forEach(pool => pools.set(pool.mainStrategyId, pool));
    (process.structuredSolutionPoolAgents || [])
        .filter(pool => pool.heartbeatNo === heartbeatNo)
        .forEach(pool => pools.set(pool.mainStrategyId, pool));

    return Array.from(pools.values()).sort((a, b) =>
        strategyOrder(a.mainStrategyId) - strategyOrder(b.mainStrategyId)
        || a.mainStrategyId.localeCompare(b.mainStrategyId)
    );
}

export const CuratedContextSolutionPools: React.FC<{
    process: DeepthinkPipelineState;
    heartbeatNo: number;
}> = ({ process, heartbeatNo }) => {
    const poolAgents = poolsForHeartbeat(process, heartbeatNo);
    const isProcessing = process.status === 'processing';

    return (
        <section className="curated-context-pools">
            <div className="curated-pools-header">
                <h3>Solution Pools</h3>
            </div>
            {poolAgents.length === 0 ? (
                <div className="curated-pools-empty-state">
                    <Icon name={isProcessing ? 'hourglass_empty' : 'info'} />
                    <span>{isProcessing ? 'Waiting for this heartbeat’s solution pools…' : 'No solution pools were recorded for this heartbeat.'}</span>
                </div>
            ) : (
                <div className="agent-grid curated-pool-agent-grid">
                    {poolAgents.map(poolAgent => {
                        const hasPool = hasPoolData(poolAgent) && poolAgent.status !== 'skipped';
                        const isSkipped = poolAgent.status === 'skipped';
                        const isError = poolAgent.status === 'error';
                        const solutionCount = poolAgent.parsedPoolResponse?.solutions?.length;

                        return (
                            <div key={poolAgent.mainStrategyId} className={`agent-card curated-pool-agent-card${isSkipped ? ' pool-skipped' : !hasPool ? ' pool-pending' : ''}`}>
                                <div className="agent-header">
                                    <h4 className="agent-title">{formatStrategyId(poolAgent.mainStrategyId)}</h4>
                                    {hasPool && solutionCount !== undefined && (
                                        <span className="sp-count-badge sp-count-badge-in-header">{solutionCount} solutions</span>
                                    )}
                                    {isSkipped && <span className="status-badge status-skipped">Skipped</span>}
                                    {!hasPool && !isSkipped && isError && <span className="status-badge status-error">Error</span>}
                                </div>
                                <div className="agent-results">
                                    {hasPool ? (
                                        <button
                                            type="button"
                                            className="view-argument-button view-pool-button"
                                            onClick={() => openSolutionPoolHeartbeatModal(heartbeatNo, poolAgents)}
                                        >
                                            <Icon name="visibility" /> View Pool
                                        </button>
                                    ) : (
                                        <div className={`pool-empty-state-mini${isSkipped ? ' skipped' : ''}`}>
                                            <Icon name={isSkipped ? 'block' : isError ? 'error' : 'hourglass_empty'} />
                                            <span>{isSkipped ? 'No pool for this branch' : isError ? 'Pool generation failed' : 'Processing…'}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Imperative Mount Functions
// ═══════════════════════════════════════════════════════════════════════

let panelRoot: Root | null = null;

function unmountPanel(): void {
    if (panelRoot) {
        const rootToUnmount = panelRoot;
        panelRoot = null;
        // Schedule unmount to avoid React 18 synchronous unmount race condition from within event handlers
        setTimeout(() => {
            rootToUnmount.unmount();
        }, 0);
    }
}

function mountSolutionPoolPanel(title: string, children: React.ReactNode): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    unmountPanel();
    const root = createRoot(container);
    panelRoot = root;

    const handleClose = () => {
        unmountPanel();
        container.remove();
    };

    root.render(
        <SolutionPoolPanel title={title} onClose={handleClose}>
            {children}
        </SolutionPoolPanel>
    );
}

function openSolutionPoolHeartbeatModal(
    heartbeatNo: number,
    poolAgents: DeepthinkStructuredSolutionPoolAgentData[]
): void {
    const availablePools = poolAgents.filter(poolAgent => poolAgent.status !== 'skipped' && hasPoolData(poolAgent));
    if (availablePools.length === 0) return;

    const title = `Heartbeat ${heartbeatNo} · Solution Pools`;
    mountSolutionPoolPanel(title, (
        <div className="sp-heartbeat-pool-list">
            {availablePools.map(poolAgent => (
                <section className="sp-heartbeat-pool-section" key={poolAgent.mainStrategyId}>
                    <div className="sp-heartbeat-pool-header">
                        <h3>{formatStrategyId(poolAgent.mainStrategyId)}</h3>
                        {poolAgent.parsedPoolResponse?.solutions && (
                            <span className="sp-count-badge">
                                {poolAgent.parsedPoolResponse.solutions.length} solutions
                            </span>
                        )}
                    </div>
                    <SolutionPoolModalContent poolAgent={poolAgent} />
                </section>
            ))}
        </div>
    ));
}
