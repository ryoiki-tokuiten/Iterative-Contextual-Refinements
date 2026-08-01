import React from 'react';
import { PromptStylingEditor } from './PromptStyling';

/**
 * Prompt Card Component
 * Reusable component for displaying system and user prompts with model selection.
 * Supports both controlled (value/onChange) and uncontrolled modes.
 */

interface PromptCardProps {
    title: string;
    textareaId?: string;
    rows?: number;
    agentName?: string;
    placeholder?: string;
    value?: string;
    onChange?: (text: string) => void;
    modelValue?: string;
    onModelChange?: (value: string) => void;
    availableModels?: string[];
}

export const PromptCard: React.FC<PromptCardProps> = ({
    title,
    textareaId,
    rows = 8,
    agentName,
    placeholder,
    value,
    onChange,
    modelValue,
    onModelChange,
    availableModels = []
}) => {
    return (
        <div className="prompt-card">
            <div className="prompt-card-header">
                <span className="prompt-card-title">{title}</span>
                <div className="prompt-model-selector">
                    <select
                        className="prompt-model-select"
                        data-agent={agentName}
                        value={onModelChange ? (modelValue || '') : undefined}
                        onChange={onModelChange ? (e) => onModelChange(e.target.value) : undefined}
                    >
                        <option value="">Use Global Model</option>
                        {availableModels.map(model => (
                            <option key={model} value={model}>{model}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="prompt-card-body">
                <PromptStylingEditor
                    id={textareaId}
                    className="prompt-textarea"
                    rows={rows}
                    value={value}
                    placeholder={placeholder}
                    onChange={onChange}
                />
            </div>
        </div>
    );
};

interface PromptPaneProps {
    promptKey: string;
    title: string;
    children: React.ReactNode;
}

export const PromptPane: React.FC<PromptPaneProps> = ({ promptKey, title, children }) => {
    return (
        <div className="prompt-content-pane" data-prompt-key={promptKey}>
            <h4 className="prompt-pane-title">{title}</h4>
            {children}
        </div>
    );
};
