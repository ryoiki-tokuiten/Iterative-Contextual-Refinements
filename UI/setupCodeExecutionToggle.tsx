import React from 'react';
import { getGeminiCodeExecutionEnabled, setGeminiCodeExecutionEnabled, shouldShowCodeExecutionToggle } from './setupCodeExecutionToggle';

export interface CodeExecutionToggleProps {
    currentMode: string;
    onChange?: (enabled: boolean) => void;
}

export const GeminiCodeExecutionToggle: React.FC<CodeExecutionToggleProps> = ({ currentMode, onChange }) => {
    const shouldShow = shouldShowCodeExecutionToggle(currentMode);
    const isEnabled = getGeminiCodeExecutionEnabled();

    if (!shouldShow) return null;

    return (
        <div id="contextual-mode-controls" style={{ display: 'block' }}>
            <label className="toggle-label">
                <input
                    id="gemini-code-execution-toggle"
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => {
                        setGeminiCodeExecutionEnabled(e.target.checked);
                        onChange?.(e.target.checked);
                    }}
                />
                <span>Enable Sandbox Terminal Environment</span>
            </label>
        </div>
    );
};

export const useCodeExecutionState = (currentMode: string) => {
    return {
        shouldShow: shouldShowCodeExecutionToggle(currentMode),
        isEnabled: getGeminiCodeExecutionEnabled()
    };
};
