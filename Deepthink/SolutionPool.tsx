/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SolutionPool — React components for rendering solution pool UI.
 * All data management logic lives in SolutionPool.ts.
 */

import React, { useState, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
    DeepthinkPipelineState,
    getActiveDeepthinkPipeline,
} from './DeepthinkCore';
import {
    SolutionPoolParsedSolution,
    SolutionPoolParsedResponse,
    computeIterationCount,
} from './SolutionPool';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import { Icon } from '../UI/Icons';

// @ts-ignore — CSS module import handled by Vite
import './SolutionPool.css';

// ═══════════════════════════════════════════════════════════════════════
// Shared Sub-components
// ═══════════════════════════════════════════════════════════════════════

const Collapsible: React.FC<{
    toggleClassName: string;
    icon: string;
    label: string;
    children: React.ReactNode;
}> = ({ toggleClassName, icon, label, children }) => {
    const [collapsed, setCollapsed] = useState(true);
    return (
        <>
            <button className={toggleClassName} onClick={() => setCollapsed(c => !c)}>
                <Icon name={icon} />
                {label}
                <Icon name={collapsed ? 'expand_more' : 'expand_less'} className="sp-critique-chevron" />
            </button>
            <div className={`sp-critique-body${collapsed ? ' sp-collapsed' : ''}`}>
                {children}
            </div>
        </>
    );
};

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

        {solution.key_insights && (
            <Collapsible toggleClassName="sp-critique-toggle" icon="tips_and_updates" label="Key Insights">
                <RenderMathMarkdown content={solution.key_insights} />
            </Collapsible>
        )}

        {solution.internal_critique && (
            <Collapsible toggleClassName="sp-critique-toggle" icon="psychology_alt" label="Internal Critique">
                <RenderMathMarkdown content={solution.internal_critique} />
            </Collapsible>
        )}
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
        return (
            <div className="sp-cards-grid">
                {parsed.solutions.map((s, i) => <SolutionCard key={i} solution={s} index={i} />)}
            </div>
        );
    }

    // Fallback: try re-parsing raw response
    if (poolAgent.poolResponse) {
        try {
            const data = JSON.parse(poolAgent.poolResponse);
            if (data && Array.isArray(data.solutions)) {
                return (
                    <div className="sp-cards-grid">
                        {data.solutions.map((s: any, i: number) => (
                            <SolutionCard key={i} index={i} solution={{
                                title: s.title || `Solution ${i + 1}`,
                                content: s.content || '',
                                confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
                                internal_critique: s.internal_critique || '',
                                key_insights: s.key_insights || '',
                            }} />
                        ))}
                    </div>
                );
            }
        } catch { /* fall through */ }
        return <RawTextFallback content={poolAgent.poolResponse} />;
    }

    return <RawTextFallback content="No pool data available." />;
};

// ═══════════════════════════════════════════════════════════════════════
// Full Repository View (Current Solution Pool)
// ═══════════════════════════════════════════════════════════════════════

const TimelineSection: React.FC<{ content: string; className: string }> = ({ content, className }) => (
    <div className={`sp-timeline-section ${className}`}>
        <RenderMathMarkdown content={content} className="sp-timeline-section-content" />
    </div>
);

const PoolLabel: React.FC<{ icon: string; text: string; className?: string }> = ({ icon, text, className = 'sp-pool-label' }) => (
    <div className={className}>
        <Icon name={icon} /> {text}
    </div>
);

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

