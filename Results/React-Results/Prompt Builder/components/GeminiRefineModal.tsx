import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { Modal } from './Modal';
import { SparklesIcon, SpinnerIcon, CopyIcon, CheckIcon, PaperClipIcon, XCircleIcon } from './icons';
import { AttachedFile } from '../types';

const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const readFileAsBase64InModal = (file: File): Promise<AttachedFile> => {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error(`File "${file.name}" is too large (max ${MAX_FILE_SIZE_MB}MB).`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1]; 
      resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', data: base64Data });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

interface GeminiRefineModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  onApply: (refinedText: string) => void;
  modelId: string;
  contextLabel: string;
  systemInstruction: string;
  showNotification?: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
  geminiApiKey: string; // Added geminiApiKey prop
}

export const GeminiRefineModal: React.FC<GeminiRefineModalProps> = ({
  isOpen,
  onClose,
  originalText,
  onApply,
  apiKey,
  modelId,
  contextLabel,
  systemInstruction,
  showNotification
}) => {
  const [currentOriginalText, setCurrentOriginalText] = useState('');
  const [refinedContent, setRefinedContent] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [attachedFilesInModal, setAttachedFilesInModal] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentOriginalText(originalText);
      setRefinedContent(''); 
      setError(null);
      setIsCopied(false);
      setAttachedFilesInModal([]); // Reset files when modal opens
    }
  }, [isOpen, originalText]);

  const handleFileChangeInModal = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFilesPromises: Promise<AttachedFile>[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!attachedFilesInModal.find(af => af.name === file.name && af.data.length === file.size)) {
            newFilesPromises.push(readFileAsBase64InModal(file));
        }
    }

    try {
        const results = await Promise.all(newFilesPromises);
        setAttachedFilesInModal(prev => [...prev, ...results]);
        if (showNotification) showNotification(`${results.length} file(s) attached.`, 'success');
    } catch (error: any) {
        console.error("Error attaching files in modal:", error);
        if (showNotification) showNotification(error.message || "Error attaching one or more files.", "error");
    }
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachedFileInModal = (fileName: string) => {
    setAttachedFilesInModal(prev => prev.filter(f => f.name !== fileName));
  };


  const handleRefine = useCallback(async () => {
    if (!apiKey) {
        setError("API key is not configured.");
        return;
    }
    if (!modelId) {
        setError("Gemini Model ID is not configured.");
        return;
    }
    if (!currentOriginalText.trim() && attachedFilesInModal.length === 0) {
      setError(`Original ${contextLabel.toLowerCase()} is empty and no files are attached. Provide some content or files to refine.`);
      return;
    }

    setIsRefining(true);
    setError(null);
    setRefinedContent('');

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const parts: Part[] = [];
      if(currentOriginalText.trim()) {
        parts.push({ text: `Refine the following ${contextLabel.toLowerCase()}:\n\n${currentOriginalText}` });
      } else {
        parts.push({ text: `Refine based on the attached files. The primary ${contextLabel.toLowerCase()} text is empty.`})
      }


      attachedFilesInModal.forEach(file => {
        parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
      });

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: modelId,
        contents: { parts },
        config: {
          systemInstruction: systemInstruction,
        }
      });
      
      setRefinedContent(response.text.trim());
    } catch (e: any) {
      console.error(`Error refining ${contextLabel.toLowerCase()}:`, e);
      setError(e.message || `Failed to refine ${contextLabel.toLowerCase()}.`);
    } finally {
      setIsRefining(false);
    }
  }, [currentOriginalText, apiKey, modelId, contextLabel, systemInstruction, attachedFilesInModal]);

  const handleApplyCallback = () => {
    if (refinedContent.trim()) {
      onApply(refinedContent);
    }
  };

  const handleCopy = () => {
    if (!refinedContent) return;
    navigator.clipboard.writeText(refinedContent)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy refined content: ', err));
  };
  
  const readOnlyBoxStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-md)',
    padding: '0.75rem 1rem',
    minHeight: '120px',
    maxHeight: '200px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    color: 'var(--text-secondary)',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Refine ${contextLabel} with Gemini`} size="2xl">
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        <div className="form-group">
          <label htmlFor="originalContextText" className="form-label">Original {contextLabel}</label>
          <div id="originalContextText" style={readOnlyBoxStyle} className="custom-scrollbar">
            {currentOriginalText || (<i>No text provided. Refining will rely on attached files if any.</i>)}
          </div>
        </div>

        <div className="form-group">
            <label className="form-label">Attach Files for Context (Max {MAX_FILE_SIZE_MB}MB each)</label>
            <input 
                type="file" multiple onChange={handleFileChangeInModal} ref={fileInputRef} 
                className="sr-only"
                accept="image/*,video/*,application/pdf,.txt,.json,.md,.csv,.tsv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn--secondary" style={{alignSelf: 'flex-start'}}>
                <PaperClipIcon className="icon" /> Attach Files
            </button>
            {attachedFilesInModal.length > 0 && (
                <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', maxHeight: '120px', overflowY: 'auto', padding:'var(--space-sm)', backgroundColor:'var(--bg-secondary)', borderRadius:'var(--radius-md)'}} className="custom-scrollbar">
                    {attachedFilesInModal.map(file => (
                        <div key={file.name} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-xs) var(--space-sm)', borderRadius: 'var(--radius-sm)'}}>
                            <span style={{fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={file.name}>
                                {file.name}
                            </span>
                            <button type="button" onClick={() => removeAttachedFileInModal(file.name)} className="btn btn--ghost btn--icon btn--sm" title="Remove file">
                                <XCircleIcon className="icon" style={{color: 'var(--accent-danger)'}} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>

        <div className="form-group">
            <div className="form-label">
                <span>Refined {contextLabel}</span>
                {refinedContent && !isRefining && (
                     <button onClick={handleCopy} className="btn btn--secondary btn--sm">
                        {isCopied ? <CheckIcon className="icon"/> : <CopyIcon className="icon" />}
                        {isCopied ? 'Copied!' : 'Copy'}
                    </button>
                )}
            </div>
          <div style={{ position: 'relative' }}>
            <textarea
              id="refinedContextText"
              value={refinedContent}
              onChange={(e) => setRefinedContent(e.target.value)}
              placeholder={isRefining ? "Gemini is thinking..." : `Refined ${contextLabel.toLowerCase()} will appear here...`}
              className="form-textarea"
              style={{minHeight: '150px'}}
              rows={7}
              readOnly={isRefining}
              aria-label={`Refined ${contextLabel.toLowerCase()}`}
            />
            {isRefining && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18, 20, 29, 0.7)', borderRadius: 'var(--radius-md)' }}>
                <SpinnerIcon className="icon animate-spin" style={{ width: '2rem', height: '2rem', color: 'var(--accent-primary)' }} />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: 'var(--space-md)', backgroundColor: 'rgba(248, 113, 113, 0.1)', border: '1px solid var(--accent-danger)', borderRadius: 'var(--radius-md)', color: 'var(--accent-danger)'}}>
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

        <div className="modal__footer">
          <button type="button" onClick={onClose} className="btn btn--secondary">
            Close
          </button>
          <button
            type="button"
            onClick={handleRefine}
            className="btn btn--secondary" 
            disabled={isRefining || (!currentOriginalText.trim() && attachedFilesInModal.length === 0) || !apiKey || !modelId}
          >
            <SparklesIcon className="icon" />
            {isRefining ? 'Refining...' : refinedContent ? 'Re-Refine' : 'Refine'}
          </button>
          <button
            type="button"
            onClick={handleApplyCallback}
            className="btn btn--primary"
            disabled={isRefining || !refinedContent.trim()}
          >
            Apply Refined Text
          </button>
        </div>
    </Modal>
  );
};