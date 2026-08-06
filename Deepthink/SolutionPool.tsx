/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SolutionPool — React components for rendering solution pool UI.
 * All data management logic lives in SolutionPool.ts.
 */

import React, { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
    DeepthinkPipelineState,
    getActiveDeepthinkPipeline,
} from './DeepthinkCore';
import {
    SolutionPoolParsedSolution,
    SolutionPoolParsedResponse,
    computeIterationCount,
    downloadAllLatestPoolsAsJSON,
} from './SolutionPool';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import { Icon } from '../UI/Icons';

import './SolutionPool.css';

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
// Solution Pool Modal (per-strategy)
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
                return <SolutionCardGrid solutions={solutions} />;
            }
        } catch { /* fall through */ }
        return <RawTextFallback content={poolAgent.poolResponse} />;
    }

    return <RawTextFallback content="No pool data available." />;
};

type BranchCard = {
    key: string;
    strategyId: string;
    branchVersion: number;
    label: string;
    strategyText: string;
    isActive: boolean;
    replacedAt?: number;
    memoryBank?: string;
};

function buildBranchCards(process: DeepthinkPipelineState): BranchCard[] {
    return process.initialStrategies.flatMap((strategy, strategyIndex) => {
        const history = (strategy.replacementHistory || []).map(record => ({
            key: `${strategy.id}-v${record.previousBranchVersion}`,
            strategyId: strategy.id,
            branchVersion: record.previousBranchVersion,
            label: `${strategy.id.toUpperCase()} · Branch v${record.previousBranchVersion}`,
            strategyText: record.previousStrategyText,
            isActive: false,
            replacedAt: record.replacedAtGlobalIteration,
            memoryBank: record.memoryBank,
        }));

        return [
            ...history,
            {
                key: `${strategy.id}-v${strategy.branchVersion || 1}-active-${strategyIndex}`,
                strategyId: strategy.id,
                branchVersion: strategy.branchVersion || 1,
                label: `${strategy.id.toUpperCase()} · Branch v${strategy.branchVersion || 1}`,
                strategyText: strategy.strategyText,
                isActive: true,
                memoryBank: strategy.memoryBank,
            },
        ];
    });
}

