import React, { useState, useEffect } from 'react';
import { globalState } from '../../../Core/State';
import { ApplicationMode } from '../../../Core/Types';
import { updateUIAfterModeChange } from '../../../Core/AppRouter';

const MODE_DETAILS: Record<ApplicationMode, {
    title: string;
    buttonLabel: string;
    tags: string[];
    description: string;
}> = {
    'deepthink': {
        title: 'Deepthink',
        buttonLabel: 'Deepthink',
        tags: ['Highest Quality', 'Highest Compute', 'Breadth-First-Search', 'Depth-First-Search'],
        description: 'Parallel strategies and hypothesis execution with Evolving Depth First Search, branch-local solution pools, memory banks, and PQF strategy evolution.'
    },
    'adaptive-deepthink': {
        title: 'Adaptive Deepthink',
        buttonLabel: 'Adaptive Deepthink',
        tags: ['High Quality', 'Medium Compute', 'Orchestrator-Guided-Search'],
        description: 'Deepthink mode given to an agent. Uses quality filtering to evolve strategies. Does not support Evolving DFS or solution pools.'
    },
    'contextual': {
        title: 'Contextual (Solution Pool + Memory)',
        buttonLabel: 'Iterative Corrections',
        tags: ['Highest Quality (might be biased sometimes)', 'Highest Compute Budget', 'Depth-First-Search', 'Memory Bank Support'],
        description: 'Can work autonomously for hours.'
    }
};

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

    const previewMode = currentMode;
    const previewDetails = MODE_DETAILS[previewMode] || MODE_DETAILS['deepthink'];

    // Helper to get tag class based on text
    const getTagClass = (tag: string) => {
        const lower = tag.toLowerCase();
        if (lower.includes('highest quality')) return 'tag-quality-highest';
        if (lower.includes('high quality')) return 'tag-quality-high';
        if (lower.includes('medium quality')) return 'tag-quality-medium';
        if (lower.includes('low quality')) return 'tag-quality-low';

        if (lower.includes('highest compute') || lower.includes('highest compute budget')) return 'tag-compute-highest';
        if (lower.includes('medium compute')) return 'tag-compute-medium';
        if (lower.includes('low compute')) return 'tag-compute-low';

        if (lower.includes('search')) return 'tag-search';
        if (lower.includes('memory bank')) return 'tag-feature-memory';
        if (lower.includes('no critique')) return 'tag-feature-nocritique';

        return 'tag-default';
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

                {/* Unified Premium Detail Card */}
                <div className="mode-details-card">
                    <div className="mode-details-header">
                        <div className="mode-details-title">{previewDetails.title}</div>
                    </div>
                    <div className="mode-details-tags">
                        {previewDetails.tags.map((tag) => (
                            <span key={tag} className={`mode-detail-tag ${getTagClass(tag)}`}>
                                {tag}
                            </span>
                        ))}
                    </div>
                    <div className="mode-details-description">
                        {previewDetails.description}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AppModeSelector;
