import React, { useState, useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ActionButtonGroup } from '../ActionButton';
import RenderMathMarkdown from '../RenderMathMarkdown';
import { Icon } from '../../../UI/Icons';
import { DiffViewMode, DiffContentType } from './types';
import { createUnifiedDiff, applyCustomThemeToD2H, addDarkThemeStyles } from './utils';
import * as Diff from 'diff';
import { html as diff2htmlHtml } from 'diff2html';

// ─── Pure Diff Logic ─────────────────────────────────────────────────────────

export function computeDiffStats(sourceText: string, targetText: string): { added: number; removed: number; total: number } {
    const differences = Diff.diffLines(sourceText, targetText, { newlineIsToken: true });
    let added = 0;
    let removed = 0;

    differences.forEach(part => {
        const lines = part.value.split('\n').filter(line => line !== '' || part.value.endsWith('\n'));
        if (part.added) {
            added += lines.length;
        } else if (part.removed) {
            removed += lines.length;
        }
    });

    return { added, removed, total: added + removed };
}

export function generateUnifiedDiffHTML(sourceText: string, targetText: string): string {
    const unifiedDiff = createUnifiedDiff(sourceText, targetText);
    return diff2htmlHtml(unifiedDiff, {
        outputFormat: 'line-by-line',
        drawFileList: false,
        matching: 'none',
        renderNothingWhenEmpty: false
    });
}

export function generateSplitDiffHTML(sourceText: string, targetText: string): string {
    const unifiedDiff = createUnifiedDiff(sourceText, targetText);
    return diff2htmlHtml(unifiedDiff, {
        outputFormat: 'side-by-side',
        drawFileList: false,
        matching: 'none',
        renderNothingWhenEmpty: false
    });
}

export function applyDiffTheme(container: HTMLElement): void {
    applyCustomThemeToD2H(container);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type InstantFixesView = 'side-by-side' | 'diff-analysis' | 'preview';

// ─── Diff Stats Bar ───────────────────────────────────────────────────────────

interface DiffStatsProps {
    added: number;
    removed: number;
    total: number;
}

const DiffStats: React.FC<DiffStatsProps> = ({ added, removed, total }) => (
    <div id="header-diff-stats" className="header-diff-stats visible">
        <div className="diff-stat-item diff-stat-additions">
            <span className="diff-stat-sign">+</span>
            <span>{added} lines</span>
        </div>
        <div className="diff-stat-item diff-stat-deletions">
            <span className="diff-stat-sign">-</span>
            <span>{removed} lines</span>
        </div>
        <div className="diff-stat-item diff-stat-total">
            <Icon name="difference" />
            <span>{total} changes</span>
        </div>
    </div>
);

// ─── Diff Viewer Panel (handles d2h rendering) ────────────────────────────────

interface DiffViewerPanelProps {
    id: string;
    sourceText: string;
    targetText: string;
    viewMode: DiffViewMode;
    className?: string;
}

const DiffViewerPanel: React.FC<DiffViewerPanelProps> = ({ id, sourceText, targetText, viewMode, className }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current || !sourceText || !targetText) return;
        const html = viewMode === 'split'
            ? generateSplitDiffHTML(sourceText, targetText)
            : generateUnifiedDiffHTML(sourceText, targetText);
        containerRef.current.innerHTML = html;
        applyDiffTheme(containerRef.current);
    }, [sourceText, targetText, viewMode]);

    return <div id={id} ref={containerRef} className={`diff-viewer-container custom-scrollbar ${className ?? ''}`} />;
};

// ─── Side-by-Side Rendered Content Panel ─────────────────────────────────────

interface RenderedContentPanelProps {
    id: string;
    content: string;
    className?: string;
}

const RenderedContentPanel: React.FC<RenderedContentPanelProps> = ({ id, content, className }) => {
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
        setShouldRender(false);

        const schedule = typeof requestIdleCallback !== 'undefined'
            ? requestIdleCallback
            : (callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 16);

        const cancel = typeof cancelIdleCallback !== 'undefined'
            ? cancelIdleCallback
            : (handle: number) => window.clearTimeout(handle);

        const handle = schedule(() => setShouldRender(true));

        return () => {
            cancel(handle as number);
        };
    }, [content]);

    return (
        <div id={id} className={`comparison-content custom-scrollbar ${className ?? ''}`}>
            {shouldRender && <RenderMathMarkdown content={content} />}
        </div>
    );
};

// ─── Instant Fixes Panel ──────────────────────────────────────────────────────

