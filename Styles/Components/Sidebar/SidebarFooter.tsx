import React, { useEffect, useState } from 'react';
import { ApplicationMode } from '../../../Core/Types';
import { App } from '../../../Core/App';
import { getRoutingManager } from '../../../Routing';
import { Icon } from '../../../UI/Icons';

interface SidebarFooterProps {
    currentMode: ApplicationMode;
}

const isDeepthinkSandboxEnabled = (): boolean =>
    getRoutingManager().getDeepthinkConfigController().isCodeExecutionEnabled();

export const SidebarFooter: React.FC<SidebarFooterProps> = ({ currentMode }) => {
    const [sandboxEnabled, setSandboxEnabled] = useState(isDeepthinkSandboxEnabled);

    useEffect(() => {
        const handleSandboxToggle = () => setSandboxEnabled(isDeepthinkSandboxEnabled());

        window.addEventListener('sandboxToggled', handleSandboxToggle);
        return () => window.removeEventListener('sandboxToggled', handleSandboxToggle);
    }, []);

    const handleGenerateClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const initialIdeaInput = document.getElementById('initial-idea') as HTMLTextAreaElement;
        const initialIdea = initialIdeaInput?.value?.trim() || '';
        App.handleGenerate(initialIdea);
    };

    const getButtonText = () => {
        switch (currentMode) {
            case 'deepthink': return 'Deepthink';
            case 'contextual': return 'Start Contextual Refinement';
            case 'adaptive-deepthink': return 'Adaptive Deepthink';
            default: return 'Deepthink';
        }
    };

    return (
        <footer className="sidebar-footer">
            <div className="api-call-indicator" style={{ display: currentMode === 'deepthink' ? 'flex' : 'none' }}>
                <div className="api-call-info">
                    <span className="api-call-count" id="api-call-count">~0</span>
                    <span className="api-call-label">API Calls</span>
                </div>
                <span
                    className="api-call-sandbox-info"
                    id="api-call-sandbox-info"
                    style={{ display: sandboxEnabled ? 'block' : 'none', marginLeft: '4px' }}
                >
                    <Icon name="info" />
                </span>
            </div>
            <button
                id="generate-button"
                className="button primary-action"
                type="button"
                onClick={handleGenerateClick}
            >
                <span className="button-text" id="generate-button-text">{getButtonText()}</span>
            </button>
        </footer>
    );
};

export default SidebarFooter;