const StrategySection: React.FC<{
    strategy: any;
    stratIdx: number;
}> = ({ strategy, stratIdx }) => {
    const strategyText = strategy.strategy_text || '';
    const subtitle = strategyText.length > 120 ? strategyText.slice(0, 120) + '…' : strategyText;

    const parsedPool: SolutionPoolParsedResponse | null =
        strategy.solution_pool && typeof strategy.solution_pool === 'object' && strategy.solution_pool.solutions
            ? strategy.solution_pool
            : null;

    const firstCritique = strategy.iterations?.[0]?.critique;
    const lastIteration = strategy.iterations?.[strategy.iterations.length - 1];
    const latestCritique = strategy.latest_critique || lastIteration?.critique;

    return (
        <div className="sp-strategy-section" style={{ animationDelay: `${stratIdx * 0.08}s` }}>
            <div className="sp-strategy-section-header">
                <Icon name="deployed_code" />
                <h3>{strategy.strategy_id?.toUpperCase() || `Strategy ${stratIdx + 1}`}</h3>
                {strategyText && <span className="sp-strategy-subtitle">{subtitle}</span>}
            </div>

            {/* 1. Original solution */}
            {strategy.original_solution && (
                <>
                    <PoolLabel icon="code" text="Original Executed Solution" className="sp-pool-label sp-original-label" />
                    <TimelineSection content={strategy.original_solution} className="sp-timeline-corrected" />
                </>
            )}

            {/* 2. First critique */}
            {firstCritique && (
                <>
                    <PoolLabel icon="rate_review" text="Initial Critique" className="sp-pool-label sp-critique-label" />
                    <TimelineSection content={firstCritique} className="sp-timeline-critique" />
                </>
            )}

            {/* 3. Memory bank */}
            {strategy.memory_bank && (
                <>
                    <PoolLabel icon="database" text="Current Memory Bank" className="sp-pool-label" />
                    <TimelineSection content={strategy.memory_bank} className="sp-timeline-corrected" />
                </>
            )}

            {Array.isArray(strategy.replaced_branches) && strategy.replaced_branches.length > 0 && (
                <>
                    <PoolLabel icon="history" text="Replaced Branches Preserved" className="sp-pool-label" />
                    <div className="sp-replaced-branches">
                        {strategy.replaced_branches.map((branch: any) => (
                            <div key={`${branch.strategy_id}-${branch.branch_version}`} className="sp-replaced-branch-card">
                                <div className="sp-replaced-branch-header">
                                    <strong>{String(branch.strategy_id || '').toUpperCase()} · Branch v{branch.branch_version}</strong>
                                    <span>Replaced at iteration {branch.replaced_at_global_iteration}</span>
                                </div>
                                <TimelineSection content={branch.strategy_text || 'No previous strategy text recorded.'} className="sp-timeline-corrected" />
                                {branch.memory_bank && (
                                    <>
                                        <PoolLabel icon="database" text="Retired Branch Memory Bank" className="sp-pool-label" />
                                        <TimelineSection content={branch.memory_bank} className="sp-timeline-corrected" />
                                    </>
                                )}
                                {branch.latest_critique && (
                                    <>
                                        <PoolLabel icon="rate_review" text="Final Retired Branch Critique" className="sp-pool-label sp-critique-label" />
                                        <TimelineSection content={branch.latest_critique} className="sp-timeline-critique" />
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* 4. Compressed iterations banner (imported snapshots only) */}
            {strategy.compressed_iterations_note && (
                <div className="sp-compressed-banner">
                    <Icon name="compress" />
                    <span>{strategy.compressed_iterations_note}</span>
                </div>
            )}

            {/* 5. Latest correction */}
            {lastIteration?.corrected_solution && (
                <>
                    <PoolLabel icon="auto_fix_high" text="Latest Correction" className="sp-pool-label sp-corrected-label" />
                    <TimelineSection content={lastIteration.corrected_solution} className="sp-timeline-corrected" />
                </>
            )}

            {/* 6. Latest critique */}
            {latestCritique && latestCritique !== firstCritique && (
                <>
                    <PoolLabel icon="rate_review" text="Latest Critique" className="sp-pool-label sp-critique-label" />
                    <TimelineSection content={latestCritique} className="sp-timeline-critique" />
                </>
            )}

            {/* 7. Full solution pool cards */}
            {parsedPool?.solutions ? (
                <>
                    <PoolLabel icon="auto_awesome" text="Solution Pool" />
                    <div className="sp-cards-grid">
                        {parsedPool.solutions.map((s, i) => <SolutionCard key={i} solution={s} index={i} />)}
                    </div>
                </>
            ) : typeof strategy.solution_pool === 'string' ? (
                <RawTextFallback content={strategy.solution_pool} />
            ) : null}
        </div>
    );
};

const CurrentSolutionPoolContent: React.FC<{ poolJson: string }> = ({ poolJson }) => {
    try {
        const poolData = JSON.parse(poolJson);
        if (poolData && Array.isArray(poolData.strategies)) {
            return (
                <>
                    {poolData.strategies.map((strategy: any, idx: number) => (
                        <StrategySection key={idx} strategy={strategy} stratIdx={idx} />
                    ))}
                </>
            );
        }
        return <RawTextFallback content={poolJson} />;
    } catch {
        return <RawTextFallback content={poolJson} />;
    }
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

    if (!process.structuredSolutionPool?.trim()) {
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

    const poolAgents = process.structuredSolutionPoolAgents || [];
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
                                    const hasPool = hasPoolResponse;
                                    const solutionCount = poolAgent?.parsedPoolResponse?.solutions?.length;

                                    return (
                                        <div key={branch.key} className={`agent-card${!hasPool ? ' pool-pending' : ''}${branch.isActive ? '' : ' replaced-branch'}`}>
                                            <div className="agent-header">
                                                <h4 className="agent-title">{branch.label}</h4>
                                                {hasPool
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
                                                            data-strategy-id={branch.strategyId}
                                                            data-branch-version={branch.branchVersion}
                                                            data-iteration={iteration}
                                                        >
                                                            <Icon name="visibility" /> View Solution Pool
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div className="pool-empty-state-mini">
                                                        <Icon name="hourglass_empty" />
                                                        <span>{isError ? 'Failed' : 'Processing...'}</span>
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
            <button className="solution-pool-current-button" data-pipeline-id={processId}>
                <Icon name="database" /> Current Pool
            </button>
            <button className="solution-pool-download-button" data-pipeline-id={processId}>
                <Icon name="download" /> Download Pool (JSON)
            </button>
            <button className="solution-pool-evolution-button" data-pipeline-id={processId}>
                <Icon name="timeline" /> View Evolution
            </button>
        </div>
    </div>
);

// ═══════════════════════════════════════════════════════════════════════
// Imperative Mount Functions (called from Deepthink.ts event handlers)
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

export function openSolutionPoolModal(strategyId: string, iteration: number, branchVersion?: number): void {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline) return;

    const matchesBranch = (agent: any) => branchVersion === undefined || (agent.branchVersion || 1) === branchVersion;
    const poolAgent = pipeline.structuredSolutionPoolAgents?.find(a => a.mainStrategyId === strategyId && a.globalIteration === iteration && matchesBranch(a))
        || pipeline.structuredSolutionPoolAgents?.filter(a => a.mainStrategyId === strategyId && matchesBranch(a)).sort((a, b) => (b.globalIteration || 0) - (a.globalIteration || 0))[0];
    if (!poolAgent?.poolResponse) {
        alert('No solution pool available for this strategy.');
        return;
    }

    const title = `${strategyId.toUpperCase()}${branchVersion ? ` · Branch v${branchVersion}` : ''} — Iteration ${iteration} • Solution Pool`;
    const container = document.createElement('div');
    document.body.appendChild(container);
    unmountPanel();
    panelRoot = createRoot(container);

    const handleClose = () => {
        unmountPanel();
        container.remove();
    };

    panelRoot.render(
        <SolutionPoolPanel title={title} onClose={handleClose}>
            <SolutionPoolModalContent poolAgent={poolAgent} />
        </SolutionPoolPanel>
    );
}

export function openCurrentSolutionPool(pipelineId: string): void {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline || pipeline.id !== pipelineId) {
        alert('Pipeline not found.');
        return;
    }
    if (!pipeline.structuredSolutionPool?.trim()) {
        alert('No solution pool content available yet. The pool is still initializing.');
        return;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    unmountPanel();
    panelRoot = createRoot(container);

    const handleClose = () => {
        unmountPanel();
        container.remove();
    };

    panelRoot.render(
        <SolutionPoolPanel title="Solution Pool Repository" onClose={handleClose}>
            <CurrentSolutionPoolContent poolJson={pipeline.structuredSolutionPool} />
        </SolutionPoolPanel>
    );
}
