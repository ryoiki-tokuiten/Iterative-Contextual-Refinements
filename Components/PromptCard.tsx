import React from 'react';

/**
 * Prompt Card Component
 * Reusable component for displaying system and user prompts with model selection
 */

interface PromptCardProps {
    title: string;
    textareaId: string;
    rows?: number;
    agentName?: string;
    placeholders?: string;
}

export const PromptCard: React.FC<PromptCardProps> = ({
    title,
    textareaId,
    rows = 8,
    agentName,
    placeholders
}) => {
    const titleId = `${textareaId}-label`;

    return (
        <div className="prompt-card">
            <div className="prompt-card-header">
                <span id={titleId} className="prompt-card-title">{title}</span>
                {agentName && (
                    <div className="prompt-model-selector">
                        <select className="prompt-model-select" data-agent={agentName}>
                            <option value="">Use Global Model</option>
                        </select>
                    </div>
                )}
                {placeholders && (
                    <span className="prompt-placeholders" dangerouslySetInnerHTML={{ __html: placeholders }} />
                )}
            </div>
            <div className="prompt-card-body">
                <textarea
                    id={textareaId}
                    className="prompt-textarea"
                    rows={rows}
                    aria-labelledby={titleId}
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

export default PromptCard;
