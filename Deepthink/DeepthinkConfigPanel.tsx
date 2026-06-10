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
import { getDeepthinkConfigController } from '../Routing';
import { buildEvolvingDfsTokenTrend, calculateEvolvingDfsTokenEstimate, type EvolvingDfsTokenEstimate } from '../Routing/DeepthinkTokenEstimator';
import { Icon } from '../UI/Icons';
import { disableSidebarCollapseButton } from '../UI/LayoutController';

export interface DeepthinkConfigPanelProps {
    strategiesCount: number;
    subStrategiesCount: number;
    hypothesisCount: number;
    skipSubStrategies: boolean;
    hypothesisEnabled: boolean;
    pqfMode: string;
    postQualityFilterEnabled: boolean;
    refinementEnabled: boolean;
    dissectedObservationsEnabled: boolean;
    evolvingDfsEnabled: boolean;
    evolvingDfsDepth: number;
    provideAllSolutionsEnabled: boolean;
    codeExecutionEnabled: boolean;
    hypothesisInjectionMode: 'parallel' | 'strategy_aware' | 'selective_injection';

    onStrategiesChange: (count: number) => void;
    onSubStrategiesChange: (count: number) => void;
    onHypothesisChange: (count: number) => void;
    onSkipSubStrategiesToggle: (skip: boolean) => void;
    onHypothesisToggle: (enabled: boolean) => void;
    onPqfModeChange: (mode: string) => void;
    onPostQualityFilterToggle: (enabled: boolean) => void;
    onRefinementToggle: (enabled: boolean) => void;
    onDissectedObservationsToggle: (enabled: boolean) => void;
    onEvolvingDfsToggle: (enabled: boolean) => void;
    onEvolvingDfsDepthChange: (depth: number) => void;
    onProvideAllSolutionsToggle: (enabled: boolean) => void;
    onCodeExecutionToggle: (enabled: boolean) => void;
    onHypothesisInjectionModeChange: (mode: 'parallel' | 'strategy_aware' | 'selective_injection') => void;
    shareHypothesesToDissected: boolean;
    onShareHypothesesToDissectedChange: (share: boolean) => void;
}

type DeepthinkController = ReturnType<typeof getDeepthinkConfigController>;
type HypothesisInjectionMode = DeepthinkConfigPanelProps['hypothesisInjectionMode'];
type TokenScaleMode = 'linear' | 'log';
type TokenGraphFocus = 'total' | 'input' | 'output';

interface TokenSeriesDescriptor {
    key: string;
    label: string;
    category: 'input' | 'output';
    valueOf: (point: EvolvingDfsTokenEstimate) => number;
}

const SUB_STRATEGY_VALUES = [0, 2, 3, 4, 5] as const;
const PQF_MODES = [
    { value: 'balanced', label: 'Balanced' },
    { value: 'very_aggressive', label: 'Aggressive' },
] as const;
const HYPOTHESIS_MODES = [
    { value: 'parallel', label: 'Blind Trust' },
    { value: 'strategy_aware', label: 'Strategy-Aware' },
    { value: 'selective_injection', label: 'Selective' },
] as const;

const PACKET_LINE_WIDTHS = {
    parallel: [85, 92, 78, 95, 68, 88, 90, 75],
    strategyAware: [90, 75, 85],
    selectivePackets: [
        [90, 65, 80],
        [85, 75, 90],
        [75, 85, 70],
    ],
} as const;

const AGENT_X = [50, 150, 250, 350] as const;
const AGENT_OPACITY = [0.7, 0.8, 0.8, 0.7] as const;
const SELECTIVE_EDGES = [
    { from: 67, to: 250, opacity: 0.8 },
    { from: 200, to: 50, opacity: 0.75 },
    { from: 200, to: 350, opacity: 0.75 },
    { from: 333, to: 150, opacity: 0.8 },
] as const;

const TOKEN_SERIES: readonly TokenSeriesDescriptor[] = [
    { key: 'input-worst', label: 'Input worst', category: 'input', valueOf: point => point.input.worst },
    { key: 'input-average', label: 'Input avg', category: 'input', valueOf: point => point.input.average },
    { key: 'output-worst', label: 'Output worst', category: 'output', valueOf: point => point.output.worst },
    { key: 'output-average', label: 'Output avg', category: 'output', valueOf: point => point.output.average },
];

const TOKEN_CHART = {
    width: 660,
    height: 238,
    padding: { top: 20, right: 20, bottom: 38, left: 66 },
} as const;

// ═══════════════════════════════════════════════════════════════════════
// Tiny Rendering Kernel
// ═══════════════════════════════════════════════════════════════════════

const classNames = (...parts: Array<string | false | null | undefined>): string => (
    parts.filter(Boolean).join(' ')
);

const clamp = (value: number, min: number, max: number): number => (
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
);

const toInteger = (value: string): number => (
    Number.parseInt(value, 10)
);

const range = <T,>(length: number, mapper: (index: number) => T): T[] => (
    Array.from({ length: Math.max(0, length) }, (_, index) => mapper(index))
);

const percentBetween = (value: number, min: number, max: number): number => (
    max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0
);

const filledTrack = (percentage: number, color: string): string => (
    `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, var(--slider-track-color) ${percentage}%, var(--slider-track-color) 100%)`
);

const nearestIndex = (values: readonly number[], target: number): number => (
    values.reduce((bestIndex, value, index) => (
        Math.abs(value - target) < Math.abs(values[bestIndex] - target) ? index : bestIndex
    ), 0)
);

