import React, { useEffect, useRef } from 'react';
import { html as renderDiffHtml } from 'diff2html';
import { applyCustomThemeToD2H } from './utils';
import './EvolutionViewer.css';

interface GitDiffViewProps {
    diff: string;
}

/** Reuses the application's Diff2Html theme for repository-level Git diffs. */
export const GitDiffView: React.FC<GitDiffViewProps> = ({ diff }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!diff.trim()) {
            container.innerHTML = '<div class="git-diff-empty">These snapshots have no text-file differences.</div>';
            return;
        }

        container.innerHTML = renderDiffHtml(diff, {
            drawFileList: false,
            outputFormat: 'side-by-side',
            matching: 'lines',
            renderNothingWhenEmpty: true,
        });
        applyCustomThemeToD2H(container);
    }, [diff]);

    return <div ref={containerRef} className="evolution-diff-wrapper git-diff-view custom-scrollbar" />;
};

export default GitDiffView;
