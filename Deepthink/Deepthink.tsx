/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deepthink — React components for the Deepthink pipeline UI.
 * All pure logic, state management, and event coordination lives in Deepthink.ts.
 */

import React, { useEffect, useState } from 'react';
import {
    DeepthinkPipelineState,
    DeepthinkMainStrategyData,
    DeepthinkSubStrategyData,
} from './DeepthinkCore';
import { ActionButton } from '../Styles/Components/ActionButton';
import RenderMathMarkdown from '../Styles/Components/RenderMathMarkdown';
import { Icon } from '../UI/Icons';

// ═══════════════════════════════════════════════════════════════════════
// Shared Primitives
// ═══════════════════════════════════════════════════════════════════════

const MIcon = Icon;

const MathHTML: React.FC<{ content: string; className?: string }> = ({ content, className }) => (
    <RenderMathMarkdown content={content} className={className} />
);

const StatusBadge: React.FC<{ status: string; label?: string }> = ({ status, label }) => (
    <span className={`status-badge status-${status}`}>{label || status}</span>
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
                    <button className={isEmbedded ? 'close-modal-btn' : 'modal-close-button'} onClick={onClose}>
                        <MIcon name="close" />
                    </button>
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

    return (
        <div className="solution-comparison-grid" style={{ gridTemplateColumns: refinementEnabled ? '1fr 1fr' : '1fr' }}>
            <div className="solution-panel">
                <div className="solution-panel-header">
                    <h4 style={{ margin: 0 }}><MIcon name="psychology" />{refinementEnabled ? 'Attempted Solution' : 'Solution'}</h4>
                </div>
                <MathHTML content={subStrategy.solutionAttempt || 'Solution not available'} className="solution-panel-body" />
            </div>

            <div className={`solution-panel${!refinementWasPerformed ? ' disabled-pane' : ''}`} style={!refinementWasPerformed ? { position: 'relative' } : undefined}>
                <div className="solution-panel-header">
                    <h4 style={{ margin: 0, ...(!refinementEnabled ? { opacity: 0.6 } : {}) }}>
                        <MIcon name={refinementEnabled ? 'auto_fix_high' : 'auto_fix_off'} />
                        {refinementEnabled ? 'Refined Solution' : 'Refined Solution (Disabled)'}
                    </h4>
                </div>
                <div className="solution-panel-body" style={!refinementWasPerformed ? { position: 'relative' } : undefined}>
                    <MathHTML content={refinementEnabled
                        ? (subStrategy.refinedSolution || 'Refined solution not available')
                        : (subStrategy.refinedSolution || subStrategy.solutionAttempt || 'Solution refinement is disabled')} />
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
    escapeHtml: (s: string) => string;
}> = ({ subStrategy, refinementEnabled }) => {
    const refinementWasPerformed = subStrategy.refinedSolution !== subStrategy.solutionAttempt;
    const refinedIcon = refinementEnabled ? 'verified' : 'auto_fix_off';
    const refinedTitle = refinementEnabled ? 'Refined Solution' : 'Refined Solution (Disabled)';



    return (
        <div className="side-by-side-comparison">
            <div className="comparison-side">
                <div className="preview-header">
                    <h4 className="comparison-title no-padding-left">
                        <MIcon name="psychology" /><span>Solution Attempt</span>
                    </h4>
                    <div className="code-actions">
                        <ActionButton
                            type="copy"
                            content={subStrategy.solutionAttempt || ''}
                            icon="content_copy"
                            text="Copy"
                            className="copy-solution-btn"
                        />
                        <ActionButton
                            type="download"
                            content={subStrategy.solutionAttempt || ''}
                            filename="solution-attempt.md"
                            icon="download"
                            text="Download"
                            className="download-solution-btn"
                        />
                    </div>
                </div>
                <div className="comparison-content custom-scrollbar">
                    {subStrategy.solutionAttempt
                        ? <MathHTML content={subStrategy.solutionAttempt} />
                        : <div className="no-content">No solution attempt available</div>}
                </div>
            </div>

            <div className={`comparison-side${refinementWasPerformed ? '' : ' disabled-pane'}`}>
                <div className="preview-header">
                    <h4 className="comparison-title no-padding-left">
                        <MIcon name={refinedIcon} /><span>{refinedTitle}</span>
                    </h4>
                    <div className="code-actions">
                        <ActionButton
                            type="copy"
                            disabled={!refinementWasPerformed}
                            content={subStrategy.refinedSolution || ''}
                            icon="content_copy"
                            text="Copy"
                            className="copy-solution-btn"
                        />
                        <ActionButton
                            type="download"
                            disabled={!refinementWasPerformed}
                            content={subStrategy.refinedSolution || ''}
                            filename="refined-solution.md"
                            icon="download"
                            text="Download"
                            className="download-solution-btn"
                        />
                    </div>
                </div>
                <div className="comparison-content custom-scrollbar">
                    {subStrategy.refinedSolution
                        ? <MathHTML content={subStrategy.refinedSolution} />
                        : <div className="no-content">No refined solution available</div>}
                    {subStrategy.error && <div className="error-content">{subStrategy.error}</div>}
                    {!refinementWasPerformed && <div className="disabled-overlay">Refinement Disabled</div>}
                </div>
            </div>
        </div>
    );
};

// Embedded modals (critique, hypothesis argument, red team reasoning, post quality filter)
export const EmbeddedModalContent: React.FC<{
    content: string;
    contentClass?: string;
}> = ({ content, contentClass = 'critique-content' }) => (
    <MathHTML content={content} className={contentClass} />
);

interface StructuredReasoningEvaluation {
    id: string;
    decision: string;
    reasoning: string;
}

interface StructuredReasoningViewModel {
    challenge?: string;
    analysisSummary?: string;
    strategyInfo?: string;
    verdict?: string;
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
        strategyInfo: typeof parsed?.strategy_id === 'string'
            ? parsed.strategy_id
            : typeof parsed?.strategy === 'string'
                ? parsed.strategy
                : undefined,
        verdict: typeof parsed?.verdict === 'string'
            ? parsed.verdict
            : typeof parsed?.decision === 'string'
                ? parsed.decision
                : typeof parsed?.action === 'string'
                    ? parsed.action
                    : undefined,
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

export const StructuredReasoningContent: React.FC<{
    reasoning: unknown;
    wrapperClassName?: string;
    resultsClassName?: string;
    emptyMessage?: string;
}> = ({
    reasoning,
    wrapperClassName = 'red-team-reasoning-display',
    resultsClassName = 'red-team-evaluation-results',
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
        : <MathHTML content={parsed.narrative || emptyMessage} className="red-team-analysis" />;

    if (!wrapperClassName) {
        return <>{body}</>;
    }

    return <div className={wrapperClassName}>{body}</div>;
};

export const RedTeamReasoningContent: React.FC<{ agent: any; reasoningData?: unknown }> = ({ agent, reasoningData }) => {
    const parsed = React.useMemo(
        () => parseStructuredReasoning(reasoningData ?? agent.reasoning),
        [agent.reasoning, reasoningData]
    );
    const verdictClass = parsed.verdict && /eliminate/i.test(parsed.verdict) ? 'verdict-eliminate' : 'verdict-keep';

    return (
        <div className="red-team-reasoning-display">
            {parsed.strategyInfo && <div className="red-team-strategy-id">{parsed.strategyInfo}</div>}
            {parsed.verdict && <div className={`red-team-verdict ${verdictClass}`}>{parsed.verdict}</div>}
            <StructuredReasoningContent
                reasoning={reasoningData ?? agent.reasoning}
                wrapperClassName=""
            />
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Tab Content Components
// ═══════════════════════════════════════════════════════════════════════

// Strategic Solver Tab
export const StrategicSolverTab: React.FC<{
    process: DeepthinkPipelineState;
    escapeHtml: (s: string) => string;
    onStrategyTabClick: (idx: number) => void;
    onViewSolution: (subStrategyId: string) => void;
}> = ({ process, escapeHtml, onStrategyTabClick, onViewSolution }) => {
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
                        <div key={strategy.id} className={`sub-tab-content${index === activeIndex ? ' active' : ''}`} data-strategy-index={index}>
                            <div className={`strategy-card${strategy.isKilledByRedTeam ? ' killed-strategy' : ''}`}>
                                {/* Nav buttons */}
                                <div className="sub-tabs-nav">
                                    {process.initialStrategies.map((s, idx) => (
                                        <button
                                            key={s.id}
                                            className={`sub-tab-button${idx === activeIndex ? ' active' : ''}${s.isKilledByRedTeam ? ' killed-strategy' : ''}`}
                                            title={`Strategy ${idx + 1}`}
                                            data-strategy-index={idx}
                                            onClick={() => onStrategyTabClick(idx)}
                                        >
                                            {idx + 1}
                                        </button>
                                    ))}
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
        </div>
    );
};

const StrategyContent: React.FC<{
    strategy: DeepthinkMainStrategyData;
    escapeHtml: (s: string) => string;
    onViewSolution: (id: string) => void;
}> = ({ strategy, escapeHtml, onViewSolution }) => {
    const isSkipMode = strategy.subStrategies.length === 1 && strategy.subStrategies[0].id.endsWith('-direct');
    const directSub = isSkipMode ? strategy.subStrategies[0] : null;

    return (
        <div className="strategy-content">
            <ExpandableText
                text={strategy.strategyText}
                maxLength={200}
                containerClassName="strategy-text-container"
                textClassName="strategy-text"
            />
            <div className="strategy-actions">
                {isSkipMode && directSub && (
                    <button
                        className="view-solution-button"
                        data-sub-strategy-id={directSub!.id}
                        onClick={() => onViewSolution(directSub!.id)}
                    >
                        <MIcon name="visibility" /> View Solution
                    </button>
                )}
            </div>
            {strategy.error && <div className="error-message">{escapeHtml(strategy.error)}</div>}
            {strategy.isKilledByRedTeam && (
                <div className="elimination-reason">{escapeHtml(strategy.redTeamReason || 'Eliminated by Red Team')}</div>
            )}
        </div>
    );
};

const SubStrategiesGrid: React.FC<{
    subStrategies: DeepthinkSubStrategyData[];
    escapeHtml: (s: string) => string;
    onViewSolution: (id: string) => void;
}> = ({ subStrategies, escapeHtml, onViewSolution }) => {
    if (!subStrategies?.length) return null;

    return (
        <div className="red-team-agents-grid">
            {subStrategies.map((sub, index) => {
                return (
                    <div key={sub.id} className={`red-team-agent-card${sub.isKilledByRedTeam ? ' killed-sub-strategy' : ''}`}>
                        <div className="red-team-agent-header">
                            <h4 className="red-team-agent-title">Sub-Strategy {index + 1}</h4>
                            <StatusBadge
                                status={sub.refinedSolution ? 'completed' : sub.solutionAttempt ? 'processing' : 'pending'}
                                label={sub.refinedSolution ? 'Completed' : sub.solutionAttempt ? 'Processing (1/2)' : 'Processing'}
                            />
                        </div>
                        <div className="red-team-results">
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
                                            data-sub-strategy-id={sub.id}
                                            onClick={() => onViewSolution(sub.id)}
                                        >
                                            <MIcon name="visibility" /> View Solution
                                        </button>
                                    )}
                                </div>
                            </div>
                            {sub.error && <div className="error-message">{escapeHtml(sub.error)}</div>}
                            {sub.isKilledByRedTeam && (
                                <div className="elimination-reason">{escapeHtml(sub.redTeamReason || 'Eliminated by Red Team')}</div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// Hypothesis Explorer Tab
export const HypothesisExplorerTab: React.FC<{
    process: DeepthinkPipelineState;
    escapeHtml: (s: string) => string;
    onViewArgument: (hypothesisId: string) => void;
}> = ({ process, escapeHtml, onViewArgument }) => {
    if (process.hypothesisGenStatus === 'processing') return <div className="loading">Generating and testing hypotheses...</div>;
    if (process.hypothesisGenStatus !== 'completed' || !process.hypotheses?.length)
        return <div className="status-message">Hypothesis exploration not yet started.</div>;

    return (
        <div className="deepthink-hypothesis-explorer">
            <div className="red-team-agents-grid">
                {process.hypotheses.map((h, i) => (
                    <div key={h.id} className="red-team-agent-card">
                        <div className="red-team-agent-header">
                            <h4 className="red-team-agent-title">Hypothesis {i + 1}</h4>
                            <StatusBadge
                                status={h.testerStatus}
                                label={h.testerStatus === 'completed' ? 'Completed' : h.testerStatus === 'processing' ? 'Processing' : 'Pending'}
                            />
                        </div>
                        <div className="red-team-results">
                            <ExpandableText
                                text={h.hypothesisText || 'No hypothesis text'}
                                maxLength={150}
                                containerClassName="hypothesis-text-container"
                                textClassName="hypothesis-text"
                            />
                            {h.testerAttempt && (
                                <div className="red-team-reasoning-section">
                                    <button
                                        className="view-argument-button"
                                        data-hypothesis-id={h.id}
                                        onClick={() => onViewArgument(h.id)}
                                    >
                                        <MIcon name="article" /> View The Argument
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {process.knowledgePacket && <KnowledgePacketSection content={process.knowledgePacket} escapeHtml={escapeHtml} />}
        </div>
    );
};

const KnowledgePacketSection: React.FC<{ content: string; escapeHtml: (s: string) => string }> = ({ content }) => {
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
        const hypothesisRegex = /<Hypothesis (\d+)>\s*Hypothesis:\s*(.*?)\s*Hypothesis Testing:\s*(.*?)\s*<\/Hypothesis \d+>/gs;
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
                <div className="knowledge-packet-card">{packetBody}</div>
            </div>
        </div>
    );
};

// Dissected Observations Tab
export const DissectedObservationsTab: React.FC<{
    process: DeepthinkPipelineState;
    refinementEnabled: boolean;
    iterativeCorrectionsEnabled: boolean;
    onViewCritique: (critiqueId: string) => void;
    onViewSubStrategyCritique: (subId: string) => void;
}> = ({ process, refinementEnabled, iterativeCorrectionsEnabled, onViewCritique, onViewSubStrategyCritique }) => {
    const hasExistingCritique = process.solutionCritiques?.length > 0;
    const hasSubStrategyCritiques = iterativeCorrectionsEnabled && process.initialStrategies.some(s =>
        s.subStrategies.some(sub => (sub.solutionCritique?.length ?? 0) > 0)
    );

    if (process.solutionCritiquesStatus === 'processing') return <div className="loading">Critiquing solutions...</div>;
    if (!refinementEnabled && !hasExistingCritique && !hasSubStrategyCritiques)
        return <div className="status-message">Dissected Observations are only available when refinement is enabled.</div>;
    if (!hasSubStrategyCritiques && !hasExistingCritique && (process.solutionCritiquesStatus as string) !== 'processing')
        return <div className="status-message">Solution critiques not yet started. Waiting for solutions to be generated.</div>;

    return (
        <div className="deepthink-dissected-observations">
            <div className="red-team-agents-grid">
                {hasExistingCritique
                    ? process.solutionCritiques.map(critique => {
                        const mainStrategy = process.initialStrategies.find(s => s.id === critique.mainStrategyId);
                        const activeSub = mainStrategy?.subStrategies.filter(sub => !sub.isKilledByRedTeam && sub.solutionAttempt) || [];
                        const iterLabel = (critique as any).retryAttempt ? ` - Iteration ${(critique as any).retryAttempt}` : '';

                        return (
                            <div key={critique.id} className="red-team-agent-card">
                                <div className="red-team-agent-header">
                                    <h4 className="red-team-agent-title">Critique: {critique.mainStrategyId}{iterLabel}</h4>
                                    <StatusBadge status={critique.status} />
                                </div>
                                <div className="red-team-results">
                                    {mainStrategy && (
                                        <div className="sub-strategy-text-container">
                                            <div className="sub-strategy-label">Main Strategy:</div>
                                            <MathHTML content={mainStrategy.strategyText?.substring(0, 150) + '...' || ''} className="sub-strategy-text" />
                                            {!iterativeCorrectionsEnabled && (
                                                <div className="sub-strategy-label" style={{ marginTop: 8 }}>Sub-Strategies Critiqued: {activeSub.length}</div>
                                            )}
                                        </div>
                                    )}
                                    {critique.critiqueResponse ? (
                                        <div className="red-team-reasoning-section">
                                            <button
                                                className="view-critique-button"
                                                data-critique-id={critique.id}
                                                onClick={() => onViewCritique(critique.id)}
                                            >
                                                <MIcon name="rate_review" /> View Full Critique
                                            </button>
                                        </div>
                                    ) : critique.status === 'error' ? (
                                        <div className="error-message">{critique.error || 'Critique failed'}</div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                    : hasSubStrategyCritiques
                        ? process.initialStrategies.map(mainStrategy => {
                            const directSub = mainStrategy.subStrategies[0];
                            if (!directSub?.solutionCritique) return null;
                            const status = directSub.solutionCritiqueStatus || 'completed';

                            return (
                                <div key={mainStrategy.id} className="red-team-agent-card">
                                    <div className="red-team-agent-header">
                                        <h4 className="red-team-agent-title">Critique: {mainStrategy.id}</h4>
                                        <StatusBadge status={status} />
                                    </div>
                                    <div className="red-team-results">
                                        <div className="sub-strategy-text-container">
                                            <div className="sub-strategy-label">Strategy:</div>
                                            <MathHTML content={mainStrategy.strategyText?.substring(0, 150) + '...' || ''} className="sub-strategy-text" />
                                        </div>
                                        <div className="red-team-reasoning-section">
                                            <button
                                                className="view-critique-button"
                                                data-critique-substrategy-id={directSub.id}
                                                onClick={() => onViewSubStrategyCritique(directSub.id)}
                                            >
                                                <MIcon name="rate_review" /> View Full Critique
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                        : null}
            </div>

            {/* Synthesis Section */}
            {!iterativeCorrectionsEnabled && process.dissectedSynthesisStatus && (
                <div className="synthesis-section">
                    <div className="synthesis-header">
                        <div className="synthesis-title"><MIcon name="integration_instructions" /><span>Dissected Observations Synthesis:</span></div>
                        <StatusBadge
                            status={process.dissectedSynthesisStatus}
                            label={process.dissectedSynthesisStatus === 'completed' ? 'Synthesis Complete' : process.dissectedSynthesisStatus === 'processing' ? 'Synthesizing...' : 'Pending'}
                        />
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

// Red Team Tab
export const RedTeamTab: React.FC<{
    process: DeepthinkPipelineState;
    onViewReasoning: (agentId: string) => void;
}> = ({ process, onViewReasoning }) => {
    const hasRedTeam = process.redTeamEvaluations?.length > 0;
    const hasPostQF = process.postQualityFilterAgents?.length > 0;

    if (!hasRedTeam && !hasPostQF) {
        return <div className="deepthink-red-team"><div className="status-message">Red Team evaluation not yet started.</div></div>;
    }

    return (
        <div className="deepthink-red-team">
            {hasRedTeam && (
                <div className="red-team-agents-grid">
                    {process.redTeamEvaluations.map((agent, i) => {
                        const killedCount = (agent.killedStrategyIds?.length || 0) + (agent.killedSubStrategyIds?.length || 0);
                        return (
                            <div key={agent.id} className="red-team-agent-card">
                                <div className="red-team-agent-header">
                                    <h4 className="red-team-agent-title">
                                        {process.redTeamEvaluations.length === 1 ? 'Red Team Evaluation' : `Red Team Agent ${i + 1}`}
                                    </h4>
                                    <StatusBadge status={agent.status} />
                                </div>
                                <div className="red-team-results">
                                    <div className="red-team-evaluation-summary">
                                        <div className="evaluation-metric">
                                            <span className="metric-value">{killedCount}</span>
                                            <span className="metric-label">Items Eliminated</span>
                                        </div>
                                    </div>
                                    {killedCount > 0 && (
                                        <div className="killed-items">
                                            {agent.killedStrategyIds?.length > 0 && <p><strong>Eliminated Strategies:</strong> {agent.killedStrategyIds.join(', ')}</p>}
                                            {agent.killedSubStrategyIds?.length > 0 && <p><strong>Eliminated Sub-Strategies:</strong> {agent.killedSubStrategyIds.join(', ')}</p>}
                                        </div>
                                    )}
                                    {agent.reasoning && (
                                        <div className="red-team-reasoning-section">
                                            <button
                                                type="button"
                                                className="red-team-fullscreen-btn red-team-reasoning-pill"
                                                data-agent-id={agent.id}
                                                onClick={() => onViewReasoning(agent.id)}
                                            >
                                                <div className="pill-content">
                                                    <MIcon name="code" className="pill-icon" />
                                                    <div className="pill-text">
                                                        <span className="pill-label">Reasoning</span>
                                                        <span className="pill-subtext">{killedCount > 0 ? 'See elimination rationale' : 'View agent notes'}</span>
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
            )}

            {hasPostQF && (
                <>
                    <h3 className="red-team-section-title" style={{ marginTop: '2rem' }}>Post Quality Filter</h3>
                    <div className="red-team-agents-grid">
                        {process.postQualityFilterAgents.map(agent => {
                            const updateCount = agent.prunedStrategyIds?.length || 0;
                            const keepCount = agent.continuedStrategyIds?.length || 0;
                            return (
                                <div key={agent.id} className="red-team-agent-card">
                                    <div className="red-team-agent-header">
                                        <h4 className="red-team-agent-title">PostQF Iteration {agent.iterationNumber}</h4>
                                        <StatusBadge status={agent.status} />
                                    </div>
                                    <div className="red-team-results">
                                        <div className="red-team-evaluation-summary">
                                            <div className="evaluation-metric"><span className="metric-value">{updateCount}</span><span className="metric-label">Strategies Updated</span></div>
                                            <div className="evaluation-metric"><span className="metric-value">{keepCount}</span><span className="metric-label">Strategies Kept</span></div>
                                        </div>
                                        {(updateCount > 0 || keepCount > 0) && (
                                            <div className="killed-items">
                                                {updateCount > 0 && <p><strong>Updated:</strong> {agent.prunedStrategyIds.join(', ')}</p>}
                                                {keepCount > 0 && <p><strong>Kept:</strong> {agent.continuedStrategyIds.join(', ')}</p>}
                                            </div>
                                        )}
                                        {agent.reasoning && (
                                            <div className="red-team-reasoning-section">
                                                <button
                                                    type="button"
                                                    className="red-team-fullscreen-btn red-team-reasoning-pill"
                                                    data-agent-id={agent.id}
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
                </>
            )}
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
