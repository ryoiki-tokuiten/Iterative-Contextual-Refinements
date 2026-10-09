/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { Icon } from '../../../UI/Icons';
import './AgentActivityPanel.css';

export interface AgentActivityPanelProps {
    title?: string;
    isProcessing?: boolean;
    error?: string | null;
    onStop?: () => void;
    headerExtra?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}

// Module-level immutable subtrees: eliminates allocations during renders
// and enables O(1) reconciler bailouts via reference equality.
const STOP_ICON = <Icon name="stop_circle" />;
const WARNING_ICON = <Icon name="warning" />;
const PROCESSING_INDICATOR = (
    <div className="processing-indicator">
        <div className="spinner" />
        <span>Processing agent response...</span>
    </div>
);

/**
 * Production-grade Agent Activity Panel.
 *
 * Key architectural improvements:
 * 1. Zero-Reactivity Scroll Tracking: Replaces `useState` with an unrendered ref,
 *    eliminating component re-renders during high-frequency scroll events.
 * 2. Unified Auto-Scroll Pipeline: Combines redundant effect hooks into a single
 *    mutation cycle and eliminates layout-thrashing `requestAnimationFrame` cascades.
 * 3. Programmatic Scroll Guard: Distinguishes between programmatic auto-scrolling
 *    and user-initiated interaction to prevent synchronous layout reflows.
 * 4. Pure Component Memoization: Protects the component tree from parent re-render churn.
 */
const AgentActivityPanelComponent: React.FC<AgentActivityPanelProps> = ({
    title = 'Agent Activity',
    isProcessing = false,
    error = null,
    onStop,
    headerExtra,
    className = '',
    style,
    children
}) => {
    const listRef = useRef<HTMLDivElement>(null);
    const autoScrollRef = useRef(true);
    const isProgrammaticScrollRef = useRef(false);

    // Event listener attached with a stable identity to prevent listener thrashing
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        if (isProgrammaticScrollRef.current) {
            isProgrammaticScrollRef.current = false;
            return;
        }
        const el = e.currentTarget;
        autoScrollRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 2;
    }, []);

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;

        if (isProcessing) {
            autoScrollRef.current = true;
        }

        if (autoScrollRef.current) {
            const target = el.scrollHeight;
            if (el.scrollTop !== target) {
                isProgrammaticScrollRef.current = true;
                el.scrollTop = target;
            }
        }
    }, [children, isProcessing]);

    const containerClassName = className
        ? `agent-activity-panel-container ${className}`
        : 'agent-activity-panel-container';

    return (
        <div className={containerClassName} style={style}>
            <div className="agent-panel-header">
                <h3>{title}</h3>
                <div className="header-info">
                    {headerExtra}
                    {isProcessing && onStop && (
                        <button className="stop-button" onClick={onStop}>
                            {STOP_ICON}
                            Stop
                        </button>
                    )}
                </div>
            </div>
            <div
                className="agent-messages-container custom-scrollbar"
                ref={listRef}
                onScroll={handleScroll}
            >
                {children}
                {isProcessing && PROCESSING_INDICATOR}
            </div>
            {error && (
                <div className="error-message">
                    {WARNING_ICON}
                    {error}
                </div>
            )}
        </div>
    );
};

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = memo(AgentActivityPanelComponent);