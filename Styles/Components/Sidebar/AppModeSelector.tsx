import React, { useState, useEffect } from 'react';
import { globalState } from '../../../Core/State';
import { ApplicationMode } from '../../../Core/Types';
import { updateUIAfterModeChange } from '../../../Core/AppRouter';

/**
 * App Mode Selector component
 * Radio group for selecting application mode (Deepthink, Refine, Agentic, etc.)
 */
export const AppModeSelector: React.FC = () => {
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

    return (
        <div className="input-group">
            <div id="app-mode-selector" className="radio-group-modern" role="radiogroup" aria-label="Select Application Mode">
                {/* Deepthink Section */}
                <div className="app-mode-section-label">Deepthink</div>
                <div className="radio-group-full-width-row">
                    <label className={`radio-label-modern radio-label-half-width ${currentMode === 'deepthink' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="deepthink" checked={currentMode === 'deepthink'} onChange={handleChange} />
                        <span>Deepthink</span>
                    </label>
                    <label className={`radio-label-modern radio-label-half-width ${currentMode === 'adaptive-deepthink' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="adaptive-deepthink" checked={currentMode === 'adaptive-deepthink'} onChange={handleChange} />
                        <span>Adaptive Deepthink</span>
                    </label>
                </div>
                <div className="radio-group-full-width-row">
                    <label className={`radio-label-modern radio-label-full-width ${currentMode === 'dynamic-compute' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="dynamic-compute" checked={currentMode === 'dynamic-compute'} onChange={handleChange} />
                        <span>Dynamic Compute Allocation</span>
                    </label>
                </div>

                {/* Iterative Refinements Section */}
                <div className="app-mode-section-label">Iterative Refinements</div>
                <div className="radio-group-full-width-row">
                    <label className={`radio-label-modern radio-label-half-width ${currentMode === 'website' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="website" checked={currentMode === 'website'} onChange={handleChange} />
                        <span>Refine</span>
                    </label>
                    <label className={`radio-label-modern radio-label-half-width ${currentMode === 'agentic' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="agentic" checked={currentMode === 'agentic'} onChange={handleChange} />
                        <span>Agentic Refinements</span>
                    </label>
                </div>
                <div className="radio-group-full-width-row">
                    <label className={`radio-label-modern radio-label-full-width ${currentMode === 'contextual' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="contextual" checked={currentMode === 'contextual'} onChange={handleChange} />
                        <span>Iterative Corrections (Solution Pool + Memory)</span>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default AppModeSelector;
