/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Declare hljs as global (loaded via CDN)
declare const hljs: any;

// --- 1. CONFIGURATION & GRAMMAR ---

const GRAMMAR = {
  // Structural splits
  // Improved Code Block Regex: Allows content without requiring strict trailing newline
  CODE_BLOCK: /(```(?:[\w-]*)\n[\s\S]*?```)/g,
  HEADING: /^(#{1,6})(\s.*)$/,
  LIST_ITEM: /^(\s*-\s)(.*)/,

  // Combined optimized regex for inline tokens
  TOKENS: new RegExp(
    [
      /(\{\{[^}]+\}\})/,                 // Variables {{x}}
      /(<\/?[\w\s="-]+>)/,               // Tags <tag>
      /(\[[^\]]+\])/,                    // Instructions [text]
      /(\*\*.*?\*\*)/,                   // Critical **text**
      /(`[^`]+`)/,                       // Inline Code `code`
      /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, // Strings "str"
      // Keywords (Positive)
      /\b(You must|Must|Always|Ensure|IMPORTANT|CRITICAL|Mandatory|Required|Require|Be sure to|Make sure to|Ensure that|Strictly|At all times)\b/,
      // Keywords (Negative)
      /\b(Never|Do not|Don't|Avoid|Must not|Mustn't|Should not|Shouldn't|No|Not allowed|Prohibited|Forbidden|Disallowed|Cannot|Can't)\b/
    ].map(r => r.source).join('|'),
    'gi'
  ),

  TYPES: {
    VAR: /^\{\{/,
    TAG: /^</,
    INST: /^\[/,
    CRIT: /^\*\*/,
    CODE: /^`/,
    STR: /^["']/,
    POS: /^(?:You must|Must|Always|Ensure|IMPORTANT|CRITICAL|Mandatory|Required|Require|Be sure to|Make sure to|Ensure that|Strictly|At all times)$/i,
    NEG: /^(?:Never|Do not|Don't|Avoid|Must not|Mustn't|Should not|Shouldn't|No|Not allowed|Prohibited|Forbidden|Disallowed|Cannot|Can't)$/i
  }
};

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
};

// --- 2. TEXT NORMALIZATION & UTILITIES ---

const Utils = {
  escapeHtml: (unsafe: string): string => unsafe.replace(/[&<>"']/g, c => ESCAPE_MAP[c]),

  /**
   * SINGLE SOURCE OF TRUTH for Text.
   * Extracts text exactly as the Tokenizer and CaretManager expect it.
   * Handles the complex way browsers wrap contenteditable lines (DIVs, BRs, etc).
   */
  getPlainText: (node: Node): string => {
    // Text Node: Strip Zero Width Spaces (cursor artifacts)
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').replace(/\u200B/g, '');
    }

    // Explicit Line Break
    if (node.nodeName === 'BR') {
      return '\n';
    }

    // Block Elements (DIV, P, PRE) - Chrome adds these when pressing Enter
    // We treat the *start* of a non-first block as a newline to match visual structure
    if (Utils.isBlockElement(node)) {
      let content = '';
      // Recursively get content
      node.childNodes.forEach(child => {
        content += Utils.getPlainText(child);
      });

      // If this element is not the first child, it implies a newline (e.g. <div>Line 1</div><div>Line 2</div>)
      // But we must be careful not to double count if CSS handles formatting
      // FIX: Don't add newline if previous sibling was already a BR (which adds its own newline)
      if (node.previousSibling && node.previousSibling.nodeName !== 'BR' && content.length > 0) {
        return '\n' + content;
      }
      return content;
    }

    // Recursion for inline elements (SPAN, B, etc)
    let text = '';
    node.childNodes.forEach(child => {
      text += Utils.getPlainText(child);
    });
    return text;
  },

  isBlockElement: (node: Node): boolean => {
    return (node.nodeType === Node.ELEMENT_NODE) &&
      ['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE'].includes(node.nodeName);
  }
};

// --- 3. CARET MANAGEMENT (WORLD CLASS LOGIC) ---

class CaretManager {
  /**
   * Maps the browser's DOM cursor to a simple integer index (0...N)
   * strictly following the logic in Utils.getPlainText()
   */
  static getCaretPosition(root: HTMLElement): number {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;

    const range = selection.getRangeAt(0);
    // Range.startContainer might be a TextNode or an Element (if cursor is between nodes)
    const targetNode = range.startContainer;
    const targetOffset = range.startOffset;

    let currentIndex = 0;
    let found = false;

    const walk = (node: Node) => {
      if (found) return;

      // 1. Handle Hit: If we reached the selection container
      if (node === targetNode) {
        if (node.nodeType === Node.TEXT_NODE) {
          currentIndex += targetOffset;
        } else {
          // If cursor is inside an element but pointing between children
          // We need to count the length of siblings before the offset
          for (let i = 0; i < targetOffset; i++) {
            // This is an approximation for Element-type selections
            // which usually happen at boundaries.
            const child = node.childNodes[i];
            currentIndex += Utils.getPlainText(child).length;
          }
        }
        found = true;
        return;
      }

      // 2. Count "Hidden" Newlines for Block Elements
      // Matches `Utils.getPlainText` logic: non-first blocks imply a newline
      if (Utils.isBlockElement(node) && node.previousSibling && node.hasChildNodes()) {
        // If we haven't found the target yet, add the implied newline char
        // BUT only if the target is NOT inside the previous sibling (which we already walked)
        currentIndex += 1; // '\n'
      }

      // 3. Increment Index based on Node Type
      if (node.nodeType === Node.TEXT_NODE) {
        // Strip ZWSP from count because they won't exist in the cleaned text
        const text = (node.textContent || '').replace(/\u200B/g, '');
        currentIndex += text.length;
      }
      else if (node.nodeName === 'BR') {
        currentIndex += 1;
      }
      else if (node.nodeName === 'PRE') {
        // For PRE, we count text content directly as it's atomic in our grammar
        // Note: If selection is INSIDE PRE, this recursive walk fails.
        // However, we recurse into children below, so we are fine unless PRE is opaque.
        // We treat PRE as transparent traversal.
      }

      // 4. Recurse
      if (!found && node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i]);
          if (found) return;
        }
      }
    };

    walk(root);
    return currentIndex;
  }

  /**
   * Inversely maps an integer index back to a DOM Range.
   */
  static setCaretPosition(root: HTMLElement, targetIndex: number): void {
    const selection = window.getSelection();
    if (!selection) return;

    let currentIndex = 0;
    let rangeSet = false;

    const range = document.createRange();

    const walk = (node: Node) => {
      if (rangeSet) return;

      // Handle Implied Newlines (Block Boundaries)
      if (Utils.isBlockElement(node) && node.previousSibling && node.hasChildNodes()) {
        if (currentIndex === targetIndex) {
          // Cursor is exactly at the start of this block (the newline)
          range.setStart(node, 0);
          range.collapse(true);
          rangeSet = true;
          return;
        }
        currentIndex += 1; // Consume '\n'
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\u200B/g, '');
        const len = text.length;

        if (currentIndex + len >= targetIndex) {
          const offset = targetIndex - currentIndex;
          range.setStart(node, offset);
          range.collapse(true);
          rangeSet = true;
          return;
        }
        currentIndex += len;
      }
      else if (node.nodeName === 'BR') {
        if (currentIndex === targetIndex) {
          range.setStartBefore(node);
          range.collapse(true);
          rangeSet = true;
          return;
        }
        currentIndex += 1;
      }

      // Recurse
      if (node.childNodes) {
        for (let i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i]);
          if (rangeSet) return;
        }
      }
    };

    walk(root);

    // Fallback: If index is out of bounds (EOF), set to end
    if (!rangeSet) {
      range.selectNodeContents(root);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }
}

