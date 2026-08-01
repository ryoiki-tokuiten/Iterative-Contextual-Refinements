import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DiffViewMode } from './types';
import {
    ContentEntry,
    LineEntry,
    SplitDiffResult,
    computeUnifiedDiffLines,
    computeSplitDiffLines,
    computeInitialLines,
    computeAdaptiveLerp,
    computeTargetScrollTop,
    computeProgressPercent,
    computeRestoredLineIndex,
    SPEED_OPTIONS,
    DEFAULT_SPEED_MS
} from './SequentialViewer';
import { Icon } from '../../../UI/Icons';
import { getOrCreatePortalRoot, unmountPortalRoot } from './PortalRoots';

// ─── Line Display Components ──────────────────────────────────────────────────

interface LineProps {
    entry: LineEntry;
    animated: boolean;
    dataIndex: string;
}

const SequentialLine = React.memo<LineProps>(({ entry, animated, dataIndex }) => {
    const cls = [
        'sequential-line',
        entry.type === 'added' ? 'sequential-line-added' : '',
        entry.type === 'removed' ? 'sequential-line-removed' : '',
        entry.isSpacer ? 'sequential-line-spacer' : '',
        animated ? 'sequential-line-animate' : ''
    ].filter(Boolean).join(' ');

    return (
        <div className={cls} data-index={dataIndex}>
            <span className="sequential-line-content">{entry.text}</span>
        </div>
    );
});

// ─── Unified View ─────────────────────────────────────────────────────────────

interface UnifiedViewProps {
    lines: LineEntry[];
    animatedUpTo: number;
    contentRef: React.RefObject<HTMLDivElement | null>;
}

const UnifiedView: React.FC<UnifiedViewProps> = ({ lines, animatedUpTo, contentRef }) => (
    <div
        className="sequential-content-display sequential-unified-view"
        id="sequential-content-display"
        ref={contentRef}
    >
        <pre><code>
            {lines.map((line, i) => (
                <SequentialLine
                    key={i}
                    entry={line}
                    animated={i < animatedUpTo}
                    dataIndex={`line-${i}`}
                />
            ))}
        </code></pre>
    </div>
);

// ─── Split View ───────────────────────────────────────────────────────────────

interface SplitViewProps {
    leftLines: LineEntry[];
    rightLines: LineEntry[];
    prevTitle: string;
    currentTitle: string;
    animatedUpTo: number;
    leftRef: React.RefObject<HTMLDivElement | null>;
    rightRef: React.RefObject<HTMLDivElement | null>;
}

const SplitView: React.FC<SplitViewProps> = ({
    leftLines,
    rightLines,
    prevTitle,
    currentTitle,
    animatedUpTo,
    leftRef,
    rightRef
}) => (
    <div className="sequential-split-container">
        <div className="sequential-split-side left">
            <div className="sequential-split-header">
                <h3 className="sequential-split-title">
                    <Icon name="history" />
                    {prevTitle}
                </h3>
            </div>
            <div className="sequential-split-content" id="sequential-left-content" ref={leftRef}>
                <div className="sequential-content-display">
                    <pre><code>
                        {leftLines.map((line, i) => (
                            <SequentialLine
                                key={i}
                                entry={line}
                                animated={i < animatedUpTo}
                                dataIndex={`left-${i}`}
                            />
                        ))}
                    </code></pre>
                </div>
            </div>
        </div>
        <div className="sequential-split-side right">
            <div className="sequential-split-header">
                <h3 className="sequential-split-title">
                    <Icon name="auto_awesome" />
                    {currentTitle}
                </h3>
            </div>
            <div className="sequential-split-content" id="sequential-right-content" ref={rightRef}>
                <div className="sequential-content-display">
                    <pre><code>
                        {rightLines.map((line, i) => (
                            <SequentialLine
                                key={i}
                                entry={line}
                                animated={i < animatedUpTo}
                                dataIndex={`right-${i}`}
                            />
                        ))}
                    </code></pre>
                </div>
            </div>
        </div>
    </div>
);

