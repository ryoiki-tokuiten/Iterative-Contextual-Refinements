import React, { useState, useEffect, useCallback } from 'react';
import { createRoot, Root } from 'react-dom/client';
import RenderMathMarkdown from '../RenderMathMarkdown';
import { ContentState } from './types';
import {
    HistoryEntry,
    buildContentStatesFromHistory,
    computeEvolutionDiff,
    splitIntoLines,
    registerEvolutionViewer,
    unregisterEvolutionViewer,
    hasEvolutionViewerOpen
} from './EvolutionViewer';
import { openSequentialViewer } from './SequentialViewer';
import { Icon } from '../../../UI/Icons';

// ─── Evolution Column ─────────────────────────────────────────────────────────

interface EvolutionColumnProps {
    state: ContentState;
    index: number;
    prevState: ContentState | null;
    hideDiff: boolean;
}

const EvolutionColumn: React.FC<EvolutionColumnProps> = ({ state, index, prevState, hideDiff }) => {
    const renderDiffLines = () => {
        if (index === 0) {
            // First column: plain content
            const lines = splitIntoLines(state.content);
            return lines.map((line, i) => (
                <div key={i} className="evolution-line">
                    <span className="evolution-line-content">{line || ' '}</span>
                </div>
            ));
        }

        // Subsequent columns: diff vs previous
        const diffLines = computeEvolutionDiff(prevState!.content, state.content);
        return diffLines.map((dl, i) => (
            <div
                key={i}
                className={`evolution-line${dl.type === 'added' ? ' evolution-line-added' : dl.type === 'removed' ? ' evolution-line-removed' : ''}`}
            >
                <span className="evolution-line-content">{dl.text}</span>
            </div>
        ));
    };

    return (
        <div className="evolution-column">
            <div className="evolution-column-header">
                <div className="evolution-column-title">{state.title}</div>
            </div>
            <div className="evolution-column-content scrollbar-compact">
                {hideDiff
                    ? <div className="evolution-rendered-content"><RenderMathMarkdown content={state.content} /></div>
                    : <pre><code>{renderDiffLines()}</code></pre>
                }
            </div>
        </div>
    );
};

// ─── Evolution Viewer Modal ───────────────────────────────────────────────────

interface EvolutionViewerProps {
    contentStates: ContentState[];
    isInsideDeepthinkModal: boolean;
    onClose: () => void;
    sessionId?: string;
    scrollContainerRef?: (el: HTMLDivElement | null) => void;
}

const EvolutionViewerModal: React.FC<EvolutionViewerProps> = ({
    contentStates,
    isInsideDeepthinkModal,
    onClose,
    scrollContainerRef
}) => {
    const [hideDiff, setHideDiff] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSequentialView = useCallback(() => {
        openSequentialViewer(contentStates.map(s => ({ title: s.title, content: s.content })));
    }, [contentStates]);

    const overlayStyle: React.CSSProperties = isInsideDeepthinkModal
        ? { zIndex: 2300 }
        : {};

    return (
        <div
            id="evolution-viewer-overlay"
            className="evolution-viewer-overlay visible"
            style={overlayStyle}
        >
            <div className="evolution-viewer-container">
                {/* Header */}
                <div className="evolution-viewer-header">
                    <div className="evolution-header-content">
                        <Icon name="movie" className="evolution-icon" />
                        <h2 className="evolution-title">Content Evolution Timeline</h2>
                        <span className="evolution-subtitle">Scroll horizontally to view all iterations</span>
                    </div>
                    <div className="evolution-header-actions">
                        <button
                            id="hide-diff-button"
                            className={`hide-diff-button${hideDiff ? ' active' : ''}`}
                            onClick={() => setHideDiff(prev => !prev)}
                        >
                            <Icon name={hideDiff ? 'visibility' : 'visibility_off'} />
                            <span className="button-text">{hideDiff ? 'Show Diff' : 'Hide Diff'}</span>
                        </button>
                        <button
                            id="sequential-view-button"
                            className="sequential-view-button"
                            onClick={handleSequentialView}
                        >
                            <Icon name="play_circle" />
                            <span className="button-text">View Iterations Sequentially</span>
                        </button>
                    </div>
                    <button className="evolution-close-button" onClick={onClose}>
                        <Icon name="close" />
                    </button>
                </div>

                {/* Scroll Container */}
                <div className="evolution-scroll-container scrollbar-standard" ref={scrollContainerRef}>
                    {contentStates.length === 0
                        ? <div className="evolution-empty-message">No iterations available to display.</div>
                        : contentStates.map((state, idx) => (
                            <EvolutionColumn
                                key={`${state.iterationNumber}-${state.title}`}
                                state={state}
                                index={idx}
                                prevState={idx > 0 ? contentStates[idx - 1] : null}
                                hideDiff={hideDiff}
                            />
                        ))
                    }
                </div>
            </div>
        </div>
    );
};