// --- 4. TOKENIZER & RENDERER ---

class Tokenizer {
  static parse(text: string) {
    const tokens: any[] = [];
    // Use the relaxed Code Block regex to handle typing
    const parts = text.split(GRAMMAR.CODE_BLOCK);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      // Identify Code Block (Starts and ends with ```)
      if (part.startsWith('```') && (part.endsWith('```') || i === parts.length - 1)) {
        // If it's the last part and starts with ``` but matches regex, treat as code
        // Our regex split keeps delimiters, so 'part' includes the ```
        const lines = part.split('\n');
        // Extract language from first line (```lang)
        const lang = lines[0].slice(3).trim() || 'plaintext';
        // Everything else is code
        const code = lines.slice(1, part.endsWith('```') ? -1 : undefined).join('\n');

        tokens.push({ type: 'code-block', content: code, lang });
        continue;
      }

      Tokenizer.parseInline(part, tokens);
    }
    return tokens;
  }

  private static parseInline(text: string, tokens: any[]) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) tokens.push({ type: 'newline' });
      if (!line) return;

      // Structural Token: Heading
      const hMatch = line.match(GRAMMAR.HEADING);
      if (hMatch) {
        tokens.push({ type: 'heading', content: line, level: hMatch[1].length });
        return;
      }

      // Structural Token: List Item
      const lMatch = line.match(GRAMMAR.LIST_ITEM);
      if (lMatch) {
        tokens.push({ type: 'list-marker', content: lMatch[1] });
        Tokenizer.tokenizeString(lMatch[2], tokens);
        return;
      }

      Tokenizer.tokenizeString(line, tokens);
    });
  }

  private static tokenizeString(text: string, tokens: any[]) {
    let lastIdx = 0;
    let match;
    // Ensure regex starts from 0 for this string chunk
    GRAMMAR.TOKENS.lastIndex = 0;

    while ((match = GRAMMAR.TOKENS.exec(text)) !== null) {
      // Text before match
      if (match.index > lastIdx) {
        tokens.push({ type: 'text', content: text.substring(lastIdx, match.index) });
      }

      const raw = match[0];
      const type = Tokenizer.classify(raw);
      tokens.push({ type, content: raw });
      lastIdx = match.index + raw.length;
    }

    // Text after last match
    if (lastIdx < text.length) {
      tokens.push({ type: 'text', content: text.substring(lastIdx) });
    }
  }

  private static classify(text: string) {
    const T = GRAMMAR.TYPES;
    if (T.VAR.test(text)) return 'variable';
    if (T.TAG.test(text)) return 'tag';
    if (T.INST.test(text)) return 'instruction';
    if (T.CRIT.test(text)) return 'critical';
    if (T.CODE.test(text)) return 'code-inline';
    if (T.STR.test(text)) return 'string';
    if (T.POS.test(text)) return 'keyword-positive';
    if (T.NEG.test(text)) return 'keyword-negative';
    return 'text';
  }
}

