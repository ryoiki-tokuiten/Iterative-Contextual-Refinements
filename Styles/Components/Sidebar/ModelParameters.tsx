import React, { useState, useEffect } from 'react';
import { globalState } from '../../../Core/State';
import { ApplicationMode } from '../../../Core/Types';
import { Icon } from '../../../UI/Icons';
import { setSandboxToolExecutionEnabled } from '../../../UI/setupCodeExecutionToggle';

const ModelParameters: React.FC = () => {
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
                    <div id="contextual-mode-controls" style={{ display: (currentMode === 'contextual' || currentMode === 'adaptive-deepthink') ? '' : 'none' }}>
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
