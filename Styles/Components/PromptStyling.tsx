/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { CaretManager, Utils, Tokenizer, Renderer } from './PromptStylingLogic';

interface PromptStylingEditorProps {
  value?: string;
  onChange?: (val: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}

const FORCE_SYNC_EVENT = 'prompt-styling-force-sync';

type AnimationFrameRef = React.MutableRefObject<number | null>;

function cancelScheduledFrame(frameRef: AnimationFrameRef): void {
  if (frameRef.current === null) return;

  cancelAnimationFrame(frameRef.current);
  frameRef.current = null;
}

function getEditorSelection(editor: HTMLElement): Selection | null {
  const selection = editor.ownerDocument.getSelection();
  if (!selection) return null;

  if (selection.rangeCount > 0) {
    const container = selection.getRangeAt(0).commonAncestorContainer;
    if (container === editor || editor.contains(container)) {
      return selection;
    }
  }

  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);

  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function dispatchInputEvent(editor: HTMLElement, text: string): void {
  const InputEventConstructor = editor.ownerDocument.defaultView?.InputEvent;

  const event = InputEventConstructor
    ? new InputEventConstructor('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText'
      })
    : new Event('input', { bubbles: true });

  editor.dispatchEvent(event);
}

/**
 * Centralizes plain-text editing. execCommand remains a narrow compatibility
 * adapter because it preserves native undo history; Range is the safe fallback.
 */
function insertPlainText(editor: HTMLElement, text: string): void {
  editor.focus();

  const selection = getEditorSelection(editor);
  if (!selection || selection.rangeCount === 0) return;

  const execCommand = editor.ownerDocument.execCommand;
  if (typeof execCommand === 'function') {
    try {
      if (execCommand.call(editor.ownerDocument, 'insertText', false, text)) {
        return;
      }
    } catch {
      // Continue through the standards-based Selection/Range fallback.
    }
  }

  const range = selection.getRangeAt(0);
  const textNode = editor.ownerDocument.createTextNode(text);

  range.deleteContents();
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
  dispatchInputEvent(editor, text);
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
  const mutationRef = useRef(false);
  const requestRef = useRef<number | null>(null);

  const replaceEditorHtml = useCallback(
    (editor: HTMLDivElement, html: string, caretOffset?: number): void => {
      mutationRef.current = true;

      try {
        editor.innerHTML = html;

        if (caretOffset !== undefined) {
          CaretManager.setCaretPosition(editor, caretOffset);
        }
      } finally {
        mutationRef.current = false;
      }
    },
    []
  );

  const syncFromValue = useCallback(
    (nextValue: string): void => {
      const editor = editorRef.current;
      if (!editor || mutationRef.current) return;

      const normalizedValue = nextValue ?? '';
      if (Utils.getPlainText(editor) === normalizedValue) return;

      cancelScheduledFrame(requestRef);
      replaceEditorHtml(
        editor,
        Renderer.render(Tokenizer.parse(normalizedValue))
      );
    },
    [replaceEditorHtml]
  );

  const updateEditor = useCallback((): void => {
    const editor = editorRef.current;
    if (!editor || mutationRef.current) return;

    const caretOffset = CaretManager.getCaretPosition(editor);
    const text = Utils.getPlainText(editor);
    const html = Renderer.render(Tokenizer.parse(text));

    if (editor.innerHTML !== html) {
      replaceEditorHtml(editor, html, caretOffset);
    }
  }, [replaceEditorHtml]);

  const scheduleEditorUpdate = useCallback((): void => {
    cancelScheduledFrame(requestRef);

    requestRef.current = requestAnimationFrame(() => {
      requestRef.current = null;
      updateEditor();
    });
  }, [updateEditor]);

  const mirrorUncontrolledValue = useCallback((text: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const handleInput = useCallback((): void => {
    const editor = editorRef.current;
    if (!editor || mutationRef.current) return;

    const text = Utils.getPlainText(editor);
    onChange?.(text);

    if (value === undefined) {
      mirrorUncontrolledValue(text);
    }

    scheduleEditorUpdate();
  }, [mirrorUncontrolledValue, onChange, scheduleEditorUpdate, value]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Enter') return;

      event.preventDefault();
      event.stopPropagation();

      const editor = editorRef.current;
      if (editor) {
        insertPlainText(editor, '\n');
      }
    },
    []
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>): void => {
      event.preventDefault();

      const editor = editorRef.current;
      if (!editor) return;

      insertPlainText(
        editor,
        event.clipboardData?.getData('text/plain') ?? ''
      );
    },
    []
  );

  // Controlled React values remain the authoritative source.
  useEffect(() => {
    if (value !== undefined) {
      syncFromValue(value);
    }
  }, [syncFromValue, value]);

  // Legacy consumers may mutate the hidden textarea and request synchronization.
  useEffect(() => {
    const handleForceSync = (): void => {
      if (value === undefined && textareaRef.current) {
        syncFromValue(textareaRef.current.value);
      }
    };

    handleForceSync();
    window.addEventListener(FORCE_SYNC_EVENT, handleForceSync);

    return () => {
      window.removeEventListener(FORCE_SYNC_EVENT, handleForceSync);
    };
  }, [syncFromValue, value]);

  useEffect(
    () => () => {
      cancelScheduledFrame(requestRef);
    },
    []
  );

  return (
    <div className="prompt-styling-container">
      <div
        ref={editorRef}
        className={`prompt-styling-editor ${className} ${
          readOnly ? 'read-only' : ''
        }`}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        id={id ? `${id}-editor` : undefined}
      />

      {/* Stable compatibility boundary for existing textarea-based integrations. */}
      <textarea
        ref={textareaRef}
        id={id}
        className={`prompt-textarea ${className}`}
        rows={rows}
        value={value !== undefined ? value : undefined}
        defaultValue={value === undefined ? '' : undefined}
        onChange={
          value !== undefined
            ? event => onChange?.(event.target.value)
            : undefined
        }
        style={{ display: 'none' }}
        data-ps-enhanced="true"
      />
    </div>
  );
};

export function updatePromptContent(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FORCE_SYNC_EVENT));
  }
}
