import React, { useState, useEffect } from 'react';
import { globalState } from '../../../Core/State';
import { ApplicationMode } from '../../../Core/Types';
import { Icon } from '../../../UI/Icons';

export const ModelParameters: React.FC = () => {
    const [currentMode, setCurrentMode] = useState<ApplicationMode>(globalState.currentMode as ApplicationMode);

    useEffect(() => {
        const handleModeChange = () => {
            setCurrentMode(globalState.currentMode as ApplicationMode);
        };

        window.addEventListener('appModeChanged', handleModeChange);

        return () => {
            window.removeEventListener('appModeChanged', handleModeChange);
        };
    }, []);
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

                    <div style={{ display: 'none' }}>
                        <span id="strategies-value">3</span>
                        <input type="range" id="strategies-slider" min="1" max="10" step="1" defaultValue="3" />
                        <span id="sub-strategies-value">3</span>
                        <input type="range" id="sub-strategies-slider" min="0" max="10" step="1" defaultValue="3" />
                        <input type="checkbox" id="skip-sub-strategies-toggle" />
                        <input type="checkbox" id="hypothesis-toggle" defaultChecked />
                        <span id="hypothesis-value">4</span>
                        <input type="range" id="hypothesis-slider" min="1" max="6" step="1" defaultValue="4" />
                        <button type="button" className="pqf-button active" data-value="balanced"></button>
                        <button type="button" className="pqf-button" data-value="very_aggressive"></button>
                        <input type="checkbox" id="refinement-toggle" />
                        <input type="checkbox" id="dissected-observations-toggle" />
                        <input type="checkbox" id="iterative-corrections-toggle" />
                        <input type="checkbox" id="provide-all-solutions-toggle" />
                    </div>

                    <div id="contextual-mode-controls" style={{ display: currentMode === 'contextual' ? '' : 'none' }}>
                        <div className="code-execution-container">
                            <div className="code-execution-header">
                                <Icon name="code" />
                                <span className="code-execution-title">Python Tool Environment</span>
                            </div>
                            <div className="code-execution-toggle-row">
                                <label className="toggle-switch">
                                    <input
                                        type="checkbox"
                                        id="gemini-code-execution-toggle"
                                        aria-label="Enable Python Tool Environment"
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                                <span className="toggle-label">Enable Python Code Execution</span>
                            </div>
                            <div className="code-execution-description">
                                Allow contextual agents to use a backend Python virtual filesystem for calculations, verification, plots, and image manipulation.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </details>
    );
};

export default ModelParameters;

export function initializeEvolutionConvergenceButtons(): void {
}