const MemoryBankStrip: React.FC<{ branches: BranchCard[]; process: DeepthinkPipelineState }> = ({ branches, process }) => {
    const memoryByBranch = new Map<string, BranchCard & { sourceIteration?: number }>();

    branches.forEach(branch => {
        if (branch.memoryBank?.trim()) {
            memoryByBranch.set(`${branch.strategyId}-v${branch.branchVersion}`, branch);
        }
    });

    (process.memoryBankAgents || []).forEach(agent => {
        if (!agent.memoryBank?.trim()) return;
        const branchVersion = agent.branchVersion || 1;
        const key = `${agent.mainStrategyId}-v${branchVersion}`;
        const existing = memoryByBranch.get(key);
        memoryByBranch.set(key, {
            key,
            strategyId: agent.mainStrategyId,
            branchVersion,
            label: `${agent.mainStrategyId.toUpperCase()} · Branch v${branchVersion}`,
            strategyText: existing?.strategyText || '',
            isActive: existing?.isActive ?? false,
            replacedAt: existing?.replacedAt,
            memoryBank: agent.memoryBank,
            sourceIteration: agent.globalIteration,
        });
    });

    const cards = Array.from(memoryByBranch.values());
    if (cards.length === 0) return null;

    return (
        <section className="sp-memory-bank-strip">
            <div className="sp-memory-bank-strip-header">
                <Icon name="database" />
                <div>
                    <h4>Strategy Memory Banks</h4>
                    <p>Branch-local distilled learning, separated from solution pools.</p>
                </div>
            </div>
            <div className="sp-memory-bank-grid">
                {cards.map(card => (
                    <div key={card.key} className={`sp-memory-bank-card${card.isActive ? '' : ' replaced'}`}>
                        <div className="sp-memory-bank-card-header">
                            <span>{card.label}</span>
                            {card.isActive
                                ? <span className="status-badge status-completed">Active</span>
                                : <span className="status-badge status-pending">Replaced{card.replacedAt ? ` at ${card.replacedAt}` : ''}</span>}
                        </div>
                        {card.sourceIteration && <div className="sp-memory-bank-meta">Updated at global iteration {card.sourceIteration}</div>}
                        <RenderMathMarkdown content={card.memoryBank || ''} className="sp-memory-bank-content" />
                    </div>
                ))}
            </div>
        </section>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Solution Pool Tab Content (iteration grid shown in the main tab)
// ═══════════════════════════════════════════════════════════════════════

export const SolutionPoolTabContent: React.FC<{ process: DeepthinkPipelineState }> = ({ process }) => {
    if (!process.structuredSolutionPoolEnabled) {
        return (
            <div className="solution-pool-container">
                <SolutionPoolHeader processId={process.id} />
                <div className="solution-pool-disabled-state">
                    <Icon name="block" className="disabled-icon" />
                    <h4>Structured Solution Pool Disabled</h4>
                    <p>This feature is currently disabled for this session.</p>
                    <p className="disabled-hint">Enable "Evolving Depth First Search" in settings to use this feature.</p>
                </div>
            </div>
        );
    }

    const poolAgents = process.structuredSolutionPoolAgents || [];
    if (poolAgents.length === 0) {
        return (
            <div className="solution-pool-container">
                <SolutionPoolHeader processId={process.id} />
                <div className="solution-pool-empty-state">
                    <Icon name="pending" className="empty-icon" />
                    <h4>Pool Initializing</h4>
                    <p>Waiting for initial solutions to be generated...</p>
                </div>
            </div>
        );
    }

    const branches = buildBranchCards(process);
    const iterationCount = computeIterationCount(process);

    return (
        <div className="solution-pool-container">
            <SolutionPoolHeader processId={process.id} />
            <div className="solution-pool-content-wrapper">
                <MemoryBankStrip branches={branches} process={process} />
                {Array.from({ length: iterationCount }, (_, i) => i + 1).map(iteration => (
                    <div key={iteration} className="pool-iteration-container">
                        <div className="pool-iteration-header">
                            <h4 className="pool-iteration-title">Iteration {iteration}</h4>
                        </div>
                        <div className="pool-iteration-content">
                            <div className="agent-grid">
                                {branches.map(branch => {
                                    const poolAgent = poolAgents.find(a =>
                                        a.mainStrategyId === branch.strategyId &&
                                        (a.branchVersion || 1) === branch.branchVersion &&
                                        a.globalIteration === iteration
                                    );
                                    const hasPoolResponse = !!(poolAgent?.poolResponse?.trim());
                                    const isError = poolAgent?.status === 'error';
                                    const isSkipped = poolAgent?.status === 'skipped';
                                    const hasPool = hasPoolResponse && !isSkipped;
                                    const solutionCount = poolAgent?.parsedPoolResponse?.solutions?.length;

                                    return (
                                        <div key={branch.key} className={`agent-card${isSkipped ? ' pool-skipped' : !hasPool ? ' pool-pending' : ''}${branch.isActive ? '' : ' replaced-branch'}`}>
                                            <div className="agent-header">
                                                <h4 className="agent-title">{branch.label}</h4>
                                                {isSkipped
                                                    ? <span className="status-badge status-skipped">Skipped</span>
                                                    : hasPool
                                                    ? <span className="status-badge status-completed">Available</span>
                                                    : isError
                                                        ? <span className="status-badge status-error">Error</span>
                                                        : branch.isActive
                                                            ? <span className="status-badge status-pending">Pending</span>
                                                            : <span className="status-badge status-pending">No pool</span>}
                                            </div>
                                            <div className="sp-branch-card-subtitle">
                                                {branch.isActive ? 'Current active branch' : `Retired at iteration ${branch.replacedAt || 'unknown'}`}
                                            </div>
                                            <div className="agent-results">
                                                {hasPool ? (
                                                    <>
                                                        {solutionCount && <span className="sp-count-badge">{solutionCount} solutions</span>}
                                                        <button
                                                            className="view-argument-button view-pool-button"
                                                            onClick={() => openSolutionPoolModal(branch.strategyId, iteration, branch.branchVersion)}
                                                        >
                                                            <Icon name="visibility" /> View Solution Pool
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div className={`pool-empty-state-mini${isSkipped ? ' skipped' : ''}`}>
                                                        <Icon name={isSkipped ? 'block' : 'hourglass_empty'} />
                                                        <span>{isSkipped ? 'No solution pool available' : isError ? 'Failed' : 'Processing...'}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const SolutionPoolHeader: React.FC<{ processId: string }> = ({ processId }) => (
    <div className="solution-pool-header">
        <div className="solution-pool-header-left">
            <Icon name="workspaces" className="solution-pool-icon" />
            <div className="solution-pool-title-group">
                <h3 className="solution-pool-title">Structured Solution Pool</h3>
                <p className="solution-pool-subtitle">Curated branch-local pool snapshots and memory banks</p>
            </div>
        </div>
        <div className="solution-pool-header-buttons">
            <button className="solution-pool-download-button" onClick={() => downloadAllLatestPoolsAsJSON(processId)}>
                <Icon name="download" /> Download All Latest Pools (JSON)
            </button>
        </div>
    </div>
);

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

function openSolutionPoolModal(strategyId: string, iteration: number, branchVersion?: number): void {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline) return;

    const matchesBranch = (agent: any) => branchVersion === undefined || (agent.branchVersion || 1) === branchVersion;
    const poolAgent = pipeline.structuredSolutionPoolAgents?.find(a => a.mainStrategyId === strategyId && a.globalIteration === iteration && matchesBranch(a))
        || pipeline.structuredSolutionPoolAgents?.filter(a => a.mainStrategyId === strategyId && matchesBranch(a)).sort((a, b) => (b.globalIteration || 0) - (a.globalIteration || 0))[0];
    if (poolAgent?.status === 'skipped') {
        alert('No solution pool available for this strategy.');
        return;
    }
    if (!poolAgent?.poolResponse) {
        alert('No solution pool available for this strategy.');
        return;
    }

    const title = `${strategyId.toUpperCase()}${branchVersion ? ` · Branch v${branchVersion}` : ''} — Iteration ${iteration} • Solution Pool`;
    mountSolutionPoolPanel(title, <SolutionPoolModalContent poolAgent={poolAgent} />);
}
