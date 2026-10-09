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
import { getDeepthinkConfigController } from '../../Routing';
import {
    buildDeepthinkTokenTrend,
    calculateDeepthinkTokenEstimate,
    type DeepthinkTokenEstimate,
} from '../../Routing/DeepthinkTokenEstimator';
import {
    MAX_HYPOTHESIS_COUNT,
    MAX_STRATEGY_PROXIMITY_LOOPS,
    MAX_HYPOTHESIS_PROXIMITY_LOOPS,
} from '../../Routing/ModelConfig';
import { Icon } from '../../UI/Icons';
import { disableSidebarCollapseButton } from '../../UI/LayoutController';
import '../styles/DeepthinkConfigPanel.css';

type DeepthinkController = ReturnType<typeof getDeepthinkConfigController>;
type TokenGraphFocus = 'total' | 'input' | 'output';

interface DeepthinkConfigPanelProps {
    strategiesCount: number;
    strategyProximityLoops: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    hypothesisEnabled: boolean;
    i: number;
    j: number;
    k: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    codeExecutionEnabled: boolean;
    onStrategiesChange: (count: number) => void;
    onStrategyProximityLoopsChange: (count: number) => void;
    onHypothesisChange: (count: number) => void;
    onHypothesisProximityLoopsChange: (count: number) => void;
    onHypothesisToggle: (enabled: boolean) => void;
    onIChange: (i: number) => void;
    onJChange: (j: number) => void;
    onKChange: (k: number) => void;
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

const PACKET_LINE_WIDTHS = [
    [90, 65, 80],
    [85, 75, 90],
    [75, 85, 70],
] as const;

const PACKET_LINE_OPACITY = [0.8, 0.55, 0.3] as const;

// 3 Branch packets at x = 100, 300, 500; 4 Execution Agents at x = 75, 225, 375, 525 (viewBox 0 0 600 90)
const BRANCH_EDGE_MAP = [
    // Branch 1 (x=100) routes to Execution-1 (75) and Execution-2 (225)
    { sourceIndex: 0, targetIndex: 0, opacity: 0.85 },
    { sourceIndex: 0, targetIndex: 1, opacity: 0.7 },
    // Branch 2 (x=300) routes to Execution-2 (225) and Execution-3 (375)
    { sourceIndex: 1, targetIndex: 1, opacity: 0.85 },
    { sourceIndex: 1, targetIndex: 2, opacity: 0.85 },
    // Branch 3 (x=500) routes to Execution-3 (375) and Execution-4 (525)
    { sourceIndex: 2, targetIndex: 2, opacity: 0.7 },
    { sourceIndex: 2, targetIndex: 3, opacity: 0.85 },
] as const;

const TOKEN_SERIES = [
    { key: 'input-worst', label: 'Input worst', category: 'input', valueOf: (point: DeepthinkTokenEstimate) => point.input.worst },
    { key: 'input-average', label: 'Input avg', category: 'input', valueOf: (point: DeepthinkTokenEstimate) => point.input.average },
    { key: 'output-worst', label: 'Output worst', category: 'output', valueOf: (point: DeepthinkTokenEstimate) => point.output.worst },
    { key: 'output-average', label: 'Output avg', category: 'output', valueOf: (point: DeepthinkTokenEstimate) => point.output.average },
] as const;

const TOKEN_CHART = {
    width: 660,
    height: 240,
    padding: { top: 20, right: 18, bottom: 40, left: 60 },
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
        <div className={classNames('section-header', headerClass)}>
            <div className="section-title-wrapper">
                <Icon name={icon} />
                <span className="section-title">{title}</span>
            </div>
        </div>
        <div className="section-body">
            {children}
        </div>
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
                <div className="slider-pair-row proximity-pair">
                    <div className="input-group-tight">
                        <label htmlFor="dt-strategies-slider" className="input-label">
                            Strategies: <span id="dt-strategies-value">{strategiesCount}</span>
                        </label>
                        <SliderWithFill
                            id="dt-strategies-slider"
                            value={strategiesCount}
                            min={1}
                            max={5}
                            color="var(--dt-red)"
                            onChange={onStrategiesChange}
                        />
                    </div>
                    <div className="input-group-tight">
                        <label htmlFor="dt-strategy-proximity-slider" className="input-label">
                            Proximity loops: <span id="dt-strategy-proximity-value">{strategyProximityLoops}</span>
                        </label>
                        <SliderWithFill
                            id="dt-strategy-proximity-slider"
                            value={strategyProximityLoops}
                            min={1}
                            max={MAX_STRATEGY_PROXIMITY_LOOPS}
                            color="var(--dt-red)"
                            onChange={onStrategyProximityLoopsChange}
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const LoopScheduleSection: React.FC<{
    i: number;
    j: number;
    k: number;
    curatedContextEnabled: boolean;
    onIChange: (i: number) => void;
    onJChange: (j: number) => void;
}> = ({ i, j, k, curatedContextEnabled, onIChange, onJChange }) => {
    const errorI = i < 5 || i > 20 ? 'Total iterations (i) must be between 5 and 20.' : null;
    const errorJ = j < 3 || j > 8 ? 'Global update interval (j) must be between 3 and 8.' : null;

    // Calculate update points (multiples of j strictly less than i)
    const updatePoints: number[] = [];
    for (let it = j; it < i; it += j) {
        updatePoints.push(it);
    }

    // Calculate curated context heartbeat points (every k iterations between global updates)
    // Spec rule: "A due heartbeat is skipped when it would feed fewer than 2 iterations before the next global update."
    const heartbeatPoints: number[] = [];
    if (curatedContextEnabled && k >= 2) {
        for (let it = 1; it < i; it++) {
            if (updatePoints.includes(it)) continue; // global update takes precedence
            const nextBarrier = updatePoints.find(p => p > it) ?? i;
            const prevBarrier = [...updatePoints].reverse().find(p => p < it) ?? 0;
            const cycleOffset = it - prevBarrier;
            if (cycleOffset > 0 && cycleOffset % k === 0) {
                const remainingBeforeBarrier = nextBarrier - it;
                if (remainingBeforeBarrier >= 2) {
                    heartbeatPoints.push(it);
                }
            }
        }
    }

    return (
        <SectionFrame
            containerClass="evolution-filter-options-container"
            headerClass="evolution-filter-options-header"
            icon="event_repeat"
            title="Loop Schedule & Global Updates"
        >
            <div className="loop-schedule-vis" style={{ marginTop: '2px', marginBottom: '6px' }}>
                <div className="loop-timeline-overview">
                    <div className="loop-timeline-bar">
                        {Array.from({ length: Math.min(20, Math.max(5, i)) }, (_, idx) => {
                            const itNum = idx + 1;
                            const isUpdate = updatePoints.includes(itNum);
                            const isFinal = itNum === i;
                            const isHeartbeat = heartbeatPoints.includes(itNum);
                            const hasHeartbeatAtUpdate = isUpdate && curatedContextEnabled;
                            return (
                                <div
                                    key={itNum}
                                    className={classNames(
                                        'timeline-step',
                                        isUpdate && 'update-step',
                                        hasHeartbeatAtUpdate && 'with-heartbeat',
                                        isFinal && 'final-step',
                                        isHeartbeat && 'heartbeat-step',
                                    )}
                                    title={`Iteration ${itNum}${
                                        isUpdate ? `: Global Update + BSR${hasHeartbeatAtUpdate ? ' (Curated Heartbeat synchronized)' : ''}` :
                                        isFinal ? ': Final Evaluation' :
                                        isHeartbeat ? `: Curated Context Heartbeat (k=${k})` : ''
                                    }`}
                                >
                                    <span className="step-num">{itNum}</span>
                                    <div className="step-dots-row">
                                        {isUpdate && <span className="step-dot" />}
                                        {(isHeartbeat || hasHeartbeatAtUpdate) && (
                                             <span className="step-dot heartbeat-dot-indicator" />
                                        )}
                                        {isFinal && <span className="step-final-dot" />}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="timeline-legend">
                        <span className="legend-item">
                            <span className="legend-dot update-dot" />
                            Global Update
                        </span>
                        {curatedContextEnabled && (
                            <span className="legend-item">
                                <span className="legend-dot heartbeat-dot" />
                                Curated Context Heartbeat
                            </span>
                        )}
                        <span className="legend-item">
                            <span className="legend-dot final-dot" />
                            Final Evaluation
                        </span>
                    </div>
                </div>
            </div>

            <div className="loop-controls-inputs">
                <div className="slider-pair-row">
                    <div className="input-group-tight">
                        <label htmlFor="dt-i-slider" className="input-label">
                            Total Iterations (i): <span id="dt-i-value">{i}</span>
                        </label>
                        <SliderWithFill
                            id="dt-i-slider"
                            value={i}
                            min={5}
                            max={20}
                            color="var(--accent-pink)"
                            onChange={onIChange}
                        />
                        {errorI && <div className="config-error-text">{errorI}</div>}
                    </div>

                    <div className="input-group-tight">
                        <label htmlFor="dt-j-slider" className="input-label">
                            Global Update Interval (j): <span id="dt-j-value">{j}</span>
                        </label>
                        <SliderWithFill
                            id="dt-j-slider"
                            value={j}
                            min={3}
                            max={8}
                            color="var(--accent-pink)"
                            onChange={onJChange}
                        />
                        {errorJ && <div className="config-error-text">{errorJ}</div>}
                    </div>
                </div>
            </div>
        </SectionFrame>
    );
};

const StrategyCards: React.FC<{ count: number }> = ({ count }) => (
    <div className="vis-strategies-row">
        {range(count, index => (
            <div key={index} className="vis-strategy-card-mini">Strategy {index + 1}</div>
        ))}
    </div>
);

const DescendingArrows: React.FC<{ count: number; width: number }> = ({ count, width }) => (
    <SvgArrowDiagram
        viewBox={'0 0 ' + String(width) + ' 28'}
        className="vis-descending-arrows"
        preserveAspectRatio="none"
        paths={evenlySpacedCenters(count, width).map(x => ({
            d: 'M' + String(x) + ' 2 V22',
            color: 'var(--accent-purple)',
            strokeWidth: 1.6,
            opacity: 0.85,
            markerSize: 6,
            arrow: true,
        }))}
    />
);

const BranchPacketPreview: React.FC = () => (
    <div className="hypothesis-routing-preview branch-routing">
        <StrategyCards count={3} />
        <DescendingArrows count={3} width={600} />
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
    // 3 branch packet centers at x = 100, 300, 500
    const packetCenters = [100, 300, 500];
    // 4 execution agent centers at x = 75, 225, 375, 525
    const agentCenters = [75, 225, 375, 525];

    const connectionPaths: SvgArrowPath[] = BRANCH_EDGE_MAP.map(edge => ({
        d: 'M' + String(packetCenters[edge.sourceIndex]) + ' 6 L' + String(agentCenters[edge.targetIndex]) + ' 88',
        color: 'var(--accent-blue)',
        opacity: edge.opacity,
        strokeWidth: 1.5,
        arrow: false,
    }));

    return (
        <div className="execution-agents-visualization" id="dt-execution-agents-visualization">
            <div className="connection-nodes">
                <SvgArrowDiagram
                    viewBox="0 0 600 90"
                    className="connection-svg"
                    preserveAspectRatio="none"
                    paths={connectionPaths}
                >
                    {packetCenters.map(x => (
                        <circle key={'p-' + x} cx={x} cy="6" r="4" fill="var(--accent-blue)" />
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

const SolutionPoolVisualization: React.FC = () => {
    return (
        <div className="solution-pool-visualization" id="dt-solution-pool-visualization">
            <div className="vis-pool-sources">
                <div className="vis-pool-source-branch">
                    <span className="source-label">Branch 1</span>
                    <span className="source-arrow">↓</span>
                </div>
                <div className="vis-pool-source-branch">
                    <span className="source-label">Branch 2</span>
                    <span className="source-arrow">↓</span>
                </div>
                <div className="vis-pool-source-branch">
                    <span className="source-label">Branch 3</span>
                    <span className="source-arrow">↓</span>
                </div>
            </div>

            <div className="vis-pool-central-box">
                <div className="vis-pool-header">
                    <div className="vis-pool-title-group">
                        <Icon name="database" size="14" />
                        <span>STRUCTURED SOLUTION POOL</span>
                    </div>
                    <span className="vis-pool-badge">k-step buffer</span>
                </div>
                <div className="vis-pool-clusters">
                    <div className="vis-pool-cluster cluster-primary">
                        <div className="cluster-tag">Pool α</div>
                        <div className="cluster-desc">Consensus Cluster</div>
                    </div>
                    <div className="vis-pool-cluster cluster-secondary">
                        <div className="cluster-tag">Pool β</div>
                        <div className="cluster-desc">Divergent Candidate</div>
                    </div>
                    <div className="vis-pool-cluster cluster-tertiary">
                        <div className="cluster-tag">Pool γ</div>
                        <div className="cluster-desc">High-Yield Refinement</div>
                    </div>
                </div>
            </div>

            <div className="vis-pool-dispatch">
                <SvgArrowDiagram
                    viewBox="0 0 600 28"
                    className="pool-dispatch-svg"
                    preserveAspectRatio="none"
                    paths={[
                        { d: 'M150 2 L100 24', color: 'var(--accent-yellow)', strokeWidth: 1.5, opacity: 0.85, arrow: true },
                        { d: 'M300 2 L300 24', color: 'var(--accent-yellow)', strokeWidth: 1.5, opacity: 0.85, arrow: true },
                        { d: 'M450 2 L500 24', color: 'var(--accent-yellow)', strokeWidth: 1.5, opacity: 0.85, arrow: true },
                    ]}
                />
                <div className="vis-pool-consumers">
                    <div className="consumer-pill">Branch-1 Ingest</div>
                    <div className="consumer-pill">Branch-2 Ingest</div>
                    <div className="consumer-pill">Branch-3 Ingest</div>
                </div>
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

const CuratedContextSection: React.FC<{
    hypothesisEnabled: boolean;
    solutionPoolEnabled: boolean;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    k: number;
    j: number;
    onHypothesisToggle: (enabled: boolean) => void;
    onSolutionPoolToggle: (disabled: boolean) => void;
    onHypothesisChange: (count: number) => void;
    onHypothesisProximityLoopsChange: (count: number) => void;
    onKChange: (k: number) => void;
}> = ({
    hypothesisEnabled,
    solutionPoolEnabled,
    hypothesisCount,
    hypothesisProximityLoops,
    k,
    j,
    onHypothesisToggle,
    onSolutionPoolToggle,
    onHypothesisChange,
    onHypothesisProximityLoopsChange,
    onKChange,
}) => {
    const isCuratedContextEnabled = hypothesisEnabled || solutionPoolEnabled;
    const maxK = Math.max(2, Math.min(8, j));
    const effectiveK = Math.min(k, maxK);
    const errorK = isCuratedContextEnabled && (k < 2 || k > j)
        ? `Heartbeat interval (k) must be between 2 and j (${j}).`
        : null;

    const toggleHypotheses = (enabled: boolean) => {
        onHypothesisToggle(enabled);
        if (!enabled) onHypothesisChange(0);
    };

    return (
        <div className="information-packet-window" id="dt-information-packet-window">
            <div className="window-header">
                <div className="window-left">
                    <Icon name="refresh" />
                    <div className="window-title">Customize How Often Curated Context Is Refreshed</div>
                </div>
            </div>

            <div className="window-content" id="dt-information-packet-content">
                {/* 1. Heartbeat Interval (k) slider at the VERY TOP (only when curated context is enabled) */}
                {isCuratedContextEnabled && (
                    <div className="k-interval-control">
                        <div className="input-group-tight">
                            <label htmlFor="dt-k-slider" className="input-label">
                                Heartbeat Interval (k): <span id="dt-k-value">{effectiveK}</span> iterations
                            </label>
                            <SliderWithFill
                                id="dt-k-slider"
                                value={effectiveK}
                                min={2}
                                max={maxK}
                                color="var(--accent-blue)"
                                onChange={onKChange}
                            />
                            {errorK && <div className="config-error-text">{errorK}</div>}
                        </div>
                    </div>
                )}

                {/* 2. Hypothesis Generation sub-section (Toggle + in-sync Visual + in-sync Sliders) */}
                <div className={classNames('curated-subfeature-card', !hypothesisEnabled && 'collapsed')}>
                    <div className="curated-subfeature-header">
                        <label htmlFor="dt-hypothesis-toggle" className="curated-toggle-label">
                            Hypothesis Generation & Independent Testing
                        </label>
                        <ToggleSwitch
                            id="dt-hypothesis-toggle"
                            checked={hypothesisEnabled}
                            onChange={toggleHypotheses}
                        />
                    </div>

                    {hypothesisEnabled && (
                        <div className="curated-subfeature-body">
                            <div className="hypothesis-visual-stack" aria-hidden="true">
                                <BranchPacketPreview />
                                <ExecutionAgentsVisualization />
                            </div>

                            <div className="hypothesis-controls">
                                <div className="slider-pair-row proximity-pair">
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
                                            onChange={onHypothesisChange}
                                        />
                                    </div>
                                    <div className="input-group-tight">
                                        <label htmlFor="dt-hypothesis-proximity-slider" className="input-label">
                                            Proximity loops: <span id="dt-hypothesis-proximity-value">{hypothesisProximityLoops}</span>
                                        </label>
                                        <SliderWithFill
                                            id="dt-hypothesis-proximity-slider"
                                            value={hypothesisProximityLoops}
                                            min={1}
                                            max={MAX_HYPOTHESIS_PROXIMITY_LOOPS}
                                            color="var(--accent-blue)"
                                            onChange={onHypothesisProximityLoopsChange}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 3. Structured Structured Noises sub-section (Toggle + in-sync Visual) */}
                <div className={classNames('curated-subfeature-card solution-pool-card', !solutionPoolEnabled && 'collapsed')}>
                    <div className="curated-subfeature-header">
                        <label htmlFor="dt-solution-pool-toggle" className="curated-toggle-label">
                            Structured Structured Noises
                        </label>
                        <ToggleSwitch
                            id="dt-solution-pool-toggle"
                            checked={solutionPoolEnabled}
                            onChange={enabled => onSolutionPoolToggle(!enabled)}
                        />
                    </div>

                    {solutionPoolEnabled && (
                        <div className="curated-subfeature-body">
                            <SolutionPoolVisualization />
                        </div>
                    )}
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
    i: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
}> = ({ strategiesCount, hypothesisCount, i, isolateBranches, disableSolutionPool }) => {
    const [focus, setFocus] = React.useState<TokenGraphFocus>('total');
    const [hoverDepth, setHoverDepth] = React.useState<number | null>(null);
    const safeDepth = Math.max(1, Math.round(i || 1));
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

    const [chartSize, setChartSize] = React.useState<{ width: number; height: number }>({ width: TOKEN_CHART.width, height: TOKEN_CHART.height });
    const shellRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!shellRef.current) return;
        const observer = new ResizeObserver(entries => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                if (width > 0 && height > 0) {
                    setChartSize({ width, height });
                }
            }
        });
        observer.observe(shellRef.current);
        return () => observer.disconnect();
    }, []);

    const { width, height } = chartSize;
    const padding = TOKEN_CHART.padding;
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
                    <div className="token-chart-shell" ref={shellRef}>
                        <svg
                            className="token-chart-svg"
                            viewBox={'0 0 ' + String(width) + ' ' + String(height)}
                            role="img"
                            aria-label={'Estimated token volume through iteration ' + String(selectedDepth)}
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
                            <text className="token-axis-caption" x={padding.left + plotWidth / 2} y={height - 2} textAnchor="middle">Iterations (i)</text>
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
                                    <text className="token-hover-title" x={tooltipX + 10} y={tooltipY + 18}>Iteration {hovered.depth}</text>
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
    i: number;
    j: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    onIsolateBranchesToggle: (enabled: boolean) => void;
}> = ({
    strategiesCount,
    hypothesisCount,
    i,
    j,
    isolateBranches,
    disableSolutionPool,
    onIsolateBranchesToggle,
}) => (
    <div className="deepthink-method-card">
        <div className="deepthink-card-vis deepthink-process-vis">
            <div className={classNames('vis-pool-node', disableSolutionPool && 'disabled')} title={disableSolutionPool ? 'Structured Structured Noise disabled' : 'Structured Structured Noise'}>
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
            <div className="vis-memory-connector" title={`Memory is distilled at each global update (every ${j} completed branch iterations)`}>
                <span className="vis-memory-interval">{j} iter</span>
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
            <div className="deepthink-behavior-controls">
                <div className="isolate-branches-option">
                    <label htmlFor="dt-isolate-branches-toggle" className="deepthink-behavior-label">Isolate Branches</label>
                    <ToggleSwitch id="dt-isolate-branches-toggle" checked={isolateBranches} onChange={onIsolateBranchesToggle} />
                </div>
            </div>
            <TokenVolumeGraph
                strategiesCount={strategiesCount}
                hypothesisCount={hypothesisCount}
                i={i}
                isolateBranches={isolateBranches}
                disableSolutionPool={disableSolutionPool}
            />
        </div>
    </div>
);

const DeepthinkConfigPanelComponent: React.FC<DeepthinkConfigPanelProps> = props => (
    <div className="deepthink-config-panel">
        <div className="deepthink-config-scroll-container">
            <div className="config-top-row">
                <LoopScheduleSection
                    i={props.i}
                    j={props.j}
                    k={props.k}
                    curatedContextEnabled={props.hypothesisEnabled || !props.disableSolutionPool}
                    onIChange={props.onIChange}
                    onJChange={props.onJChange}
                />
                <SandboxEnvironmentPanel enabled={props.codeExecutionEnabled} onToggle={props.onCodeExecutionToggle} />
            </div>
            <div className="config-bottom-grid">
                <div className="config-left-col">
                    <StrategyExecutionSection
                        strategiesCount={props.strategiesCount}
                        strategyProximityLoops={props.strategyProximityLoops}
                        onStrategiesChange={props.onStrategiesChange}
                        onStrategyProximityLoopsChange={props.onStrategyProximityLoopsChange}
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
                                    i={props.i}
                                    j={props.j}
                                    isolateBranches={props.isolateBranches}
                                    disableSolutionPool={props.disableSolutionPool}
                                    onIsolateBranchesToggle={props.onIsolateBranchesToggle}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="config-right-col">
                    <CuratedContextSection
                        hypothesisEnabled={props.hypothesisEnabled}
                        solutionPoolEnabled={!props.disableSolutionPool}
                        hypothesisCount={props.hypothesisCount}
                        hypothesisProximityLoops={props.hypothesisProximityLoops}
                        k={props.k}
                        j={props.j}
                        onHypothesisToggle={props.onHypothesisToggle}
                        onSolutionPoolToggle={props.onSolutionPoolDisabledToggle}
                        onHypothesisChange={props.onHypothesisChange}
                        onHypothesisProximityLoopsChange={props.onHypothesisProximityLoopsChange}
                        onKChange={props.onKChange}
                    />
                </div>
            </div>
        </div>
    </div>
);

function deriveProps(controller: DeepthinkController): DeepthinkConfigPanelProps {
    const state = controller.getState();
    const currentJ = state.j ?? 5;
    return {
        ...state,
        i: state.i ?? 10,
        j: currentJ,
        k: state.k ?? 3,
        onStrategiesChange: value => controller.setStrategiesCount(value),
        onStrategyProximityLoopsChange: value => controller.setStrategyProximityLoops(value),
        onHypothesisChange: value => controller.setHypothesisCount(value),
        onHypothesisProximityLoopsChange: value => controller.setHypothesisProximityLoops(value),
        onHypothesisToggle: value => controller.setHypothesisEnabled(value),
        onIChange: value => {
            const clamped = Math.max(5, Math.min(20, Math.round(value)));
            controller.setI(clamped);
        },
        onJChange: value => {
            const clampedJ = Math.max(3, Math.min(8, Math.round(value)));
            controller.setJ(clampedJ);
            if (controller.getK() > clampedJ) {
                controller.setK(clampedJ);
            }
        },
        onKChange: value => {
            const maxK = Math.max(2, Math.min(8, controller.getJ()));
            const clampedK = Math.max(2, Math.min(maxK, Math.round(value)));
            controller.setK(clampedK);
        },
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
