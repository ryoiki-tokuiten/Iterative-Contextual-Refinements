/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeepthinkConfigPanel — React component for the configuration panel.
 * All business logic and state management lives in the controller (Routing/DeepthinkConfigController).
 * This file renders JSX exclusively.
 */

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { getDeepthinkConfigController, getProviderForCurrentModel } from '../Routing';
import { Icon } from '../UI/Icons';
import { disableSidebarCollapseButton } from '../UI/LayoutController';

export interface DeepthinkConfigPanelProps {
    strategiesCount: number;
    subStrategiesCount: number;
    hypothesisCount: number;
    skipSubStrategies: boolean;
    hypothesisEnabled: boolean;
    redTeamMode: string;
    postQualityFilterEnabled: boolean;
    refinementEnabled: boolean;
    dissectedObservationsEnabled: boolean;
    iterativeCorrectionsEnabled: boolean;
    iterativeDepth: number;
    provideAllSolutionsEnabled: boolean;
    codeExecutionEnabled: boolean;
    isGeminiProvider: boolean;
    hypothesisInjectionMode: 'parallel' | 'strategy_aware' | 'selective_injection';

    onStrategiesChange: (count: number) => void;
    onSubStrategiesChange: (count: number) => void;
    onHypothesisChange: (count: number) => void;
    onSkipSubStrategiesToggle: (skip: boolean) => void;
    onHypothesisToggle: (enabled: boolean) => void;
    onRedTeamModeChange: (mode: string) => void;
    onPostQualityFilterToggle: (enabled: boolean) => void;
    onRefinementToggle: (enabled: boolean) => void;
    onDissectedObservationsToggle: (enabled: boolean) => void;
    onIterativeCorrectionsToggle: (enabled: boolean) => void;
    onIterativeDepthChange: (depth: number) => void;
    onProvideAllSolutionsToggle: (enabled: boolean) => void;
    onCodeExecutionToggle: (enabled: boolean) => void;
    onHypothesisInjectionModeChange: (mode: 'parallel' | 'strategy_aware' | 'selective_injection') => void;
    shareHypothesesToDissected: boolean;
    onShareHypothesesToDissectedChange: (share: boolean) => void;
}

// ═══════════════════════════════════════════════════════════════════════
// Shared Helpers
// ═══════════════════════════════════════════════════════════════════════

