import React, { useState, useEffect } from 'react';
import { DCAPromptsState } from './DCAPrompts';
import { DCAPromptsManager } from './DCAPromptsManager';
import { PromptStylingEditor } from '../../Styles/Components/PromptStyling';

interface DCAPromptsContentProps {
    manager: DCAPromptsManager;
}

export const DCAPromptsContent: React.FC<DCAPromptsContentProps> = ({ manager }) => {
    const [prompts, setPrompts] = useState<DCAPromptsState>( manager.getPrompts() );

    useEffect(() => {
        setPrompts(manager.getPrompts());
    }, [manager]);

    const handleChange = (key: keyof DCAPromptsState) => (val: string) => {
        const newPrompts = { ...prompts, [key]: val };
        setPrompts(newPrompts);
        manager.setPrompts(newPrompts);
    };

    return (
        <div id="dynamic-compute-prompts-container" className="prompts-mode-container">
            {/* Strategic Solution Pool Generator */}
            <div className="prompt-content-pane" data-prompt-key="dca-solution-generator">
                <h4 className="prompt-pane-title">Strategic Solution Pool Generator Prompt</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Strategic Solution Pool Generator system prompt..."
                            value={prompts.sys_pool_generator}
                            onChange={handleChange('sys_pool_generator')}
                        />
                    </div>
                </div>
            </div>

            {/* Local Solution Pool Agent */}
            <div className="prompt-content-pane" data-prompt-key="dca-local-pool-agent">
                <h4 className="prompt-pane-title mt-8">Local Solution Pool Agent Prompt</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Local Solution Pool Agent system prompt..."
                            value={prompts.sys_local_pool_agent}
                            onChange={handleChange('sys_local_pool_agent')}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DCAPromptsContent;

