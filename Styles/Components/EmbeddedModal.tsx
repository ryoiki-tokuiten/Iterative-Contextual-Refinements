/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Icon } from '../../UI/Icons';
import RenderMathMarkdown from './RenderMathMarkdown';
import { SandboxAgentActivity } from '../../Deepthink/SandboxAgentActivity';

interface ModalMessage {
    id: string;
    role: string;
    content: string;
    iterationNumber: number;
    executionTraceText?: string;
}

interface EmbeddedModalViewerProps {
    title: string;
    content: string;
    currentMessage?: ModalMessage;
    allMessages?: ModalMessage[];
    onClose: () => void;
}

let modalRoot: Root | null = null;
let modalContainer: HTMLElement | null = null;

function ensureModalRoot(): Root {
    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'embedded-modal-root';
        document.body.appendChild(modalContainer);
    }

    if (!modalRoot) {
        modalRoot = createRoot(modalContainer);
    }

    return modalRoot;
}

function destroyModalRoot() {
    if (modalRoot) {
        modalRoot.unmount();
        modalRoot = null;
    }

    modalContainer?.remove();
    modalContainer = null;
}

const EmbeddedModalViewer: React.FC<EmbeddedModalViewerProps> = ({
    title,
    content,
    currentMessage,
    allMessages,
    onClose,
}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const contentWrapperRef = useRef<HTMLDivElement>(null);
    const transitionTimeoutRef = useRef<number | null>(null);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [modalWidth, setModalWidth] = useState<number | undefined>(undefined);
    const [viewMode, setViewMode] = useState<'submitted' | 'activity'>('submitted');

    const messages = useMemo(() => {
        if (!currentMessage || !allMessages?.length) return [];
        return allMessages
            .filter((message) => message.role === currentMessage.role)
            .sort((left, right) => left.iterationNumber - right.iterationNumber);
    }, [allMessages, currentMessage]);

    const hasNavigation = messages.length > 1;
    const initialIndex = useMemo(() => {
        if (!hasNavigation || !currentMessage) return -1;
        return messages.findIndex((message) => message.id === currentMessage.id);
    }, [currentMessage, hasNavigation, messages]);
    const [activeIndex, setActiveIndex] = useState(initialIndex);

    useEffect(() => {
        setActiveIndex(initialIndex);
    }, [initialIndex]);

    const displayedMessage = hasNavigation && activeIndex >= 0 ? messages[activeIndex] : null;
    const submittedContent = displayedMessage?.content || content || 'No content available';
    const executionTraceText = displayedMessage?.executionTraceText || currentMessage?.executionTraceText;
    const displayIteration = displayedMessage?.iterationNumber;

    useEffect(() => {
        setViewMode('submitted');
    }, [displayedMessage?.id, currentMessage?.id]);

    const navigateTo = (nextIndex: number) => {
        if (nextIndex === activeIndex || nextIndex < 0 || nextIndex >= messages.length) {
            return;
        }

        if (transitionTimeoutRef.current) {
            window.clearTimeout(transitionTimeoutRef.current);
        }

        setIsTransitioning(true);
        transitionTimeoutRef.current = window.setTimeout(() => {
            setActiveIndex(nextIndex);
            setIsTransitioning(false);
            transitionTimeoutRef.current = null;
        }, 150);
    };

    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            } else if (hasNavigation && event.key === 'ArrowLeft') {
                event.preventDefault();
                navigateTo(activeIndex - 1);
            } else if (hasNavigation && event.key === 'ArrowRight') {
                event.preventDefault();
                navigateTo(activeIndex + 1);
            }
        };

        document.addEventListener('keydown', handleKeydown);
        return () => document.removeEventListener('keydown', handleKeydown);
    }, [activeIndex, hasNavigation, onClose]);

    useEffect(() => () => {
        if (transitionTimeoutRef.current) {
            window.clearTimeout(transitionTimeoutRef.current);
        }
    }, []);

    useLayoutEffect(() => {
        const handle = window.requestAnimationFrame(() => {
            const wrapper = contentWrapperRef.current;
            const modal = modalRef.current;
            if (!wrapper || !modal) return;

            const scrollWidth = wrapper.scrollWidth;
            const currentWidth = modal.offsetWidth;
            if (scrollWidth > currentWidth - 100) {
                setModalWidth(Math.min(scrollWidth + 100, window.innerWidth * 0.95, 1400));
            } else {
                setModalWidth(undefined);
            }
        });

        return () => window.cancelAnimationFrame(handle);
    }, [submittedContent]);

    const activityViewToggle = executionTraceText && (
        <div className="response-view-toggle" aria-label="Response view">
            <button
                type="button"
                className={`response-toggle-option ${viewMode === 'submitted' ? 'active' : ''}`}
                onClick={() => setViewMode('submitted')}
            >
                Artifact
            </button>
            <button
                type="button"
                className={`response-toggle-option ${viewMode === 'activity' ? 'active' : ''}`}
                onClick={() => setViewMode('activity')}
            >
                Agent Activity
            </button>
        </div>
    );

    const overlayStyle: React.CSSProperties = {
        position: 'fixed',
        pointerEvents: 'auto',
    };

    const isInsideDeepthinkModal = document.getElementById('solution-modal-overlay') !== null;
    overlayStyle.zIndex = isInsideDeepthinkModal ? 2200 : 1000;

    return (
        <div
            className="embedded-modal-overlay"
            style={overlayStyle}
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                ref={modalRef}
                className="embedded-modal-content"
                style={modalWidth ? { width: `${modalWidth}px` } : undefined}
            >
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="embedded-modal-header-left" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '.5rem' }}>
                        <div className="modal-title-row" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '.5rem' }}>
                            <h4 style={{ margin: 0 }}>{title}</h4>
                            {hasNavigation && displayIteration !== undefined && (
                                <span className="iteration-indicator" style={{ display: 'inline-flex' }}>
                                    {displayIteration}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="embedded-modal-header-controls" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginLeft: 'auto' }}>
                        {activityViewToggle}
                        {hasNavigation && (
                            <>
                                <button
                                    className="modal-nav-btn"
                                    data-nav="prev"
                                    disabled={activeIndex <= 0}
                                    title="Previous iteration"
                                    onClick={() => navigateTo(activeIndex - 1)}
                                >
                                    <Icon name="chevron_left" />
                                </button>
                                <button
                                    className="modal-nav-btn"
                                    data-nav="next"
                                    disabled={activeIndex >= messages.length - 1}
                                    title="Next iteration"
                                    onClick={() => navigateTo(activeIndex + 1)}
                                >
                                    <Icon name="chevron_right" />
                                </button>
                            </>
                        )}
                        <button className="close-modal-btn" onClick={onClose}>
                            <Icon name="close" />
                        </button>
                    </div>
                </div>
                <div className="modal-body custom-scrollbar" style={{ opacity: isTransitioning ? 0.3 : 1 }}>
                    {viewMode === 'activity' && executionTraceText ? (
                        <SandboxAgentActivity executionTraceText={executionTraceText} />
                    ) : (
                        <div ref={contentWrapperRef} className="modal-content-wrapper">
                            <RenderMathMarkdown content={submittedContent} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * Opens an embedded modal with blur backdrop (reusable across modes)
 * @param title - Modal title
 * @param content - Markdown content to display
 * @param currentMessage - Optional current message for navigation
 * @param allMessages - Optional all messages for navigation
 */
export function openEmbeddedModal(
    title: string,
    content: string,
    currentMessage?: ModalMessage,
    allMessages?: ModalMessage[]
): void {
    const root = ensureModalRoot();
    root.render(
        <EmbeddedModalViewer
            title={title}
            content={content}
            currentMessage={currentMessage}
            allMessages={allMessages}
            onClose={destroyModalRoot}
        />
    );
}
