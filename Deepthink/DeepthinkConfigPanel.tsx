/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DeepthinkConfigPanel — the fixed Deepthink configuration surface.
 * The original panel layout and visual primitives are retained; only the
 * retired execution choices have been removed from the rendered controls.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getDeepthinkConfigController } from '../Routing';
import {
    buildDeepthinkTokenTrend,
    calculateDeepthinkTokenEstimate,
    type DeepthinkTokenEstimate,
} from '../Routing/DeepthinkTokenEstimator';
import { MAX_HYPOTHESIS_COUNT } from '../Routing/ModelConfig';
import { Icon } from '../UI/Icons';
import { disableSidebarCollapseButton } from '../UI/LayoutController';

type DeepthinkController = ReturnType<typeof getDeepthinkConfigController>;
type TokenGraphFocus = 'total' | 'input' | 'output';

interface DeepthinkConfigPanelProps {
    strategiesCount: number;
    strategyProximityLoops: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    hypothesisEnabled: boolean;
    pqfMode: string;
    deepthinkDepth: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    codeExecutionEnabled: boolean;
    onStrategiesChange: (count: number) => void;
    onStrategyProximityLoopsChange: (count: number) => void;
    onHypothesisChange: (count: number) => void;
    onHypothesisProximityLoopsChange: (count: number) => void;
    onHypothesisToggle: (enabled: boolean) => void;
    onPqfModeChange: (mode: string) => void;
    onDeepthinkDepthChange: (depth: number) => void;
    onIsolateBranchesToggle: (enabled: boolean) => void;
    onSolutionPoolDisabledToggle: (disabled: boolean) => void;
    onCodeExecutionToggle: (enabled: boolean) => void;
}

interface SectionFrameProps {
    containerClass: string;
    headerClass: string;
    icon: string;
    title: string;
    children: React.ReactNode;
}

interface SliderWithFillProps {
    id: string;
    value: number;
    min: number;
    max: number;
    color: string;
    disabled?: boolean;
    onChange: (value: number) => void;
}

interface ToggleSwitchProps {
    id: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
    inputClassName?: string;
    sliderClassName?: string;
    disabled?: boolean;
}

interface SvgArrowPath {
    d: string;
    color: string;
    strokeWidth?: number;
    dashArray?: string;
    opacity?: number;
    markerSize?: number;
    arrow?: boolean;
}

interface SvgArrowDiagramProps {
    viewBox: string;
    className: string;
    paths: readonly SvgArrowPath[];
    preserveAspectRatio?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}

const PQF_MODES = [
    { value: 'balanced', label: 'Balanced' },
    { value: 'very_aggressive', label: 'Aggressive' },
] as const;

const PACKET_LINE_WIDTHS = [
    [90, 65, 80],
    [85, 75, 90],
    [75, 85, 70],
] as const;

const PACKET_LINE_OPACITY = [0.8, 0.55, 0.3] as const;
const BRANCH_EDGE_MAP = [
    { sourceIndex: 0, targetIndex: 2, opacity: 0.8 },
    { sourceIndex: 1, targetIndex: 0, opacity: 0.75 },
    { sourceIndex: 1, targetIndex: 3, opacity: 0.75 },
    { sourceIndex: 2, targetIndex: 1, opacity: 0.8 },
] as const;

const TOKEN_SERIES = [
    { key: 'input-worst', label: 'Input worst', category: 'input', valueOf: (point: DeepthinkTokenEstimate) => point.input.worst },
    { key: 'input-average', label: 'Input avg', category: 'input', valueOf: (point: DeepthinkTokenEstimate) => point.input.average },
    { key: 'output-worst', label: 'Output worst', category: 'output', valueOf: (point: DeepthinkTokenEstimate) => point.output.worst },
    { key: 'output-average', label: 'Output avg', category: 'output', valueOf: (point: DeepthinkTokenEstimate) => point.output.average },
] as const;

const TOKEN_CHART = {
    width: 660,
    height: 360,
    padding: { top: 28, right: 20, bottom: 48, left: 66 },
} as const;

