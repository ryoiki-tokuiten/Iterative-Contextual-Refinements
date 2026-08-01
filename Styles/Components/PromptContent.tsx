import React, { useEffect, useState } from 'react';
import { PromptCard, PromptPane } from './PromptCard';

interface PromptContentManager<T extends object> {
    getPrompts(): T;
    subscribe(listener: (state: T) => void): () => void;
    updatePrompt(key: keyof T, value: string): void;
    updateModel?(key: keyof T, value: string): void;
}

export interface PromptPaneConfig<T extends object> {
    key: string;
    title: string;
    promptKey: keyof T;
    modelKey: keyof T;
    rows?: number;
    placeholder?: string;
    textareaId?: string;
    agentName?: string;
    showAvailableModels?: boolean;
}

interface PromptContentProps<T extends object> {
    containerId: string;
    panes: readonly PromptPaneConfig<T>[];
    manager: PromptContentManager<T>;
    availableModels?: string[];
}

function promptValue<T extends object>(prompts: T, key: keyof T): string {
    const value = prompts[key];
    return typeof value === 'string' ? value : '';
}

export function PromptContent<T extends object>({
    containerId,
    panes,
    manager,
    availableModels = []
}: PromptContentProps<T>): React.ReactElement {
    const [prompts, setPrompts] = useState<T>(() => manager.getPrompts());

    useEffect(() => manager.subscribe(setPrompts), [manager]);

    const updatePrompt = (key: keyof T, value: string): void => {
        manager.updatePrompt(key, value);
    };

    const updateModel = (key: keyof T, value: string): void => {
        if (manager.updateModel) {
            manager.updateModel(key, value);
        } else {
            manager.updatePrompt(key, value);
        }
    };

    return (
        <div id={containerId} className="prompts-mode-container">
            {panes.map(pane => (
                <PromptPane key={pane.key} promptKey={pane.key} title={pane.title}>
                    <PromptCard
                        title="System Instruction"
                        textareaId={pane.textareaId}
                        rows={pane.rows}
                        agentName={pane.agentName}
                        value={promptValue(prompts, pane.promptKey)}
                        onChange={value => updatePrompt(pane.promptKey, value)}
                        modelValue={promptValue(prompts, pane.modelKey)}
                        onModelChange={value => updateModel(pane.modelKey, value)}
                        availableModels={pane.showAvailableModels ? availableModels : []}
                        placeholder={pane.placeholder}
                    />
                </PromptPane>
            ))}
        </div>
    );
}
