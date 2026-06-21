import React, { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { Icon } from '../UI/Icons';
import { globalState } from '../Core/State';
import { GitDiffView } from '../Styles/Components/DiffModal/GitDiffView';
import './DeepthinkFilesystemTab.css';

interface CommitItem {
    hash: string;
    date: string;
    message: string;
}

interface FileItem {
    path: string;
    size: number;
    mtime: number;
}

interface TreeFolder {
    name: string;
    type: 'folder';
    children: Record<string, TreeNode>;
}

interface TreeFile {
    name: string;
    type: 'file';
    path: string;
    size: number;
    mtime: number;
}

type TreeNode = TreeFolder | TreeFile;
type ExplorerView = 'file' | 'diff';

const IGNORED_NAMES = new Set([
    'venv', 'env', '.venv', 'node_modules', '__pycache__', '.git', '.cache',
    '.local', '.matplotlib', '.python_user_base', '.ipynb_checkpoints', '.tmp',
]);

function getMediaFileType(filename: string): 'image' | 'video' | 'audio' | 'pdf' | null {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return null;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video';
    if (['mp3', 'wav'].includes(ext)) return 'audio';
    return ext === 'pdf' ? 'pdf' : null;
}

function buildFileTree(files: FileItem[]): TreeFolder {
    const root: TreeFolder = { name: '', type: 'folder', children: {} };
    for (const file of files) {
        const parts = file.path.split('/');
        if (parts.some(part => part.startsWith('.') || IGNORED_NAMES.has(part.toLowerCase()))) continue;

        let current = root;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                current.children[part] = { name: part, type: 'file', path: file.path, size: file.size, mtime: file.mtime };
                return;
            }
            if (!current.children[part] || current.children[part].type !== 'folder') {
                current.children[part] = { name: part, type: 'folder', children: {} };
            }
            current = current.children[part] as TreeFolder;
        });
    }
    return root;
}

function getLanguageExtension(filename: string) {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'js': case 'jsx': case 'ts': case 'tsx': return [javascript()];
        case 'py': return [python()];
        case 'css': return [css()];
        case 'html': case 'htm': return [html()];
        case 'json': return [json()];
        case 'md': return [markdown()];
        case 'rs': return [rust()];
        case 'c': case 'cpp': case 'h': case 'hpp': case 'cc': return [cpp()];
        case 'go': return [go()];
        case 'yaml': case 'yml': return [yaml()];
        case 'sql': return [sql()];
        case 'sh': case 'bash': case 'zsh': return [StreamLanguage.define(shell)];
        default:
            return filename.toLowerCase().endsWith('rc') || filename.toLowerCase().includes('profile')
                ? [StreamLanguage.define(shell)]
                : [];
    }
}

function activeDeepthinkRepositoryId(): string {
    return globalState.activeDeepthinkPipeline?.id || '';
}