const classNames = (...parts: Array<string | false | null | undefined>): string => (
    parts.filter(Boolean).join(' ')
);

const clamp = (value: number, min: number, max: number): number => (
    Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
);

const toInteger = (value: string): number => Number.parseInt(value, 10);

const range = <T,>(length: number, mapper: (index: number) => T): T[] => (
    Array.from({ length: Math.max(0, length) }, (_, index) => mapper(index))
);

const percentBetween = (value: number, min: number, max: number): number => (
    max > min ? clamp(((value - min) / (max - min)) * 100, 0, 100) : 0
);

const filledTrack = (percentage: number, color: string): string => (
    'linear-gradient(to right, ' + color + ' 0%, ' + color + ' ' + percentage + '%, var(--slider-track-color) ' + percentage + '%, var(--slider-track-color) 100%)'
);

const evenlySpacedCenters = (count: number, width: number): number[] => (
    range(count, index => ((index + 0.5) / count) * width)
);

const SectionFrame: React.FC<SectionFrameProps> = ({ containerClass, headerClass, icon, title, children }) => (
    <div className={containerClass}>
        <div className={headerClass}>
            <Icon name={icon} />
            <span>{title}</span>
        </div>
        {children}
    </div>
);

const SliderWithFill: React.FC<SliderWithFillProps> = ({ id, value, min, max, color, disabled, onChange }) => {
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

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
    id,
    checked,
    onChange,
    className = 'toggle-switch',
    inputClassName = 'toggle-input',
    sliderClassName = 'toggle-slider',
    disabled,
}) => (
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

const SvgArrowDiagram: React.FC<SvgArrowDiagramProps> = ({
    viewBox,
    className,
    paths,
    preserveAspectRatio,
    style,
    children,
}) => {
    const markerNamespace = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');

    return (
        <svg
            viewBox={viewBox}
            className={className}
            preserveAspectRatio={preserveAspectRatio}
            style={style}
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                {paths.map((path, index) => path.arrow !== false && (
                    <marker
                        key={'marker-' + String(index)}
                        id={markerNamespace + '-arrow-' + String(index)}
                        markerUnits="userSpaceOnUse"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth={path.markerSize ?? 6}
                        markerHeight={path.markerSize ?? 6}
                        orient="auto"
                    >
                        <path d="M1 1 L7 4 L1 7 Z" fill={path.color} opacity={path.opacity ?? 1} />
                    </marker>
                ))}
            </defs>
            {children}
            {paths.map((path, index) => (
                <path
                    key={path.d + '-' + String(index)}
                    d={path.d}
                    fill="none"
                    stroke={path.color}
                    strokeWidth={path.strokeWidth ?? 1.5}
                    strokeDasharray={path.dashArray}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={path.opacity ?? 1}
                    markerEnd={path.arrow === false ? undefined : 'url(#' + markerNamespace + '-arrow-' + String(index) + ')'}
                />
            ))}
        </svg>
    );
};

const StrategyExecutionSection: React.FC<{
    strategiesCount: number;
    strategyProximityLoops: number;
    onStrategiesChange: (count: number) => void;
    onStrategyProximityLoopsChange: (count: number) => void;
}> = ({ strategiesCount, strategyProximityLoops, onStrategiesChange, onStrategyProximityLoopsChange }) => (
    <div className="strategy-execution-container">
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
                        max={5}
                        color="#e86b6b"
                        onChange={onStrategiesChange}
                    />
                    <label htmlFor="dt-strategy-proximity-slider" className="input-label proximity-loop-label">
                        Strategy–proximity loops: <span id="dt-strategy-proximity-value">{strategyProximityLoops}</span>
                    </label>
                    <SliderWithFill
                        id="dt-strategy-proximity-slider"
                        value={strategyProximityLoops}
                        min={1}
                        max={5}
                        color="#e86b6b"
                        onChange={onStrategyProximityLoopsChange}
                    />
                </div>
            </div>
        </div>
    </div>
);

const EvolutionFilterSection: React.FC<{
    pqfMode: string;
    onPqfModeChange: (mode: string) => void;
}> = ({ pqfMode, onPqfModeChange }) => (
    <SectionFrame
        containerClass="evolution-filter-options-container"
        headerClass="evolution-filter-options-header"
        icon="security"
        title="Post Quality Filter"
    >
        <div className="deepthink-card-vis post-quality-filter-vis" style={{ marginTop: '8px', marginBottom: '16px' }}>
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
                <div className="vis-strategy-node evolved-node" title="Replacement Strategy">
                    <Icon name="lightbulb" size="10" />
                    <span>S₁</span>
                </div>
                <div className="vis-final-badge" title="Verified OK">
                    <Icon name="check" size="10" />
                    <span>OK</span>
                </div>
            </div>
        </div>

        <div className="pqf-toggle-wrapper">
            <div className="pqf-buttons">
                {PQF_MODES.map(mode => (
                    <button
                        key={mode.value}
                        type="button"
                        className={classNames('pqf-button', pqfMode === mode.value && 'active')}
                        aria-pressed={pqfMode === mode.value}
                        onClick={() => onPqfModeChange(mode.value)}
                    >
                        {mode.label}
                    </button>
                ))}
            </div>
        </div>
    </SectionFrame>
);

const StrategyCards: React.FC<{ count: number }> = ({ count }) => (
    <div className="vis-strategies-row">
        {range(count, index => (
            <div key={index} className="vis-strategy-card-mini">Strategy {index + 1}</div>
        ))}
    </div>
);

const DescendingArrows: React.FC<{ count: number; width: number }> = ({ count, width }) => (
    <SvgArrowDiagram
        viewBox={'0 0 ' + String(width) + ' 64'}
        className="vis-descending-arrows"
        preserveAspectRatio="none"
        paths={evenlySpacedCenters(count, width).map(x => ({
            d: 'M' + String(x) + ' 3 V57',
            color: 'var(--accent-purple)',
            strokeWidth: 1.6,
            opacity: 0.8,
            markerSize: 7,
        }))}
    />
);

const BranchPacketPreview: React.FC = () => (
    <div className="hypothesis-routing-preview branch-routing">
        <StrategyCards count={3} />
        <DescendingArrows count={3} width={300} />
        <div className="vis-branch-packets-row">
            {PACKET_LINE_WIDTHS.map((widths, packetIndex) => (
                <div key={packetIndex} className="vis-branch-packet">
                    <div className="vis-branch-packet-title">Branch {packetIndex + 1}</div>
                    {widths.map((width, lineIndex) => (
                        <div
                            key={String(packetIndex) + '-' + String(lineIndex)}
                            className="loading-line"
                            style={{
                                width: String(width) + '%',
                                height: '6px',
                                opacity: PACKET_LINE_OPACITY[lineIndex],
                            }}
                        />
                    ))}
                </div>
            ))}
        </div>
    </div>
);

const ExecutionAgentsVisualization: React.FC = () => {
    const packetCenters = evenlySpacedCenters(3, 400);
    const agentCenters = evenlySpacedCenters(4, 400);
    const connectionPaths: SvgArrowPath[] = BRANCH_EDGE_MAP.map(edge => ({
        d: 'M' + String(packetCenters[edge.sourceIndex]) + ' 6 L' + String(agentCenters[edge.targetIndex]) + ' 109',
        color: 'var(--accent-blue)',
        opacity: edge.opacity,
    }));

    return (
        <div className="execution-agents-visualization" id="dt-execution-agents-visualization">
            <div className="connection-nodes">
                <SvgArrowDiagram
                    viewBox="0 0 400 116"
                    className="connection-svg"
                    preserveAspectRatio="none"
                    paths={connectionPaths}
                >
                    {packetCenters.map(x => (
                        <circle key={x} cx={x} cy="6" r="4" fill="var(--accent-blue)" />
                    ))}
                </SvgArrowDiagram>
            </div>
            <div className="branch-agents">
                {range(4, index => (
                    <div key={index} className="agent-pill">Execution-{index + 1}</div>
                ))}
            </div>
        </div>
    );
};

const SandboxEnvironmentPanel: React.FC<{
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
}> = ({ enabled, onToggle }) => (
    <div className="code-execution-toggle-container" id="dt-code-execution-container">
        <ToggleSwitch
            id="dt-code-execution-toggle"
            checked={enabled}
            onChange={onToggle}
        />
        <div className="code-execution-toggle-info">
            <span className="code-execution-toggle-title">Sandbox Terminal Environment</span>
            <span className="code-execution-toggle-subtitle">Persistent secure workspace for every Deepthink agent</span>
        </div>
    </div>
);

const InformationPacketSection: React.FC<{
    hypothesisEnabled: boolean;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    onHypothesisToggle: (enabled: boolean) => void;
    onHypothesisChange: (count: number) => void;
    onHypothesisProximityLoopsChange: (count: number) => void;
}> = ({
    hypothesisEnabled,
    hypothesisCount,
    hypothesisProximityLoops,
    onHypothesisToggle,
    onHypothesisChange,
    onHypothesisProximityLoopsChange,
}) => {
    const toggleHypotheses = (enabled: boolean) => {
        onHypothesisToggle(enabled);
        if (!enabled) onHypothesisChange(0);
    };

    return (
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
                    <div className="window-controls" aria-hidden="true">
                        <div className="window-button close" />
                        <div className="window-button minimize" />
                        <div className="window-button maximize" />
                    </div>
                </div>
            </div>

            <div className="window-content" id="dt-information-packet-content">
                <div className="hypothesis-visual-stack" aria-hidden="true">
                    <BranchPacketPreview />
                    <ExecutionAgentsVisualization />
                </div>

                <div className="hypothesis-controls">
                    <div className="hypothesis-slider-container" id="dt-hypothesis-slider-container">
                        <div className="input-group-tight">
                            <label htmlFor="dt-hypothesis-slider" className="input-label">
                                Hypothesis Count: <span id="dt-hypothesis-value">{hypothesisCount}</span>
                            </label>
                            <SliderWithFill
                                id="dt-hypothesis-slider"
                                value={hypothesisCount > 0 ? hypothesisCount : 1}
                                min={1}
                                max={MAX_HYPOTHESIS_COUNT}
                                color="var(--accent-blue)"
                                disabled={!hypothesisEnabled}
                                onChange={onHypothesisChange}
                            />
                            <label htmlFor="dt-hypothesis-proximity-slider" className="input-label proximity-loop-label">
                                Hypothesis–proximity loops: <span id="dt-hypothesis-proximity-value">{hypothesisProximityLoops}</span>
                            </label>
                            <SliderWithFill
                                id="dt-hypothesis-proximity-slider"
                                value={hypothesisProximityLoops}
                                min={1}
                                max={5}
                                color="var(--accent-blue)"
                                disabled={!hypothesisEnabled}
                                onChange={onHypothesisProximityLoopsChange}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const formatTokenCount = (value: number): string => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    if (safeValue >= 1000000) {
        const millions = safeValue / 1000000;
        return String(millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)) + 'M';
    }
    if (safeValue >= 1000) {
        const thousands = safeValue / 1000;
        return String(thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1)) + 'K';
    }
    return String(Math.round(safeValue));
};

