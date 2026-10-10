import React, { useEffect, useState } from 'react';
import { ApplicationMode } from '../../../Core/Types';
import { App } from '../../../Core/App';
import { Icon } from '../../../UI/Icons';
import { getActiveDeepthinkPipeline } from '../../../Deepthink/core/deepthinkCore';
import { updateControlsState } from '../../../UI/Controls';

interface SidebarFooterProps {
    currentMode: ApplicationMode;
}

const getPipelineStatus = (): string | null => {
    const pipeline = getActiveDeepthinkPipeline();
    return pipeline ? pipeline.status : null;
};

export const SidebarFooter: React.FC<SidebarFooterProps> = ({ currentMode }) => {
    const [pipelineStatus, setPipelineStatus] = useState<string | null>(getPipelineStatus);

    useEffect(() => {
        const handlePipelineUpdate = () => {
            setPipelineStatus(getPipelineStatus());
        };

        window.addEventListener('deepthinkPipelineUpdated', handlePipelineUpdate);
        window.addEventListener('deepthinkPipelineStateChanged', handlePipelineUpdate);
        window.addEventListener('controlsStateUpdated', handlePipelineUpdate);
        return () => {
            window.removeEventListener('deepthinkPipelineUpdated', handlePipelineUpdate);
            window.removeEventListener('deepthinkPipelineStateChanged', handlePipelineUpdate);
            window.removeEventListener('controlsStateUpdated', handlePipelineUpdate);
        };
    }, []);

    const isDeepthinkRunning = currentMode === 'deepthink' && (pipelineStatus === 'processing' || pipelineStatus === 'stopping');

    const handleStopClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const pipeline = getActiveDeepthinkPipeline();
        if (pipeline) {
            pipeline.isStopRequested = true;
            pipeline.status = 'stopped';
        }
        setPipelineStatus('stopped');
        updateControlsState();
        window.dispatchEvent(new CustomEvent('deepthinkPipelineUpdated'));
        window.dispatchEvent(new CustomEvent('deepthinkPipelineStateChanged'));
    };

    const handleGenerateClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const initialIdeaInput = document.getElementById('initial-idea') as HTMLTextAreaElement;
        const initialIdea = initialIdeaInput?.value?.trim() || '';
        App.handleGenerate(initialIdea);
    };

    const getButtonText = () => {
        switch (currentMode) {
            case 'deepthink': return 'Start Deepthink';
            case 'contextual': return 'Start Contextual Refinement';
            case 'adaptive-deepthink': return 'Adaptive Deepthink';
            default: return 'Start Deepthink';
        }
    };

    return (
        <footer className="sidebar-footer">
            {isDeepthinkRunning ? (
                <button
                    id="stop-button"
                    className="sidebar-stop-button"
                    type="button"
                    onClick={handleStopClick}
                    title="Stop Deepthink"
                >
                    <Icon name="stop_circle" />
                    <span>Stop</span>
                </button>
            ) : (
                <button
                    id="generate-button"
                    className="button primary-action"
                    type="button"
                    onClick={handleGenerateClick}
                >
                    <span className="button-text" id="generate-button-text">{getButtonText()}</span>
                </button>
            )}
        </footer>
    );
};

export default SidebarFooter;
