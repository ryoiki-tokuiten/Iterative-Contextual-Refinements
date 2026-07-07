import React, { useState, useEffect } from 'react';
import SidebarHeader from './SidebarHeader';
import AppModeSelector from './AppModeSelector';
import ModelParameters from './ModelParameters';
import SidebarFooter from './SidebarFooter';
import { FileUpload } from './FileUpload';
import { AppMode, getShowFileUploadForMode, createModeChangeHandler, attachModeChangeListener } from './SidebarLogic';
import { Icon } from '../../../UI/Icons';

export const Sidebar: React.FC = () => {
    const [currentMode, setCurrentMode] = useState<AppMode>('deepthink');
    const importInputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handler = createModeChangeHandler((mode) => {
            setCurrentMode(mode);
        });

        const { cleanup } = attachModeChangeListener(handler);

        return () => {
            cleanup();
        };
    }, []);

    const showFileUpload = currentMode === 'contextual' || getShowFileUploadForMode(currentMode);

    let labelText = 'Core Challenge:';
    let placeholderText = 'E.g., "Design a sustainable urban transportation system", "Analyze the impact of remote work on company culture"...';

    if (currentMode === 'contextual') {
        labelText = 'Initial User Request:';
        placeholderText = 'E.g., "Write a comprehensive guide on machine learning basics", "Create a detailed business plan for a coffee shop"...';
    } else if (currentMode === 'adaptive-deepthink') {
        labelText = 'Core Challenge:';
        placeholderText = 'E.g., "Solve this mathematical problem", "Design a scalable database architecture", "Analyze this complex scenario"...';
    }

    return (
        <aside id="controls-sidebar" className="inspector-panel custom-scrollbar" aria-labelledby="controls-sidebar-heading">
            <SidebarHeader />

            <div className="sidebar-content">
                <div className="input-group">
                    <label htmlFor="initial-idea" id="initial-idea-label" className="input-label">
                        {labelText}
                    </label>
                    <textarea
                        id="initial-idea"
                        className="input-base"
                        placeholder={placeholderText}
                        rows={5}
                    />
                    {showFileUpload && <FileUpload />}
                </div>

                <AppModeSelector />

                <ModelParameters />

                <details className="sidebar-section" open>
                    <summary className="sidebar-section-header">Configuration</summary>
                    <div className="sidebar-section-content">
                        <div className="config-buttons-container" style={{ display: 'flex', gap: '1rem' }}>
                            <button id="export-config-button" className="button" type="button" onClick={() => import('../../../Core/App').then(m => m.App.handleExportConfig())}>
                                <Icon name="upload" />
                                <span className="button-text">Export</span>
                            </button>
                            <input type="file" id="import-config-input" ref={importInputRef} className="sr-only" accept=".json,.gz,.msgpack,.msgpack.gz" onChange={(e) => import('../../../Core/App').then(m => m.App.handleImportConfig(e.nativeEvent))} />
                            <button id="import-config-button" className="button" type="button" onClick={() => importInputRef.current?.click()}>
                                <Icon name="download" />
                                <span className="button-text">Import</span>
                            </button>
                        </div>
                    </div>
                </details>
            </div>

            <SidebarFooter currentMode={currentMode} />
        </aside>
    );
};

export default Sidebar;