const formatTokenRange = (rangeValue: { average: number; worst: number }): string => (
    formatTokenCount(rangeValue.average) + ' - ' + formatTokenCount(rangeValue.worst)
);

const pathForPoints = (points: Array<{ x: number; y: number }>): string => (
    points.map((point, index) => (index === 0 ? 'M' : 'L') + ' ' + point.x.toFixed(2) + ' ' + point.y.toFixed(2)).join(' ')
);

const TokenVolumeGraph: React.FC<{
    strategiesCount: number;
    hypothesisCount: number;
    deepthinkDepth: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
}> = ({ strategiesCount, hypothesisCount, deepthinkDepth, isolateBranches, disableSolutionPool }) => {
    const [focus, setFocus] = React.useState<TokenGraphFocus>('total');
    const [hoverDepth, setHoverDepth] = React.useState<number | null>(null);
    const safeDepth = Math.max(1, Math.round(deepthinkDepth || 1));
    const trend = React.useMemo(() => buildDeepthinkTokenTrend({
        strategiesCount,
        hypothesisCount,
        isolateBranches,
        disableSolutionPool,
        maxDepth: safeDepth,
    }), [strategiesCount, hypothesisCount, isolateBranches, disableSolutionPool, safeDepth]);
    const selected = React.useMemo(() => calculateDeepthinkTokenEstimate({
        strategiesCount,
        hypothesisCount,
        deepthinkDepth: safeDepth,
        isolateBranches,
        disableSolutionPool,
    }), [strategiesCount, hypothesisCount, isolateBranches, disableSolutionPool, safeDepth]);

    const { width, height, padding } = TOKEN_CHART;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxDepth = Math.max(1, trend.at(-1)?.depth ?? selected.depth);
    const selectedDepth = clamp(selected.depth, 1, maxDepth);
    const selectedX = maxDepth === 1
        ? padding.left + plotWidth / 2
        : padding.left + ((selectedDepth - 1) / (maxDepth - 1)) * plotWidth;
    const visibleSeries = focus === 'total' ? TOKEN_SERIES : TOKEN_SERIES.filter(item => item.category === focus);
    const allValues = visibleSeries.flatMap(item => trend.map(point => item.valueOf(point))).filter(value => value > 0);
    const maxValue = Math.max(...allValues, 1) * 1.1;
    const minPositive = allValues.length ? Math.max(1, Math.min(...allValues)) : 1;
    const minValue = Math.max(1, minPositive * 0.72);
    const xForDepth = (depth: number): number => (
        maxDepth === 1 ? padding.left + plotWidth / 2 : padding.left + ((depth - 1) / (maxDepth - 1)) * plotWidth
    );
    const yForValue = (value: number): number => {
        const logMin = Math.log10(minValue);
        const logMax = Math.log10(maxValue);
        const normalizedValue = (Math.log10(Math.max(value, minValue)) - logMin) / (logMax - logMin || 1);
        return padding.top + plotHeight - normalizedValue * plotHeight;
    };
    const pathForSeries = (valueOf: (point: DeepthinkTokenEstimate) => number): string => (
        pathForPoints(trend.map(point => ({ x: xForDepth(point.depth), y: yForValue(valueOf(point)) })))
    );
    const areaPathForFocus = (category: 'input' | 'output'): string => {
        const high = category === 'input'
            ? (point: DeepthinkTokenEstimate) => point.input.worst
            : (point: DeepthinkTokenEstimate) => point.output.worst;
        const low = category === 'input'
            ? (point: DeepthinkTokenEstimate) => point.input.average
            : (point: DeepthinkTokenEstimate) => point.output.average;
        const upper = trend.map(point => ({ x: xForDepth(point.depth), y: yForValue(high(point)) }));
        const lower = [...trend].reverse().map(point => ({ x: xForDepth(point.depth), y: yForValue(low(point)) }));
        return pathForPoints(upper) + ' ' + lower.map(point => 'L ' + point.x.toFixed(2) + ' ' + point.y.toFixed(2)).join(' ') + ' Z';
    };
    const yTicks = [minValue, Math.sqrt(minValue * maxValue), maxValue];
    const xTicks = maxDepth <= 4 ? range(maxDepth, index => index + 1) : Array.from(new Set([1, Math.ceil(maxDepth / 2), maxDepth]));
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
        <div className={'token-volume-estimator focus-' + focus}>
            <div className="token-estimator-layout">
                <div className="token-chart-column">
                    <div className="token-chart-shell">
                        <svg
                            className="token-chart-svg"
                            viewBox={'0 0 ' + String(width) + ' ' + String(height)}
                            preserveAspectRatio="none"
                            role="img"
                            aria-label={'Estimated token volume through depth ' + String(selectedDepth)}
                            onPointerMove={handlePointerMove}
                            onPointerLeave={() => setHoverDepth(null)}
                        >
                            <rect className="token-chart-backdrop" x="0" y="0" width={width} height={height} rx="8" />
                            {yTicks.map((tick, index) => {
                                const y = yForValue(tick);
                                return (
                                    <g key={'y-' + String(index)}>
                                        <line className="token-grid-line" x1={padding.left} y1={y} x2={width - padding.right} y2={y} />
                                        <text className="token-axis-label token-y-label" x={padding.left - 8} y={y + 4} textAnchor="end">{formatTokenCount(tick)}</text>
                                    </g>
                                );
                            })}
                            {xTicks.map(tick => {
                                const x = xForDepth(tick);
                                return (
                                    <g key={'x-' + String(tick)}>
                                        <line className="token-x-tick" x1={x} y1={padding.top + plotHeight} x2={x} y2={padding.top + plotHeight + 5} />
                                        <text className="token-axis-label" x={x} y={height - 12} textAnchor="middle">{tick}</text>
                                    </g>
                                );
                            })}
                            <text className="token-axis-caption" x={padding.left + plotWidth / 2} y={height - 2} textAnchor="middle">Depth</text>
                            <text className="token-axis-caption token-y-axis-caption" x={-(padding.top + plotHeight / 2)} y="14" textAnchor="middle" transform="rotate(-90)">Total tokens</text>
                            <line className="token-selected-depth-line" x1={selectedX} y1={padding.top} x2={selectedX} y2={padding.top + plotHeight} />
                            {focus !== 'total' && <path className={'token-area-fill ' + focus} d={areaPathForFocus(focus)} />}
                            {visibleSeries.map(item => <path key={item.key} className={'token-series-line ' + item.key} d={pathForSeries(item.valueOf)} />)}
                            {visibleSeries.map(item => (
                                <circle key={item.key + '-point'} className={'token-selected-point ' + item.key} cx={selectedX} cy={yForValue(item.valueOf(selected))} r="3.4" />
                            ))}
                            {hovered && (
                                <g className="token-hover-layer">
                                    <line className="token-hover-line" x1={hoveredX} y1={padding.top} x2={hoveredX} y2={padding.top + plotHeight} />
                                    {visibleSeries.map(item => (
                                        <circle key={item.key + '-hover'} className={'token-hover-point ' + item.key} cx={hoveredX} cy={yForValue(item.valueOf(hovered))} r="4.2" />
                                    ))}
                                    <rect className="token-hover-tooltip" x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="7" />
                                    <text className="token-hover-title" x={tooltipX + 10} y={tooltipY + 18}>Depth {hovered.depth}</text>
                                    {visibleSeries.map((item, index) => (
                                        <text key={item.key + '-hover-label'} className={'token-hover-label ' + item.key} x={tooltipX + 10} y={tooltipY + 38 + index * 17}>
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
                                <span className={'token-legend-swatch ' + item.key} />
                                {item.label}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="token-summary-column">
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
                </div>
            </div>
        </div>
    );
};

const DeepthinkPipelineCard: React.FC<{
    strategiesCount: number;
    hypothesisCount: number;
    deepthinkDepth: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    onDeepthinkDepthChange: (depth: number) => void;
    onIsolateBranchesToggle: (enabled: boolean) => void;
    onSolutionPoolDisabledToggle: (disabled: boolean) => void;
}> = ({
    strategiesCount,
    hypothesisCount,
    deepthinkDepth,
    isolateBranches,
    disableSolutionPool,
    onDeepthinkDepthChange,
    onIsolateBranchesToggle,
    onSolutionPoolDisabledToggle,
}) => (
    <div className="deepthink-method-card">
        <div className="deepthink-card-vis deepthink-process-vis">
            <div className={classNames('vis-pool-node', disableSolutionPool && 'disabled')} title={disableSolutionPool ? 'Structured Solution Pool disabled' : 'Structured Solution Pool'}>
                <Icon name="database" size="16" />
            </div>
            <div className={classNames('vis-arrow-flow vis-pool-connector', disableSolutionPool && 'disabled')}>
                <SvgArrowDiagram
                    viewBox="0 0 24 20"
                    className="flow-arrow-svg"
                    style={{ maxWidth: '24px' }}
                    paths={[{ d: 'M2 10 H23', color: 'var(--accent-yellow)', dashArray: '3 2', opacity: 0.65 }]}
                />
            </div>
            <div className="vis-critique-loop-pill" title="Critique and correction cycle">
                <div className="vis-node critique-node" title="Critique">C</div>
                <div className="vis-arrow-flow" style={{ flex: '0 0 auto' }}>
                    <SvgArrowDiagram
                        viewBox="0 0 32 20"
                        className="flow-arrow-svg"
                        style={{ maxWidth: '32px' }}
                        paths={[
                            { d: 'M3 6 H30', color: 'var(--accent-purple)', dashArray: '2 1', opacity: 0.65 },
                            { d: 'M29 14 H2', color: 'var(--accent-purple)', dashArray: '2 1', opacity: 0.65 },
                        ]}
                    />
                </div>
                <div className="vis-node corrector-node" title="Correction">R</div>
            </div>
            <div className="vis-memory-connector" title="Memory is distilled every 5 completed branch iterations">
                <span className="vis-memory-interval">5 iter</span>
                <SvgArrowDiagram
                    viewBox="0 0 48 24"
                    className="flow-arrow-svg"
                    paths={[
                        { d: 'M3 8 H46', color: 'var(--accent-blue)', strokeWidth: 1.4, dashArray: '3 2', opacity: 0.75 },
                        { d: 'M45 17 H2', color: 'var(--accent-purple)', strokeWidth: 1.2, dashArray: '2 2', opacity: 0.55 },
                    ]}
                />
            </div>
            <div className="vis-node memory-bank-node" title="Distilled Memory Bank">
                <Icon name="pending" size="14" strokeWidth={1.8} />
            </div>
        </div>

        <div className="deepthink-depth-container">
            <div className="input-group-tight">
                <label htmlFor="dt-deepthink-depth-slider" className="input-label">
                    Search Depth: <span id="dt-deepthink-depth-value">{deepthinkDepth}</span>
                </label>
                <SliderWithFill
                    id="dt-deepthink-depth-slider"
                    value={deepthinkDepth}
                    min={1}
                    max={10}
                    color="var(--accent-purple)"
                    onChange={onDeepthinkDepthChange}
                />
            </div>
            <div className="deepthink-behavior-controls">
                <div className="isolate-branches-option">
                    <label htmlFor="dt-isolate-branches-toggle" className="deepthink-behavior-label">Isolate Branches</label>
                    <ToggleSwitch id="dt-isolate-branches-toggle" checked={isolateBranches} onChange={onIsolateBranchesToggle} />
                </div>
                <div className="disable-solution-pool-option">
                    <label htmlFor="dt-disable-solution-pool-toggle" className="deepthink-behavior-label">Disable Solution Pool</label>
                    <ToggleSwitch id="dt-disable-solution-pool-toggle" checked={disableSolutionPool} onChange={onSolutionPoolDisabledToggle} />
                </div>
            </div>
            <TokenVolumeGraph
                strategiesCount={strategiesCount}
                hypothesisCount={hypothesisCount}
                deepthinkDepth={deepthinkDepth}
                isolateBranches={isolateBranches}
                disableSolutionPool={disableSolutionPool}
            />
        </div>
    </div>
);

const DeepthinkConfigPanelComponent: React.FC<DeepthinkConfigPanelProps> = props => (
    <div className="deepthink-config-panel">
        <div className="deepthink-config-scroll-container">
            <div className="config-row-container">
                <div className="config-row-inner">
                    <div className="strategy-controls-column">
                        <SandboxEnvironmentPanel enabled={props.codeExecutionEnabled} onToggle={props.onCodeExecutionToggle} />
                        <StrategyExecutionSection
                            strategiesCount={props.strategiesCount}
                            strategyProximityLoops={props.strategyProximityLoops}
                            onStrategiesChange={props.onStrategiesChange}
                            onStrategyProximityLoopsChange={props.onStrategyProximityLoopsChange}
                        />
                    </div>
                    <div className="information-column">
                        <EvolutionFilterSection pqfMode={props.pqfMode} onPqfModeChange={props.onPqfModeChange} />
                    </div>
                </div>
            </div>
            <div className="config-row-container">
                <div className="config-row-inner">
                    <InformationPacketSection
                        hypothesisEnabled={props.hypothesisEnabled}
                        hypothesisCount={props.hypothesisCount}
                        hypothesisProximityLoops={props.hypothesisProximityLoops}
                        onHypothesisToggle={props.onHypothesisToggle}
                        onHypothesisChange={props.onHypothesisChange}
                        onHypothesisProximityLoopsChange={props.onHypothesisProximityLoopsChange}
                    />
                    <div className="deepthink-options-container">
                        <div className="window-header">
                            <div className="window-left">
                                <Icon name="sync" />
                                <div className="window-title">Deepthink Pipeline</div>
                            </div>
                        </div>
                        <div className="window-content deepthink-window-content">
                            <div className="deepthink-methods">
                                <DeepthinkPipelineCard
                                    strategiesCount={props.strategiesCount}
                                    hypothesisCount={props.hypothesisCount}
                                    deepthinkDepth={props.deepthinkDepth}
                                    isolateBranches={props.isolateBranches}
                                    disableSolutionPool={props.disableSolutionPool}
                                    onDeepthinkDepthChange={props.onDeepthinkDepthChange}
                                    onIsolateBranchesToggle={props.onIsolateBranchesToggle}
                                    onSolutionPoolDisabledToggle={props.onSolutionPoolDisabledToggle}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

function deriveProps(controller: DeepthinkController): DeepthinkConfigPanelProps {
    const state = controller.getState();
    return {
        ...state,
        onStrategiesChange: value => controller.setStrategiesCount(value),
        onStrategyProximityLoopsChange: value => controller.setStrategyProximityLoops(value),
        onHypothesisChange: value => controller.setHypothesisCount(value),
        onHypothesisProximityLoopsChange: value => controller.setHypothesisProximityLoops(value),
        onHypothesisToggle: value => controller.setHypothesisEnabled(value),
        onPqfModeChange: value => controller.setPqfMode(value),
        onDeepthinkDepthChange: value => controller.setDeepthinkDepth(value),
        onIsolateBranchesToggle: value => controller.setIsolateBranchesEnabled(value),
        onSolutionPoolDisabledToggle: value => controller.setSolutionPoolDisabled(value),
        onCodeExecutionToggle: value => controller.setCodeExecutionEnabled(value),
    };
}

let configPanelRoot: Root | null = null;
let configPanelContainerNode: HTMLElement | null = null;
let unsubscribeControllerEvents: (() => void) | null = null;

function deferUnmount(root: Root): void {
    const unmount = () => root.unmount();
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(unmount);
    } else {
        setTimeout(unmount, 0);
    }
}

function renderPanel(controller: DeepthinkController): void {
    configPanelRoot?.render(<DeepthinkConfigPanelComponent {...deriveProps(controller)} />);
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

function subscribeToController(controller: DeepthinkController): void {
    unsubscribeControllerEvents?.();
    const render = () => renderPanel(controller);
    const unsubscribe = () => {
        controller.removeEventListener('configchange', render);
        window.removeEventListener('selectedModelChanged', render);
        if (unsubscribeControllerEvents === unsubscribe) unsubscribeControllerEvents = null;
    };
    controller.addEventListener('configchange', render);
    window.addEventListener('selectedModelChanged', render);
    unsubscribeControllerEvents = unsubscribe;
}

export function renderDeepthinkConfigPanelInContainer(pipelinesContentContainer: HTMLElement): void {
    if (!pipelinesContentContainer) return;
    const controller = getDeepthinkConfigController();
    hideMainHeader();
    disableSidebarCollapseButton('Sidebar collapse disabled in config view');
    ensureRoot(pipelinesContentContainer);
    renderPanel(controller);
    subscribeToController(controller);
}