// ─── Main Sequential Viewer ───────────────────────────────────────────────────

interface SequentialViewerProps {
    contentStates: ContentEntry[];
    onClose: () => void;
}

const SequentialViewerModal: React.FC<SequentialViewerProps> = ({ contentStates, onClose }) => {
    const [currentIteration, setCurrentIteration] = useState(0);
    const [viewMode, setViewMode] = useState<DiffViewMode>('split');
    const [isPlaying, setIsPlaying] = useState(false);
    const [speedMs, setSpeedMs] = useState(DEFAULT_SPEED_MS);
    const [animatedUpTo, setAnimatedUpTo] = useState(0);

    // Refs for animation loop (avoid stale closures)
    const animFrameRef = useRef<number | null>(null);
    const currentLineRef = useRef(0);
    const isPlayingRef = useRef(false);
    const speedRef = useRef(DEFAULT_SPEED_MS);
    const isAutoScrollingRef = useRef(false);

    // Scroll target refs for smooth scroll
    const targetScrollRef = useRef(0);
    const currentScrollRef = useRef(0);

    // DOM refs for scrollable containers
    const unifiedContentRef = useRef<HTMLDivElement>(null);
    const leftContentRef = useRef<HTMLDivElement>(null);
    const rightContentRef = useRef<HTMLDivElement>(null);

    // ── Derived content for current iteration ────────────────────────────────

    const currentState = contentStates[currentIteration];
    const prevState = currentIteration > 0 ? contentStates[currentIteration - 1] : null;

    let unifiedLines: LineEntry[] = [];
    let splitResult: SplitDiffResult = { leftLines: [], rightLines: [] };

    if (prevState) {
        unifiedLines = computeUnifiedDiffLines(prevState.content, currentState.content);
        splitResult = computeSplitDiffLines(prevState.content, currentState.content);
    } else {
        const initial = computeInitialLines(currentState.content);
        unifiedLines = initial;
        splitResult = { leftLines: [], rightLines: initial };
    }

    const totalLines = viewMode === 'split'
        ? Math.max(splitResult.leftLines.length, splitResult.rightLines.length)
        : unifiedLines.length;

    const progress = computeProgressPercent(animatedUpTo, totalLines);

    // ── Synchronized scrolling for split view ────────────────────────────────

    useEffect(() => {
        const left = leftContentRef.current;
        const right = rightContentRef.current;
        if (!left || !right || viewMode !== 'split') return;

        let isSyncing = false;
        const syncScroll = (source: HTMLElement, target: HTMLElement) => {
            if (isAutoScrollingRef.current || isPlayingRef.current || isSyncing) return;
            isSyncing = true;
            requestAnimationFrame(() => {
                target.scrollTop = source.scrollTop;
                requestAnimationFrame(() => { isSyncing = false; });
            });
        };

        const onLeftScroll = () => syncScroll(left, right);
        const onRightScroll = () => syncScroll(right, left);

        left.addEventListener('scroll', onLeftScroll, { passive: true });
        right.addEventListener('scroll', onRightScroll, { passive: true });
        return () => {
            left.removeEventListener('scroll', onLeftScroll);
            right.removeEventListener('scroll', onRightScroll);
        };
    }, [viewMode, currentIteration]);

    // ── Keyboard handling ────────────────────────────────────────────────────

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key === ' ') { e.preventDefault(); handleTogglePlayback(); return; }
            if (e.key === 'ArrowRight') handleNext();
            if (e.key === 'ArrowLeft') handlePrev();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    });

    // ── Stop animation on unmount ────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, []);

    // ── Reset animated position when iteration/viewMode changes ─────────────

    useEffect(() => {
        currentLineRef.current = 0;
        setAnimatedUpTo(0);
        targetScrollRef.current = 0;
        currentScrollRef.current = 0;
    }, [currentIteration, viewMode]);

    // ── Animation loop ───────────────────────────────────────────────────────
    // Generation counter as a cancel token: each new startAnimation() call
    // increments the generation, making any in-flight loop exit immediately.
    const animGenRef = useRef(0);

    const startAnimation = useCallback(() => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

        const generation = ++animGenRef.current;
        let lastTimestamp = performance.now();
        let accumulatedTime = 0;

        isAutoScrollingRef.current = true;

        const getLines = (container: HTMLElement | null) =>
            container ? Array.from(container.querySelectorAll<HTMLElement>('.sequential-line')) : [];

        const tick = (timestamp: number) => {
            if (generation !== animGenRef.current || !isPlayingRef.current) {
                isAutoScrollingRef.current = false;
                return;
            }

            // Cap delta to avoid huge jumps after tab switches or pauses
            const delta = Math.min(timestamp - lastTimestamp, 100);
            lastTimestamp = timestamp;
            accumulatedTime += delta;

            const currentMax = viewMode === 'split'
                ? Math.max(
                    getLines(leftContentRef.current).length,
                    getLines(rightContentRef.current).length
                )
                : getLines(unifiedContentRef.current).length;

            // Process as many lines as accumulated time allows — correctly handles fast speeds
            while (accumulatedTime >= speedRef.current && currentLineRef.current < currentMax) {
                accumulatedTime -= speedRef.current;
                const idx = currentLineRef.current;

                if (viewMode === 'split') {
                    const leftLines = getLines(leftContentRef.current);
                    const rightLines = getLines(rightContentRef.current);
                    if (idx < leftLines.length) {
                        const line = leftLines[idx];
                        targetScrollRef.current = computeTargetScrollTop(
                            line.offsetTop, line.offsetHeight, leftContentRef.current?.clientHeight ?? 0
                        );
                    } else if (idx < rightLines.length) {
                        const line = rightLines[idx];
                        targetScrollRef.current = computeTargetScrollTop(
                            line.offsetTop, line.offsetHeight, rightContentRef.current?.clientHeight ?? 0
                        );
                    }
                } else {
                    const lines = getLines(unifiedContentRef.current);
                    if (idx < lines.length) {
                        const line = lines[idx];
                        targetScrollRef.current = computeTargetScrollTop(
                            line.offsetTop, line.offsetHeight, unifiedContentRef.current?.clientHeight ?? 0
                        );
                    }
                }

                currentLineRef.current++;
            }

            // Batch React state update once per frame for performance
            setAnimatedUpTo(currentLineRef.current);

            if (currentLineRef.current >= currentMax && currentMax > 0) {
                // Iteration complete — pause then auto-advance
                currentLineRef.current = 0;
                isAutoScrollingRef.current = false;
                setTimeout(() => {
                    if (generation !== animGenRef.current || !isPlayingRef.current) return;
                    setCurrentIteration(prev => {
                        if (prev < contentStates.length - 1) {
                            setTimeout(() => {
                                if (isPlayingRef.current) startAnimation();
                            }, 400);
                            return prev + 1;
                        } else {
                            isPlayingRef.current = false;
                            setIsPlaying(false);
                            return prev;
                        }
                    });
                }, 800);
                return;
            }

            // Smooth scroll towards target
            const lerp = computeAdaptiveLerp(delta);
            const scrollDiff = targetScrollRef.current - currentScrollRef.current;
            if (Math.abs(scrollDiff) > 0.5) {
                currentScrollRef.current += scrollDiff * lerp;
                const scrollVal = currentScrollRef.current;
                if (viewMode === 'split') {
                    if (leftContentRef.current) leftContentRef.current.scrollTop = scrollVal;
                    if (rightContentRef.current) rightContentRef.current.scrollTop = scrollVal;
                } else {
                    if (unifiedContentRef.current) unifiedContentRef.current.scrollTop = scrollVal;
                }
            }

            animFrameRef.current = requestAnimationFrame(tick);
        };

        animFrameRef.current = requestAnimationFrame(tick);
    }, [viewMode, currentIteration, contentStates.length]);

    const stopAnimation = useCallback(() => {
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = null;
        }
        isAutoScrollingRef.current = false;
    }, []);

    const handleTogglePlayback = useCallback(() => {
        const next = !isPlayingRef.current;
        isPlayingRef.current = next;
        setIsPlaying(next);
        if (next) {
            startAnimation();
        } else {
            stopAnimation();
        }
    }, [startAnimation, stopAnimation]);

    const handleNext = useCallback(() => {
        if (currentIteration >= contentStates.length - 1) return;
        const wasPlaying = isPlayingRef.current;
        const progressPct = computeProgressPercent(currentLineRef.current, totalLines);

        stopAnimation();
        if (wasPlaying) { isPlayingRef.current = false; setIsPlaying(false); }

        setCurrentIteration(prev => {
            const next = prev + 1;
            // Restore position after render
            setTimeout(() => {
                const newTotal = viewMode === 'split'
                    ? Math.max(
                        leftContentRef.current?.querySelectorAll('.sequential-line').length ?? 0,
                        rightContentRef.current?.querySelectorAll('.sequential-line').length ?? 0
                    )
                    : unifiedContentRef.current?.querySelectorAll('.sequential-line').length ?? 0;
                const restored = computeRestoredLineIndex(progressPct, newTotal);
                currentLineRef.current = restored;
                setAnimatedUpTo(restored);
                if (wasPlaying) {
                    isPlayingRef.current = true;
                    setIsPlaying(true);
                    startAnimation();
                }
            }, 50);
            return next;
        });
    }, [currentIteration, contentStates.length, stopAnimation, startAnimation, viewMode, totalLines]);

    const handlePrev = useCallback(() => {
        if (currentIteration <= 0) return;
        const wasPlaying = isPlayingRef.current;
        const progressPct = computeProgressPercent(currentLineRef.current, totalLines);

        stopAnimation();
        if (wasPlaying) { isPlayingRef.current = false; setIsPlaying(false); }

        setCurrentIteration(prev => {
            const next = prev - 1;
            setTimeout(() => {
                const newTotal = viewMode === 'split'
                    ? Math.max(
                        leftContentRef.current?.querySelectorAll('.sequential-line').length ?? 0,
                        rightContentRef.current?.querySelectorAll('.sequential-line').length ?? 0
                    )
                    : unifiedContentRef.current?.querySelectorAll('.sequential-line').length ?? 0;
                const restored = computeRestoredLineIndex(progressPct, newTotal);
                currentLineRef.current = restored;
                setAnimatedUpTo(restored);
                if (wasPlaying) {
                    isPlayingRef.current = true;
                    setIsPlaying(true);
                    startAnimation();
                }
            }, 50);
            return next;
        });
    }, [currentIteration, stopAnimation, startAnimation, viewMode, totalLines]);

    const handleSpeedChange = useCallback((ms: number) => {
        speedRef.current = ms;
        setSpeedMs(ms);
        // Restart the loop immediately so the new speed takes effect on the next frame
        // rather than waiting for the old accumulated time to drain
        if (isPlayingRef.current) {
            startAnimation();
        }
    }, [startAnimation]);

    const handleToggleViewMode = useCallback(() => {
        const wasPlaying = isPlayingRef.current;
        if (wasPlaying) {
            isPlayingRef.current = false;
            setIsPlaying(false);
            stopAnimation();
        }
        setViewMode(prev => prev === 'split' ? 'unified' : 'split');
        if (wasPlaying) {
            setTimeout(() => {
                isPlayingRef.current = true;
                setIsPlaying(true);
                startAnimation();
            }, 50);
        }
    }, [stopAnimation, startAnimation]);

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div id="sequential-viewer-overlay" className="sequential-viewer-overlay visible">
            <div className="sequential-viewer-container">
                {/* Header */}
                <div className="sequential-viewer-header">
                    <div className="sequential-header-content">
                        <Icon name="subscriptions" className="sequential-icon" />
                        <div className="sequential-title-group">
                            <h2 className="sequential-title">Sequential Evolution Playback</h2>
                            <span className="sequential-subtitle" id="iteration-indicator">
                                {currentState.title || `Iteration ${currentIteration + 1}`}
                            </span>
                        </div>
                    </div>
                    <div className="sequential-header-actions">
                        <button
                            className="sequential-view-toggle-button"
                            id="sequential-view-toggle-btn"
                            title="Toggle View Mode"
                            onClick={handleToggleViewMode}
                        >
                            <Icon name={viewMode === 'split' ? 'view_column' : 'view_agenda'} />
                            <span className="button-text">
                                {viewMode === 'split' ? 'Unified View' : 'Split View'}
                            </span>
                        </button>
                        <button
                            className="sequential-close-button"
                            id="sequential-close-btn"
                            onClick={onClose}
                        >
                            <Icon name="close" />
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="sequential-content-area" id="sequential-content-area">
                    {viewMode === 'split'
                        ? <SplitView
                            leftLines={prevState ? splitResult.leftLines : []}
                            rightLines={prevState ? splitResult.rightLines : computeInitialLines(currentState.content)}
                            prevTitle={prevState ? prevState.title : 'Initial State'}
                            currentTitle={currentState.title}
                            animatedUpTo={animatedUpTo}
                            leftRef={leftContentRef}
                            rightRef={rightContentRef}
                        />
                        : <UnifiedView
                            lines={unifiedLines}
                            animatedUpTo={animatedUpTo}
                            contentRef={unifiedContentRef}
                        />
                    }
                </div>

                {/* Progress Bar */}
                <div className="sequential-progress-container">
                    <div className="sequential-progress-bar">
                        <div
                            className="sequential-progress-fill"
                            id="sequential-progress-fill"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Controls */}
                <div className="sequential-controls">
                    <div className="sequential-controls-left">
                        <button
                            className="sequential-control-btn"
                            id="seq-prev-btn"
                            title="Previous Iteration (←)"
                            onClick={handlePrev}
                            disabled={currentIteration === 0}
                        >
                            <Icon name="skip_previous" />
                        </button>
                        <button
                            className="sequential-control-btn sequential-play-btn"
                            id="seq-play-btn"
                            title="Play/Pause (Space)"
                            onClick={handleTogglePlayback}
                        >
                            <Icon name={isPlaying ? 'pause' : 'play_arrow'} />
                        </button>
                        <button
                            className="sequential-control-btn"
                            id="seq-next-btn"
                            title="Next Iteration (→)"
                            onClick={handleNext}
                            disabled={currentIteration === contentStates.length - 1}
                        >
                            <Icon name="skip_next" />
                        </button>
                    </div>
                    <div className="sequential-controls-right">
                        <span className="speed-label">Speed:</span>
                        {SPEED_OPTIONS.map(opt => (
                            <button
                                key={opt.ms}
                                className={`sequential-speed-btn${speedMs === opt.ms ? ' active' : ''}`}
                                data-speed={opt.ms}
                                title={opt.label}
                                onClick={() => handleSpeedChange(opt.ms)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Imperative Portal API ────────────────────────────────────────────────────

export function openSequentialViewer(contentStates: Array<{ title: string; content: string }>): void {
    if (!contentStates || contentStates.length === 0) return;

    const rootId = 'sequential-viewer-root';
    unmountPortalRoot(rootId);

    const root = getOrCreatePortalRoot(rootId);
    root.render(
        <SequentialViewerModal
            contentStates={contentStates}
            onClose={() => unmountPortalRoot(rootId)}
        />
    );
}
