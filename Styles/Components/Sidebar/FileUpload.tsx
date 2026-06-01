import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './FileUpload.css';
import { Icon } from '../../../UI/Icons';
import {
    FileData,
    ACCEPTED_FILES,
    getFileConfig,
    isImage,
    isVideo,
    isPdf,
    isText,
    formatFileSize,
    calculateTotalSize,
    isSizeWarning,
    decodeBase64Content,
    processFiles,
    updateGlobalStateWithFiles,
    clearGlobalStateFiles,
    resetFileInput,
} from './FileUploadLogic';

const FilePreviewModal: React.FC<{
    file: FileData;
    onClose: () => void;
}> = ({ file, onClose }) => {
    const config = getFileConfig(file.mimeType);

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

                    {isVideo(file.mimeType) && (
                        <video
                            src={`data:${file.mimeType};base64,${file.base64}`}
                            controls
                            autoPlay
                            className="preview-video"
                        />
                    )}

                    {isPdf(file.mimeType) && (
                        <iframe
                            src={`data:${file.mimeType};base64,${file.base64}`}
                            className="preview-pdf"
                            title={file.name}
                        />
                    )}

                    {isText(file.mimeType) && (
                        <pre className="preview-code">
                            <code>{getTextContent()}</code>
                        </pre>
                    )}

                    {!isImage(file.mimeType) && !isVideo(file.mimeType) && !isPdf(file.mimeType) && !isText(file.mimeType) && (
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
    const [files, setFiles] = useState<FileData[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [totalSize, setTotalSize] = useState(0);
    const [previewFile, setPreviewFile] = useState<FileData | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback(async (fileList: FileList | File[]) => {
        try {
            const newFiles = await processFiles(fileList);
            setFiles(prev => {
                const updated = [...prev, ...newFiles];
                updateGlobalStateWithFiles(updated);
                setTotalSize(calculateTotalSize(updated));
                return updated;
            });
        } catch (error) {
            console.error('Error processing files:', error);
        }
    }, []);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            handleFiles(event.target.files);
        }
        resetFileInput(fileInputRef);
    };

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        if (e.dataTransfer.files?.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    }, [handleFiles]);

    const removeFile = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setFiles(prev => {
            const updated = prev.filter((_, i) => i !== index);
            updateGlobalStateWithFiles(updated);
            setTotalSize(calculateTotalSize(updated));
            return updated;
        });
    };

    const clearAll = () => {
        setFiles([]);
        clearGlobalStateFiles();
        setTotalSize(0);
    };

    const sizeWarning = isSizeWarning(totalSize);

    return (
        <>
            <div className="file-upload-wrapper">
                <div
                    className={`file-drop-zone ${isDragging ? 'dragging' : ''} ${files.length > 0 ? 'has-files' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept={ACCEPTED_FILES}
                        multiple
                        style={{ display: 'none' }}
                    />

                    {files.length === 0 ? (
                        <div className="drop-zone-content">
                            <Icon name="cloud_upload" className="drop-icon" />
                            <div className="drop-text">
                                <span className="drop-primary">Drop files here or click to upload</span>
                                <span className="drop-secondary">Images, PDFs, Documents, Code, Video</span>
                            </div>
                        </div>
                    ) : (
                        <div className="drop-zone-mini">
                            <Icon name="add" />
                            <span>Add more files</span>
                        </div>
                    )}
                </div>

                {files.length > 0 && (
                    <div className="file-list-container scrollbar-compact">
                        <div className="file-list-header">
                            <span className="file-count">{files.length} file{files.length !== 1 ? 's' : ''} • {formatFileSize(totalSize)}</span>
                            <button className="clear-all-btn" onClick={clearAll}>
                                <Icon name="delete_sweep" />
                                Clear all
                            </button>
                        </div>

                        {sizeWarning && (
                            <div className="size-warning">
                                <Icon name="warning" />
                                <span>Large upload ({formatFileSize(totalSize)}). Some providers may reject requests over 20MB.</span>
                            </div>
                        )}

                        <div className="file-grid">
                            {files.map((file, idx) => {
                                const config = getFileConfig(file.mimeType);
                                return (
                                    <div
                                        key={idx}
                                        className="file-card"
                                        title={`Click to preview: ${file.name}`}
                                        onClick={() => setPreviewFile(file)}
                                    >
                                        <button
                                            className="file-remove-btn"
                                            onClick={(e) => removeFile(idx, e)}
                                            title="Remove file"
                                        >
                                            <Icon name="close" />
                                        </button>

                                        <div className="file-preview-thumb">
                                            {isImage(file.mimeType) ? (
                                                <img
                                                    src={`data:${file.mimeType};base64,${file.base64}`}
                                                    alt={file.name}
                                                    className="file-image"
                                                />
                                            ) : (
                                                <div className="file-icon-wrapper" style={{ backgroundColor: `${config.color}15` }}>
                                                    <Icon name={config.icon} className="file-type-icon" style={{ color: config.color }} />
                                                </div>
                                            )}
                                            <div className="file-preview-overlay">
                                                <Icon name="visibility" />
                                            </div>
                                        </div>

                                        <div className="file-info">
                                            <span className="file-name">{file.name}</span>
                                            <div className="file-meta">
                                                <span className="file-type-badge" style={{ backgroundColor: `${config.color}20`, color: config.color }}>
                                                    {config.label}
                                                </span>
                                                <span className="file-size">{formatFileSize(file.size)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

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
