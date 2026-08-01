import React, { useState, useEffect } from 'react';
import { globalState } from '../../../Core/State';
import { ApplicationMode } from '../../../Core/Types';
import { Icon } from '../../../UI/Icons';
import { setSandboxToolExecutionEnabled } from '../../../UI/setupCodeExecutionToggle';
import { getDeepthinkConfigController } from '../../../Routing';

export const ModelParameters: React.FC = () => {
    const [currentMode, setCurrentMode] = useState<ApplicationMode>(globalState.currentMode as ApplicationMode);
    const configController = getDeepthinkConfigController();
    const [strategyProximityLoops, setStrategyProximityLoops] = useState(() => configController.getStrategyProximityLoops());
    const [hypothesisProximityLoops, setHypothesisProximityLoops] = useState(() => configController.getHypothesisProximityLoops());

    useEffect(() => {
        const handleModeChange = () => {
            setCurrentMode(globalState.currentMode as ApplicationMode);
        };

        window.addEventListener('appModeChanged', handleModeChange);

        return () => {
            window.removeEventListener('appModeChanged', handleModeChange);
        };
    }, []);

    useEffect(() => {
        const handleConfigChange = () => {
            setStrategyProximityLoops(configController.getStrategyProximityLoops());
            setHypothesisProximityLoops(configController.getHypothesisProximityLoops());
        };
        configController.addEventListener('configchange', handleConfigChange);
        return () => configController.removeEventListener('configchange', handleConfigChange);
    }, [configController]);

    const proximityControls = [
        ['strategy', 'Strategy–proximity', strategyProximityLoops, configController.setStrategyProximityLoops.bind(configController), '#e86b6b'],
        ['hypothesis', 'Hypothesis–proximity', hypothesisProximityLoops, configController.setHypothesisProximityLoops.bind(configController), 'var(--accent-blue)'],
    ] as const;

    return (
        <details className="sidebar-section" open>
            <summary className="sidebar-section-header">Model & Parameters</summary>
            <div className="sidebar-section-content">
                <div id="model-selection-container" className="input-group-tight">
                    <select id="model-select" className="input-base" aria-label="Select AI Model">
                    </select>
                </div>

                <div id="thinking-level-container" className="input-group-tight" style={{ display: 'none' }}>
                    <label htmlFor="thinking-level-select" className="input-label">Thinking Level</label>
                    <select id="thinking-level-select" className="input-base" aria-label="Select Gemini Thinking Level">
                        <option value="minimal">Minimal</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>

                <div id="model-parameters-container" className="input-group-tight">
                    <div className="input-group-tight">
                        <label htmlFor="temperature-slider" className="input-label">
                            Temperature: <span id="temperature-value">1.0</span>
                        </label>
                        <input
                            type="range"
                            id="temperature-slider"
                            className="slider"
                            min="0"
                            max="2"
                            step="0.1"
                            defaultValue="1.0"
                            aria-label="Temperature slider"
                        />
                    </div>
                    <div className="input-group-tight">
                        <label htmlFor="top-p-slider" className="input-label">
                            Top P: <span id="top-p-value">0.95</span>
                        </label>
                        <input
                            type="range"
                            id="top-p-slider"
                            className="slider"
                            min="0"
                            max="1"
                            step="0.05"
                            defaultValue="0.95"
                            aria-label="Top P slider"
                        />
                    </div>

                    <div id="contextual-mode-controls" style={{ display: (currentMode === 'contextual' || currentMode === 'adaptive-deepthink') ? '' : 'none' }}>
                        {currentMode === 'adaptive-deepthink' && (
                            <div className="adaptive-proximity-loop-controls">
                                {proximityControls.map(([kind, label, value, update, color]) => (
                                    <div className="input-group-tight" key={kind}>
                                        <label htmlFor={`adaptive-${kind}-proximity-slider`} className="input-label">
                                            {label} loops: <span>{value}</span>
                                        </label>
                                        <input
                                            type="range"
                                            id={`adaptive-${kind}-proximity-slider`}
                                            className={`slider adaptive-proximity-slider adaptive-${kind}-proximity-slider`}
                                            min="1"
                                            max="5"
                                            value={value}
                                            style={{
                                                background: `linear-gradient(to right, ${color} 0%, ${color} ${(value - 1) * 25}%, var(--slider-track-color) ${(value - 1) * 25}%, var(--slider-track-color) 100%)`,
                                            }}
                                            onChange={event => update(Number(event.currentTarget.value))}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="code-execution-container">
                            <div className="code-execution-header">
                                <Icon name="code" />
                                <span className="code-execution-title">Sandbox Terminal Environment</span>
                            </div>
                            <div className="code-execution-toggle-row">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        id="sandbox-code-execution-toggle"
                                        aria-label="Enable Sandbox Terminal Environment"
                                        defaultChecked={globalState.virtualEnvironmentEnabled}
                                        onChange={(event) => setSandboxToolExecutionEnabled(event.target.checked)}
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                                <span className="toggle-label">Enable Sandbox Execution</span>
                            </div>
                            <div className="code-execution-description">
                                Allow agents to use a persistent sandbox terminal for calculations, verification, scripts, plots, and image manipulation.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </details>
    );
};

export default ModelParameters;
