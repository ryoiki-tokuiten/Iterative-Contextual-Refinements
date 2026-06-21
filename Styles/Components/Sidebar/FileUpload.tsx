import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './FileUpload.css';
import { Icon } from '../../../UI/Icons';
import { getProviderForCurrentModel, getRoutingManager, getSelectedModel } from '../../../Routing';
import {
    FileData,
    ACCEPTED_FILES,
    getFileConfig,
    isImage,
    isText,
    formatFileSize,
    calculateTotalSize,
    isSizeWarning,
    decodeBase64Content,
    processFiles,
    updateGlobalStateWithFiles,
    clearGlobalStateFiles,
    resetFileInput,
    countFileTokens,
    getMediaCounts,
    DIRECT_CONTEXT_TOKEN_LIMIT,
    DIRECT_CONTEXT_MEDIA_LIMITS,
} from './FileUploadLogic';

type ImageCapabilityNotice = {
    status: 'supported' | 'unsupported' | 'unverified';
    message: string;
};

function getImageCapabilityNotice(): ImageCapabilityNotice | null {
    const provider = getProviderForCurrentModel();
    if (provider !== 'openrouter' && provider !== 'nvidia' && provider !== 'local') return null;

    const model = getSelectedModel();
    const support = getRoutingManager()
        .getApiKeyManager()
        .getProviderManager()
        .getImageInputSupportForModel(model);
    const providerLabel = provider === 'openrouter' ? 'OpenRouter' : provider === 'nvidia' ? 'NVIDIA' : 'Local model';

    if (support === true) {
        return {
            status: 'supported',
            message: `${providerLabel} confirms ${model} accepts native image input. Tool support and image limits are separate.`,
        };
    }

    if (support === false) {
        return {
            status: 'unsupported',
            message: `${providerLabel} reports ${model} does not accept image input. The request will likely fail.`,
        };
    }

    return {
        status: 'unverified',
        message: `${providerLabel} does not expose a reliable vision capability for ${model}. The image will still be sent natively.`,
    };
}