export const DeepthinkFilesystemTab: React.FC = () => {
    const [repositoryId, setRepositoryId] = useState('');
    const [history, setHistory] = useState<CommitItem[]>([]);
    const [selectedCommit, setSelectedCommit] = useState('current');
    const [compareBase, setCompareBase] = useState('current');
    const [compareHead, setCompareHead] = useState('current');
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selectedFile, setSelectedFile] = useState('');
    const [fileContent, setFileContent] = useState('');
    const [diffContent, setDiffContent] = useState('');
    const [view, setView] = useState<ExplorerView>('file');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isTreeLoading, setIsTreeLoading] = useState(false);
    const [isContentLoading, setIsContentLoading] = useState(false);
    const [isDiffLoading, setIsDiffLoading] = useState(false);
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    const [theme, setTheme] = useState<'light' | 'dark'>(() => document.body.classList.contains('light-mode') ? 'light' : 'dark');
    const treeRequest = useRef(0);

    const fetchFileTree = async (id: string, commit: string) => {
        const requestId = ++treeRequest.current;
        setIsTreeLoading(true);
        try {
            const response = await fetch(`/api/sandbox/workspace/files?repositoryId=${encodeURIComponent(id)}&commit=${encodeURIComponent(commit)}&scope=repository`);
            if (!response.ok || requestId !== treeRequest.current) return;
            const nextFiles = await response.json() as FileItem[];
            if (requestId !== treeRequest.current) return;
            setFiles(nextFiles);
            setCollapsedFolders({});
            setSelectedFile(current => {
                if (current && nextFiles.some(file => file.path === current)) return current;
                setFileContent('');
                return '';
            });
        } catch (error) {
            console.error('Failed to load Results repository tree:', error);
        } finally {
            if (requestId === treeRequest.current) setIsTreeLoading(false);
        }
    };

    const fetchHistory = async (id: string) => {
        try {
            const response = await fetch(`/api/sandbox/workspace/history?repositoryId=${encodeURIComponent(id)}`);
            if (!response.ok) return;
            const nextHistory = await response.json() as CommitItem[];
            setHistory(nextHistory);
            setCompareBase(current => current === 'current' && nextHistory.length ? nextHistory[nextHistory.length - 1].hash : current);
        } catch (error) {
            console.error('Failed to load Results repository history:', error);
        }
    };

    const refreshRepository = async (id = repositoryId, commit = selectedCommit) => {
        if (!id) return;
        setIsRefreshing(true);
        try {
            await Promise.all([fetchHistory(id), fetchFileTree(id, commit)]);
        } finally {
            setIsRefreshing(false);
        }
    };

    const fetchFileContent = async (id: string, filePath: string, commit: string) => {
        setIsContentLoading(true);
        try {
            const response = await fetch(`/api/sandbox/workspace/file?repositoryId=${encodeURIComponent(id)}&path=${encodeURIComponent(filePath)}&commit=${encodeURIComponent(commit)}&scope=repository`);
            setFileContent(response.ok ? await response.text() : 'This file does not exist in the selected snapshot.');
        } catch (error) {
            console.error('Failed to load Results repository file:', error);
            setFileContent('Failed to load file content.');
        } finally {
            setIsContentLoading(false);
        }
    };

    const compareRevisions = async () => {
        if (!repositoryId) return;
        setIsDiffLoading(true);
        try {
            const response = await fetch(`/api/sandbox/workspace/diff?repositoryId=${encodeURIComponent(repositoryId)}&base=${encodeURIComponent(compareBase)}&head=${encodeURIComponent(compareHead)}`);
            setDiffContent(response.ok ? (await response.text() || 'These snapshots have no differences.') : 'Unable to load this repository comparison.');
            setView('diff');
            setIsCompareOpen(false);
        } catch (error) {
            console.error('Failed to compare Results repository snapshots:', error);
            setDiffContent('Unable to load this repository comparison.');
            setView('diff');
            setIsCompareOpen(false);
        } finally {
            setIsDiffLoading(false);
        }
    };

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(document.body.classList.contains('light-mode') ? 'light' : 'dark'));
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    // The filesystem is a first-class Deepthink tab, not a card inside one.
    // Let it own the available pipeline surface while this tab is mounted.
    useEffect(() => {
        const container = document.getElementById('pipelines-content-container');
        container?.classList.add('filesystem-active');
        return () => container?.classList.remove('filesystem-active');
    }, []);

    useEffect(() => {
        const id = activeDeepthinkRepositoryId();
        setRepositoryId(id);
        setSelectedCommit('current');
        setCompareBase('current');
        setCompareHead('current');
        setView('file');
        if (id) void refreshRepository(id, 'current');
    }, []);

    // Switching between Deepthink runs must switch the explorer's repository
    // immediately; it is not a timed refresh and never reuses another run's tree.
    useEffect(() => {
        const syncActiveRepository = () => {
            const id = activeDeepthinkRepositoryId();
            if (id === repositoryId) return;
            setRepositoryId(id);
            setSelectedCommit('current');
            setCompareBase('current');
            setCompareHead('current');
            setSelectedFile('');
            setFileContent('');
            setDiffContent('');
            setView('file');
            setFiles([]);
            if (id) void refreshRepository(id, 'current');
        };
        window.addEventListener('deepthinkPipelineUpdated', syncActiveRepository);
        return () => window.removeEventListener('deepthinkPipelineUpdated', syncActiveRepository);
    }, [repositoryId]);

    useEffect(() => {
        const onSnapshot = (event: Event) => {
            const id = (event as CustomEvent<{ repositoryId?: string }>).detail?.repositoryId;
            if (id && id === repositoryId) void refreshRepository(id);
        };
        window.addEventListener('deepthinkResultsSnapshot', onSnapshot);
        return () => window.removeEventListener('deepthinkResultsSnapshot', onSnapshot);
    }, [repositoryId, selectedCommit]);

    useEffect(() => {
        if (repositoryId) void fetchFileTree(repositoryId, selectedCommit);
    }, [repositoryId, selectedCommit]);

    useEffect(() => {
        if (!repositoryId || !selectedFile || view !== 'file') return;
        if (getMediaFileType(selectedFile)) {
            setFileContent('');
            return;
        }
        void fetchFileContent(repositoryId, selectedFile, selectedCommit);
    }, [repositoryId, selectedFile, selectedCommit, view]);

    const toggleFolder = (folderPath: string) => {
        setCollapsedFolders(current => ({ ...current, [folderPath]: !(current[folderPath] !== false) }));
    };

    const renderTreeNodes = (node: TreeNode, parentPath = ''): React.ReactNode => {
        if (node.type !== 'folder') return null;
        const names = Object.keys(node.children).sort((left, right) => {
            const a = node.children[left];
            const b = node.children[right];
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return left.localeCompare(right);
        });
        return names.map(name => {
            const child = node.children[name];
            const currentPath = parentPath ? `${parentPath}/${name}` : name;
            if (child.type === 'folder') {
                const isCollapsed = collapsedFolders[currentPath] !== false;
                return (
                    <div key={currentPath} className="tree-folder-wrapper">
                        <button className="tree-node tree-folder" type="button" onClick={() => toggleFolder(currentPath)}>
                            <span className={`tree-chevron ${isCollapsed ? '' : 'is-open'}`}><Icon name="chevron_right" /></span>
                            <Icon name="folder" />
                            <span className="tree-label">{child.name}</span>
                        </button>
                        {!isCollapsed && <div className="tree-folder-children">{renderTreeNodes(child, currentPath)}</div>}
                    </div>
                );
            }
            return (
                <button
                    key={currentPath}
                    className={`tree-node tree-file ${selectedFile === child.path && view === 'file' ? 'selected' : ''}`}
                    type="button"
                    onClick={() => { setSelectedFile(child.path); setView('file'); }}
                >
                    <span className="tree-file-spacer" />
                    <Icon name="file" />
                    <span className="tree-label">{child.name}</span>
                </button>
            );
        });
    };

    const revisionLabel = (revision: string) => {
        if (revision === 'current') return 'Current snapshot';
        const commit = history.find(item => item.hash === revision);
        return commit ? `${commit.message} · ${commit.hash.slice(0, 7)}` : revision.slice(0, 7);
    };

    const revisionOptions = (
        <>
            <option value="current">Current snapshot</option>
            {history.map(commit => <option key={commit.hash} value={commit.hash}>{commit.message} · {commit.hash.slice(0, 7)}</option>)}
        </>
    );
    const fileTree = buildFileTree(files);
    const mediaType = selectedFile ? getMediaFileType(selectedFile) : null;
    const fileUrl = selectedFile
        ? `/api/sandbox/workspace/file?repositoryId=${encodeURIComponent(repositoryId)}&path=${encodeURIComponent(selectedFile)}&commit=${encodeURIComponent(selectedCommit)}&scope=repository`
        : '';

    return (
            <div className="vfs-filesystem-tab">
                <div className="vfs-modal-body">
                    {!repositoryId ? (
                        <div className="vfs-empty-state"><h3>No Deepthink Results Repository</h3><p>Start a sandboxed Deepthink run to create and inspect its Results repository.</p></div>
                    ) : (
                        <div className="vfs-split-layout">
                            <aside className="vfs-sidebar">
                                <div className="vfs-sidebar-title">Files</div>
                                <div className="vfs-tree-container custom-scrollbar">
                                    {isTreeLoading ? <div className="vfs-tree-empty">Loading…</div> : files.length ? renderTreeNodes(fileTree) : <div className="vfs-tree-empty">No files in this snapshot</div>}
                                </div>
                                <div className="vfs-sidebar-footer">
                                    <div className="vfs-sidebar-footer-row">
                                        <div className="vfs-agent-select-wrapper" style={{ width: '100%' }}>
                                            <select aria-label="Browse repository snapshot" title="Browse repository snapshot" value={selectedCommit} onChange={event => { setSelectedCommit(event.target.value); setView('file'); }} className="vfs-agent-select">
                                                {revisionOptions}
                                            </select>
                                            <span className="vfs-select-arrow"><Icon name="chevron_down" /></span>
                                        </div>
                                    </div>
                                    <div className="vfs-sidebar-footer-row">
                                        <button className="vfs-compare-trigger-footer" type="button" onClick={() => setIsCompareOpen(true)} disabled={!history.length}>
                                            <Icon name="compare" /> <span>Compare</span>
                                        </button>
                                        <button className="vfs-refresh-btn-footer" type="button" title="Refresh repository" onClick={() => void refreshRepository()} disabled={isRefreshing}>
                                            <Icon name="refresh" className={isRefreshing ? 'spinning' : ''} />
                                        </button>
                                    </div>
                                </div>
                            </aside>
                            <main className="vfs-editor-area">
                                {view === 'diff' ? (
                                    <div className="vfs-editor-wrapper">
                                        <div className="vfs-editor-header"><div className="vfs-file-info">{revisionLabel(compareBase)} → {revisionLabel(compareHead)}</div><button className="vfs-inline-action" type="button" onClick={() => setView('file')}>Files</button></div>
                                        <GitDiffView diff={diffContent} />
                                    </div>
                                ) : selectedFile ? (
                                    <div className="vfs-editor-wrapper">
                                        <div className="vfs-editor-header"><div className="vfs-file-info"><Icon name="file" /><span className="vfs-file-path">{selectedFile}</span></div></div>
                                        <div className={`vfs-code-viewport custom-scrollbar ${mediaType ? 'has-media' : ''}`}>
                                            {isContentLoading ? <div className="vfs-code-loading">Loading file…</div> : (
                                                mediaType === 'image' ? <div className="vfs-media-preview img-preview"><img src={fileUrl} alt={selectedFile} /></div>
                                                    : mediaType === 'video' ? <div className="vfs-media-preview video-preview"><video src={fileUrl} controls /></div>
                                                        : mediaType === 'audio' ? <div className="vfs-media-preview audio-preview"><audio src={fileUrl} controls /></div>
                                                            : mediaType === 'pdf' ? <iframe src={fileUrl} title={selectedFile} className="vfs-pdf-preview" />
                                                                : <CodeMirror key={`${selectedCommit}:${selectedFile}`} value={fileContent} height="100%" extensions={getLanguageExtension(selectedFile)} readOnly theme={theme} className="vfs-codemirror-wrapper" />
                                            )}
                                        </div>
                                    </div>
                                ) : <div className="vfs-editor-placeholder"><h3>No File Selected</h3><p>Expand a folder and select a file.</p></div>}
                            </main>
                        </div>
                    )}
                </div>

                {isCompareOpen && (
                    <div className="vfs-compare-overlay" onClick={() => setIsCompareOpen(false)}>
                        <div className="vfs-compare-dialog" onClick={event => event.stopPropagation()}>
                            <h3>Compare snapshots</h3>
                            <label>From<select value={compareBase} onChange={event => setCompareBase(event.target.value)} className="vfs-version-select">{revisionOptions}</select></label>
                            <label>To<select value={compareHead} onChange={event => setCompareHead(event.target.value)} className="vfs-version-select">{revisionOptions}</select></label>
                            <div className="vfs-compare-dialog-actions"><button className="vfs-inline-action" type="button" onClick={() => setIsCompareOpen(false)}>Cancel</button><button className="vfs-compare-button" type="button" onClick={() => void compareRevisions()} disabled={isDiffLoading || compareBase === compareHead}>{isDiffLoading ? 'Loading…' : 'Compare'}</button></div>
                        </div>
                    </div>
                )}
            </div>
    );
};

export default DeepthinkFilesystemTab;
