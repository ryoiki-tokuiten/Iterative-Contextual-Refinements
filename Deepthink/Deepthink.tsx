/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink — React components for the Deepthink pipeline UI.
 * All pure logic, state management, and event coordination lives in Deepthink.ts.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    DeepthinkPipelineState,
    DeepthinkMainStrategyData,
    DeepthinkSubStrategyData,
    DeepthinkHypothesisData,
} from './DeepthinkCore';
import { ActionButton } from '../Styles/Components/ActionButton';
import MathHTML from '../Styles/Components/RenderMathMarkdown';
import { Icon as MIcon } from '../UI/Icons';
import { AgentActivityPanel } from '../Styles/Components/AgentActivity/AgentActivityPanel';
import type { ProximityTurn } from './DeepthinkProximity';

// ═══════════════════════════════════════════════════════════════════════
// Shared Primitives
// ═══════════════════════════════════════════════════════════════════════

const solutionAttemptDisplay = (subStrategy: DeepthinkSubStrategyData): string =>
    subStrategy.solutionAttemptDisplay || subStrategy.solutionAttempt || '';

const refinedSolutionDisplay = (subStrategy: DeepthinkSubStrategyData): string =>
    subStrategy.refinedSolutionDisplay || subStrategy.refinedSolution || '';

const critiqueDisplay = (value: {
    critiqueResponseDisplay?: string;
    critiqueResponse?: string;
    solutionCritiqueDisplay?: string;
    solutionCritique?: string;
    error?: string;
}): string =>
    value.critiqueResponseDisplay || value.critiqueResponse || value.solutionCritiqueDisplay || value.solutionCritique || value.error || '';

const hypothesisTesterDisplay = (hypothesis: DeepthinkHypothesisData): string =>
    hypothesis.testerAttemptDisplay || hypothesis.testerAttempt || '';

const StatusBadge: React.FC<{ status: string; label?: string }> = ({ status, label }) => (
    <span className={`status-badge status-${status}`}>{label || status}</span>
);

const ProximityHistoryModal: React.FC<{
    kind: 'strategy' | 'hypothesis';
    history: ProximityTurn[];
    version: number;
    onClose: () => void;
}> = ({ kind, history, version, onClose }) => createPortal(
    <BaseModal title={`Proximity History - v${version}`} isEmbedded noPadding onClose={onClose}>
        <AgentActivityPanel
            title=""
            className="proximity-history-activity"
            style={{ height: 'min(68vh, 720px)' }}
        >
            {history.filter(turn => turn.version === version).map((turn, index) => {
                const isGenerator = turn.role === 'generator';
                return (
                    <article key={index} className={`adaptive-message-card ${isGenerator ? 'user-message' : 'agent-message'}`}>
                        <div className="message-header">
                            <MIcon name={isGenerator ? 'psychology' : 'manage_search'} />
                            <span className="message-role">
                                {isGenerator
                                    ? `${kind === 'strategy' ? 'Strategy' : 'Hypothesis'} Generator`
                                    : `${kind === 'strategy' ? 'Strategies' : 'Hypothesis'} Proximity`}
                            </span>
                            <span className="message-time">Turn {index + 1}</span>
                        </div>
                        <MathHTML content={turn.content} className="message-content" />
                    </article>
                );
            })}
        </AgentActivityPanel>
    </BaseModal>,
    document.body,
);

const ArtifactPane: React.FC<{
    artifact: string;
    emptyMessage: string;
}> = ({ artifact, emptyMessage }) => (
    <div>
        <MathHTML content={artifact || emptyMessage} />
    </div>
);

// ═══════════════════════════════════════════════════════════════════════
// Show More / Show Less Toggle
// ═══════════════════════════════════════════════════════════════════════