const FilePreviewModal: React.FC<{
    file: FileData;
    onClose: () => void;
}> = ({ file, onClose }) => {
    const config = getFileConfig(file.mimeType, file.name);

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    const getTextContent = () => {
        return decodeBase64Content(file.base64);
    };

    return (
        <div className="file-preview-modal-overlay" onClick={onClose}>
            <div className="file-preview-modal" onClick={e => e.stopPropagation()}>
                <div className="preview-modal-header">
                    <div className="preview-file-info">
                        <Icon name={config.icon} style={{ color: config.color }} />
                        <span className="preview-file-name">{file.name}</span>
                        <span className="preview-file-badge" style={{ backgroundColor: `${config.color}20`, color: config.color }}>
                            {config.label}
                        </span>
                    </div>
                    <button className="preview-close-btn" onClick={onClose} title="Close (Esc)">
                        <Icon name="close" />
                    </button>
                </div>

                <div className="preview-modal-content">
                    {isImage(file.mimeType) && (
                        <div className="preview-image-container">
                            <img
                                src={`data:${file.mimeType};base64,${file.base64}`}
                                alt={file.name}
                                className="preview-image"
                            />
                        </div>
                    )}

                    {isText(file.mimeType) && (
                        <pre className="preview-code">
                            <code>{getTextContent()}</code>
                        </pre>
                    )}

                    {!isImage(file.mimeType) && !isText(file.mimeType) && (
                        <div className="preview-unsupported">
                            <Icon name={config.icon} style={{ fontSize: '4rem', color: config.color }} />
                            <p>Preview not available for this file type</p>
                            <a
                                href={`data:${file.mimeType};base64,${file.base64}`}
                                download={file.name}
                                className="preview-download-btn"
                            >
                                <Icon name="download" />
                                Download File
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const FileUpload: React.FC = () => {
    const [directFiles, setDirectFiles] = useState<FileData[]>([]);
    const [filesystemFiles, setFilesystemFiles] = useState<FileData[]>([]);
    const [draggingTarget, setDraggingTarget] = useState<'direct' | 'filesystem' | null>(null);
    const [draggedFile, setDraggedFile] = useState<{
        source: 'direct' | 'filesystem';
        index: number;
        file: FileData;
    } | null>(null);
    const [previewFile, setPreviewFile] = useState<FileData | null>(null);
    const directInputRef = useRef<HTMLInputElement>(null);
    const filesystemInputRef = useRef<HTMLInputElement>(null);
    const pointerDragStart = useRef<{ source: 'direct' | 'filesystem'; index: number; file: FileData; x: number; y: number } | null>(null);
    const didPointerDrag = useRef(false);
    const dragGhostRef = useRef<HTMLDivElement>(null);
    const dragPosition = useRef({ x: 0, y: 0 });
    const dragTarget = useRef<'direct' | 'filesystem' | null>(null);
    const [, setModelCapabilityRevision] = useState(0);

    React.useEffect(() => {
        const refreshCapability = () => setModelCapabilityRevision(revision => revision + 1);
        const providerManager = getRoutingManager().getApiKeyManager().getProviderManager();
        window.addEventListener('selectedModelChanged', refreshCapability);
        providerManager.addModelUpdateListener(refreshCapability);

        return () => {
            window.removeEventListener('selectedModelChanged', refreshCapability);
            providerManager.removeModelUpdateListener(refreshCapability);
        };
    }, []);

    React.useLayoutEffect(() => {
        if (draggedFile && dragGhostRef.current) {
            dragGhostRef.current.style.transform = `translate3d(${dragPosition.current.x + 14}px, ${dragPosition.current.y + 14}px, 0)`;
        }
    }, [draggedFile]);

    const syncFiles = useCallback((nextDirect: FileData[], nextFilesystem: FileData[]) => {
        setDirectFiles(nextDirect);
        setFilesystemFiles(nextFilesystem);
        updateGlobalStateWithFiles(nextDirect, nextFilesystem);
    }, []);

    const handleFiles = useCallback(async (fileList: FileList | File[], target: 'direct' | 'filesystem') => {
        try {
            const newFiles = await processFiles(fileList);
            syncFiles(
                target === 'direct' ? [...directFiles, ...newFiles] : directFiles,
                target === 'filesystem' ? [...filesystemFiles, ...newFiles] : filesystemFiles,
            );
        } catch (error) {
            console.error('Error processing files:', error);
        }
    }, [directFiles, filesystemFiles, syncFiles]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, target: 'direct' | 'filesystem') => {
        if (event.target.files) {
            handleFiles(event.target.files, target);
        }
        resetFileInput(target === 'direct' ? directInputRef : filesystemInputRef);
    };

    const handleDragOver = useCallback((e: React.DragEvent, target: 'direct' | 'filesystem') => {
        e.preventDefault();
        e.stopPropagation();
        dragTarget.current = target;
        setDraggingTarget(previous => previous === target ? previous : target);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        dragTarget.current = null;
        setDraggingTarget(null);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, target: 'direct' | 'filesystem') => {
        e.preventDefault();
        e.stopPropagation();
        setDraggingTarget(null);
        setDraggedFile(null);

        if (e.dataTransfer.files?.length > 0) {
            handleFiles(e.dataTransfer.files, target);
            return;
        }
        const source = e.dataTransfer.getData('application/x-iterative-studio-upload');
        const index = Number(e.dataTransfer.getData('text/plain'));
        if ((source === 'direct' || source === 'filesystem') && Number.isInteger(index) && source !== target) {
            const sourceFiles = source === 'direct' ? directFiles : filesystemFiles;
            const file = sourceFiles[index];
            if (!file) return;
            syncFiles(
                source === 'direct' ? directFiles.filter((_, i) => i !== index) : [...directFiles, file],
                source === 'filesystem' ? filesystemFiles.filter((_, i) => i !== index) : [...filesystemFiles, file],
            );
        }
    }, [directFiles, filesystemFiles, handleFiles, syncFiles]);

    const moveFile = useCallback((source: 'direct' | 'filesystem', target: 'direct' | 'filesystem', index: number) => {
        if (source === target) return;
        const sourceFiles = source === 'direct' ? directFiles : filesystemFiles;
        const file = sourceFiles[index];
        if (!file) return;
        syncFiles(
            source === 'direct' ? directFiles.filter((_, i) => i !== index) : [...directFiles, file],
            source === 'filesystem' ? filesystemFiles.filter((_, i) => i !== index) : [...filesystemFiles, file],
        );
    }, [directFiles, filesystemFiles, syncFiles]);

    const sectionAtPoint = (x: number, y: number): 'direct' | 'filesystem' | null => {
        const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-upload-section]');
        const section = element?.dataset.uploadSection;
        return section === 'direct' || section === 'filesystem' ? section : null;
    };

    const finishPointerDrag = () => {
        pointerDragStart.current = null;
        dragTarget.current = null;
        setDraggedFile(null);
        setDraggingTarget(null);
        document.body.style.userSelect = '';
    };

    const handleCardPointerDown = (event: React.PointerEvent<HTMLDivElement>, source: 'direct' | 'filesystem', index: number, file: FileData) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        didPointerDrag.current = false;
        pointerDragStart.current = { source, index, file, x: event.clientX, y: event.clientY };
    };

    const handleCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const start = pointerDragStart.current;
        if (!start) return;
        const hasStarted = didPointerDrag.current;
        if (!hasStarted && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 7) return;

        if (!hasStarted) {
            event.currentTarget.setPointerCapture(event.pointerId);
            didPointerDrag.current = true;
            document.body.style.userSelect = 'none';
        }

        const target = sectionAtPoint(event.clientX, event.clientY);
        const nextTarget = target && target !== start.source ? target : null;
        if (dragTarget.current !== nextTarget) {
            dragTarget.current = nextTarget;
            setDraggingTarget(nextTarget);
        }
        dragPosition.current = { x: event.clientX, y: event.clientY };
        if (dragGhostRef.current) {
            dragGhostRef.current.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
        }
        if (!draggedFile) setDraggedFile({ source: start.source, index: start.index, file: start.file });
    };

    const handleCardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const start = pointerDragStart.current;
        const target = sectionAtPoint(event.clientX, event.clientY);
        if (start && didPointerDrag.current && target) moveFile(start.source, target, start.index);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        finishPointerDrag();
    };

    const removeFile = (section: 'direct' | 'filesystem', index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        syncFiles(
            section === 'direct' ? directFiles.filter((_, i) => i !== index) : directFiles,
            section === 'filesystem' ? filesystemFiles.filter((_, i) => i !== index) : filesystemFiles,
        );
    };

    const clearAll = (section: 'direct' | 'filesystem') => {
        if (section === 'direct') syncFiles([], filesystemFiles);
        else syncFiles(directFiles, []);
        if (section === 'direct' && filesystemFiles.length === 0 || section === 'filesystem' && directFiles.length === 0) {
            clearGlobalStateFiles();
        }
    };

    const directTokens = countFileTokens(directFiles);
    const directMedia = getMediaCounts(directFiles);
    const imageCapabilityNotice = directMedia.images > 0 ? getImageCapabilityNotice() : null;
    const directLimitExceeded = directTokens > DIRECT_CONTEXT_TOKEN_LIMIT
        || directMedia.images > DIRECT_CONTEXT_MEDIA_LIMITS.images;
    const renderSection = (section: 'direct' | 'filesystem', files: FileData[], inputRef: React.RefObject<HTMLInputElement | null>) => {
        const isDirect = section === 'direct';
        const totalSize = calculateTotalSize(files);
        const sizeWarning = isSizeWarning(totalSize);
        return <section className={`upload-context-section ${isDirect ? 'direct-context-section' : 'filesystem-context-section'} ${draggingTarget === section ? 'is-file-drag-target' : ''}`} data-upload-section={section}>
            <div className="upload-context-heading">
                <div>
                    <h4>{isDirect ? 'Direct context' : 'Context through file-system'}</h4>
                </div>
            </div>
            <div
                className={`file-drop-zone ${!isDirect ? 'compact-upload-control' : ''} ${draggingTarget === section ? 'dragging' : ''} ${files.length > 0 ? 'has-files' : ''}`}
                onDragOver={(e) => handleDragOver(e, section)} onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, section)} onClick={() => inputRef.current?.click()}
            >
                <input type="file" ref={inputRef} onChange={(e) => handleFileChange(e, section)} accept={ACCEPTED_FILES} multiple style={{ display: 'none' }} />
                {isDirect && files.length === 0 ? <div className="drop-zone-content"><Icon name="cloud_upload" className="drop-icon" /><div className="drop-text"><span className="drop-primary">Drop files here or click to upload</span><span className="drop-secondary">Images, text, Markdown, data, and source code</span></div></div> : <div className="drop-zone-mini"><Icon name="add" /><span>Add more files</span></div>}
            </div>
            {isDirect && <div className={`context-limit-status ${directLimitExceeded ? 'limit-exceeded' : ''}`}><span>{directTokens.toLocaleString()} / {DIRECT_CONTEXT_TOKEN_LIMIT.toLocaleString()} text tokens</span><span>{directMedia.images}/{DIRECT_CONTEXT_MEDIA_LIMITS.images} images</span></div>}
            {isDirect && imageCapabilityNotice && <div className={`image-capability-indicator ${imageCapabilityNotice.status}`} role={imageCapabilityNotice.status === 'unsupported' ? 'alert' : 'status'}><Icon name={imageCapabilityNotice.status === 'supported' ? 'check_circle' : 'info'} /><span>{imageCapabilityNotice.message}</span></div>}
            {files.length > 0 && <div className="file-list-container scrollbar-compact"><div className="file-list-header"><span className="file-count">{files.length} file{files.length !== 1 ? 's' : ''} • {formatFileSize(totalSize)}</span><button className="clear-all-btn" onClick={() => clearAll(section)}><Icon name="delete_sweep" />Clear all</button></div>
                {sizeWarning && <div className="size-warning"><Icon name="warning" /><span>Large upload ({formatFileSize(totalSize)}). Some providers may reject requests over 20MB.</span></div>}
                <div className="file-grid">{files.map((file, idx) => {
                    const config = getFileConfig(file.mimeType, file.name);
                    const isDraggingThisFile = draggedFile?.source === section && draggedFile.index === idx;
                    return <div key={`${section}-${idx}-${file.name}`} className={`file-card ${isDraggingThisFile ? 'is-dragging' : ''}`} aria-label={file.name} onPointerDown={(event) => handleCardPointerDown(event, section, idx, file)} onPointerMove={handleCardPointerMove} onPointerUp={handleCardPointerUp} onPointerCancel={finishPointerDrag} onClick={() => { if (!didPointerDrag.current) setPreviewFile(file); }}>
                        <button className="file-remove-btn" onClick={(e) => removeFile(section, idx, e)} title="Remove file"><Icon name="close" /></button>
                        <div className="file-preview-thumb">{isImage(file.mimeType) ? <img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name} className="file-image" /> : <div className="file-icon-wrapper" style={{ backgroundColor: `${config.color}15` }}><Icon name={config.icon} className="file-type-icon" style={{ color: config.color }} /></div>}</div>
                        <div className="file-info"><span className="file-name">{file.name}</span><div className="file-meta"><span className="file-type-badge" style={{ backgroundColor: `${config.color}20`, color: config.color }}>{config.label}</span><span className="file-size">{formatFileSize(file.size)}</span></div></div>
                    </div>;
                })}</div>
            </div>}
        </section>;
    };

    return (
        <>
            <div className="file-upload-wrapper">
                {renderSection('direct', directFiles, directInputRef)}
                {renderSection('filesystem', filesystemFiles, filesystemInputRef)}
            </div>

            {draggedFile && createPortal(
                <div ref={dragGhostRef} className="file-drag-ghost">
                    <Icon name={getFileConfig(draggedFile.file.mimeType, draggedFile.file.name).icon} />
                    <span>{draggedFile.file.name}</span>
                </div>,
                document.body
            )}

            {previewFile && createPortal(
                <FilePreviewModal
                    file={previewFile}
                    onClose={() => setPreviewFile(null)}
                />,
                document.body
            )}
        </>
    );
};
