import React from 'react';
import { Icon } from '../../UI/Icons';

/**
 * Prompts Modal Layout component
 * Provides the modal shell structure for customizing prompts
 */
const PromptsModalLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    return (
        <div id="prompts-modal-overlay" className="modal-overlay">
            <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="prompts-modal-title">
                <header className="modal-header">
                    <h2 id="prompts-modal-title" className="modal-title">Customize Prompts</h2>
                    <button id="prompts-modal-close-button" className="modal-close-button" aria-label="Close Custom Prompts">
                        <Icon name="close" />
                    </button>
                </header>
                <div id="prompts-modal-body" className="modal-body">
                    <div id="prompts-modal-layout" className="prompts-modal-layout">
                        <nav id="prompts-modal-nav" className="prompts-nav custom-scrollbar"></nav>
                        <div id="prompts-modal-content" className="prompts-content custom-scrollbar">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PromptsModalLayout;