const SliderWithFill: React.FC<{
    id: string;
    value: number;
    min: number;
    max: number;
    color: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}> = ({ id, value, min, max, color, disabled, onChange }) => {
    const percentage = max > min ? ((value - min) / (max - min)) * 100 : 0;
    const background = `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, var(--slider-track-color) ${percentage}%, var(--slider-track-color) 100%)`;

    return (
        <input
            type="range"
            id={id}
            className="slider"
            min={min}
            max={max}
            step={1}
            value={value}
            disabled={disabled}
            style={{ background }}
            onChange={e => onChange(parseInt(e.target.value))}
        />
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Sub-Sections
// ═══════════════════════════════════════════════════════════════════════

const allowedSubStrategies = [0, 2, 3, 4, 5];

const getSliderIndex = (value: number): number => {
    const idx = allowedSubStrategies.indexOf(value);
    if (idx !== -1) return idx;
    // Find closest index
    let closestIdx = 0;
    let minDiff = Math.abs(allowedSubStrategies[0] - value);
    for (let i = 1; i < allowedSubStrategies.length; i++) {
        const diff = Math.abs(allowedSubStrategies[i] - value);
        if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
        }
    }
    return closestIdx;
};

const StrategyExecutionSection: React.FC<{
    strategiesCount: number;
    subStrategiesCount: number;
    iterativeCorrectionsEnabled: boolean;
    onStrategiesChange: (v: number) => void;
    onSubStrategiesChange: (v: number) => void;
    onSkipSubStrategiesToggle: (skip: boolean) => void;
}> = ({ strategiesCount, subStrategiesCount, iterativeCorrectionsEnabled, onStrategiesChange, onSubStrategiesChange, onSkipSubStrategiesToggle }) => {
    const subIdx = getSliderIndex(subStrategiesCount);
    const subPercentage = (subIdx / (allowedSubStrategies.length - 1)) * 100;
    const subBackground = `linear-gradient(to right, #e86b6b 0%, #e86b6b ${subPercentage}%, var(--slider-track-color) ${subPercentage}%, var(--slider-track-color) 100%)`;

    return (
        <div className="strategy-execution-container">
            <div className="strategy-execution-header">
                <Icon name="account_tree" />
                <span>Strategy Execution</span>
            </div>
            <div className="strategy-execution-card">
                {/* Primary strategies */}
                <div className="strategy-execution-section">
                    <div className="input-group-tight">
                        <label htmlFor="dt-strategies-slider" className="input-label">
                            Strategies: <span id="dt-strategies-value">{strategiesCount}</span>
                        </label>
                        <SliderWithFill
                            id="dt-strategies-slider"
                            value={strategiesCount}
                            min={1}
                            max={10}
                            color="#e86b6b"
                            onChange={onStrategiesChange}
                        />
                    </div>
                </div>

                <div className="strategy-execution-divider" />

                {/* Sub-strategies */}
                <div className={`strategy-execution-section${subStrategiesCount === 0 ? ' dimmed' : ''}`}>
                    <div className="input-group-tight">
                        <label htmlFor="dt-sub-strategies-slider" className="input-label">
                            Sub-strategies: <span id="dt-sub-strategies-value">{subStrategiesCount}</span>
                            {subStrategiesCount === 0 && <span className="disabled-label">(Disabled)</span>}
                        </label>
                        <div className="slider-with-dots">
                            <input
                                type="range"
                                id="dt-sub-strategies-slider"
                                className="slider dots-slider"
                                min={0}
                                max={allowedSubStrategies.length - 1}
                                step={1}
                                value={subIdx}
                                disabled={iterativeCorrectionsEnabled}
                                style={{ background: subBackground }}
                                onChange={e => {
                                    const index = parseInt(e.target.value);
                                    const v = allowedSubStrategies[index];
                                    onSkipSubStrategiesToggle(v === 0);
                                    onSubStrategiesChange(v);
                                }}
                            />
                            <div className="slider-dots">
                                {allowedSubStrategies.map((val) => (
                                    <span key={val} className={`slider-dot${val <= subStrategiesCount ? ' active' : ''}`} data-value={val}>{val}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RedTeamSection: React.FC<{
    redTeamMode: string;
    postQualityFilterEnabled: boolean;
    iterativeCorrectionsEnabled: boolean;
    onRedTeamModeChange: (mode: string) => void;
    onPostQualityFilterToggle: (enabled: boolean) => void;
}> = ({ redTeamMode, postQualityFilterEnabled, iterativeCorrectionsEnabled, onRedTeamModeChange, onPostQualityFilterToggle }) => (
    <div className="red-team-options-container">
        <div className="red-team-options-header">
            <Icon name="security" />
            <span>Red Team Evaluation</span>
        </div>
        <div className="red-team-toggle-wrapper">
            <div className="red-team-buttons">
                {(['off', 'balanced', 'very_aggressive'] as const).map(mode => (
                    <button
                        key={mode}
                        type="button"
                        className={`red-team-button${redTeamMode === mode ? ' active' : ''}`}
                        data-value={mode}
                        onClick={() => onRedTeamModeChange(mode)}
                    >
                        {mode === 'off' ? 'Off' : mode === 'balanced' ? 'Balanced' : 'Aggressive'}
                    </button>
                ))}
            </div>
        </div>

        {/* Post Quality Filter */}
        <div className="post-quality-filter-card-wrapper">
            <div className={`refinement-method-card post-quality-filter-card${!iterativeCorrectionsEnabled ? ' disabled' : ''}`} data-method="postqualityfilter">
                <div className="method-card-header">
                    <div className="method-card-selector">
                        <input
                            type="checkbox"
                            id="dt-post-quality-filter-toggle"
                            className="method-checkbox"
                            checked={postQualityFilterEnabled}
                            disabled={!iterativeCorrectionsEnabled}
                            onChange={e => onPostQualityFilterToggle(e.target.checked)}
                        />
                        <label htmlFor="dt-post-quality-filter-toggle" className="method-checkbox-label">
                            <div className="method-checkbox-custom">
                                <Icon name="check" className="checkbox-icon" />
                            </div>
                        </label>
                    </div>
                    <div className="method-card-title">
                        <div className="method-name">Post Quality Filter</div>
                        <div className="method-type" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="account_tree" size="10" />
                            <span>Strategy Evolution</span>
                        </div>
                    </div>
                </div>
                <div className="method-card-description">
                    Requires Iterative Corrections enabled. Iteratively refines strategies based on execution quality.
                </div>
                <div className="refinement-card-vis post-quality-filter-vis">
                    {/* Stage 0 */}
                    <div className="vis-stage-column">
                        <div className="vis-strategy-node initial-node" title="Initial Strategy">
                            <Icon name="lightbulb" size="10" />
                            <span>S₀</span>
                        </div>
                        <div className="vis-critique-node-small" title="Critique 0">
                            <Icon name="rate_review" size="10" />
                            <span>C₀</span>
                        </div>
                    </div>

                    {/* Stage 0 -> PQF Connector */}
                    <div className="vis-connector-column">
                        <svg viewBox="0 0 40 40" className="converging-arrows-svg">
                            <path d="M5,8 C18,8 18,20 32,20" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <path d="M5,32 C18,32 18,20 32,20" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <polygon points="29,17 35,20 29,23" fill="var(--accent-pink)" opacity="0.8" />
                        </svg>
                    </div>

                    {/* PQF Agent 0 */}
                    <div className="vis-agent-column">
                        <div className="vis-evaluator-node" title="PQF Evaluator">
                            <Icon name="account_tree" size="11" className="evolution-icon" />
                        </div>
                    </div>

                    {/* PQF -> Stage 1 Connector */}
                    <div className="vis-connector-column">
                        <svg viewBox="0 0 30 40" className="evolving-arrow-svg">
                            <path d="M2,20 C10,20 12,8 22,8" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <polygon points="19,5 25,8 19,11" fill="var(--accent-pink)" opacity="0.8" />
                        </svg>
                    </div>

                    {/* Stage 1 */}
                    <div className="vis-stage-column">
                        <div className="vis-strategy-node evolved-node" title="Evolved Strategy 1">
                            <Icon name="lightbulb" size="10" />
                            <span>S₁</span>
                        </div>
                        <div className="vis-critique-node-small" title="Critique 1">
                            <Icon name="rate_review" size="10" />
                            <span>C₁</span>
                        </div>
                    </div>

                    {/* Stage 1 -> PQF Connector */}
                    <div className="vis-connector-column">
                        <svg viewBox="0 0 40 40" className="converging-arrows-svg">
                            <path d="M5,8 C18,8 18,20 32,20" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <path d="M5,32 C18,32 18,20 32,20" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <polygon points="29,17 35,20 29,23" fill="var(--accent-pink)" opacity="0.8" />
                        </svg>
                    </div>

                    {/* PQF Agent 1 */}
                    <div className="vis-agent-column">
                        <div className="vis-evaluator-node" title="PQF Evaluator">
                            <Icon name="account_tree" size="11" className="evolution-icon" />
                        </div>
                    </div>

                    {/* PQF -> Stage 2 Connector */}
                    <div className="vis-connector-column">
                        <svg viewBox="0 0 30 40" className="evolving-arrow-svg">
                            <path d="M2,20 C10,20 12,8 22,8" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <polygon points="19,5 25,8 19,11" fill="var(--accent-pink)" opacity="0.8" />
                        </svg>
                    </div>

                    {/* Stage 2 (Final) */}
                    <div className="vis-stage-column">
                        <div className="vis-strategy-node evolved-node-final" title="Evolved Strategy 2 (Final)">
                            <Icon name="lightbulb" size="10" />
                            <span>S₂</span>
                        </div>
                        <div className="vis-final-badge" title="Optimization Complete">
                            <Icon name="check" size="10" />
                            <span>OK</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const InformationPacketSection: React.FC<{
    hypothesisEnabled: boolean;
    hypothesisCount: number;
    hypothesisInjectionMode: 'parallel' | 'strategy_aware' | 'selective_injection';
    onHypothesisToggle: (enabled: boolean) => void;
    onHypothesisChange: (value: number) => void;
    onHypothesisInjectionModeChange: (mode: 'parallel' | 'strategy_aware' | 'selective_injection') => void;
}> = ({ hypothesisEnabled, hypothesisCount, hypothesisInjectionMode, onHypothesisToggle, onHypothesisChange, onHypothesisInjectionModeChange }) => (
    <div className="information-packet-container">
        <div className={`information-packet-window${!hypothesisEnabled ? ' collapsed' : ''}`} id="dt-information-packet-window">
            <div className="window-header">
                <div className="window-left">
                    <label className="window-toggle-label">
                        <input
                            type="checkbox"
                            id="dt-hypothesis-toggle"
                            className="window-toggle-input"
                            checked={hypothesisEnabled}
                            onChange={e => {
                                onHypothesisToggle(e.target.checked);
                                if (!e.target.checked) onHypothesisChange(0);
                            }}
                        />
                        <span className="window-toggle-slider" />
                    </label>
                    <div className="window-title">Information Packet</div>
                </div>
                <div className="window-right">
                    <div className="window-controls">
                        <div className="window-button close" />
                        <div className="window-button minimize" />
                        <div className="window-button maximize" />
                    </div>
                </div>
            </div>
            <div className="window-content" id="dt-information-packet-content">
                {hypothesisInjectionMode === 'parallel' && (
                    <div className="loading-info">
                        {Array.from({ length: 8 }, (_, i) => {
                            const widths = [85, 92, 78, 95, 68, 88, 90, 75];
                            return <div key={i} className="loading-line" style={{ width: `${widths[i]}%` }} />;
                        })}
                    </div>
                )}

                {hypothesisInjectionMode === 'strategy_aware' && (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', padding: '4px 0' }}>
                        {/* Top: 2 Strategy Cards */}
                        <div className="vis-strategies-row">
                            <div className="vis-strategy-card-mini">Strategy 1</div>
                            <div className="vis-strategy-card-mini">Strategy 2</div>
                        </div>

                        {/* Middle: Downward SVG arrows merging */}
                        <svg className="vis-descending-arrows" viewBox="0 0 200 30" style={{ height: '30px' }}>
                            <path d="M50,2 L95,28" stroke="var(--accent-purple)" strokeWidth="1.2" strokeDasharray="2 1" opacity="0.6" fill="none" />
                            <path d="M150,2 L105,28" stroke="var(--accent-purple)" strokeWidth="1.2" strokeDasharray="2 1" opacity="0.6" fill="none" />
                            <polygon points="97,24 100,30 103,24" fill="var(--accent-purple)" opacity="0.8" />
                        </svg>

                        {/* Bottom: Unified packet */}
                        <div className="loading-info" style={{ gap: '4px' }}>
                            {Array.from({ length: 3 }, (_, i) => {
                                const widths = [90, 75, 85];
                                return <div key={i} className="loading-line" style={{ width: `${widths[i]}%`, height: '6px' }} />;
                            })}
                        </div>
                    </div>
                )}

                {hypothesisInjectionMode === 'selective_injection' && (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', padding: '4px 0' }}>
                        {/* Top: 3 Strategy Cards */}
                        <div className="vis-strategies-row" style={{ gap: '4px' }}>
                            <div className="vis-strategy-card-mini" style={{ fontSize: '9.5px', padding: '6px 8px' }}>Strategy 1</div>
                            <div className="vis-strategy-card-mini" style={{ fontSize: '9.5px', padding: '6px 8px' }}>Strategy 2</div>
                            <div className="vis-strategy-card-mini" style={{ fontSize: '9.5px', padding: '6px 8px' }}>Strategy 3</div>
                        </div>

                        {/* Middle: 3 separate parallel descending arrows */}
                        <svg className="vis-descending-arrows" viewBox="0 0 300 15" preserveAspectRatio="none">
                            <path d="M50,2 L50,10" stroke="var(--accent-purple)" strokeWidth="1" strokeDasharray="2 1" opacity="0.6" fill="none" />
                            <polygon points="48,9 50,13 52,9" fill="var(--accent-purple)" opacity="0.8" />
                            <path d="M150,2 L150,10" stroke="var(--accent-purple)" strokeWidth="1" strokeDasharray="2 1" opacity="0.6" fill="none" />
                            <polygon points="148,9 150,13 152,9" fill="var(--accent-purple)" opacity="0.8" />
                            <path d="M250,2 L250,10" stroke="var(--accent-purple)" strokeWidth="1" strokeDasharray="2 1" opacity="0.6" fill="none" />
                            <polygon points="248,9 250,13 252,9" fill="var(--accent-purple)" opacity="0.8" />
                        </svg>

                        {/* Bottom: 3 Sub-packets side-by-side */}
                        <div className="vis-sub-packets-row">
                            <div className="vis-sub-packet">
                                <div className="vis-sub-packet-title">Sub-Pkt 1</div>
                                <div className="loading-line" style={{ width: '90%', height: '5px' }} />
                                <div className="loading-line" style={{ width: '70%', height: '5px' }} />
                            </div>
                            <div className="vis-sub-packet">
                                <div className="vis-sub-packet-title">Sub-Pkt 2</div>
                                <div className="loading-line" style={{ width: '80%', height: '5px' }} />
                                <div className="loading-line" style={{ width: '85%', height: '5px' }} />
                            </div>
                            <div className="vis-sub-packet">
                                <div className="vis-sub-packet-title">Sub-Pkt 3</div>
                                <div className="loading-line" style={{ width: '75%', height: '5px' }} />
                                <div className="loading-line" style={{ width: '90%', height: '5px' }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Execution agents SVG + labels — INSIDE the window */}
                <div className="execution-agents-visualization" id="dt-execution-agents-visualization">
                    <div className="connection-nodes">
                        {/*
                          Math for SVG coordinates (viewBox 0 0 400 40):
                          - 4 agent pills evenly across 400 units:
                            width_per_pill = 400/4 = 100
                            centers: 50, 150, 250, 350
                          - Parallel/Strategy-Aware: single source at center = 200
                          - Selective: 3 sub-packet sources evenly across 400:
                            width_per_pkt = 400/3 ≈ 133.3
                            centers: 66.7, 200, 333.3 → rounded to 67, 200, 333
                        */}
                        <svg className="connection-svg" viewBox="0 0 400 50" preserveAspectRatio="none">
                            <defs>
                                <linearGradient id="dtBlueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" style={{ stopColor: 'var(--accent-blue)', stopOpacity: 0.9 }} />
                                    <stop offset="100%" style={{ stopColor: 'var(--accent-blue)', stopOpacity: 0.3 }} />
                                </linearGradient>
                                <marker id="dtArrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                                    <path d="M 0 2 L 8 5 L 0 8 z" fill="var(--accent-blue)" />
                                </marker>
                            </defs>

                            {hypothesisInjectionMode !== 'selective_injection' ? (
                                <>
                                    {/* Single source at center (200) -> 4 agents at 50, 150, 250, 350 */}
                                    <circle cx="200" cy="6" r="4" fill="var(--accent-blue)" opacity="1" />
                                    {[50, 150, 250, 350].map((x, i) => (
                                        <React.Fragment key={i}>
                                            <line x1="200" y1="6" x2={x} y2="48" stroke="var(--accent-blue)" strokeWidth="1.5" opacity={[0.7, 0.8, 0.8, 0.7][i]} markerEnd="url(#dtArrowhead)" />
                                        </React.Fragment>
                                    ))}
                                </>
                            ) : (
                                <>
                                    {/* 3 source points at 67, 200, 333 */}
                                    <circle cx="67" cy="6" r="4" fill="var(--accent-blue)" opacity="1" />
                                    <circle cx="200" cy="6" r="4" fill="var(--accent-blue)" opacity="1" />
                                    <circle cx="333" cy="6" r="4" fill="var(--accent-blue)" opacity="1" />

                                    {/* Sub-pkt 1 (x=67) -> Execution-3 (250) */}
                                    <line x1="67" y1="6" x2="250" y2="48" stroke="var(--accent-blue)" strokeWidth="1.5" opacity="0.8" markerEnd="url(#dtArrowhead)" />

                                    {/* Sub-pkt 2 (x=200) -> Execution-1 (50) & Execution-4 (350) */}
                                    <line x1="200" y1="6" x2="50" y2="48" stroke="var(--accent-blue)" strokeWidth="1.5" opacity="0.75" markerEnd="url(#dtArrowhead)" />
                                    <line x1="200" y1="6" x2="350" y2="48" stroke="var(--accent-blue)" strokeWidth="1.5" opacity="0.75" markerEnd="url(#dtArrowhead)" />

                                    {/* Sub-pkt 3 (x=333) -> Execution-2 (150) */}
                                    <line x1="333" y1="6" x2="150" y2="48" stroke="var(--accent-blue)" strokeWidth="1.5" opacity="0.8" markerEnd="url(#dtArrowhead)" />
                                </>
                            )}
                        </svg>
                    </div>
                    {hypothesisInjectionMode !== 'selective_injection' ? (
                        <div className="execution-agents-wrapper">
                            <div className="execution-agents-text">Execution &amp; Refinement Agents</div>
                        </div>
                    ) : (
                        <div className="selective-agents">
                            <div className="agent-pill">Execution-1</div>
                            <div className="agent-pill">Execution-2</div>
                            <div className="agent-pill">Execution-3</div>
                            <div className="agent-pill">Execution-4</div>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Hypothesis Count and Injection Mode Configurations */}
        <div className="hypothesis-slider-card">
            <div className="hypothesis-slider-container" id="dt-hypothesis-slider-container">
                <div className="input-group-tight">
                    <label htmlFor="dt-hypothesis-slider" className="input-label">
                        Hypothesis Count: <span id="dt-hypothesis-value">{hypothesisCount}</span>
                    </label>
                    <SliderWithFill
                        id="dt-hypothesis-slider"
                        value={hypothesisCount > 0 ? hypothesisCount : 1}
                        min={1}
                        max={6}
                        color="var(--accent-blue)"
                        disabled={!hypothesisEnabled}
                        onChange={onHypothesisChange}
                    />
                </div>
            </div>

            {/* Injection Mode selector */}
            <div className="hypothesis-slider-container" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(var(--accent-blue-rgb), 0.1)' }}>
                <div className="input-group-tight">
                    <label className="input-label" style={{ marginBottom: '8px', display: 'block' }}>
                        Injection Mode:
                    </label>
                    <div className="hypothesis-mode-buttons">
                        {([
                            { value: 'parallel', label: 'Blind Trust' },
                            { value: 'strategy_aware', label: 'Strategy-Aware' },
                            { value: 'selective_injection', label: 'Selective' }
                        ] as const).map(item => (
                            <button
                                key={item.value}
                                type="button"
                                className={`hypothesis-mode-button${hypothesisInjectionMode === item.value ? ' active' : ''}`}
                                disabled={!hypothesisEnabled}
                                onClick={() => onHypothesisInjectionModeChange(item.value)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <div className="red-team-description" style={{ marginTop: '6px', textAlign: 'left', lineHeight: '1.4' }}>
                        {hypothesisInjectionMode === 'parallel' && "Run hypothesis exploration & initial strategies concurrently. Complete packet is injected to all solvers."}
                        {hypothesisInjectionMode === 'strategy_aware' && "Run hypothesis exploration after strategies are finalized. Complete packet is injected to all solvers."}
                        {hypothesisInjectionMode === 'selective_injection' && "Run hypothesis exploration after strategies are finalized. Inject mapped hypotheses into corresponding solvers."}
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const RefinementSection: React.FC<{
    refinementEnabled: boolean;
    dissectedObservationsEnabled: boolean;
    iterativeCorrectionsEnabled: boolean;
    iterativeDepth: number;
    provideAllSolutionsEnabled: boolean;
    codeExecutionEnabled: boolean;
    isGeminiProvider: boolean;
    hypothesisCount: number;
    shareHypothesesToDissected: boolean;
    onRefinementToggle: (enabled: boolean) => void;
    onDissectedObservationsToggle: (enabled: boolean) => void;
    onIterativeCorrectionsToggle: (enabled: boolean) => void;
    onIterativeDepthChange: (value: number) => void;
    onProvideAllSolutionsToggle: (enabled: boolean) => void;
    onCodeExecutionToggle: (enabled: boolean) => void;
    onShareHypothesesToDissectedChange: (share: boolean) => void;
}> = (props) => {
    const {
        refinementEnabled, dissectedObservationsEnabled, iterativeCorrectionsEnabled,
        iterativeDepth, provideAllSolutionsEnabled, codeExecutionEnabled, isGeminiProvider,
        hypothesisCount, shareHypothesesToDissected,
        onRefinementToggle, onDissectedObservationsToggle, onIterativeCorrectionsToggle,
        onIterativeDepthChange, onProvideAllSolutionsToggle, onCodeExecutionToggle,
        onShareHypothesesToDissectedChange,
    } = props;

    const singlePassDisabled = !refinementEnabled || iterativeCorrectionsEnabled;

    return (
        <div className="refinement-options-container">
            <div className="refinement-options-header">
                <Icon name="auto_fix_high" />
                <span>Solution Refinement</span>
            </div>

            {/* Master toggle */}
            <div className="refinement-master-control">
                <label className="toggle-switch">
                    <input type="checkbox" id="dt-refinement-toggle" className="toggle-input" checked={refinementEnabled} onChange={e => onRefinementToggle(e.target.checked)} />
                    <span className="toggle-slider" />
                </label>
                <div className="refinement-master-info">
                    <div className="refinement-master-title">Enable Refinements</div>
                    <div className="refinement-master-description">Generates critique for each solution &amp; attempts to correct it</div>
                </div>
            </div>

            {/* Method cards */}
            <div className="refinement-methods">
                <div className="refinement-methods-label">Select Refinement Strategy</div>

                <div className="refinement-methods-row">
                    {/* Synthesis */}
                    <div className={`refinement-method-card${singlePassDisabled ? ' disabled' : ''}`} data-method="synthesis">
                        <div className="method-card-header">
                            <div className="method-card-selector">
                                <input type="checkbox" id="dt-dissected-observations-toggle" className="method-checkbox"
                                    checked={dissectedObservationsEnabled} disabled={singlePassDisabled}
                                    onChange={e => onDissectedObservationsToggle(e.target.checked)} />
                                <label htmlFor="dt-dissected-observations-toggle" className="method-checkbox-label">
                                    <div className="method-checkbox-custom">
                                        <Icon name="check" className="checkbox-icon" />
                                    </div>
                                </label>
                            </div>
                            <div className="method-card-title">
                                <div className="method-name">Critique Synthesis</div>
                                <div className="method-type">Single Pass</div>
                            </div>
                        </div>
                        <div className="method-card-description">Synthesizes all solution critiques. Cannot use with Iterative Corrections.</div>
                        {dissectedObservationsEnabled && !singlePassDisabled && hypothesisCount > 0 && (
                            <div className="method-sub-option" onClick={e => e.stopPropagation()}>
                                <label className="toggle-switch">
                                    <input type="checkbox" id="dt-share-hypotheses-toggle" className="toggle-input"
                                        checked={shareHypothesesToDissected}
                                        onChange={e => onShareHypothesesToDissectedChange(e.target.checked)} />
                                    <span className="toggle-slider" />
                                </label>
                                <label htmlFor="dt-share-hypotheses-toggle" className="method-sub-option-label">
                                    Include Hypothesis Findings
                                </label>
                            </div>
                        )}
                        <div className="refinement-card-vis synthesis-vis">
                            <div className="vis-inputs">
                                <span className="vis-node critique-node" title="Critique 1">C₁</span>
                                <span className="vis-node critique-node" title="Critique 2">C₂</span>
                                <span className="vis-node critique-node" title="Critique 3">C₃</span>
                            </div>
                            <div className="vis-arrow-flow">
                                <svg viewBox="0 0 60 20" className="flow-arrow-svg">
                                    <path d="M5,10 L50,10" stroke="var(--accent-purple)" strokeWidth="2" strokeDasharray="4 3" opacity="0.6" />
                                    <polygon points="50,7 56,10 50,13" fill="var(--accent-purple)" opacity="0.8" />
                                </svg>
                            </div>
                            <div className="vis-agent">
                                <Icon name="smart_toy" size="14" className="vis-agent-icon" />
                            </div>
                        </div>
                    </div>

                    {/* Full Context */}
                    <div className={`refinement-method-card${singlePassDisabled ? ' disabled' : ''}`} data-method="fullcontext">
                        <div className="method-card-header">
                            <div className="method-card-selector">
                                <input type="checkbox" id="dt-provide-all-solutions-toggle" className="method-checkbox"
                                    checked={provideAllSolutionsEnabled} disabled={singlePassDisabled}
                                    onChange={e => onProvideAllSolutionsToggle(e.target.checked)} />
                                <label htmlFor="dt-provide-all-solutions-toggle" className="method-checkbox-label">
                                    <div className="method-checkbox-custom">
                                        <Icon name="check" className="checkbox-icon" />
                                    </div>
                                </label>
                            </div>
                            <div className="method-card-title">
                                <div className="method-name">Full Solution Context</div>
                                <div className="method-type">Static Solution Pool</div>
                            </div>
                        </div>
                        <div className="method-card-description">Provides all solutions to correctors. Cannot use with Iterative Corrections.</div>
                        <div className="refinement-card-vis fullcontext-vis">
                            <div className="vis-solutions">
                                <span className="vis-doc-node" title="Solution 1">S₁</span>
                                <span className="vis-plus-operator">+</span>
                                <span className="vis-doc-node" title="Solution 2">S₂</span>
                                <span className="vis-plus-operator">+</span>
                                <span className="vis-doc-node" title="Solution N">Sₙ</span>
                            </div>
                            <div className="vis-arrow-flow">
                                <div className="vis-label-small">
                                    <span className="code-concat-text">solutions</span>
                                    <span className="code-concat-operator">.</span>
                                    <span className="code-concat-method">concatenate</span>
                                    <span className="code-concat-bracket">()</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Iterative */}
                <div className={`refinement-method-card${!refinementEnabled ? ' disabled' : ''}`} data-method="iterative">
                    <div className="method-card-header">
                        <div className="method-card-selector">
                            <input type="checkbox" id="dt-iterative-corrections-toggle" className="method-checkbox"
                                checked={iterativeCorrectionsEnabled} disabled={!refinementEnabled}
                                onChange={e => onIterativeCorrectionsToggle(e.target.checked)} />
                            <label htmlFor="dt-iterative-corrections-toggle" className="method-checkbox-label">
                                <div className="method-checkbox-custom">
                                    <Icon name="check" className="checkbox-icon" />
                                </div>
                            </label>
                        </div>
                        <div className="method-card-title">
                            <div className="method-name">Iterative Corrections</div>
                            <div className="method-type">{iterativeDepth} Refinement Loop{iterativeDepth !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                    <div className="method-card-description">Iterative loop of Corrector &amp; Critique. Disables Synthesis &amp; Full Context options.</div>
                    <div className="refinement-card-vis iterative-vis" style={{ maxWidth: '100%', justifyContent: 'center', gap: '6px' }}>
                        {/* Left: Solution Pool raw icon (Yellow) */}
                        <div className="vis-pool-node" title="Structured Solution Pool">
                            <Icon name="database" size="16" />
                        </div>

                        {/* Fetching flow from Pool to Critique Refinement */}
                        <div className="vis-arrow-flow" style={{ flex: '0 0 auto' }}>
                            <svg viewBox="0 0 24 20" className="flow-arrow-svg" style={{ maxWidth: '24px' }}>
                                <path d="M2,10 L18,10" stroke="var(--accent-yellow)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
                                <polygon points="18,7 24,10 18,13" fill="var(--accent-yellow)" opacity="0.8" />
                            </svg>
                        </div>

                        {/* Right: Critique Refinement Pill (Enclosing Loop C <-> R) */}
                        <div className="vis-critique-refinement-pill" title="Critique Refinement Loop">
                            <div className="vis-node critique-node" title="Critique">C</div>
                            <div className="vis-arrow-flow" style={{ flex: '0 0 auto' }}>
                                <svg viewBox="0 0 32 20" className="flow-arrow-svg" style={{ maxWidth: '32px' }}>
                                    <path d="M4,6 L26,6" stroke="var(--accent-purple)" strokeWidth="1.5" strokeDasharray="2 1" opacity="0.6" />
                                    <polygon points="26,4 30,6 26,8" fill="var(--accent-purple)" opacity="0.8" />

                                    <path d="M26,14 L4,14" stroke="var(--accent-purple)" strokeWidth="1.5" strokeDasharray="2 1" opacity="0.6" />
                                    <polygon points="4,12 0,14 4,16" fill="var(--accent-purple)" opacity="0.8" />
                                </svg>
                            </div>
                            <div className="vis-node corrector-node" title="Corrector">R</div>
                        </div>
                    </div>
                    <div className="iteration-depth-container" style={{ display: iterativeCorrectionsEnabled ? 'block' : 'none', marginTop: 8, paddingTop: 8, paddingBottom: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="input-group-tight">
                            <label htmlFor="dt-iteration-depth-slider" className="input-label">
                                Iteration Depth: <span id="dt-iteration-depth-value">{iterativeDepth}</span>
                            </label>
                            <SliderWithFill
                                id="dt-iteration-depth-slider"
                                value={iterativeDepth}
                                min={1}
                                max={10}
                                color="var(--accent-purple)"
                                onChange={onIterativeDepthChange}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Code Execution */}
            <div className="code-execution-toggle-container" id="dt-code-execution-container" style={{ display: isGeminiProvider ? 'flex' : 'none', marginTop: 12 }}>
                <label className="code-execution-toggle-label">
                    <input type="checkbox" id="dt-code-execution-toggle" className="code-execution-toggle-input"
                        checked={codeExecutionEnabled} onChange={e => onCodeExecutionToggle(e.target.checked)} />
                    <span className="code-execution-toggle-slider" />
                </label>
                <div className="code-execution-toggle-info">
                    <span className="code-execution-toggle-title">Code Execution</span>
                    <span className="code-execution-toggle-subtitle">Python sandbox for agents</span>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Main Config Panel Component
// ═══════════════════════════════════════════════════════════════════════

export const DeepthinkConfigPanelComponent: React.FC<DeepthinkConfigPanelProps> = (props) => (
    <div className="deepthink-config-panel">
        <div className="deepthink-config-scroll-container">
            {/* Top Row: Strategy Execution + Red Team */}
            <div className="config-row-container">
                <div className="config-row-inner">
                    <StrategyExecutionSection
                        strategiesCount={props.strategiesCount}
                        subStrategiesCount={props.subStrategiesCount}
                        iterativeCorrectionsEnabled={props.iterativeCorrectionsEnabled}
                        onStrategiesChange={props.onStrategiesChange}
                        onSubStrategiesChange={props.onSubStrategiesChange}
                        onSkipSubStrategiesToggle={props.onSkipSubStrategiesToggle}
                    />
                    <RedTeamSection
                        redTeamMode={props.redTeamMode}
                        postQualityFilterEnabled={props.postQualityFilterEnabled}
                        iterativeCorrectionsEnabled={props.iterativeCorrectionsEnabled}
                        onRedTeamModeChange={props.onRedTeamModeChange}
                        onPostQualityFilterToggle={props.onPostQualityFilterToggle}
                    />
                </div>
            </div>

            {/* Bottom Row: Information Packet + Refinement */}
            <div className="config-row-container">
                <div className="config-row-inner">
                    <InformationPacketSection
                        hypothesisEnabled={props.hypothesisEnabled}
                        hypothesisCount={props.hypothesisCount}
                        hypothesisInjectionMode={props.hypothesisInjectionMode}
                        onHypothesisToggle={props.onHypothesisToggle}
                        onHypothesisChange={props.onHypothesisChange}
                        onHypothesisInjectionModeChange={props.onHypothesisInjectionModeChange}
                    />
                    <RefinementSection
                        refinementEnabled={props.refinementEnabled}
                        dissectedObservationsEnabled={props.dissectedObservationsEnabled}
                        iterativeCorrectionsEnabled={props.iterativeCorrectionsEnabled}
                        iterativeDepth={props.iterativeDepth}
                        provideAllSolutionsEnabled={props.provideAllSolutionsEnabled}
                        codeExecutionEnabled={props.codeExecutionEnabled}
                        isGeminiProvider={props.isGeminiProvider}
                        hypothesisCount={props.hypothesisCount}
                        shareHypothesesToDissected={props.shareHypothesesToDissected}
                        onShareHypothesesToDissectedChange={props.onShareHypothesesToDissectedChange}
                        onRefinementToggle={props.onRefinementToggle}
                        onDissectedObservationsToggle={props.onDissectedObservationsToggle}
                        onIterativeCorrectionsToggle={props.onIterativeCorrectionsToggle}
                        onIterativeDepthChange={props.onIterativeDepthChange}
                        onProvideAllSolutionsToggle={props.onProvideAllSolutionsToggle}
                        onCodeExecutionToggle={props.onCodeExecutionToggle}
                    />
                </div>
            </div>
        </div>
    </div>
);

// ═══════════════════════════════════════════════════════════════════════
// Controller Bridge & Mounting
// ═══════════════════════════════════════════════════════════════════════

function deriveProps(controller: ReturnType<typeof getDeepthinkConfigController>): DeepthinkConfigPanelProps {
    const s = controller.getState();
    return {
        ...s,
        isGeminiProvider: getProviderForCurrentModel() === 'gemini',
        onStrategiesChange: v => controller.setStrategiesCount(v),
        onSubStrategiesChange: v => controller.setSubStrategiesCount(v),
        onHypothesisChange: v => controller.setHypothesisCount(v),
        onSkipSubStrategiesToggle: v => controller.setSkipSubStrategies(v),
        onHypothesisToggle: v => controller.setHypothesisEnabled(v),
        onRedTeamModeChange: v => controller.setRedTeamMode(v),
        onPostQualityFilterToggle: v => controller.setPostQualityFilterEnabled(v),
        onRefinementToggle: v => controller.setRefinementEnabled(v),
        onDissectedObservationsToggle: v => controller.setDissectedObservationsEnabled(v),
        onIterativeCorrectionsToggle: v => controller.setIterativeCorrectionsEnabled(v),
        onIterativeDepthChange: v => controller.setIterativeDepth(v),
        onProvideAllSolutionsToggle: v => controller.setProvideAllSolutionsEnabled(v),
        onCodeExecutionToggle: v => controller.setCodeExecutionEnabled(v),
        onHypothesisInjectionModeChange: v => controller.setHypothesisInjectionMode(v),
        shareHypothesesToDissected: s.shareHypothesesToDissected,
        onShareHypothesesToDissectedChange: v => controller.setShareHypothesesToDissected(v),
    };
}

let configPanelRoot: Root | null = null;
let configPanelContainerNode: HTMLElement | null = null;

function renderPanel(controller: ReturnType<typeof getDeepthinkConfigController>): void {
    if (configPanelRoot) {
        configPanelRoot.render(React.createElement(DeepthinkConfigPanelComponent, deriveProps(controller)));
    }
}

/**
 * Renders the Deepthink config panel into the given container.
 * Subscribes to the controller's state changes and re-renders automatically.
 */
export function renderDeepthinkConfigPanelInContainer(pipelinesContentContainer: HTMLElement): void {
    if (!pipelinesContentContainer) return;

    const controller = getDeepthinkConfigController();

    // Hide main header for edge-to-edge config panel
    const mainHeaderContent = document.querySelector('.main-header-content') as HTMLElement;
    if (mainHeaderContent) mainHeaderContent.style.display = 'none';

    disableSidebarCollapseButton('Sidebar collapse disabled in config view');

    // Unmount explicitly if the DOM node was wiped by the AppRouter
    if (configPanelRoot && configPanelContainerNode && !document.contains(configPanelContainerNode)) {
        const rootToUnmount = configPanelRoot;
        setTimeout(() => {
            rootToUnmount.unmount();
        }, 0);
        configPanelRoot = null;
        configPanelContainerNode = null;
    }

    if (!configPanelRoot) {
        pipelinesContentContainer.innerHTML = '';
        configPanelContainerNode = document.createElement('div');
        configPanelContainerNode.className = 'deepthink-config-react-root';
        pipelinesContentContainer.appendChild(configPanelContainerNode);

        configPanelRoot = createRoot(configPanelContainerNode);
    }

    // Mount or update React component
    renderPanel(controller);

    // Subscribe to controller state changes
    const onConfigChange = (_e: Event) => {
        renderPanel(controller);
    };

    const onModelChange = () => {
        renderPanel(controller);
    };

    controller.addEventListener('configchange', onConfigChange);
    window.addEventListener('selectedModelChanged', onModelChange);

    // Store cleanup function on the container for later removal
    (pipelinesContentContainer as any).__deepthinkConfigCleanup = () => {
        controller.removeEventListener('configchange', onConfigChange);
        window.removeEventListener('selectedModelChanged', onModelChange);
        if (configPanelRoot) {
            const rootToUnmount = configPanelRoot;
            configPanelRoot = null;
            setTimeout(() => {
                rootToUnmount.unmount();
            }, 0);
        }
    };
}

export { renderDeepthinkConfigPanelInContainer as renderDeepthinkConfigPanel };
export default DeepthinkConfigPanelComponent;