// ─── Imperative Portal API ────────────────────────────────────────────────────

const roots = new Map<string, Root>();

function getOrCreateRoot(id: string): Root {
    if (roots.has(id)) return roots.get(id)!;
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.set(id, root);
    return root;
}

function unmountRoot(id: string): void {
    const root = roots.get(id);
    if (root) {
        root.unmount();
        roots.delete(id);
    }
    document.getElementById(id)?.remove();
}

function mountEvolutionViewer(contentStates: ContentState[], sessionId?: string): void {
    const rootId = 'evolution-viewer-root';
    unmountRoot(rootId);

    const isInsideDeepthinkModal = document.getElementById('solution-modal-overlay') !== null;

    const handleClose = () => {
        if (sessionId) unregisterEvolutionViewer(sessionId);
        unmountRoot(rootId);
    };

    const root = getOrCreateRoot(rootId);
    root.render(
        <EvolutionViewerModal
            contentStates={contentStates}
            isInsideDeepthinkModal={isInsideDeepthinkModal}
            onClose={handleClose}
            sessionId={sessionId}
            scrollContainerRef={(el) => {
                if (sessionId && el) {
                    registerEvolutionViewer(sessionId, { scrollContainer: el, lastCount: contentStates.length });
                }
            }}
        />
    );
}

// Evolution Viewer from content history is the canonical entry point for all modern modes

export function openEvolutionViewerFromHistory(history: HistoryEntry[], sessionId: string): void {
    if (!history || history.length === 0) {
        alert('No content history available.');
        return;
    }

    if (hasEvolutionViewerOpen(sessionId)) {
        // Update existing viewer
        updateEvolutionViewerIfOpen(sessionId, history);
        return;
    }

    const contentStates = buildContentStatesFromHistory(history);
    mountEvolutionViewer(contentStates, sessionId);
}

export function updateEvolutionViewerIfOpen(sessionId: string, history: HistoryEntry[]): void {
    const viewer = roots.get('evolution-viewer-root');
    if (!viewer || !hasEvolutionViewerOpen(sessionId)) return;

    const contentStates = buildContentStatesFromHistory(history);
    const rootId = 'evolution-viewer-root';
    const isInsideDeepthinkModal = document.getElementById('solution-modal-overlay') !== null;

    viewer.render(
        <EvolutionViewerModal
            contentStates={contentStates}
            isInsideDeepthinkModal={isInsideDeepthinkModal}
            onClose={() => {
                unregisterEvolutionViewer(sessionId);
                unmountRoot(rootId);
            }}
            sessionId={sessionId}
            scrollContainerRef={(el) => {
                if (el) {
                    registerEvolutionViewer(sessionId, { scrollContainer: el, lastCount: history.length });
                    setTimeout(() => { el.scrollLeft = el.scrollWidth; }, 100);
                }
            }}
        />
    );
}

export function closeEvolutionViewer(): void {
    unmountRoot('evolution-viewer-root');
}
