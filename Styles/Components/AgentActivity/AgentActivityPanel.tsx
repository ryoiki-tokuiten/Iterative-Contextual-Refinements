/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Icon } from '../../../UI/Icons';
import './AgentActivityPanel.css';

interface AgentActivityPanelProps {
    title?: string;
    isProcessing?: boolean;
    error?: string | null;
    onStop?: () => void;
    headerExtra?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({
    title = 'Agent Activity',
    isProcessing = false,
    error = null,
    onStop,
    headerExtra,
    className = '',
    style,
    children
}) => {
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

    const handleScroll = useCallback(() => {
        const el = messagesContainerRef.current;
        if (el) {
            const { scrollTop, scrollHeight, clientHeight } = el;
            const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) <= 2;
            setIsUserScrolledUp(!isAtBottom);
        }
    }, []);

    useEffect(() => {
        if (!isUserScrolledUp && messagesContainerRef.current) {
            const el = messagesContainerRef.current;
            el.scrollTop = el.scrollHeight;
            requestAnimationFrame(() => {
                if (!isUserScrolledUp && messagesContainerRef.current) {
                    const el2 = messagesContainerRef.current;
                    el2.scrollTop = el2.scrollHeight;
                }
            });
        }
    }, [children, isUserScrolledUp]);

    useEffect(() => {
        if (isProcessing && messagesContainerRef.current) {
            const el = messagesContainerRef.current;
            el.scrollTop = el.scrollHeight;
            setIsUserScrolledUp(false);
        }
    }, [isProcessing]);

    return (
        <div className={`agent-activity-panel-container ${className}`} style={style}>
            <div className="agent-panel-header">
                <h3>{title}</h3>
                <div className="header-info">
                    {headerExtra}
                    {isProcessing && onStop && (
                        <button className="stop-button" onClick={onStop}>
                            <Icon name="stop_circle" />
                            Stop
                        </button>
                    )}
                </div>
            </div>
            <div 
                className="agent-messages-container custom-scrollbar" 
                ref={messagesContainerRef} 
                onScroll={handleScroll}
            >
                {children}
                {isProcessing && (
                    <div className="processing-indicator">
                        <div className="spinner"></div>
                        <span>Processing agent response...</span>
                    </div>
                )}
            </div>
            {error && (
                <div className="error-message">
                    <Icon name="warning" />
                    {error}
                </div>
            )}
        </div>
    );
};
