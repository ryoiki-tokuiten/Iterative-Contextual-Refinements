/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CaretManager, Utils, Tokenizer, Renderer } from './PromptStylingLogic';

export interface PromptStylingEditorProps {
  value?: string;
  onChange?: (val: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}

export const PromptStylingEditor: React.FC<PromptStylingEditorProps> = ({
  value,
  onChange,
  id,
  className = '',
  placeholder,
  rows,
  readOnly = false
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isLocked, setIsLocked] = useState(false);
  const requestRef = useRef<number | null>(null);

  const syncFromValue = useCallback((val: string) => {
    if (!editorRef.current || isLocked) return;
    const currentText = Utils.getPlainText(editorRef.current);
    if (currentText !== val) {
      const tokens = Tokenizer.parse(val || '');
      editorRef.current.innerHTML = Renderer.render(tokens);
    }
  }, [isLocked]);

  // Priority 1: React controlled value changes
  useEffect(() => {
    if (value !== undefined) {
      syncFromValue(value);
    }
  }, [value, syncFromValue]);

  // Priority 2: Uncontrolled legacy syncing via window event
  useEffect(() => {
    const handleForceSync = () => {
      if (value === undefined && textareaRef.current) {
        syncFromValue(textareaRef.current.value);
      }
    };
    handleForceSync(); // initial sync
    window.addEventListener('prompt-styling-force-sync', handleForceSync);
    return () => window.removeEventListener('prompt-styling-force-sync', handleForceSync);
  }, [value, syncFromValue]);

  const updateEditor = useCallback(() => {
    if (!editorRef.current) return;

    const cursorOffset = CaretManager.getCaretPosition(editorRef.current);
    const rawText = Utils.getPlainText(editorRef.current);

    const tokens = Tokenizer.parse(rawText);
    const newHtml = Renderer.render(tokens);

    if (editorRef.current.innerHTML !== newHtml) {
      setIsLocked(true);
      editorRef.current.innerHTML = newHtml;
      CaretManager.setCaretPosition(editorRef.current, cursorOffset);
      setIsLocked(false);
    }
  }, []);

  const handleInput = () => {
    if (!editorRef.current || isLocked) return;

    const text = Utils.getPlainText(editorRef.current);

    if (onChange) {
      onChange(text);
    }

    if (value === undefined && textareaRef.current) {
      // Uncontrolled: notify DOM of change manually
      textareaRef.current.value = text;
      textareaRef.current.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    requestRef.current = requestAnimationFrame(updateEditor);
  };

  useEffect(() => {
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('insertText', false, '\n');
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  };

  return (
    <div className="prompt-styling-container">
      <div
        ref={editorRef}
        className={`prompt-styling-editor ${className} ${readOnly ? 'read-only' : ''}`}
        contentEditable={!readOnly}
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        id={id ? `${id}-editor` : undefined}
      />
      {/* Hidden textarea ensures drop-in compatibility for vanilla JS logic */}
      <textarea
        ref={textareaRef}
        id={id}
        className={`prompt-textarea ${className}`}
        rows={rows}
        value={value !== undefined ? value : undefined}
        defaultValue={value === undefined ? "" : undefined}
        onChange={value !== undefined ? (e) => onChange?.(e.target.value) : undefined}
        style={{ display: 'none' }}
        data-ps-enhanced="true"
      />
    </div>
  );
};

export function updatePromptContent() {
  window.dispatchEvent(new Event('prompt-styling-force-sync'));
}

export function initializePromptStyling() {
  // No-op for backward compatibility. 
  // The PromptStylingEditor component auto-initializes on mount.
}

export default PromptStylingEditor;