const ExpandableText: React.FC<{
    text: string;
    maxLength: number;
    containerClassName?: string;
    textClassName?: string;
}> = ({ text, maxLength, containerClassName, textClassName }) => {
    const [expanded, setExpanded] = useState(false);
    const isLong = text.length > maxLength;
    const display = expanded || !isLong ? text : text.substring(0, maxLength) + '...';

    return (
        <div className={containerClassName}>
            <MathHTML content={display} className={textClassName} />
            {isLong && (
                <div className="expandable-text-actions">
                    <button className="show-more-btn" onClick={() => setExpanded(e => !e)}>
                        {expanded ? 'Show Less' : 'Show More'}
                    </button>
                </div>
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Solution Modals (embedded + fullscreen)
// ═══════════════════════════════════════════════════════════════════════

export const BaseModal: React.FC<{
    title: string;
    isEmbedded?: boolean;
    className?: string;
    noPadding?: boolean;
    onClose: () => void;
    children: React.ReactNode;
}> = ({ title, isEmbedded, className, noPadding, onClose, children }) => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const overlayClass = isEmbedded ? 'embedded-modal-overlay' : 'modal-overlay is-visible';
    const contentClass = isEmbedded ? 'embedded-modal-content' : 'modal-content';

    return (
        <div
            className={`${overlayClass}${className ? ` ${className}` : ''}`}
            style={isEmbedded ? { position: 'fixed', zIndex: 1000, pointerEvents: 'auto' } : { display: 'flex' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className={contentClass} role={isEmbedded ? undefined : 'dialog'} aria-modal={isEmbedded ? undefined : true}>
                <div className="modal-header">
                    {title && (isEmbedded
                        ? <h4>{title}</h4>
                        : <h2 className="modal-title">{title}</h2>)}
                    <div className="embedded-modal-header-actions">
                        <button className={isEmbedded ? 'close-modal-btn' : 'modal-close-button'} onClick={onClose}>
                            <MIcon name="close" />
                        </button>
                    </div>
                </div>
                <div className={`modal-body${isEmbedded ? ' custom-scrollbar' : ''}`} style={noPadding ? { padding: 0 } : undefined}>
                    {children}
                </div>
            </div>
        </div>
    );
};

// Default (non-iterative) solution modal body
export const DefaultSolutionUI: React.FC<{
    subStrategy: DeepthinkSubStrategyData;
    refinementEnabled: boolean;
}> = ({ subStrategy, refinementEnabled }) => {
    const refinementWasPerformed = subStrategy.refinedSolution !== subStrategy.solutionAttempt;
    const attemptContent = solutionAttemptDisplay(subStrategy);
    const refinedContent = refinedSolutionDisplay(subStrategy);

    return (
        <div className="solution-comparison-grid" style={{ gridTemplateColumns: refinementEnabled ? '1fr 1fr' : '1fr' }}>
            <div className="solution-panel">
                <div className="solution-panel-header">
                    <h4 style={{ margin: 0 }}><MIcon name="psychology" />{refinementEnabled ? 'Attempted Solution' : 'Solution'}</h4>
                </div>
                <div className="solution-panel-body">
                    <ArtifactPane
                        artifact={attemptContent}
                        emptyMessage="Solution not available"
                    />
                </div>
            </div>

            <div className={`solution-panel${!refinementWasPerformed ? ' disabled-pane' : ''}`} style={!refinementWasPerformed ? { position: 'relative' } : undefined}>
                <div className="solution-panel-header">
                    <h4 style={{ margin: 0, ...(!refinementEnabled ? { opacity: 0.6 } : {}) }}>
                        <MIcon name={refinementEnabled ? 'auto_fix_high' : 'auto_fix_off'} />
                        {refinementEnabled ? 'Refined Solution' : 'Refined Solution (Disabled)'}
                    </h4>
                </div>
                <div className="solution-panel-body" style={!refinementWasPerformed ? { position: 'relative' } : undefined}>
                    <ArtifactPane
                        artifact={refinementEnabled
                            ? (refinedContent || 'Refined solution not available')
                            : (refinedContent || attemptContent || 'Solution refinement is disabled')}
                        emptyMessage="Refined solution not available"
                    />
                    {!refinementWasPerformed && <div className="disabled-overlay">Refinement Disabled</div>}
                </div>
            </div>
        </div>
    );
};

// Fullscreen sub-strategy comparison modal body
export const SubStrategyComparisonUI: React.FC<{
    subStrategy: DeepthinkSubStrategyData;
    refinementEnabled: boolean;
}> = ({ subStrategy, refinementEnabled }) => {
    const refinementWasPerformed = subStrategy.refinedSolution !== subStrategy.solutionAttempt;
    const refinedIcon = refinementEnabled ? 'verified' : 'auto_fix_off';
    const refinedTitle = refinementEnabled ? 'Refined Solution' : 'Refined Solution (Disabled)';
    const attemptContent = solutionAttemptDisplay(subStrategy);
    const refinedContent = refinedSolutionDisplay(subStrategy);
    const attemptDisplay = attemptContent || 'No solution attempt available';
    const refinedDisplay = refinedContent || 'No refined solution available';

    return (
        <div className="solution-comparison-grid">
            <div className="solution-panel">
                <div className="solution-panel-header">
                    <h4 className="comparison-title no-padding-left">
                        <MIcon name="psychology" /><span>Solution Attempt</span>
                    </h4>
                    <div className="code-actions">
                        <ActionButton
                            type="copy"
                            content={attemptContent}
                            icon="content_copy"
                            text="Copy"
                            className="copy-solution-btn"
                        />
                        <ActionButton
                            type="download"
                            content={attemptContent}
                            filename="solution-attempt.md"
                            icon="download"
                            text="Download"
                            className="download-solution-btn"
                        />
                    </div>
                </div>
                <div className="solution-panel-body custom-scrollbar">
                    <MathHTML content={attemptDisplay} />
                </div>
            </div>

            <div className={`solution-panel${refinementWasPerformed ? '' : ' disabled-pane'}`}>
                <div className="solution-panel-header">
                    <h4 className="comparison-title no-padding-left">
                        <MIcon name={refinedIcon} /><span>{refinedTitle}</span>
                    </h4>
                    <div className="code-actions">
                        <ActionButton
                            type="copy"
                            disabled={!refinementWasPerformed}
                            content={refinedContent}
                            icon="content_copy"
                            text="Copy"
                            className="copy-solution-btn"
                        />
                        <ActionButton
                            type="download"
                            disabled={!refinementWasPerformed}
                            content={refinedContent}
                            filename="refined-solution.md"
                            icon="download"
                            text="Download"
                            className="download-solution-btn"
                        />
                    </div>
                </div>
                <div className="solution-panel-body custom-scrollbar">
                    <MathHTML content={refinedDisplay} />
                    {subStrategy.error && <div className="error-content">{subStrategy.error}</div>}
                    {!refinementWasPerformed && <div className="disabled-overlay">Refinement Disabled</div>}
                </div>
            </div>
        </div>
    );
};

// Embedded modals (critique, hypothesis argument, post quality filter)
export const EmbeddedModalContent: React.FC<{
    content: string;
    contentClass?: string;
}> = ({ content, contentClass = 'critique-content' }) => (
    <div className="deepthink-embedded-response">
        <div>
            <MathHTML content={content} className={contentClass} />
        </div>
    </div>
);

interface StructuredReasoningEvaluation {
    id: string;
    decision: string;
    reasoning: string;
}

interface StructuredReasoningViewModel {
    challenge?: string;
    analysisSummary?: string;
    narrative?: string;
    evaluations: StructuredReasoningEvaluation[];
}

function parseStructuredReasoning(reasoning: unknown): StructuredReasoningViewModel {
    const fallbackText = typeof reasoning === 'string'
        ? reasoning
        : reasoning
            ? JSON.stringify(reasoning, null, 2)
            : '';

    let parsed: Record<string, any> | null = null;
    if (typeof reasoning === 'string') {
        try {
            parsed = JSON.parse(reasoning);
        } catch {
            parsed = null;
        }
    } else if (reasoning && typeof reasoning === 'object') {
        parsed = reasoning as Record<string, any>;
    }

    const evaluationsSource = Array.isArray(parsed?.strategy_evaluations)
        ? parsed?.strategy_evaluations
        : Array.isArray(parsed?.strategies)
            ? parsed?.strategies
            : [];

    return {
        challenge: typeof parsed?.challenge === 'string' ? parsed.challenge : undefined,
        analysisSummary: typeof parsed?.analysis_summary === 'string' ? parsed.analysis_summary : undefined,
        narrative: typeof parsed?.reasoning === 'string'
            ? parsed.reasoning
            : typeof parsed?.explanation === 'string'
                ? parsed.explanation
                : typeof parsed?.analysis === 'string'
                    ? parsed.analysis
                    : fallbackText,
        evaluations: evaluationsSource
            .filter((evaluation: any) => evaluation && typeof evaluation === 'object')
            .map((evaluation: any) => ({
                id: String(evaluation.id || evaluation.strategy_id || 'Unknown ID'),
                decision: String(evaluation.decision || evaluation.verdict || evaluation.action || 'unknown'),
                reasoning: String(evaluation.reason || evaluation.reasoning || evaluation.explanation || 'No reasoning provided'),
            })),
    };
}

const StructuredReasoningContent: React.FC<{
    reasoning: unknown;
    wrapperClassName?: string;
    resultsClassName?: string;
    emptyMessage?: string;
}> = ({
    reasoning,
    wrapperClassName = 'agent-reasoning-display',
    resultsClassName = 'evaluation-results',
    emptyMessage = 'No analysis available',
}) => {
    const parsed = React.useMemo(() => parseStructuredReasoning(reasoning), [reasoning]);

    const body = parsed.evaluations.length > 0 || parsed.challenge || parsed.analysisSummary
        ? (
            <div className={resultsClassName}>
                {parsed.challenge && <h4>Challenge Evaluation: {parsed.challenge}</h4>}
                {parsed.analysisSummary && (
                    <>
                        <h4>Analysis Summary</h4>
                        <div className="evaluation-reason">
                            <MathHTML content={parsed.analysisSummary} />
                        </div>
                    </>
                )}
                {parsed.evaluations.map((evaluation, index) => (
                    <div key={`${evaluation.id}-${index}`} className="strategy-evaluation-item">
                        <div className="evaluation-header">
                            <span className="strategy-id">{evaluation.id}</span>
                            <span className={`decision-badge decision-${evaluation.decision.toLowerCase()}`}>{evaluation.decision}</span>
                        </div>
                        <div className="evaluation-reason">
                            <MathHTML content={evaluation.reasoning} />
                        </div>
                    </div>
                ))}
            </div>
        )
        : <MathHTML content={parsed.narrative || emptyMessage} className="agent-analysis" />;

    if (!wrapperClassName) {
        return <>{body}</>;
    }

    return <div className={wrapperClassName}>{body}</div>;
};

export const StructuredResponseModalContent: React.FC<{
    reasoning: unknown;
    resultsClassName?: string;
    emptyMessage?: string;
}> = ({ reasoning, resultsClassName, emptyMessage }) => (
    <div className="deepthink-embedded-response">
        <div>
            <StructuredReasoningContent
                reasoning={reasoning}
                resultsClassName={resultsClassName}
                emptyMessage={emptyMessage}
            />
        </div>
    </div>
);

// ═══════════════════════════════════════════════════════════════════════
// Tab Content Components
// ═══════════════════════════════════════════════════════════════════════

// Strategic Solver Tab
export const StrategicSolverTab: React.FC<{
    process: DeepthinkPipelineState;
    escapeHtml: (s: string) => string;
    onStrategyTabClick: (idx: number) => void;
    onViewSolution: (subStrategyId: string, branchVersion?: number) => void;
}> = ({ process, escapeHtml, onStrategyTabClick, onViewSolution }) => {
    const [proximityVersion, setProximityVersion] = useState<number | null>(null);
    const proximityVersions = Array.from(new Set((process.strategyGenerationHistory || []).map(turn => turn.version))).sort((a, b) => a - b);

    if (process.status === 'error' && process.error) {
        return <div className="status-message error"><pre>{escapeHtml(process.error)}</pre></div>;
    }
    if (!process.initialStrategies?.length) {
        return <div className="loading">Generating strategic approaches...</div>;
    }

    const activeIndex = process.activeStrategyTab || 0;

    return (
        <div className="deepthink-strategic-solver">
            <div className="sub-tabs-container">
                <div className="sub-tabs-content">
                    {process.initialStrategies.map((strategy, index) => (
                        <div key={strategy.id} className={`sub-tab-content${index === activeIndex ? ' active' : ''}`}>
                            <div className="strategy-card">
                                {/* Nav buttons */}
                                <div className="sub-tabs-nav">
                                    <div className="proximity-history-nav">
                                        {proximityVersions.map(version => (
                                            <button
                                                key={version}
                                                type="button"
                                            className="view-solution-button proximity-history-pill"
                                            onClick={() => setProximityVersion(version)}
                                        >
                                                Proximity -v{version}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="strategy-tab-number-grid">
                                        {process.initialStrategies.map((s, idx) => (
                                            <button
                                                key={s.id}
                                                className={`sub-tab-button${idx === activeIndex ? ' active' : ''}`}
                                                title={`Strategy ${idx + 1}`}
                                                onClick={() => onStrategyTabClick(idx)}
                                            >
                                                {idx + 1}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <StrategyContent
                                    strategy={strategy}
                                    escapeHtml={escapeHtml}
                                    onViewSolution={onViewSolution}
                                />

                                {/* Sub-strategies grid (skip mode = no grid) */}
                                {!(strategy.subStrategies.length === 1 && strategy.subStrategies[0].id.endsWith('-direct')) && (
                                    <SubStrategiesGrid
                                        subStrategies={strategy.subStrategies}
                                        escapeHtml={escapeHtml}
                                        onViewSolution={onViewSolution}
                                    />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            {proximityVersion !== null && (
                <ProximityHistoryModal
                    kind="strategy"
                    history={process.strategyGenerationHistory || []}
                    version={proximityVersion}
                    onClose={() => setProximityVersion(null)}
                />
            )}
        </div>
    );
};

const StrategyContent: React.FC<{
    strategy: DeepthinkMainStrategyData;
    escapeHtml: (s: string) => string;
    onViewSolution: (id: string, branchVersion?: number) => void;
}> = ({ strategy, escapeHtml, onViewSolution }) => {
    const isSkipMode = strategy.subStrategies.length === 1 && strategy.subStrategies[0].id.endsWith('-direct');
    const directSub = isSkipMode ? strategy.subStrategies[0] : null;
    const currentBranchVersion = strategy.branchVersion || 1;
    const branchViews = [
        ...(strategy.replacementHistory || []).map(record => ({
            version: record.previousBranchVersion,
            isCurrent: false,
            strategyText: record.previousStrategyText,
            replacedAt: record.replacedAtGlobalIteration,
            reason: record.pqfReasoning,
            memoryBank: record.memoryBank,
            latestCritique: record.latestCritiqueDisplay || record.latestCritique,
            latestSolution: record.latestSolutionDisplay || record.latestSolution,
        })),
        {
            version: currentBranchVersion,
            isCurrent: true,
            strategyText: strategy.strategyText,
            replacedAt: undefined,
            reason: strategy.updatedByPostQualityFilter
                ? `Created after Evolution Filter update at iteration ${strategy.postQualityFilterIteration}.`
                : undefined,
            memoryBank: strategy.memoryBank,
            latestCritique: directSub ? critiqueDisplay(directSub) : undefined,
            latestSolution: directSub ? refinedSolutionDisplay(directSub) || solutionAttemptDisplay(directSub) : undefined,
        },
    ];
    const [selectedBranchVersion, setSelectedBranchVersion] = useState(currentBranchVersion);
    useEffect(() => {
        setSelectedBranchVersion(currentBranchVersion);
    }, [currentBranchVersion]);
    const selectedBranch = branchViews.find(branch => branch.version === selectedBranchVersion) || branchViews[branchViews.length - 1];
    const preservedCards = [
        selectedBranch.reason ? { title: 'Evolution Filter Reasoning', icon: 'shield', content: selectedBranch.reason } : null,
        selectedBranch.memoryBank ? { title: 'Preserved Memory Bank', icon: 'database', content: selectedBranch.memoryBank } : null,
        selectedBranch.latestCritique ? { title: 'Preserved Critique', icon: 'rate_review', content: selectedBranch.latestCritique } : null,
    ].filter(Boolean) as Array<{ title: string; icon: string; content: string }>;

    return (
        <div className="strategy-content">
            {branchViews.length > 1 && (
                <div className="strategy-branch-switcher">
                    <div className="strategy-branch-switcher-title">
                        <MIcon name="account_tree" />
                        Branches
                    </div>
                    <div className="strategy-branch-circles" aria-label="Strategy branch selector">
                        {branchViews.map(branch => (
                            <button
                                key={branch.version}
                                type="button"
                                className={`strategy-branch-circle${branch.version === selectedBranch.version ? ' active' : ''}${branch.isCurrent ? ' current' : ''}`}
                                title={`${branch.isCurrent ? 'Current' : 'Preserved'} branch v${branch.version}`}
                                onClick={() => setSelectedBranchVersion(branch.version)}
                            >
                                {branch.version}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {(branchViews.length > 1 || selectedBranch.reason || !selectedBranch.isCurrent) && (
                <div className="strategy-branch-summary">
                    <span className="strategy-branch-pill">
                        Branch v{selectedBranch.version}{selectedBranch.isCurrent ? ' · Current' : ` · Replaced at iteration ${selectedBranch.replacedAt || 'unknown'}`}
                    </span>
                    {selectedBranch.isCurrent && selectedBranch.reason && (
                        <span className="strategy-branch-origin">{selectedBranch.reason}</span>
                    )}
                </div>
            )}
            <ExpandableText
                text={selectedBranch.strategyText}
                maxLength={200}
                containerClassName="strategy-text-container"
                textClassName="strategy-text"
            />
            {!selectedBranch.isCurrent && preservedCards.length > 0 && (
                <div className="strategy-preserved-card-row">
                    {preservedCards.map(card => (
                        <div key={card.title} className="strategy-preserved-card">
                            <div className="strategy-preserved-card-title">
                                <MIcon name={card.icon} />
                                {card.title}
                            </div>
                            <MathHTML content={card.content} className="strategy-preserved-card-content" />
                        </div>
                    ))}
                </div>
            )}
            <div className="strategy-actions" style={{ display: 'flex', gap: '8px' }}>
                {isSkipMode && directSub && (
                    <button
                        className="view-solution-button"
                        onClick={() => onViewSolution(directSub!.id, selectedBranch.version)}
                    >
                        <MIcon name="visibility" /> {selectedBranch.isCurrent ? 'View Solution' : 'View Branch History'}
                    </button>
                )}
            </div>
            {strategy.error && <div className="error-message">{escapeHtml(strategy.error)}</div>}
        </div>
    );
};

const SubStrategiesGrid: React.FC<{
    subStrategies: DeepthinkSubStrategyData[];
    escapeHtml: (s: string) => string;
    onViewSolution: (id: string, branchVersion?: number) => void;
}> = ({ subStrategies, escapeHtml, onViewSolution }) => {
    if (!subStrategies?.length) return null;

    return (
        <div className="agent-grid">
            {subStrategies.map((sub, index) => {
                return (
                    <div key={sub.id} className="agent-card">
                        <div className="agent-header">
                            <h4 className="agent-title">Sub-Strategy {index + 1}</h4>
                            <StatusBadge
                                status={sub.refinedSolution ? 'completed' : sub.solutionAttempt ? 'processing' : 'pending'}
                                label={sub.refinedSolution ? 'Completed' : sub.solutionAttempt ? 'Processing (1/2)' : 'Processing'}
                            />
                        </div>
                        <div className="agent-results">
                            <div className="sub-strategy-content-wrapper">
                                <ExpandableText
                                    text={sub.subStrategyText || 'No sub-strategy text available'}
                                    maxLength={150}
                                    containerClassName="sub-strategy-text-container"
                                    textClassName="sub-strategy-text"
                                />
                                <div className="sub-strategy-actions">
                                    {sub.id && (
                                        <button
                                            className="view-solution-button"
                                            onClick={() => onViewSolution(sub.id)}
                                        >
                                            <MIcon name="visibility" /> View Solution
                                        </button>
                                    )}
                                </div>
                            </div>
                            {sub.error && <div className="error-message">{escapeHtml(sub.error)}</div>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const formatStrategyId = (id: string): string => {
    if (id.startsWith('main')) {
        const num = id.slice(4);
        return `Strategy ${num}`;
    }
    return id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const formatStrategyCircleLabel = (id: string): string => {
    if (id.startsWith('main')) return id.slice(4);
    const match = id.match(/\d+/);
    return match?.[0] || id.slice(0, 2).toUpperCase();
};

function resolveCritiqueBranchVersion(critique: any, _strategy?: DeepthinkMainStrategyData): number {
    if (typeof critique.branchVersion === 'number' && critique.branchVersion > 0) return critique.branchVersion;
    if (typeof critique.branchVersion === 'string') {
        const parsed = parseInt(critique.branchVersion, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 1;
}

type HypothesisRoundView = {
    key: string;
    label: string;
    roundNumber?: number;
    hypotheses: DeepthinkHypothesisData[];
    packet: string;
};

function hypothesisRoundLabel(roundNumber: number): string {
    const start = Math.max(1, (roundNumber - 1) * 2 + 1);
    return `Iteration-${start},${start + 1}`;
}

function buildHypothesisRoundViews(process: DeepthinkPipelineState): HypothesisRoundView[] {
    const rounds = process.hypothesisRounds || [];
    if (rounds.length === 0) {
        const roundNumber = process.hypotheses[0]?.roundNumber;
        return [{
            key: 'current',
            label: hypothesisRoundLabel(roundNumber || 1),
            roundNumber,
            hypotheses: process.hypotheses || [],
            packet: process.knowledgePacket || '',
        }];
    }

    const history = process.hypothesisHistory || [];
    return rounds.map((round, index) => {
        const historicalHypotheses = history[index];
        const liveHypotheses = process.hypotheses?.filter(h => h.roundNumber === round.roundNumber) || [];
        const hypotheses = historicalHypotheses?.length ? historicalHypotheses : liveHypotheses.length ? liveHypotheses : process.hypotheses || [];
        return {
            key: `round-${round.roundNumber}`,
            label: hypothesisRoundLabel(round.roundNumber),
            roundNumber: round.roundNumber,
            hypotheses,
            packet: round.packet || process.knowledgePacket || '',
        };
    });
}

// Hypothesis Explorer Tab
export const HypothesisExplorerTab: React.FC<{
    process: DeepthinkPipelineState;
    onViewArgument: (hypothesisId: string) => void;
}> = ({ process, onViewArgument }) => {
    const roundViews = buildHypothesisRoundViews(process);
    const [activeRoundIndex, setActiveRoundIndex] = useState(Math.max(0, roundViews.length - 1));
    const [proximityVersion, setProximityVersion] = useState<number | null>(null);
    useEffect(() => {
        setActiveRoundIndex(Math.max(0, roundViews.length - 1));
    }, [roundViews.length]);
    const activeRound = roundViews[Math.min(activeRoundIndex, roundViews.length - 1)] || roundViews[0];
    const activeHypotheses = activeRound?.hypotheses || [];
    const activeProximityVersion = activeRound?.roundNumber
        ?? Math.max(0, ...(process.hypothesisGenerationHistory || []).map(turn => turn.version));
    const hasProximityHistory = (process.hypothesisGenerationHistory || []).some(turn => turn.version === activeProximityVersion);

    if (process.hypothesisGenStatus === 'processing' && !roundViews.some(round => round.hypotheses.length)) return <div className="loading">Generating and testing hypotheses...</div>;
    if (!roundViews.some(round => round.hypotheses.length))
        return <div className="status-message">Hypothesis exploration not yet started.</div>;

    return (
        <div className="deepthink-hypothesis-explorer">
            <div className="hypothesis-round-layout">
                <div className="hypothesis-round-pills" aria-label="Hypothesis heartbeat rounds">
                    {roundViews.map((round, index) => (
                        <button
                            key={round.key}
                            type="button"
                            className={`hypothesis-round-pill${index === activeRoundIndex ? ' active' : ''}`}
                            onClick={() => setActiveRoundIndex(index)}
                        >
                            {round.label}
                        </button>
                    ))}
                </div>

                <div className="hypothesis-round-content">
                    {hasProximityHistory && (
                        <button
                            type="button"
                            className="view-solution-button proximity-history-pill"
                            onClick={() => setProximityVersion(activeProximityVersion)}
                        >
                            <MIcon name="forum" /> Proximity
                        </button>
                    )}
                    <div className="agent-grid hypothesis-agent-grid">
                        {activeHypotheses.map((h, i) => (
                            <div key={h.id} className="agent-card">
                                <div className="agent-header hypothesis-card-header">
                                    <h4 className="agent-title">Hypothesis {i + 1}</h4>
                                    <StatusBadge
                                        status={h.testerStatus}
                                        label={h.testerStatus === 'completed' ? 'Completed' : h.testerStatus === 'processing' ? 'Processing' : 'Pending'}
                                    />
                                </div>
                                <div className="agent-results">
                                    <div className="hypothesis-targets">
                                        <span>Targeting:</span>
                                        {process.runConfig?.hypothesisInjectionMode === 'selective_injection' ? (
                                            h.targetStrategyIds && h.targetStrategyIds.length > 0 ? (
                                                h.targetStrategyIds.map(id => (
                                                    <span key={id} className="strategy-target-badge">
                                                        {formatStrategyId(id)}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="strategy-target-badge fallback">All (Fallback)</span>
                                            )
                                        ) : (
                                            <span className="strategy-target-badge">All Strategies</span>
                                        )}
                                    </div>
                                    <ExpandableText
                                        text={h.hypothesisText || 'No hypothesis text'}
                                        maxLength={150}
                                        containerClassName="hypothesis-text-container"
                                        textClassName="hypothesis-text"
                                    />
                                    {hypothesisTesterDisplay(h) && (
                                        <button
                                            className="view-argument-button"
                                            onClick={() => onViewArgument(h.id)}
                                        >
                                            <MIcon name="article" /> View The Argument
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {proximityVersion !== null && (
                <ProximityHistoryModal
                    kind="hypothesis"
                    history={process.hypothesisGenerationHistory || []}
                    version={proximityVersion}
                    onClose={() => setProximityVersion(null)}
                />
            )}

            {activeRound?.packet && (
                <KnowledgePacketSection
                    content={activeRound.packet}
                    process={process}
                    hypotheses={activeHypotheses}
                />
            )}
        </div>
    );
};

const KnowledgePacketSection: React.FC<{
    content: string;
    process: DeepthinkPipelineState;
    hypotheses?: DeepthinkHypothesisData[];
}> = ({ content, process, hypotheses }) => {
    const [copiedState, setCopiedState] = useState(false);

    const handleCopyXml = async () => {
        await navigator.clipboard.writeText(content).catch(console.error);
        setCopiedState(true);
        setTimeout(() => setCopiedState(false), 2000);
    };

    const handleDownloadXml = () => {
        const blob = new Blob([content], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'information_packet.xml';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Parse hypothesis sections if present
    let packetBody: React.ReactNode;
    if (content.includes('<Full Information Packet>')) {
        const hypothesisRegex = /<Hypothesis ([^>]+)>\s*Hypothesis:\s*([\s\S]*?)(?:\s*Target Strategies:\s*[^\n]+)?\s*Hypothesis Testing:\s*([\s\S]*?)\s*<\/Hypothesis \1>/g;
        const matches: Array<{ number: string; hypothesis: string; testing: string }> = [];
        let match;
        while ((match = hypothesisRegex.exec(content)) !== null) {
            matches.push({ number: match[1], hypothesis: match[2], testing: match[3] });
        }

        if (matches.length > 0) {
            packetBody = matches.map((m, i) => (
                <details key={i} className="hypothesis-details" style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', overflow: 'hidden' }}>
                    <summary style={{ padding: '1rem', background: 'rgba(var(--card-bg-base-rgb), 0.5)', cursor: 'pointer', fontWeight: 600, listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <MIcon name="chevron_right" className="dropdown-icon" />
                        Hypothesis {m.number}
                    </summary>
                    <div className="hypothesis-details-content" style={{ padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
                        <div className="hypothesis-block" style={{ marginBottom: '1.5rem' }}>
                            <strong style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--accent-blue)' }}>Hypothesis:</strong>
                            <MathHTML content={m.hypothesis.trim()} className="hypothesis-description" />
                        </div>
                        <div className="hypothesis-testing">
                            <strong style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--accent-purple)' }}>Hypothesis Testing:</strong>
                            <MathHTML content={m.testing.trim()} className="testing-output" />
                        </div>
                    </div>
                </details>
            ));
        } else {
            packetBody = <MathHTML content={content} />;
        }
    } else {
        packetBody = <MathHTML content={content} />;
    }

    // Resolve strategy-to-hypothesis mapping
    const strategyMappings = React.useMemo(() => {
        const mappedSource = hypotheses || process.hypotheses;
        if (!mappedSource || !process.initialStrategies) return null;

        return process.initialStrategies.map(strategy => {
            const mappedHypotheses: number[] = [];

            mappedSource.forEach((h, index) => {
                const hypNum = index + 1; // 1-based index corresponding to Hypothesis 1, 2...
                
                if (process.runConfig?.hypothesisInjectionMode !== 'selective_injection') {
                    mappedHypotheses.push(hypNum);
                } else {
                    const isMapped = h.targetStrategyIds?.includes(strategy.id);
                    const isFallback = !h.targetStrategyIds || h.targetStrategyIds.length === 0;
                    if (isMapped || isFallback) {
                        mappedHypotheses.push(hypNum);
                    }
                }
            });

            return {
                strategyId: strategy.id,
                strategyText: strategy.strategyText,
                hypotheses: mappedHypotheses
            };
        });
    }, [hypotheses, process.hypotheses, process.initialStrategies, process.runConfig?.hypothesisInjectionMode]);

    return (
        <div className="knowledge-packet-section">
            <div className="knowledge-packet-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div className="knowledge-packet-title"><MIcon name="psychology" /><span>Full Information Packet</span></div>
                <div className="code-actions" style={{ marginTop: 0 }}>
                    <button className="action-btn copy-xml-btn" onClick={handleCopyXml}>
                        <MIcon name={copiedState ? 'check' : 'content_copy'} /> {copiedState ? 'Copied' : 'XML'}
                    </button>
                    <button className="action-btn download-xml-btn" onClick={handleDownloadXml}>
                        <MIcon name="download" /> XML
                    </button>
                </div>
            </div>
            <div className="knowledge-packet-content">
                <div className="knowledge-packet-card">
                    {strategyMappings && strategyMappings.length > 0 && (
                        <div className="strategy-hypothesis-mappings" style={{
                            marginBottom: '1.25rem',
                            padding: '0.85rem 1rem',
                            background: 'rgba(var(--accent-purple-rgb), 0.04)',
                            border: '1px solid rgba(var(--accent-purple-rgb), 0.15)',
                            borderRadius: '12px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--accent-purple)', fontWeight: 600, fontSize: '0.85rem' }}>
                                <MIcon name="hub" style={{ fontSize: '16px' }} />
                                <span>Resolved Hypothesis Mappings</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {strategyMappings.map(mapping => {
                                    const strategyName = formatStrategyId(mapping.strategyId);
                                    return (
                                        <div key={mapping.strategyId} style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-color)' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--text-color)', minWidth: '95px' }}>{strategyName}:</span>
                                            <span style={{ marginLeft: '8px', color: 'var(--text-color)' }}>
                                                {mapping.hypotheses.length > 0 ? (
                                                    mapping.hypotheses.map(num => `Hypothesis ${num}`).join(', ')
                                                ) : (
                                                    <span style={{ fontStyle: 'italic', color: 'var(--text-secondary-color)' }}>None</span>
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {packetBody}
                </div>
            </div>
        </div>
    );
};

// Dissected Observations Tab
export const DissectedObservationsTab: React.FC<{
    process: DeepthinkPipelineState;
    refinementEnabled: boolean;
    evolvingDfsEnabled: boolean;
    onViewCritique: (critiqueId: string) => void;
    onViewSubStrategyCritique: (subId: string) => void;
}> = ({ process, refinementEnabled, evolvingDfsEnabled, onViewCritique, onViewSubStrategyCritique }) => {
    const hasExistingCritique = process.solutionCritiques?.length > 0;
    const hasSubStrategyCritiques = evolvingDfsEnabled && process.initialStrategies.some(s =>
        s.subStrategies.some(sub => (sub.solutionCritique?.length ?? 0) > 0)
    );
    const selectableStrategies = process.initialStrategies.filter(strategy =>
        process.solutionCritiques.some(critique => critique.mainStrategyId === strategy.id)
    );
    const [selectedStrategyId, setSelectedStrategyId] = useState(selectableStrategies[0]?.id || process.initialStrategies[0]?.id || '');
    useEffect(() => {
        if (!selectedStrategyId || !selectableStrategies.some(strategy => strategy.id === selectedStrategyId)) {
            setSelectedStrategyId(selectableStrategies[0]?.id || process.initialStrategies[0]?.id || '');
        }
    }, [selectableStrategies.length, selectedStrategyId, process.initialStrategies.length]);

    const selectedStrategy = process.initialStrategies.find(strategy => strategy.id === selectedStrategyId);
    const selectedCritiques = process.solutionCritiques
        .filter(critique => critique.mainStrategyId === selectedStrategyId)
        .sort((a, b) => {
            const branchDiff = resolveCritiqueBranchVersion(a, selectedStrategy) - resolveCritiqueBranchVersion(b, selectedStrategy);
            if (branchDiff !== 0) return branchDiff;
            const iterationDiff = (a.branchIteration || 0) - (b.branchIteration || 0);
            if (iterationDiff !== 0) return iterationDiff;
            return (a.globalIteration || 0) - (b.globalIteration || 0);
        });

    if (process.solutionCritiquesStatus === 'processing' && !hasExistingCritique) return <div className="loading">Critiquing solutions...</div>;
    if (!refinementEnabled && !hasExistingCritique && !hasSubStrategyCritiques)
        return <div className="status-message">Dissected Observations are only available when refinement is enabled.</div>;
    if (!hasSubStrategyCritiques && !hasExistingCritique && (process.solutionCritiquesStatus as string) !== 'processing')
        return <div className="status-message">Solution critiques not yet started. Waiting for solutions to be generated.</div>;

    return (
        <div className="deepthink-dissected-observations">
            {hasExistingCritique ? (
                <div className="dissected-observations-layout">
                    <div className="dissected-strategy-pills" aria-label="Critique strategy filter">
                        {selectableStrategies.map(strategy => (
                            <button
                                key={strategy.id}
                                type="button"
                                className={`dissected-strategy-pill${strategy.id === selectedStrategyId ? ' active' : ''}`}
                                title={formatStrategyId(strategy.id)}
                                onClick={() => setSelectedStrategyId(strategy.id)}
                            >
                                {formatStrategyCircleLabel(strategy.id)}
                            </button>
                        ))}
                    </div>

                    <section className="dissected-strategy-panel">
                        <div className="dissected-strategy-panel-header">
                            <div>
                                <h4>{selectedStrategy ? formatStrategyId(selectedStrategy.id) : 'Selected Strategy'}</h4>
                                <p>{selectedStrategy?.strategyText || 'No strategy text available.'}</p>
                            </div>
                            <span className="status-badge status-completed">{selectedCritiques.length} critiques</span>
                        </div>
                        <div className="dissected-critique-rail custom-scrollbar">
                            {selectedCritiques.map((critique, index) => {
                                const resolvedBranchVersion = resolveCritiqueBranchVersion(critique, selectedStrategy);
                                const label = critique.branchIteration
                                    ? `Iteration ${critique.branchIteration}`
                                    : critique.globalIteration
                                        ? `Global ${critique.globalIteration}`
                                        : `Critique ${index + 1}`;
                                const branchLabel = `Branch v${resolvedBranchVersion}`;
                                return (
                                    <article key={critique.id} className="dissected-critique-card">
                                        <div className="dissected-critique-card-header">
                                            <div>
                                                <span className="dissected-critique-branch">{branchLabel}</span>
                                                <h5>{label}</h5>
                                            </div>
                                            <StatusBadge status={critique.status} />
                                        </div>
                                        <div className="dissected-critique-preview">
                                            <MathHTML
                                                content={critiqueDisplay(critique) || 'Critique is still processing.'}
                                                className="critique-content"
                                            />
                                        </div>
                                        {critique.critiqueResponse ? (
                                            <button
                                                className="view-critique-button"
                                                onClick={() => onViewCritique(critique.id)}
                                            >
                                                <MIcon name="rate_review" /> View Full Critique
                                            </button>
                                        ) : critique.status === 'error' ? (
                                            <div className="error-message">{critique.error || 'Critique failed'}</div>
                                        ) : null}
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                </div>
            ) : hasSubStrategyCritiques ? (
                <div className="agent-grid">
                    {process.initialStrategies.map(mainStrategy => {
                        const directSub = mainStrategy.subStrategies[0];
                        if (!directSub?.solutionCritique) return null;
                        const status = directSub.solutionCritiqueStatus || 'completed';

                        return (
                            <div key={mainStrategy.id} className="agent-card">
                                <div className="agent-header">
                                    <h4 className="agent-title">Critique: {mainStrategy.id}</h4>
                                    <StatusBadge status={status} />
                                </div>
                                <div className="agent-results">
                                    <div className="sub-strategy-text-container">
                                        <div className="sub-strategy-label">Strategy:</div>
                                        <MathHTML content={mainStrategy.strategyText?.substring(0, 150) + '...' || ''} className="sub-strategy-text" />
                                    </div>
                                    <div className="agent-reasoning-section">
                                        <button
                                            className="view-critique-button"
                                            onClick={() => onViewSubStrategyCritique(directSub.id)}
                                        >
                                            <MIcon name="rate_review" /> View Full Critique
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* Synthesis Section */}
            {!evolvingDfsEnabled && process.dissectedSynthesisStatus && (
                <div className="synthesis-section">
                    <div className="synthesis-header">
                        <div className="synthesis-title"><MIcon name="integration_instructions" /><span>Dissected Observations Synthesis:</span></div>
                        <div className="synthesis-actions">
                            <StatusBadge
                                status={process.dissectedSynthesisStatus}
                                label={process.dissectedSynthesisStatus === 'completed' ? 'Synthesis Complete' : process.dissectedSynthesisStatus === 'processing' ? 'Synthesizing...' : 'Pending'}
                            />
                            {process.dissectedObservationsSynthesis && (
                                <ActionButton
                                    type="download"
                                    icon="download"
                                    text="Download"
                                    title="Download dissected observations synthesis"
                                    content={process.dissectedObservationsSynthesis}
                                    filename="dissected_observations_synthesis.md"
                                />
                            )}
                        </div>
                    </div>
                    {process.dissectedObservationsSynthesis && (
                        <div className="synthesis-content"><MathHTML content={process.dissectedObservationsSynthesis} className="synthesis-card" /></div>
                    )}
                    {process.dissectedSynthesisStatus === 'error' && (
                        <div className="error-message">{process.dissectedSynthesisError || 'Synthesis failed'}</div>
                    )}
                </div>
            )}
        </div>
    );
};

// Evolution Filter Tab
export const EvolutionFilterTab: React.FC<{
    process: DeepthinkPipelineState;
    onViewReasoning: (agentId: string) => void;
}> = ({ process, onViewReasoning }) => {
    const hasPostQF = process.postQualityFilterAgents?.length > 0;

    if (!hasPostQF) {
        return <div className="deepthink-evolution-filter"><div className="status-message">Evolution filter not yet started.</div></div>;
    }

    return (
        <div className="deepthink-evolution-filter">
            <div className="agent-grid">
                {process.postQualityFilterAgents.map(agent => {
                    const updateCount = agent.prunedStrategyIds?.length || 0;
                    const keepCount = agent.continuedStrategyIds?.length || 0;
                    return (
                        <div key={agent.id} className="agent-card">
                            <div className="agent-header">
                                <h4 className="agent-title">
                                    PQF Iteration {agent.iterationNumber}{agent.groupIndex !== undefined ? ` / Group ${agent.groupIndex + 1}` : ''}
                                </h4>
                                <StatusBadge status={agent.status} />
                            </div>
                            <div className="agent-results">
                                <div className="evaluation-summary">
                                    <div className="evaluation-metric"><span className="metric-value">{updateCount}</span><span className="metric-label">Strategies Updated</span></div>
                                    <div className="evaluation-metric"><span className="metric-value">{keepCount}</span><span className="metric-label">Strategies Kept</span></div>
                                </div>
                                {(updateCount > 0 || keepCount > 0) && (
                                    <div className="updated-items">
                                        {updateCount > 0 && <p><strong>Updated:</strong> {agent.prunedStrategyIds.join(', ')}</p>}
                                        {keepCount > 0 && <p><strong>Kept:</strong> {agent.continuedStrategyIds.join(', ')}</p>}
                                    </div>
                                )}
                                {agent.reasoning && (
                                    <div className="agent-reasoning-section">
                                        <button
                                            type="button"
                                            className="reasoning-fullscreen-btn reasoning-pill"
                                            onClick={() => onViewReasoning(agent.id)}
                                        >
                                            <div className="pill-content">
                                                <MIcon name="code" className="pill-icon" />
                                                <div className="pill-text">
                                                    <span className="pill-label">Analysis</span>
                                                    <span className="pill-subtext">{(updateCount > 0 || keepCount > 0) ? 'Iteration decisions' : 'View agent notes'}</span>
                                                </div>
                                            </div>
                                            <MIcon name="open_in_new" className="pill-action-icon" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Final Result Tab
export const FinalResultTab: React.FC<{
    process: DeepthinkPipelineState;
    escapeHtml: (s: string) => string;
}> = ({ process, escapeHtml }) => (
    <div className="deepthink-final-result">
        {process.finalJudgingStatus === 'completed' && process.finalJudgedBestSolution
            ? (
                <div className="judged-solution-container final-judged-solution">
                    <MathHTML content={process.finalJudgedBestSolution} />
                </div>
            )
            : process.finalJudgingStatus === 'processing'
                ? <div className="loading">Final judging in progress...</div>
                : process.finalJudgingStatus === 'error'
                    ? <div className="status-message error"><p>Error during final judging:</p><pre>{escapeHtml(process.finalJudgingError || 'Unknown error')}</pre></div>
                    : process.status === 'completed'
                        ? <div className="status-message">Final result not available</div>
                        : <div className="status-message">Waiting for solution completion...</div>}
    </div>
);