interface InstantFixesPanelProps {
    activeView: InstantFixesView;
    sourceContent: string;
    targetContent: string;
    sourceTitle: string;
    targetTitle: string;
    viewMode: DiffViewMode;
    isHtmlContent: boolean;
}

const InstantFixesPanel: React.FC<InstantFixesPanelProps> = ({
    activeView,
    sourceContent,
    targetContent,
    sourceTitle,
    targetTitle,
    viewMode,
    isHtmlContent
}) => {
    const [mounted, setMounted] = useState<Record<InstantFixesView, boolean>>({ 'side-by-side': true, 'diff-analysis': false, 'preview': false });

    useEffect(() => {
        setMounted(prev => prev[activeView] ? prev : { ...prev, [activeView]: true });
    }, [activeView]);

    const previewSourceRef = useRef<HTMLIFrameElement>(null);
    const previewTargetRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        if (activeView !== 'preview' || !isHtmlContent) return;
        if (previewSourceRef.current) previewSourceRef.current.srcdoc = sourceContent;
        if (previewTargetRef.current) previewTargetRef.current.srcdoc = targetContent;
    }, [activeView, sourceContent, targetContent, isHtmlContent]);

    return (
        <div className="instant-fixes-content" style={{ width: '100%', height: '100%' }}>
            {/* Side-by-side view — always mounted (default tab) */}
            <div id="side-by-side-view" className={`instant-fixes-view${activeView === 'side-by-side' ? ' active' : ''}`}>
                <div className="side-by-side-comparison">
                    <div className="comparison-side">
                        <div className="preview-header">
                            <h4 className="comparison-title">
                                <Icon name="psychology" />
                                <span>{sourceTitle}</span>
                            </h4>
                            <ActionButtonGroup
                                type="source"
                                view="instant"
                                contentSource={() => sourceContent}
                            />
                        </div>
                        <RenderedContentPanel id="diff-source-content" content={sourceContent} />
                    </div>
                    <div className="comparison-side">
                        <div className="preview-header">
                            <h4 className="comparison-title">
                                <Icon name="auto_fix_high" />
                                <span>{targetTitle}</span>
                            </h4>
                            <ActionButtonGroup
                                type="target"
                                view="instant"
                                contentSource={() => targetContent}
                            />
                        </div>
                        <RenderedContentPanel id="diff-target-content" content={targetContent} />
                    </div>
                </div>
            </div>

            {/* Diff Analysis View */}
            <div id="diff-analysis-view" className={`instant-fixes-view${activeView === 'diff-analysis' ? ' active' : ''}`}>
                {mounted['diff-analysis']
                    ? <DiffViewerPanel
                        id="instant-fixes-diff-viewer"
                        sourceText={sourceContent}
                        targetText={targetContent}
                        viewMode={viewMode}
                    />
                    : <div id="instant-fixes-diff-viewer" className="diff-viewer-container custom-scrollbar">
                        <div className="empty-state-message"><p>Click &ldquo;Diff Analysis&rdquo; to see detailed line-by-line changes</p></div>
                    </div>
                }
            </div>

            {/* Preview View */}
            <div id="preview-view" className={`instant-fixes-view${activeView === 'preview' ? ' active' : ''}`}>
                {mounted['preview'] && (
                    <div className="preview-comparison">
                        <div className="preview-side">
                            <div className="preview-header">
                                <h4 className="comparison-title">
                                    <Icon name="psychology" />
                                    <span>{sourceTitle}</span>
                                </h4>
                                <div className="preview-controls">
                                    <ActionButtonGroup type="source" view="preview" contentSource={() => sourceContent} />
                                </div>
                            </div>
                            <iframe
                                ref={previewSourceRef}
                                id="preview-source-frame"
                                className="preview-frame"
                                sandbox="allow-scripts allow-same-origin"
                            />
                        </div>
                        <div className="preview-side">
                            <div className="preview-header">
                                <h4 className="comparison-title">
                                    <Icon name="auto_fix_high" />
                                    <span>{targetTitle}</span>
                                </h4>
                                <ActionButtonGroup type="target" view="preview" contentSource={() => targetContent} />
                            </div>
                            <iframe
                                ref={previewTargetRef}
                                id="preview-target-frame"
                                className="preview-frame"
                                sandbox="allow-scripts allow-same-origin"
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Main Diff Modal ──────────────────────────────────────────────────────────

interface DiffModalProps {
    sourceContent: string;
    targetContent: string;
    sourceTitle: string;
    targetTitle: string;
    contentType: DiffContentType;
    modalTitle: string;
    onClose: () => void;
}

const DiffModal: React.FC<DiffModalProps> = ({
    sourceContent,
    targetContent,
    sourceTitle,
    targetTitle,
    contentType,
    modalTitle,
    onClose
}) => {
    const [instantView, setInstantView] = useState<InstantFixesView>('side-by-side');
    const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('split');

    const stats = computeDiffStats(sourceContent, targetContent);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div
            id="diff-modal-overlay"
            className="modal-overlay fullscreen-modal is-visible"
            style={{ display: 'flex' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="modal-content" role="dialog" aria-modal="true">
                {/* Header */}
                <header className="modal-header">
                    <div className="modal-header-left">
                        <h2 className="modal-title" id="diff-modal-title">{modalTitle}</h2>
                    </div>
                    <div className="modal-header-right">
                        <div className="diff-modal-controls">
                            <button
                                id="side-by-side-button"
                                className={`view-mode-button${instantView === 'side-by-side' ? ' active' : ''}`}
                                onClick={() => setInstantView('side-by-side')}
                            >
                                <Icon name="auto_fix_high" />
                                <span className="button-text">Side by Side</span>
                            </button>
                            <button
                                id="diff-analysis-view-button"
                                className={`view-mode-button${instantView === 'diff-analysis' ? ' active' : ''}`}
                                onClick={() => setInstantView('diff-analysis')}
                            >
                                <Icon name="difference" />
                                <span className="button-text">Diff Analysis</span>
                            </button>
                            {contentType === 'html' && (
                                <button
                                    id="preview-button"
                                    className={`view-mode-button${instantView === 'preview' ? ' active' : ''}`}
                                    onClick={() => setInstantView('preview')}
                                >
                                    <Icon name="preview" />
                                    <span className="button-text">Preview</span>
                                </button>
                            )}
                            <div
                                className="diff-view-selector-container"
                                id="diff-view-selector-container"
                                style={{ display: instantView === 'diff-analysis' ? 'flex' : 'none' }}
                            >
                                <label htmlFor="diff-view-selector" className="diff-view-label">
                                    <Icon name="view_column" />
                                </label>
                                <select
                                    id="diff-view-selector"
                                    className="diff-view-selector"
                                    value={diffViewMode}
                                    onChange={e => setDiffViewMode(e.target.value as DiffViewMode)}
                                >
                                    <option value="split">Split View</option>
                                    <option value="unified">Unified View</option>
                                </select>
                            </div>
                        </div>
                        <button className="modal-close-button" onClick={onClose}>
                            <Icon name="close" />
                        </button>
                    </div>
                </header>

                {/* Diff Stats */}
                <div className="diff-stats-section">
                    <DiffStats added={stats.added} removed={stats.removed} total={stats.total} />
                </div>

                {/* Modal Body */}
                <div
                    id="diff-modal-body"
                    style={{ display: 'flex', overflow: 'hidden', height: 'calc(100vh - 180px)', padding: 0 }}
                >
                    <div id="instant-fixes-panel" className="diff-mode-panel active" style={{ width: '100%', height: '100%' }}>
                        <InstantFixesPanel
                            activeView={instantView}
                            sourceContent={sourceContent}
                            targetContent={targetContent}
                            sourceTitle={sourceTitle}
                            targetTitle={targetTitle}
                            viewMode={diffViewMode}
                            isHtmlContent={contentType === 'html'}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Prompt Diff Modal ────────────────────────────────────────────────────────

interface PromptDiffModalProps {
    originalPrompt: string;
    currentPrompt: string;
    title: string;
    onClose: () => void;
}

const PromptDiffModal: React.FC<PromptDiffModalProps> = ({ originalPrompt, currentPrompt, title, onClose }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
        if (!containerRef.current) return;
        const html = generateSplitDiffHTML(originalPrompt, currentPrompt);
        containerRef.current.innerHTML = html;
        applyDiffTheme(containerRef.current);
    }, [originalPrompt, currentPrompt]);

    return (
        <div
            id="prompt-diff-modal-overlay"
            className="modal-overlay fullscreen-modal is-visible"
            style={{ display: 'flex', zIndex: 10001 }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="modal-content">
                <header className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="modal-header-left">
                        <h2 className="modal-title" style={{ margin: 0 }}>{title}</h2>
                    </div>
                    <div className="modal-header-right">
                        <button className="modal-close-button" onClick={onClose}>
                            <Icon name="close" />
                        </button>
                    </div>
                </header>
                <div className="modal-body" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 120px)' }}>
                    <div
                        ref={containerRef}
                        id="diff-viewer-panel"
                        className="diff-viewer-container custom-scrollbar"
                        style={{ height: '100%', overflow: 'auto' }}
                    />
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

export function openDiffModal(
    sourceContent: string,
    targetContent: string,
    sourceTitle: string = 'Original',
    targetTitle: string = 'Revised',
    contentType: DiffContentType = 'text',
    modalTitle: string = 'Compare Outputs'
): void {
    const root = getOrCreateRoot('diff-modal-root');
    root.render(
        <DiffModal
            sourceContent={sourceContent}
            targetContent={targetContent}
            sourceTitle={sourceTitle}
            targetTitle={targetTitle}
            contentType={contentType}
            modalTitle={modalTitle}
            onClose={() => unmountRoot('diff-modal-root')}
        />
    );
}

export function closeDiffModal(): void {
    unmountRoot('diff-modal-root');
}

export function openPromptDiffModal(originalPrompt: string, currentPrompt: string, title: string): void {
    const root = getOrCreateRoot('prompt-diff-modal-root');
    root.render(
        <PromptDiffModal
            originalPrompt={originalPrompt}
            currentPrompt={currentPrompt}
            title={title}
            onClose={() => unmountRoot('prompt-diff-modal-root')}
        />
    );
}

// standalone live HTML preview
export function openFullscreenPreview(content: string, sessionId: string): void {
    let overlay = document.getElementById(`preview-overlay-${sessionId}`);
    if (overlay) {
        const iframe = overlay.querySelector('iframe') as HTMLIFrameElement;
        const refreshIndicator = overlay.querySelector('.refresh-indicator') as HTMLElement;
        if (iframe && refreshIndicator) {
            refreshIndicator.style.display = 'flex';
            const styledContent = addDarkThemeStyles(content);
            const blob = new Blob([styledContent], { type: 'text/html' });
            iframe.src = URL.createObjectURL(blob);
            iframe.onload = () => {
                setTimeout(() => { refreshIndicator.style.display = 'none'; }, 300);
            };
        }
        return;
    }

    overlay = document.createElement('div');
    overlay.id = `preview-overlay-${sessionId}`;
    overlay.className = 'preview-fullscreen-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: 100vw; height: 100vh;
        background: var(--bg-color); z-index: 10000;
        display: flex; flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        padding: 1rem 1.5rem;
        background: rgba(var(--card-bg-base-rgb), 0.85);
        border-bottom: 1px solid var(--border-color);
        backdrop-filter: var(--card-blur-effect);
    `;
    header.innerHTML = `
        <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-color);">
            Live Preview
        </h3>
        <button class="preview-close-btn" style="
            background: rgba(var(--accent-pink-rgb), 0.2);
            border: 1px solid var(--accent-pink);
            color: var(--accent-pink);
            padding: 0.5rem 1rem;
            border-radius: var(--border-radius-md);
            cursor: pointer; display: flex; align-items: center; gap: 0.5rem; font-weight: 500;
        ">
            Close
        </button>
    `;

    const refreshIndicator = document.createElement('div');
    refreshIndicator.className = 'refresh-indicator';
    refreshIndicator.style.cssText = `
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(var(--card-bg-base-rgb), 0.95);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-md);
        padding: 1rem 1.5rem; display: none; align-items: center; gap: 0.75rem;
        z-index: 10001; backdrop-filter: var(--card-blur-effect);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    `;
    refreshIndicator.innerHTML = `
        <div style="
            width: 20px; height: 20px;
            border: 2px solid rgba(var(--accent-purple-rgb), 0.3);
            border-top-color: var(--accent-purple);
            border-radius: 50%; animation: spin 0.8s linear infinite;
        "></div>
        <span style="color: var(--text-color); font-weight: 500;">Refreshing...</span>
    `;

    const iframeContainer = document.createElement('div');
    iframeContainer.style.cssText = 'flex: 1; position: relative; width: 100%;';

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width: 100%; height: 100%; border: none; background: white;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

    const styledContent = addDarkThemeStyles(content);
    const blob = new Blob([styledContent], { type: 'text/html' });
    iframe.src = URL.createObjectURL(blob);

    iframeContainer.appendChild(refreshIndicator);
    iframeContainer.appendChild(iframe);

    overlay.appendChild(header);
    overlay.appendChild(iframeContainer);
    document.body.appendChild(overlay);

    const closeBtn = header.querySelector('.preview-close-btn');
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            overlay!.remove();
            document.removeEventListener('keydown', handleKeyDown);
        }
    };

    closeBtn?.addEventListener('click', () => {
        overlay!.remove();
    });
    document.addEventListener('keydown', handleKeyDown);
}

export function getDiffSourceData(): null { return null; }
export function getCurrentSourceContent(): string { return ''; }
export function getCurrentTargetContent(): string { return ''; }
