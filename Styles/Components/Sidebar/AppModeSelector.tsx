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
                <div className="app-mode-section-label">Deepthink Mode Options</div>
                <div className="radio-group-full-width-row" style={{ flexDirection: 'column', gap: '8px' }}>
                    <label className={`mode-selector-card ${currentMode === 'deepthink' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="deepthink" checked={currentMode === 'deepthink'} onChange={handleChange} />
                        <div className="mode-card-header">
                            <span className="mode-card-title">Deepthink</span>
                            <div className="mode-card-badges">
                                <span className="mode-badge mode-badge-quality-high">High Quality</span>
                                <span className="mode-badge mode-badge-compute-high">High Compute</span>
                            </div>
                        </div>
                        <div className="mode-card-description">
                            Best for complex planning, math, and logic puzzles.
                        </div>
                    </label>
                    <label className={`mode-selector-card ${currentMode === 'adaptive-deepthink' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="adaptive-deepthink" checked={currentMode === 'adaptive-deepthink'} onChange={handleChange} />
                        <div className="mode-card-header">
                            <span className="mode-card-title">Adaptive Deepthink</span>
                            <div className="mode-card-badges">
                                <span className="mode-badge mode-badge-quality-high">High Quality</span>
                                <span className="mode-badge mode-badge-compute-high">Med-High Compute</span>
                            </div>
                        </div>
                        <div className="mode-card-description">
                            Conversational agent utilizing reasoning tools dynamically.
                        </div>
                    </label>
                    <label className={`mode-selector-card ${currentMode === 'dynamic-compute' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="dynamic-compute" checked={currentMode === 'dynamic-compute'} onChange={handleChange} />
                        <div className="mode-card-header">
                            <span className="mode-card-title">Dynamic Compute Allocation</span>
                            <div className="mode-card-badges">
                                <span className="mode-badge mode-badge-quality-highest">Highest Quality</span>
                                <span className="mode-badge mode-badge-compute-max">Max / Dynamic</span>
                            </div>
                        </div>
                        <div className="mode-card-description">
                            Scales reasoning budget dynamically for maximum quality. Ideal when compute is not a constraint.
                        </div>
                    </label>
                </div>

                {/* Iterative Refinements Section */}
                <div className="app-mode-section-label">Iterative Refinement Options</div>
                <div className="radio-group-full-width-row" style={{ flexDirection: 'column', gap: '8px' }}>
                    <label className={`mode-selector-card ${currentMode === 'website' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="website" checked={currentMode === 'website'} onChange={handleChange} />
                        <div className="mode-card-header">
                            <span className="mode-card-title">Refine</span>
                            <div className="mode-card-badges">
                                <span className="mode-badge mode-badge-quality-standard">Standard Quality</span>
                                <span className="mode-badge mode-badge-compute-low">Low Compute</span>
                            </div>
                        </div>
                        <div className="mode-card-description">
                            Fast template generation and basic error fixing.
                        </div>
                    </label>
                    <label className={`mode-selector-card ${currentMode === 'agentic' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="agentic" checked={currentMode === 'agentic'} onChange={handleChange} />
                        <div className="mode-card-header">
                            <span className="mode-card-title">Agentic Refinements</span>
                            <div className="mode-card-badges">
                                <span className="mode-badge mode-badge-quality-high">High Quality</span>
                                <span className="mode-badge mode-badge-compute-medium">Medium Compute</span>
                            </div>
                        </div>
                        <div className="mode-card-description">
                            Multi-step coding and writing tasks with tool integration.
                        </div>
                    </label>
                    <label className={`mode-selector-card ${currentMode === 'contextual' ? 'active' : ''}`}>
                        <input type="radio" name="app-mode" value="contextual" checked={currentMode === 'contextual'} onChange={handleChange} />
                        <div className="mode-card-header">
                            <span className="mode-card-title">Iterative Corrections (Solution Pool + Memory)</span>
                            <div className="mode-card-badges">
                                <span className="mode-badge mode-badge-quality-highest">Highest Quality</span>
                                <span className="mode-badge mode-badge-compute-high">High Compute</span>
                            </div>
                        </div>
                        <div className="mode-card-description">
                            Sustained collaborative refinement for difficult problems. Uses long term memory (stable up to 2 hours).
                        </div>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default AppModeSelector;
