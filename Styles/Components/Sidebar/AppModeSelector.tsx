import React, { useState, useEffect } from 'react';
import { globalState } from '../../../Core/State';
import { ApplicationMode } from '../../../Core/Types';
import { updateUIAfterModeChange } from '../../../Core/AppRouter';

const MODE_DETAILS: Record<ApplicationMode, {
    buttonLabel: string;
}> = {
    'deepthink': {
        buttonLabel: 'Deepthink',
    },
    'adaptive-deepthink': {
        buttonLabel: 'Adaptive Deepthink',
    },
    'contextual': {
        buttonLabel: 'Iterative Corrections',
    }
};

const AppModeSelector: React.FC = () => {
    const [currentMode, setCurrentMode] = useState<ApplicationMode>(globalState.currentMode as ApplicationMode);

    useEffect(() => {
        const handleModeChange = () => {
            setCurrentMode(globalState.currentMode as ApplicationMode);
        };
        window.addEventListener('appModeChanged', handleModeChange);
        return () => window.removeEventListener('appModeChanged', handleModeChange);
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMode = e.target.value as ApplicationMode;
        globalState.currentMode = newMode;
        updateUIAfterModeChange();
    };


    const renderGridItem = (mode: ApplicationMode) => {
        const details = MODE_DETAILS[mode];
        const isActive = currentMode === mode;
        return (
            <label
                key={mode}
                className={`mode-grid-button ${isActive ? 'active' : ''}`}
            >
                <input
                    type="radio"
                    name="app-mode"
                    value={mode}
                    checked={isActive}
                    onChange={handleChange}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                />
                <span className="mode-button-text">{details.buttonLabel}</span>
            </label>
        );
    };

    return (
        <div className="input-group">
            <div id="app-mode-selector" className="mode-selector-container" role="radiogroup" aria-label="Select Application Mode">
                <div className="mode-section">
                    <div className="app-mode-section-label">Application Mode</div>
                    <div className="mode-grid">
                        {(['deepthink', 'adaptive-deepthink', 'contextual'] as ApplicationMode[]).map(renderGridItem)}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AppModeSelector;
