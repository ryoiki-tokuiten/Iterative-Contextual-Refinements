import React, { useEffect, useState } from 'react';
import { ApplicationMode } from '../../../Core/Types';
import { App } from '../../../Core/App';
import { Icon } from '../../../UI/Icons';
import { getActiveDeepthinkPipeline, stopDeepthinkAnalysisProcess } from '../../../Deepthink/core/deepthinkCore';
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
    const isDeepthinkPaused = currentMode === 'deepthink' && pipelineStatus === 'stopped';

    const handleStopClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        stopDeepthinkAnalysisProcess();
        setPipelineStatus('stopped');
    };

    const handleResumeClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        await App.handleResumeDeepthink();
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
            ) : isDeepthinkPaused ? (
                <button
                    id="resume-button"
                    className="sidebar-resume-button"
                    type="button"
                    onClick={handleResumeClick}
                    title="Resume Deepthink"
                >
                    <Icon name="play_arrow" />
                    <span>Resume</span>
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