class Renderer {
  static render(tokens: any[]): string {
    return tokens.map(t => {
      switch (t.type) {
        case 'newline': return '<br>';
        case 'text': return Utils.escapeHtml(t.content);

        case 'code-block':
          // Safe Synchronous Highlighting
          let highlighted = Utils.escapeHtml(t.content);
          let langClass = 'plaintext';

          if (typeof hljs !== 'undefined' && t.lang) {
            try {
              // Check language validity to prevent hljs errors
              const validLang = hljs.getLanguage(t.lang) ? t.lang : 'plaintext';
              langClass = validLang;
              // highlight() returns an object with a 'value' property containing HTML
              highlighted = hljs.highlight(t.content, { language: validLang }).value;
            } catch (e) {
              // Fallback is already set to escaped plaintext
            }
          }

          // Note: We use \u0060 (backtick) to render visual fences that are unselectable/ignored by utils
          return `<div class="token-code-marker">\u0060\u0060\u0060${t.lang}</div>` +
            `<pre><code class="hljs language-${langClass}">${highlighted}</code></pre>` +
            `<div class="token-code-marker">\u0060\u0060\u0060</div>`;

        case 'heading':
          return `<span class="token-heading token-heading${t.level}">${Utils.escapeHtml(t.content)}</span>`;

        case 'list-marker':
          return `<span class="token-list-marker">${Utils.escapeHtml(t.content)}</span>`;

        default:
          return `<span class="token-${t.type}">${Utils.escapeHtml(t.content)}</span>`;
      }
    }).join('');
  }
}

