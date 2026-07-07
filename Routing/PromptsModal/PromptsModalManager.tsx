import React, { useEffect, useState } from 'react';
import PromptsModalLayout from './PromptsModalLayout';
import DeepthinkPromptsContent from '../../Deepthink/DeepthinkPromptsContent';
import AdaptivePromptsContent from '../../AdaptiveDeepthink/AdaptivePromptsContent';
import ContextualPromptsContent from '../../Contextual/ContextualPromptsContent';
import { getRoutingManager } from '../index';

/**
 * Prompts Modal Manager
 * Orchestrates which mode-specific prompts content to display.
 * All mode-specific content components receive their manager and render via React state.
 */
export const PromptsModalManager: React.FC = () => {
    const [promptsManager, setPromptsManager] = useState(() => getRoutingManager().getPromptsManager());

    // This root is rendered independently from the app root. Its first render
    // can precede AppInitializer's effect, which creates the prompts manager.
    useEffect(() => {
        if (promptsManager) return;
        const retry = window.setInterval(() => {
            const manager = getRoutingManager().getPromptsManager();
            if (manager) setPromptsManager(manager);
        }, 25);
        return () => window.clearInterval(retry);
    }, [promptsManager]);

    if (!promptsManager) return null;

    const modelConfigManager = getRoutingManager().getModelConfigManager();
    const availableModels = modelConfigManager
        ? modelConfigManager.getAvailableModels().map((m: any) => m.value)
        : [];

    return (
        <PromptsModalLayout>
            {/* All mode-specific prompt containers are rendered */}
            {/* The PromptsModal.ts handles showing/hiding based on active mode */}
            <DeepthinkPromptsContent
                promptsManager={promptsManager.getDeepthinkPromptsManager()}
                availableModels={availableModels}
            />
            <AdaptivePromptsContent />
            {promptsManager.getContextualPromptsManager() ? (
                <ContextualPromptsContent manager={promptsManager.getContextualPromptsManager()!} />
            ) : null}
        </PromptsModalLayout>
    );
};

export default PromptsModalManager;
