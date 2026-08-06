import React, { useEffect, useRef } from 'react';
import { mountProviderButtons, createPollingInterval } from './SidebarHeaderLogic';
import { Icon } from '../../../UI/Icons';

const SidebarHeader: React.FC = () => {
    const buttonsContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const attemptMount = () => {
            mountProviderButtons(buttonsContainerRef);
        };

        attemptMount();

        const intervalId = createPollingInterval(buttonsContainerRef, attemptMount);

        return () => clearInterval(intervalId);
    }, []);

    return (
        <header className="sidebar-header">
            <div className="sidebar-header-content">
                <div
                    id="provider-buttons-mount-point"
                    className="api-key-status-container sidebar-provider-actions"
                    ref={buttonsContainerRef}
                >
                </div>
                <div className="sidebar-header-actions">
                    <button
                        id="theme-toggle-button"
                        className="theme-toggle-button"
                        aria-label="Toggle Theme"
                        title="Toggle Light/Dark Mode"
                    >
                        <Icon name="light_mode" />
                    </button>
                    <button
                        id="sidebar-collapse-button"
                        className="sidebar-collapse-button"
                        aria-label="Collapse Sidebar"
                        title="Collapse Sidebar"
                    >
                        <Icon name="dock_to_right" />
                    </button>
                </div>
            </div>
        </header>
    );
};

export default SidebarHeader;