// --- 5. EDITOR CLASS ---

class PromptEditor {
  private root: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private isLocked = false;
  private rafId: number | null = null;

  constructor(textarea: HTMLTextAreaElement) {
    this.textarea = textarea;
    this.root = this.createDom();
    this.bindEvents();

    if (textarea.value) {
      // Initial sync
      this.root.textContent = textarea.value;
      this.update(true);
    }
  }

  private createDom() {
    const container = document.createElement('div');
    container.className = 'prompt-styling-container';

    const editor = document.createElement('div');
    editor.className = 'prompt-styling-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('spellcheck', 'false');
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');

    // Copy accessibility attributes from source textarea
    const ariaLabel = this.textarea.getAttribute('aria-label');
    if (ariaLabel) editor.setAttribute('aria-label', ariaLabel);

    const ariaLabelledBy = this.textarea.getAttribute('aria-labelledby');
    if (ariaLabelledBy) editor.setAttribute('aria-labelledby', ariaLabelledBy);

    this.textarea.parentNode?.insertBefore(container, this.textarea);
    container.appendChild(editor);
    container.appendChild(this.textarea);

    this.textarea.style.display = 'none';
    this.textarea.dataset.psEnhanced = 'true';

    (this.textarea as any)._promptEditor = this;
    return editor;
  }

  private bindEvents() {
    const el = this.root;

    // INPUT: Handling text changes
    el.addEventListener('input', () => {
      if (this.isLocked) return;

      // 1. Sync hidden textarea using the robust getPlainText
      const text = Utils.getPlainText(el);
      this.textarea.value = text;
      this.textarea.dispatchEvent(new Event('input', { bubbles: true }));

      // 2. Schedule Render
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => this.update(false));
    });

    // PASTE: Sanitize to Plain Text
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';
      document.execCommand('insertText', false, text);
    });

    // KEYDOWN: normalize Enter key
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation(); // Prevent bubbling to avoid triggering parent listeners
        // Forces a plain newline insertion, effectively normalizing block generation
        document.execCommand('insertText', false, '\n');
      }
    });
  }

  public update(immediate = false) {
    // 1. Snapshot Cursor
    const cursorOffset = CaretManager.getCaretPosition(this.root);

    // 2. Parse & Render (Using getPlainText to ensure consistency)
    const rawText = Utils.getPlainText(this.root);
    const tokens = Tokenizer.parse(rawText);
    const newHtml = Renderer.render(tokens);

    // 3. Diff & Apply
    if (this.root.innerHTML !== newHtml) {
      this.isLocked = true;
      this.root.innerHTML = newHtml;
      // 4. Restore Cursor
      CaretManager.setCaretPosition(this.root, cursorOffset);
      this.isLocked = false;
    }
  }

  public setContent(text: string) {
    const current = Utils.getPlainText(this.root);
    // Only update if visually different (ignoring HTML structure diffs)
    if (current !== text) {
      this.root.textContent = text;
      this.update(true);
    }
  }
}

// --- 6. EXPORTS ---

export function enhanceTextarea(textarea: HTMLTextAreaElement) {
  if (textarea.dataset.psEnhanced === 'true') return;
  new PromptEditor(textarea);
}

export function updatePromptContent() {
  document.querySelectorAll('.prompt-textarea').forEach((textarea: any) => {
    if (textarea._promptEditor) {
      textarea._promptEditor.setContent(textarea.value);
    }
  });
}

export function initializePromptStyling() {
  if (typeof hljs === 'undefined') {
    setTimeout(initializePromptStyling, 50);
    return;
  }
  document.querySelectorAll('.prompt-textarea').forEach(el =>
    enhanceTextarea(el as HTMLTextAreaElement)
  );
}