const interpolateClamped = (value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): number => {
    if (!Number.isFinite(value) || value <= inputMin) return outputMin;
    if (value >= inputMax) return outputMax;
    return Math.round(outputMin + ((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin));
};

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

const useMeasuredElementHeight = <T extends Element>(): [React.RefCallback<T>, number] => {
    const [node, setNode] = React.useState<T | null>(null);
    const [height, setHeight] = React.useState(0);

    useIsoLayoutEffect(() => {
        if (!node) return;

        const measure = () => setHeight(node.getBoundingClientRect().height);
        measure();

        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(entries => {
            setHeight(entries[0]?.contentRect.height ?? node.getBoundingClientRect().height);
        });
        observer.observe(node);

        return () => observer.disconnect();
    }, [node]);

    return [setNode, height];
};

const SectionFrame: React.FC<{
    containerClass: string;
    headerClass: string;
    icon: string;
    title: string;
    children: React.ReactNode;
}> = ({ containerClass, headerClass, icon, title, children }) => (
    <div className={containerClass}>
        <div className={headerClass}>
            <Icon name={icon} />
            <span>{title}</span>
        </div>
        {children}
    </div>
);

const SliderWithFill: React.FC<{
    id: string;
    value: number;
    min: number;
    max: number;
    color: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}> = ({ id, value, min, max, color, disabled, onChange }) => {
    const safeValue = clamp(value, min, max);

    return (
        <input
            type="range"
            id={id}
            className="slider"
            min={min}
            max={max}
            step={1}
            value={safeValue}
            disabled={disabled}
            style={{ background: filledTrack(percentBetween(safeValue, min, max), color) }}
            onChange={event => onChange(toInteger(event.currentTarget.value))}
        />
    );
};

const ToggleSwitch: React.FC<{
    id: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    inputClassName?: string;
    sliderClassName?: string;
    disabled?: boolean;
}> = ({ id, checked, onChange, className = 'toggle-switch', inputClassName = 'toggle-input', sliderClassName = 'toggle-slider', disabled }) => (
    <label className={className}>
        <input
            type="checkbox"
            id={id}
            className={inputClassName}
            checked={checked}
            disabled={disabled}
            onChange={event => onChange(event.currentTarget.checked)}
        />
        <span className={sliderClassName} />
    </label>
);

const MethodCheckbox: React.FC<{
    id: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}> = ({ id, checked, disabled, onChange }) => (
    <div className="method-card-selector">
        <input
            type="checkbox"
            id={id}
            className="method-checkbox"
            checked={checked}
            disabled={disabled}
            onChange={event => onChange(event.currentTarget.checked)}
        />
        <label htmlFor={id} className="method-checkbox-label">
            <div className="method-checkbox-custom">
                <Icon name="check" className="checkbox-icon" />
            </div>
        </label>
    </div>
);

const LoadingLines: React.FC<{
    widths: readonly number[];
    styleForIndex?: (index: number) => React.CSSProperties;
    containerStyle?: React.CSSProperties;
}> = ({ widths, styleForIndex, containerStyle }) => (
    <div className="loading-info" style={containerStyle}>
        {widths.map((width, index) => (
            <div key={`${width}-${index}`} className="loading-line" style={{ width: `${width}%`, ...styleForIndex?.(index) }} />
        ))}
    </div>
);

// ═══════════════════════════════════════════════════════════════════════
// Strategy Execution
// ═══════════════════════════════════════════════════════════════════════

const StrategyExecutionSection: React.FC<{
    strategiesCount: number;
    subStrategiesCount: number;
    evolvingDfsEnabled: boolean;
    onStrategiesChange: (value: number) => void;
    onSubStrategiesChange: (value: number) => void;
    onSkipSubStrategiesToggle: (skip: boolean) => void;
}> = ({ strategiesCount, subStrategiesCount, evolvingDfsEnabled, onStrategiesChange, onSubStrategiesChange, onSkipSubStrategiesToggle }) => {
    const subStrategyIndex = nearestIndex(SUB_STRATEGY_VALUES, subStrategiesCount);
    const subStrategyPercentage = percentBetween(subStrategyIndex, 0, SUB_STRATEGY_VALUES.length - 1);

    const setSubStrategyIndex = (index: number) => {
        const value = SUB_STRATEGY_VALUES[clamp(index, 0, SUB_STRATEGY_VALUES.length - 1)] ?? 0;
        onSkipSubStrategiesToggle(value === 0);
        onSubStrategiesChange(value);
    };

    return (
        <SectionFrame
            containerClass="strategy-execution-container"
            headerClass="strategy-execution-header"
            icon="account_tree"
            title="Strategy Execution"
        >
            <div className="strategy-execution-card">
                <div className="strategy-execution-section">
                    <div className="input-group-tight">
                        <label htmlFor="dt-strategies-slider" className="input-label">
                            Strategies: <span id="dt-strategies-value">{strategiesCount}</span>
                        </label>
                        <SliderWithFill
                            id="dt-strategies-slider"
                            value={strategiesCount}
                            min={1}
                            max={evolvingDfsEnabled ? 5 : 10}
                            color="#e86b6b"
                            onChange={onStrategiesChange}
                        />
                    </div>
                </div>

                <div className="strategy-execution-divider" />

                <div className={classNames('strategy-execution-section', subStrategiesCount === 0 && 'dimmed')}>
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
                                max={SUB_STRATEGY_VALUES.length - 1}
                                step={1}
                                value={subStrategyIndex}
                                disabled={evolvingDfsEnabled}
                                style={{ background: filledTrack(subStrategyPercentage, '#e86b6b') }}
                                onChange={event => setSubStrategyIndex(toInteger(event.currentTarget.value))}
                            />
                            <div className="slider-dots">
                                {SUB_STRATEGY_VALUES.map(value => (
                                    <span
                                        key={value}
                                        className={classNames('slider-dot', value <= subStrategiesCount && 'active')}
                                        data-value={value}
                                    >
                                        {value}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </SectionFrame>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Evolution Filter
// ═══════════════════════════════════════════════════════════════════════

const EvolutionFilterSection: React.FC<{
    pqfMode: string;
    evolvingDfsEnabled: boolean;
    onPqfModeChange: (mode: string) => void;
}> = ({ pqfMode, evolvingDfsEnabled, onPqfModeChange }) => (
    <SectionFrame
        containerClass="evolution-filter-options-container"
        headerClass="evolution-filter-options-header"
        icon="security"
        title="Evolution Filter"
    >
        <div className="pqf-toggle-wrapper">
            <div className="pqf-buttons">
                {PQF_MODES.map(mode => (
                    <button
                        key={mode.value}
                        type="button"
                        className={classNames(
                            'pqf-button',
                            pqfMode === mode.value && evolvingDfsEnabled && 'active',
                            !evolvingDfsEnabled && 'disabled',
                        )}
                        data-value={mode.value}
                        disabled={!evolvingDfsEnabled}
                        onClick={() => onPqfModeChange(mode.value)}
                    >
                        {mode.label}
                    </button>
                ))}
            </div>
        </div>

        <div className="post-quality-filter-card-wrapper">
            <div className={classNames('refinement-method-card post-quality-filter-card', !evolvingDfsEnabled && 'disabled')} data-method="postqualityfilter">
                <div className="method-card-header">
                    <div className="method-card-selector">
                        <div className={classNames('method-checkbox-custom', evolvingDfsEnabled && 'checked')}>
                            <Icon name="check" className="checkbox-icon" />
                        </div>
                    </div>
                    <div className="method-card-title">
                        <div className="method-name">Post Quality Filter</div>
                        <div className="method-type" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="account_tree" size="10" />
                            <span>{evolvingDfsEnabled ? 'Required' : 'Requires Evolving DFS'}</span>
                        </div>
                    </div>
                </div>
                <div className="method-card-description">
                    Reviews two strategy branches per agent, keeps viable branches, and replaces failed branches with fresh strategy slots.
                </div>
                <div className="refinement-card-vis post-quality-filter-vis">
                    <div className="vis-stage-column">
                        <div className="vis-strategy-node initial-node" title="Branch after five iterations">
                            <Icon name="lightbulb" size="10" />
                            <span>B₅</span>
                        </div>
                        <div className="vis-critique-node-small" title="Memory Bank">
                            <Icon name="database" size="10" />
                            <span>M</span>
                        </div>
                    </div>
                    <div className="vis-connector-column">
                        <svg viewBox="0 0 40 40" className="converging-arrows-svg">
                            <path d="M5,8 C18,8 18,20 32,20" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <path d="M5,32 C18,32 18,20 32,20" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <polygon points="29,17 35,20 29,23" fill="var(--accent-pink)" opacity="0.8" />
                        </svg>
                    </div>
                    <div className="vis-agent-column">
                        <div className="vis-evaluator-node" title="PQF Evaluator">
                            <Icon name="account_tree" size="11" className="evolution-icon" />
                        </div>
                    </div>
                    <div className="vis-connector-column">
                        <svg viewBox="0 0 30 40" className="evolving-arrow-svg">
                            <path d="M2,20 C10,20 12,8 22,8" stroke="var(--accent-pink)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" fill="none" />
                            <polygon points="19,5 25,8 19,11" fill="var(--accent-pink)" opacity="0.8" />
                        </svg>
                    </div>
                    <div className="vis-stage-column">
                        <div className="vis-strategy-node evolved-node" title="Fresh branch if updated">
                            <Icon name="lightbulb" size="10" />
                            <span>B₁</span>
                        </div>
                        <div className="vis-final-badge" title="Keep or Update">
                            <Icon name="check" size="10" />
                            <span>OK</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </SectionFrame>
);

// ═══════════════════════════════════════════════════════════════════════
// Information Packet
// ═══════════════════════════════════════════════════════════════════════

const StrategyCards: React.FC<{ count: number }> = ({ count }) => (
    <div className="vis-strategies-row">
        {range(count, index => (
            <div key={index} className="vis-strategy-card-mini">Strategy {index + 1}</div>
        ))}
    </div>
);

const StrategyAwarePacketPreview: React.FC<{
    arrowRef: React.RefCallback<SVGSVGElement>;
    markerSize: number;
}> = ({ arrowRef, markerSize }) => (
    <div className="hypothesis-routing-preview strategy-aware">
        <StrategyCards count={2} />
        <svg ref={arrowRef} className="vis-descending-arrows" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <marker id="dtPurpleArrowheadAware" viewBox="0 0 10 10" refX="7" refY="5" markerWidth={markerSize} markerHeight={markerSize} orient="auto">
                    <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--accent-purple)" />
                </marker>
            </defs>
            {[50, 150].map(x => (
                <path
                    key={x}
                    d={`M${x},2 L${x},74`}
                    stroke="var(--accent-purple)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    fill="none"
                    opacity="0.8"
                    markerEnd="url(#dtPurpleArrowheadAware)"
                />
            ))}
        </svg>
        <LoadingLines
            widths={PACKET_LINE_WIDTHS.strategyAware}
            containerStyle={{ gap: '4px' }}
            styleForIndex={() => ({ height: '6px' })}
        />
    </div>
);

const SelectivePacketPreview: React.FC<{
    arrowRef: React.RefCallback<SVGSVGElement>;
    markerSize: number;
    arrowCount: number;
}> = ({ arrowRef, markerSize, arrowCount }) => {
    const xs = React.useMemo(() => range(arrowCount, index => ((index + 0.5) / arrowCount) * 300), [arrowCount]);

    return (
        <div className="hypothesis-routing-preview selective">
            <StrategyCards count={3} />
            <svg ref={arrowRef} className="vis-descending-arrows" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <marker id="dtPurpleArrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth={markerSize} markerHeight={markerSize} orient="auto">
                        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--accent-purple)" />
                    </marker>
                </defs>
                {xs.map(x => (
                    <path
                        key={x}
                        d={`M${x},2 L${x},74`}
                        stroke="var(--accent-purple)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                        opacity="0.8"
                        markerEnd="url(#dtPurpleArrowhead)"
                    />
                ))}
            </svg>
            <div className="vis-sub-packets-row">
                {PACKET_LINE_WIDTHS.selectivePackets.map((widths, packetIndex) => (
                    <div key={packetIndex} className="vis-sub-packet">
                        <div className="vis-sub-packet-title">Sub-Pkt {packetIndex + 1}</div>
                        {widths.map((width, lineIndex) => (
                            <div
                                key={`${packetIndex}-${lineIndex}`}
                                className="loading-line"
                                style={{
                                    width: `${width}%`,
                                    height: '6px',
                                    opacity: [0.8, 0.55, 0.3][lineIndex],
                                }}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

const ExecutionAgentsVisualization: React.FC<{
    mode: HypothesisInjectionMode;
    arrowRef: React.RefCallback<SVGSVGElement>;
    markerSize: number;
}> = ({ mode, arrowRef, markerSize }) => {
    const selective = mode === 'selective_injection';

    return (
        <div className="execution-agents-visualization" id="dt-execution-agents-visualization">
            <div className="connection-nodes">
                <svg ref={arrowRef} className="connection-svg" viewBox="0 0 400 50" preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="dtBlueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style={{ stopColor: 'var(--accent-blue)', stopOpacity: 0.9 }} />
                            <stop offset="100%" style={{ stopColor: 'var(--accent-blue)', stopOpacity: 0.3 }} />
                        </linearGradient>
                        <marker id="dtArrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth={markerSize} markerHeight={markerSize} orient="auto">
                            <path d="M 0 2 L 8 5 L 0 8 z" fill="var(--accent-blue)" />
                        </marker>
                    </defs>

                    {!selective ? (
                        <>
                            <circle cx="200" cy="6" r="4" fill="var(--accent-blue)" opacity="1" />
                            {AGENT_X.map((x, index) => (
                                <line
                                    key={x}
                                    x1="200"
                                    y1="6"
                                    x2={x}
                                    y2="48"
                                    stroke="var(--accent-blue)"
                                    strokeWidth="1.5"
                                    opacity={AGENT_OPACITY[index]}
                                    markerEnd="url(#dtArrowhead)"
                                />
                            ))}
                        </>
                    ) : (
                        <>
                            {[67, 200, 333].map(x => (
                                <circle key={x} cx={x} cy="6" r="4" fill="var(--accent-blue)" opacity="1" />
                            ))}
                            {SELECTIVE_EDGES.map(edge => (
                                <line
                                    key={`${edge.from}-${edge.to}`}
                                    x1={edge.from}
                                    y1="6"
                                    x2={edge.to}
                                    y2="48"
                                    stroke="var(--accent-blue)"
                                    strokeWidth="1.5"
                                    opacity={edge.opacity}
                                    markerEnd="url(#dtArrowhead)"
                                />
                            ))}
                        </>
                    )}
                </svg>
            </div>

            {!selective ? (
                <div className="execution-agents-wrapper">
                    <div className="execution-agents-text">Execution &amp; Refinement Agents</div>
                </div>
            ) : (
                <div className="selective-agents">
                    {range(4, index => (
                        <div key={index} className="agent-pill">Execution-{index + 1}</div>
                    ))}
                </div>
            )}
        </div>
    );
};

const hypothesisModeDescription = (mode: HypothesisInjectionMode, evolvingDfsEnabled: boolean): string => {
    if (mode === 'parallel') {
        return 'Run hypothesis exploration & initial strategies concurrently. Complete packet is injected to all solvers.';
    }

    if (mode === 'strategy_aware') {
        return 'Run hypothesis exploration after strategies are finalized. Complete packet is injected to all solvers.';
    }

    return evolvingDfsEnabled
        ? 'Evolving DFS requires Selective mode. Strategy-specific packets are injected into execution, correction, and solution-pool agents.'
        : 'Run hypothesis exploration after strategies are finalized. Inject mapped hypotheses into corresponding solvers.';
};

const InformationPacketSection: React.FC<{
    hypothesisEnabled: boolean;
    hypothesisCount: number;
    hypothesisInjectionMode: HypothesisInjectionMode;
    evolvingDfsEnabled: boolean;
    onHypothesisToggle: (enabled: boolean) => void;
    onHypothesisChange: (value: number) => void;
    onHypothesisInjectionModeChange: (mode: HypothesisInjectionMode) => void;
}> = ({ hypothesisEnabled, hypothesisCount, hypothesisInjectionMode, evolvingDfsEnabled, onHypothesisToggle, onHypothesisChange, onHypothesisInjectionModeChange }) => {
    const [routingArrowRef, routingArrowHeight] = useMeasuredElementHeight<SVGSVGElement>();
    const [executionArrowRef, executionArrowHeight] = useMeasuredElementHeight<SVGSVGElement>();
    const routingArrowMarkerSize = interpolateClamped(routingArrowHeight, 80, 260, 6, 22);
    const executionArrowMarkerSize = interpolateClamped(executionArrowHeight, 50, 150, 6, 17);

    const toggleHypotheses = (enabled: boolean) => {
        onHypothesisToggle(enabled);
        if (!enabled) onHypothesisChange(0);
    };

    return (
        <div className="information-packet-container">
            <div className={classNames('information-packet-window', !hypothesisEnabled && 'collapsed')} id="dt-information-packet-window">
                <div className="window-header">
                    <div className="window-left">
                        <ToggleSwitch
                            id="dt-hypothesis-toggle"
                            checked={hypothesisEnabled}
                            onChange={toggleHypotheses}
                            className="window-toggle-label"
                            inputClassName="window-toggle-input"
                            sliderClassName="window-toggle-slider"
                        />
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
                    <div className={`hypothesis-visual-stack mode-${hypothesisInjectionMode}`}>
                        {hypothesisInjectionMode === 'parallel' && (
                            <LoadingLines widths={PACKET_LINE_WIDTHS.parallel} />
                        )}

                        {hypothesisInjectionMode === 'strategy_aware' && (
                            <StrategyAwarePacketPreview arrowRef={routingArrowRef} markerSize={routingArrowMarkerSize} />
                        )}

                        {hypothesisInjectionMode === 'selective_injection' && (
                            <SelectivePacketPreview
                                arrowRef={routingArrowRef}
                                markerSize={routingArrowMarkerSize}
                                arrowCount={routingArrowHeight > 120 ? 8 : 5}
                            />
                        )}

                        <ExecutionAgentsVisualization
                            mode={hypothesisInjectionMode}
                            arrowRef={executionArrowRef}
                            markerSize={executionArrowMarkerSize}
                        />
                    </div>
                </div>
            </div>

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

                <div className="hypothesis-slider-container" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(var(--accent-blue-rgb), 0.1)' }}>
                    <div className="input-group-tight">
                        <label className="input-label" style={{ marginBottom: '8px', display: 'block' }}>
                            Injection Mode:
                        </label>
                        <div className="hypothesis-mode-buttons">
                            {HYPOTHESIS_MODES.map(item => (
                                <button
                                    key={item.value}
                                    type="button"
                                    className={classNames('hypothesis-mode-button', hypothesisInjectionMode === item.value && 'active')}
                                    disabled={!hypothesisEnabled || (evolvingDfsEnabled && item.value !== 'selective_injection')}
                                    onClick={() => onHypothesisInjectionModeChange(item.value)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <div className="pqf-description" style={{ marginTop: '6px', textAlign: 'left', lineHeight: '1.4' }}>
                            {hypothesisModeDescription(hypothesisInjectionMode, evolvingDfsEnabled)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Token Volume Graph
// ═══════════════════════════════════════════════════════════════════════

const formatTokenCount = (value: number): string => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);

    if (safeValue >= 1_000_000) {
        const millions = safeValue / 1_000_000;
        return `${millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)}M`;
    }

    if (safeValue >= 1_000) {
        const thousands = safeValue / 1_000;
        return `${thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
    }

    return `${Math.round(safeValue)}`;
};

const formatTokenRange = (rangeValue: { average: number; worst: number }): string => (
    `${formatTokenCount(rangeValue.average)} - ${formatTokenCount(rangeValue.worst)}`
);

const pathForPoints = (points: Array<{ x: number; y: number }>): string => (
    points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
);

const TokenVolumeGraph: React.FC<{
    strategiesCount: number;
    hypothesisCount: number;
    evolvingDfsDepth: number;
}> = ({ strategiesCount, hypothesisCount, evolvingDfsDepth }) => {
    const [scaleMode, setScaleMode] = React.useState<TokenScaleMode>('log');
    const [focus, setFocus] = React.useState<TokenGraphFocus>('total');
    const [hoverDepth, setHoverDepth] = React.useState<number | null>(null);

    const safeDepth = Math.max(1, Math.round(evolvingDfsDepth || 1));
    const trend = React.useMemo(() => buildEvolvingDfsTokenTrend({
        strategiesCount,
        hypothesisCount,
        maxDepth: safeDepth,
    }), [strategiesCount, hypothesisCount, safeDepth]);

    const selected = React.useMemo(() => calculateEvolvingDfsTokenEstimate({
        strategiesCount,
        hypothesisCount,
        evolvingDfsDepth: safeDepth,
    }), [strategiesCount, hypothesisCount, safeDepth]);

    const { width, height, padding } = TOKEN_CHART;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxDepth = Math.max(1, trend.at(-1)?.depth ?? selected.depth);
    const selectedDepth = clamp(selected.depth, 1, maxDepth);
    const selectedX = maxDepth === 1
        ? padding.left + plotWidth / 2
        : padding.left + ((selectedDepth - 1) / (maxDepth - 1)) * plotWidth;

    const visibleSeries = focus === 'total'
        ? TOKEN_SERIES
        : TOKEN_SERIES.filter(item => item.category === focus);

    const allValues = visibleSeries.flatMap(item => trend.map(point => item.valueOf(point))).filter(value => value > 0);
    const maxValue = Math.max(...allValues, 1) * 1.1;
    const minPositive = allValues.length ? Math.max(1, Math.min(...allValues)) : 1;
    const minValue = scaleMode === 'log' ? Math.max(1, minPositive * 0.72) : 0;

    const xForDepth = (depth: number): number => (
        maxDepth === 1
            ? padding.left + plotWidth / 2
            : padding.left + ((depth - 1) / (maxDepth - 1)) * plotWidth
    );

    const yForValue = (value: number): number => {
        if (scaleMode === 'log') {
            const logMin = Math.log10(minValue);
            const logMax = Math.log10(maxValue);
            return padding.top + plotHeight - (((Math.log10(Math.max(value, minValue)) - logMin) / (logMax - logMin || 1)) * plotHeight);
        }

        return padding.top + plotHeight - (((value - minValue) / (maxValue - minValue || 1)) * plotHeight);
    };

    const pathForSeries = (valueOf: (point: EvolvingDfsTokenEstimate) => number): string => (
        pathForPoints(trend.map(point => ({ x: xForDepth(point.depth), y: yForValue(valueOf(point)) })))
    );

    const areaPathForFocus = (category: 'input' | 'output'): string => {
        const high = category === 'input'
            ? (point: EvolvingDfsTokenEstimate) => point.input.worst
            : (point: EvolvingDfsTokenEstimate) => point.output.worst;
        const low = category === 'input'
            ? (point: EvolvingDfsTokenEstimate) => point.input.average
            : (point: EvolvingDfsTokenEstimate) => point.output.average;
        const upper = trend.map(point => ({ x: xForDepth(point.depth), y: yForValue(high(point)) }));
        const lower = [...trend].reverse().map(point => ({ x: xForDepth(point.depth), y: yForValue(low(point)) }));

        return `${pathForPoints(upper)} ${lower.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`;
    };

    const yTicks = scaleMode === 'log'
        ? [minValue, Math.sqrt(minValue * maxValue), maxValue]
        : [0, maxValue / 2, maxValue];
    const xTicks = maxDepth <= 4
        ? range(maxDepth, index => index + 1)
        : Array.from(new Set([1, Math.ceil(maxDepth / 2), maxDepth]));
    const hovered = hoverDepth == null ? null : trend.find(point => point.depth === hoverDepth) ?? null;
    const hoveredX = hovered ? xForDepth(hovered.depth) : 0;
    const hoverValues = hovered ? visibleSeries.map(item => item.valueOf(hovered)) : [];
    const hoveredY = hovered && hoverValues.length ? yForValue(Math.max(...hoverValues)) : padding.top;
    const tooltipWidth = focus === 'total' ? 198 : 168;
    const tooltipHeight = 30 + visibleSeries.length * 17;
    const tooltipX = hovered ? clamp(hoveredX + 12, padding.left, width - padding.right - tooltipWidth) : 0;
    const tooltipY = hovered ? clamp(hoveredY - 12, padding.top + 4, padding.top + plotHeight - tooltipHeight - 4) : 0;

    const setGraphFocus = (nextFocus: TokenGraphFocus) => {
        setFocus(current => current === nextFocus && nextFocus !== 'total' ? 'total' : nextFocus);
        setHoverDepth(null);
    };

    const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;

        const svgX = ((event.clientX - rect.left) / rect.width) * width;
        const rawDepth = maxDepth === 1 ? 1 : 1 + ((svgX - padding.left) / plotWidth) * (maxDepth - 1);
        setHoverDepth(clamp(Math.round(rawDepth), 1, maxDepth));
    };

    return (
        <div className={`token-volume-estimator focus-${focus}`}>
            <div className="token-estimator-topline">
                <div className="token-estimator-title">
                    <Icon name="timeline" size="13" />
                    <span>Token Volume</span>
                    <span className="token-estimator-context">{strategiesCount}S / {hypothesisCount}H / D{selectedDepth}</span>
                </div>
                <div className="token-scale-toggle" role="group" aria-label="Token chart scale">
                    {(['linear', 'log'] as const).map(mode => (
                        <button
                            key={mode}
                            type="button"
                            className={classNames('token-scale-button', scaleMode === mode && 'active')}
                            aria-pressed={scaleMode === mode}
                            onClick={() => setScaleMode(mode)}
                        >
                            {mode === 'linear' ? 'Linear' : 'Log'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="token-summary-grid">
                {(['input', 'output', 'total'] as const).map(item => (
                    <button
                        key={item}
                        type="button"
                        className={classNames('token-summary-item filterable', item, focus === item && 'active')}
                        aria-pressed={focus === item}
                        onClick={() => setGraphFocus(item)}
                    >
                        <span className="token-summary-label">{item[0].toUpperCase() + item.slice(1)}</span>
                        <span className="token-summary-value">{formatTokenRange(selected[item])}</span>
                    </button>
                ))}
                <div className="token-summary-item calls">
                    <span className="token-summary-label">API Calls</span>
                    <span className="token-summary-value">
                        {selected.apiCalls.min === selected.apiCalls.max
                            ? `~${selected.apiCalls.min}`
                            : `~${selected.apiCalls.min}-${selected.apiCalls.max}`}
                    </span>
                </div>
            </div>

            <div className="token-chart-shell">
                <svg
                    className="token-chart-svg"
                    viewBox={`0 0 ${width} ${height}`}
                    role="img"
                    aria-label={`Estimated token volume through depth ${selectedDepth}`}
                    onPointerMove={handlePointerMove}
                    onPointerLeave={() => setHoverDepth(null)}
                >
                    <rect className="token-chart-backdrop" x="0" y="0" width={width} height={height} rx="8" />
                    {yTicks.map((tick, index) => {
                        const y = yForValue(tick);
                        return (
                            <g key={`y-${index}`}>
                                <line className="token-grid-line" x1={padding.left} y1={y} x2={width - padding.right} y2={y} />
                                <text className="token-axis-label token-y-label" x={padding.left - 8} y={y + 4} textAnchor="end">
                                    {formatTokenCount(tick)}
                                </text>
                            </g>
                        );
                    })}
                    {xTicks.map(tick => {
                        const x = xForDepth(tick);
                        return (
                            <g key={`x-${tick}`}>
                                <line className="token-x-tick" x1={x} y1={padding.top + plotHeight} x2={x} y2={padding.top + plotHeight + 5} />
                                <text className="token-axis-label" x={x} y={height - 12} textAnchor="middle">{tick}</text>
                            </g>
                        );
                    })}
                    <text className="token-axis-caption" x={padding.left + plotWidth / 2} y={height - 2} textAnchor="middle">Depth</text>
                    <text
                        className="token-axis-caption token-y-axis-caption"
                        x={-(padding.top + plotHeight / 2)}
                        y="14"
                        textAnchor="middle"
                        transform="rotate(-90)"
                    >
                        Total tokens
                    </text>
                    <line className="token-selected-depth-line" x1={selectedX} y1={padding.top} x2={selectedX} y2={padding.top + plotHeight} />
                    {focus !== 'total' && <path className={`token-area-fill ${focus}`} d={areaPathForFocus(focus)} />}
                    {visibleSeries.map(item => (
                        <path key={item.key} className={`token-series-line ${item.key}`} d={pathForSeries(item.valueOf)} />
                    ))}
                    {visibleSeries.map(item => (
                        <circle
                            key={`${item.key}-point`}
                            className={`token-selected-point ${item.key}`}
                            cx={selectedX}
                            cy={yForValue(item.valueOf(selected))}
                            r="3.4"
                        />
                    ))}
                    {hovered && (
                        <g className="token-hover-layer">
                            <line className="token-hover-line" x1={hoveredX} y1={padding.top} x2={hoveredX} y2={padding.top + plotHeight} />
                            {visibleSeries.map(item => (
                                <circle
                                    key={`${item.key}-hover`}
                                    className={`token-hover-point ${item.key}`}
                                    cx={hoveredX}
                                    cy={yForValue(item.valueOf(hovered))}
                                    r="4.2"
                                />
                            ))}
                            <rect className="token-hover-tooltip" x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="7" />
                            <text className="token-hover-title" x={tooltipX + 10} y={tooltipY + 18}>Depth {hovered.depth}</text>
                            {visibleSeries.map((item, index) => (
                                <text key={`${item.key}-hover-label`} className={`token-hover-label ${item.key}`} x={tooltipX + 10} y={tooltipY + 38 + index * 17}>
                                    {item.label}: {formatTokenCount(item.valueOf(hovered))}
                                </text>
                            ))}
                        </g>
                    )}
                </svg>
            </div>

            <div className="token-chart-legend">
                {visibleSeries.map(item => (
                    <span key={item.key} className="token-legend-item">
                        <span className={`token-legend-swatch ${item.key}`} />
                        {item.label}
                    </span>
                ))}
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Refinement
// ═══════════════════════════════════════════════════════════════════════

const RefinementMethodCard: React.FC<{
    method: string;
    disabled?: boolean;
    children: React.ReactNode;
}> = ({ method, disabled, children }) => (
    <div className={classNames('refinement-method-card', disabled && 'disabled')} data-method={method}>
        {children}
    </div>
);

const SynthesisCard: React.FC<{
    disabled: boolean;
    enabled: boolean;
    hypothesisCount: number;
    shareHypothesesToDissected: boolean;
    onToggle: (enabled: boolean) => void;
    onShareHypothesesToDissectedChange: (share: boolean) => void;
}> = ({ disabled, enabled, hypothesisCount, shareHypothesesToDissected, onToggle, onShareHypothesesToDissectedChange }) => (
    <RefinementMethodCard method="synthesis" disabled={disabled}>
        <div className="method-card-header">
            <MethodCheckbox id="dt-dissected-observations-toggle" checked={enabled} disabled={disabled} onChange={onToggle} />
            <div className="method-card-title">
                <div className="method-name">Critique Synthesis</div>
                <div className="method-type">Single Pass</div>
            </div>
        </div>
        <div className="method-card-description">Synthesizes all solution critiques. Cannot use with Evolving DFS.</div>
        {enabled && !disabled && hypothesisCount > 0 && (
            <div className="method-sub-option" onClick={event => event.stopPropagation()}>
                <ToggleSwitch id="dt-share-hypotheses-toggle" checked={shareHypothesesToDissected} onChange={onShareHypothesesToDissectedChange} />
                <label htmlFor="dt-share-hypotheses-toggle" className="method-sub-option-label">
                    Include Hypothesis Findings
                </label>
            </div>
        )}
        <div className="refinement-card-vis synthesis-vis">
            <div className="vis-inputs">
                {['C₁', 'C₂', 'C₃'].map((label, index) => (
                    <span key={label} className="vis-node critique-node" title={`Critique ${index + 1}`}>{label}</span>
                ))}
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
    </RefinementMethodCard>
);

const FullContextCard: React.FC<{
    disabled: boolean;
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
}> = ({ disabled, enabled, onToggle }) => (
    <RefinementMethodCard method="fullcontext" disabled={disabled}>
        <div className="method-card-header">
            <MethodCheckbox id="dt-provide-all-solutions-toggle" checked={enabled} disabled={disabled} onChange={onToggle} />
            <div className="method-card-title">
                <div className="method-name">Full Solution Context</div>
                <div className="method-type">Static Solution Pool</div>
            </div>
        </div>
        <div className="method-card-description">Provides all solutions to correctors. Cannot use with Evolving DFS.</div>
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
    </RefinementMethodCard>
);

const EvolvingDfsCard: React.FC<{
    strategiesCount: number;
    enabled: boolean;
    disabled: boolean;
    depth: number;
    hypothesisCount: number;
    onToggle: (enabled: boolean) => void;
    onDepthChange: (value: number) => void;
}> = ({ strategiesCount, enabled, disabled, depth, hypothesisCount, onToggle, onDepthChange }) => (
    <RefinementMethodCard method="iterative" disabled={disabled}>
        <div className="method-card-header">
            <MethodCheckbox id="dt-evolving-dfs-toggle" checked={enabled} disabled={disabled} onChange={onToggle} />
            <div className="method-card-title">
                <div className="method-name">Evolving Depth First Search</div>
                <div className="method-type">Depth {depth}</div>
            </div>
        </div>
        <div className="method-card-description">Branch-local correction, critique, solution pools, memory banks, and required PQF evolution.</div>
        <div className="refinement-card-vis iterative-vis" style={{ maxWidth: '100%', justifyContent: 'center', gap: '6px' }}>
            <div className="vis-pool-node" title="Structured Solution Pool">
                <Icon name="database" size="16" />
            </div>
            <div className="vis-arrow-flow" style={{ flex: '0 0 auto' }}>
                <svg viewBox="0 0 24 20" className="flow-arrow-svg" style={{ maxWidth: '24px' }}>
                    <path d="M2,10 L18,10" stroke="var(--accent-yellow)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
                    <polygon points="18,7 24,10 18,13" fill="var(--accent-yellow)" opacity="0.8" />
                </svg>
            </div>
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

        <div className="evolving-dfs-depth-container" style={{ display: enabled ? 'block' : 'none', marginTop: 8, paddingTop: 8, paddingBottom: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="input-group-tight">
                <label htmlFor="dt-evolving-dfs-depth-slider" className="input-label">
                    Search Depth: <span id="dt-evolving-dfs-depth-value">{depth}</span>
                </label>
                <SliderWithFill
                    id="dt-evolving-dfs-depth-slider"
                    value={depth}
                    min={1}
                    max={10}
                    color="var(--accent-purple)"
                    onChange={onDepthChange}
                />
            </div>
            {enabled && (
                <TokenVolumeGraph
                    strategiesCount={strategiesCount}
                    hypothesisCount={hypothesisCount}
                    evolvingDfsDepth={depth}
                />
            )}
        </div>
    </RefinementMethodCard>
);

const RefinementSection: React.FC<{
    strategiesCount: number;
    refinementEnabled: boolean;
    dissectedObservationsEnabled: boolean;
    evolvingDfsEnabled: boolean;
    evolvingDfsDepth: number;
    provideAllSolutionsEnabled: boolean;
    codeExecutionEnabled: boolean;
    hypothesisCount: number;
    shareHypothesesToDissected: boolean;
    onRefinementToggle: (enabled: boolean) => void;
    onDissectedObservationsToggle: (enabled: boolean) => void;
    onEvolvingDfsToggle: (enabled: boolean) => void;
    onEvolvingDfsDepthChange: (value: number) => void;
    onProvideAllSolutionsToggle: (enabled: boolean) => void;
    onCodeExecutionToggle: (enabled: boolean) => void;
    onShareHypothesesToDissectedChange: (share: boolean) => void;
}> = ({
    strategiesCount,
    refinementEnabled,
    dissectedObservationsEnabled,
    evolvingDfsEnabled,
    evolvingDfsDepth,
    provideAllSolutionsEnabled,
    codeExecutionEnabled,
    hypothesisCount,
    shareHypothesesToDissected,
    onRefinementToggle,
    onDissectedObservationsToggle,
    onEvolvingDfsToggle,
    onEvolvingDfsDepthChange,
    onProvideAllSolutionsToggle,
    onCodeExecutionToggle,
    onShareHypothesesToDissectedChange,
}) => {
    const singlePassDisabled = !refinementEnabled || evolvingDfsEnabled;

    return (
        <SectionFrame
            containerClass="refinement-options-container"
            headerClass="refinement-options-header"
            icon="auto_fix_high"
            title="Solution Refinement"
        >
            <div className="refinement-master-control">
                <ToggleSwitch id="dt-refinement-toggle" checked={refinementEnabled} onChange={onRefinementToggle} />
                <div className="refinement-master-info">
                    <div className="refinement-master-title">Enable Refinements</div>
                    <div className="refinement-master-description">Generates critique for each solution &amp; attempts to correct it</div>
                </div>
            </div>

            <div className="refinement-methods">
                <div className="refinement-methods-label">Select Refinement Strategy</div>

                <div className="refinement-methods-row">
                    <SynthesisCard
                        disabled={singlePassDisabled}
                        enabled={dissectedObservationsEnabled}
                        hypothesisCount={hypothesisCount}
                        shareHypothesesToDissected={shareHypothesesToDissected}
                        onToggle={onDissectedObservationsToggle}
                        onShareHypothesesToDissectedChange={onShareHypothesesToDissectedChange}
                    />
                    <FullContextCard
                        disabled={singlePassDisabled}
                        enabled={provideAllSolutionsEnabled}
                        onToggle={onProvideAllSolutionsToggle}
                    />
                </div>

                <EvolvingDfsCard
                    strategiesCount={strategiesCount}
                    enabled={evolvingDfsEnabled}
                    disabled={!refinementEnabled}
                    depth={evolvingDfsDepth}
                    hypothesisCount={hypothesisCount}
                    onToggle={onEvolvingDfsToggle}
                    onDepthChange={onEvolvingDfsDepthChange}
                />
            </div>

            <div className="code-execution-toggle-container" id="dt-code-execution-container" style={{ display: 'flex', marginTop: 12 }}>
                <ToggleSwitch
                    id="dt-code-execution-toggle"
                    checked={codeExecutionEnabled}
                    onChange={onCodeExecutionToggle}
                    className="code-execution-toggle-label"
                    inputClassName="code-execution-toggle-input"
                    sliderClassName="code-execution-toggle-slider"
                />
                <div className="code-execution-toggle-info">
                    <span className="code-execution-toggle-title">Python Tool Environment</span>
                    <span className="code-execution-toggle-subtitle">Backend Python workspace for eligible agents</span>
                </div>
            </div>
        </SectionFrame>
    );
};

// ═══════════════════════════════════════════════════════════════════════
// Main Config Panel Component
// ═══════════════════════════════════════════════════════════════════════

export const DeepthinkConfigPanelComponent: React.FC<DeepthinkConfigPanelProps> = props => (
    <div className="deepthink-config-panel">
        <div className="deepthink-config-scroll-container">
            <div className="config-row-container">
                <div className="config-row-inner">
                    <StrategyExecutionSection
                        strategiesCount={props.strategiesCount}
                        subStrategiesCount={props.subStrategiesCount}
                        evolvingDfsEnabled={props.evolvingDfsEnabled}
                        onStrategiesChange={props.onStrategiesChange}
                        onSubStrategiesChange={props.onSubStrategiesChange}
                        onSkipSubStrategiesToggle={props.onSkipSubStrategiesToggle}
                    />
                    <EvolutionFilterSection
                        pqfMode={props.pqfMode}
                        evolvingDfsEnabled={props.evolvingDfsEnabled}
                        onPqfModeChange={props.onPqfModeChange}
                    />
                </div>
            </div>

            <div className="config-row-container">
                <div className="config-row-inner">
                    <InformationPacketSection
                        hypothesisEnabled={props.hypothesisEnabled}
                        hypothesisCount={props.hypothesisCount}
                        hypothesisInjectionMode={props.hypothesisInjectionMode}
                        evolvingDfsEnabled={props.evolvingDfsEnabled}
                        onHypothesisToggle={props.onHypothesisToggle}
                        onHypothesisChange={props.onHypothesisChange}
                        onHypothesisInjectionModeChange={props.onHypothesisInjectionModeChange}
                    />
                    <RefinementSection
                        strategiesCount={props.strategiesCount}
                        refinementEnabled={props.refinementEnabled}
                        dissectedObservationsEnabled={props.dissectedObservationsEnabled}
                        evolvingDfsEnabled={props.evolvingDfsEnabled}
                        evolvingDfsDepth={props.evolvingDfsDepth}
                        provideAllSolutionsEnabled={props.provideAllSolutionsEnabled}
                        codeExecutionEnabled={props.codeExecutionEnabled}
                        hypothesisCount={props.hypothesisCount}
                        shareHypothesesToDissected={props.shareHypothesesToDissected}
                        onShareHypothesesToDissectedChange={props.onShareHypothesesToDissectedChange}
                        onRefinementToggle={props.onRefinementToggle}
                        onDissectedObservationsToggle={props.onDissectedObservationsToggle}
                        onEvolvingDfsToggle={props.onEvolvingDfsToggle}
                        onEvolvingDfsDepthChange={props.onEvolvingDfsDepthChange}
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

function deriveProps(controller: DeepthinkController): DeepthinkConfigPanelProps {
    const state = controller.getState();

    return {
        ...state,
        onStrategiesChange: value => controller.setStrategiesCount(value),
        onSubStrategiesChange: value => controller.setSubStrategiesCount(value),
        onHypothesisChange: value => controller.setHypothesisCount(value),
        onSkipSubStrategiesToggle: value => controller.setSkipSubStrategies(value),
        onHypothesisToggle: value => controller.setHypothesisEnabled(value),
        onPqfModeChange: value => controller.setPqfMode(value),
        onPostQualityFilterToggle: value => controller.setPostQualityFilterEnabled(value),
        onRefinementToggle: value => controller.setRefinementEnabled(value),
        onDissectedObservationsToggle: value => controller.setDissectedObservationsEnabled(value),
        onEvolvingDfsToggle: value => controller.setEvolvingDfsEnabled(value),
        onEvolvingDfsDepthChange: value => controller.setEvolvingDfsDepth(value),
        onProvideAllSolutionsToggle: value => controller.setProvideAllSolutionsEnabled(value),
        onCodeExecutionToggle: value => controller.setCodeExecutionEnabled(value),
        onHypothesisInjectionModeChange: value => controller.setHypothesisInjectionMode(value),
        shareHypothesesToDissected: state.shareHypothesesToDissected,
        onShareHypothesesToDissectedChange: value => controller.setShareHypothesesToDissected(value),
    };
}

let configPanelRoot: Root | null = null;
let configPanelContainerNode: HTMLElement | null = null;
let unsubscribeControllerEvents: (() => void) | null = null;

const deferUnmount = (root: Root): void => {
    const unmount = () => root.unmount();

    if (typeof queueMicrotask === 'function') {
        queueMicrotask(unmount);
        return;
    }

    setTimeout(unmount, 0);
};

function renderPanel(controller: DeepthinkController): void {
    configPanelRoot?.render(React.createElement(DeepthinkConfigPanelComponent, deriveProps(controller)));
}

function hideMainHeader(): void {
    const mainHeaderContent = document.querySelector<HTMLElement>('.main-header-content');
    if (mainHeaderContent) mainHeaderContent.style.display = 'none';
}

function disposeRoot(): void {
    if (!configPanelRoot) return;

    const rootToUnmount = configPanelRoot;
    configPanelRoot = null;
    configPanelContainerNode = null;
    deferUnmount(rootToUnmount);
}

function ensureRoot(container: HTMLElement): void {
    if (configPanelRoot && configPanelContainerNode && !document.contains(configPanelContainerNode)) {
        disposeRoot();
    }

    if (configPanelRoot && configPanelContainerNode?.parentElement !== container) {
        disposeRoot();
    }

    if (configPanelRoot) return;

    container.innerHTML = '';
    configPanelContainerNode = document.createElement('div');
    configPanelContainerNode.className = 'deepthink-config-react-root';
    container.appendChild(configPanelContainerNode);
    configPanelRoot = createRoot(configPanelContainerNode);
}

function subscribeToController(controller: DeepthinkController): () => void {
    unsubscribeControllerEvents?.();

    const render = () => renderPanel(controller);
    controller.addEventListener('configchange', render);
    window.addEventListener('selectedModelChanged', render);

    unsubscribeControllerEvents = () => {
        controller.removeEventListener('configchange', render);
        window.removeEventListener('selectedModelChanged', render);
        unsubscribeControllerEvents = null;
    };

    return unsubscribeControllerEvents;
}

/**
 * Renders the Deepthink config panel into the given container.
 * Subscribes to the controller's state changes and re-renders automatically.
 */
export function renderDeepthinkConfigPanelInContainer(pipelinesContentContainer: HTMLElement): void {
    if (!pipelinesContentContainer) return;

    const controller = getDeepthinkConfigController();

    hideMainHeader();
    disableSidebarCollapseButton('Sidebar collapse disabled in config view');
    ensureRoot(pipelinesContentContainer);
    renderPanel(controller);

    const unsubscribe = subscribeToController(controller);

    // The router calls this opaque property; keep it while making repeated mounts idempotent.
    (pipelinesContentContainer as any).__deepthinkConfigCleanup = () => {
        unsubscribe();
        disposeRoot();
    };
}

export { renderDeepthinkConfigPanelInContainer as renderDeepthinkConfigPanel };
export default DeepthinkConfigPanelComponent;