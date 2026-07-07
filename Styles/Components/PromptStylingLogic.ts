/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  highlightCodeSync,
  isLanguageSupported,
  resolveLanguage
} from '../Shiki';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;

const ZERO_WIDTH_CHARACTER = '\u200B';
const ZERO_WIDTH_PATTERN = /\u200B/g;
const CODE_ELEMENT_PATTERN = /<code\b[^>]*>([\s\S]*?)<\/code>/i;
const CODE_FENCE = '```';

const BLOCK_ELEMENTS = new Set([
  'DIV',
  'P',
  'LI',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE'
]);

const GRAMMAR = {
  CODE_BLOCK: /(```(?:[\w-]*)\n[\s\S]*?```)/g,
  HEADING: /^(#{1,6})(\s.*)$/,
  LIST_ITEM: /^(\s*-\s)(.*)/,
  TOKENS: new RegExp(
    [
      /(\{\{[^}]+\}\})/,
      /(<\/?[\w\s="-]+>)/,
      /(\[[^\]]+\])/,
      /(\*\*.*?\*\*)/,
      /(`[^`]+`)/,
      /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,
      /\b(You must|Must|Always|Ensure|IMPORTANT|CRITICAL|Mandatory|Required|Require|Be sure to|Make sure to|Ensure that|Strictly|At all times)\b/,
      /\b(Never|Do not|Don't|Avoid|Must not|Mustn't|Should not|Shouldn't|No|Not allowed|Prohibited|Forbidden|Disallowed|Cannot|Can't)\b/
    ]
      .map(expression => expression.source)
      .join('|'),
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
} as const;

const ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
});

interface InternalToken {
  type: string;
  content: string;
  level?: number;
  lang?: string;

  /**
   * The exact source-language marker. This keeps an unlabelled fence
   * visually unlabelled while still highlighting it as plaintext.
   */
  marker?: string;
}

interface HighlightedCode {
  html: string;
  language: string;
}

type TokenRenderer = (token: InternalToken) => string;
type MutationObserverConstructor = typeof MutationObserver;

function cleanText(text: string): string {
  return text.replace(ZERO_WIDTH_PATTERN, '');
}

function isBlockElement(node: Node): boolean {
  return (
    node.nodeType === ELEMENT_NODE &&
    BLOCK_ELEMENTS.has(node.nodeName)
  );
}

function getOwnerWindow(node: Node): Window | null {
  if (node.nodeType === DOCUMENT_NODE) {
    return (node as Document).defaultView;
  }

  return node.ownerDocument?.defaultView ?? null;
}

function getMutationObserverConstructor(
  root: Node
): MutationObserverConstructor | undefined {
  const ownerConstructor = (getOwnerWindow(root) as any)?.MutationObserver;

  if (ownerConstructor) {
    return ownerConstructor;
  }

  return typeof globalThis.MutationObserver === 'function'
    ? globalThis.MutationObserver
    : undefined;
}

/**
 * Represents one persistent logical-text view of a DOM subtree.
 *
 * Mutation records invalidate only the affected node and its ancestor path.
 * Cached text for untouched sibling subtrees remains reusable across editor
 * reads and keystrokes.
 */
class TextProjection {
  private readonly contentCache = new WeakMap<Node, string>();
  private readonly textCache = new WeakMap<Node, string>();
  private readonly observer: MutationObserver | null;

  constructor(
    private readonly root: Node,
    Observer?: MutationObserverConstructor
  ) {
    this.observer = Observer
      ? new Observer(records => this.invalidate(records))
      : null;

    this.observer?.observe(root, {
      subtree: true,
      childList: true,
      characterData: true
    });
  }

  read(): string {
    this.synchronize();
    return this.textOf(this.root);
  }

  offsetAt(targetNode: Node, targetOffset: number): number {
    this.synchronize();

    if (
      targetNode !== this.root &&
      !this.root.contains(targetNode)
    ) {
      return 0;
    }

    let logicalOffset = 0;
    let found = false;

    const visit = (node: Node): void => {
      if (found) return;

      logicalOffset += this.prefixLength(node);

      if (node === targetNode) {
        if (node.nodeType === TEXT_NODE) {
          const rawText = node.textContent ?? '';
          const boundedOffset = Math.max(
            0,
            Math.min(targetOffset, rawText.length)
          );

          logicalOffset += cleanText(
            rawText.slice(0, boundedOffset)
          ).length;
        } else {
          const boundedOffset = Math.max(
            0,
            Math.min(targetOffset, node.childNodes.length)
          );

          for (
            let index = 0;
            index < boundedOffset;
            index += 1
          ) {
            logicalOffset += this.textOf(
              node.childNodes[index]
            ).length;
          }
        }

        found = true;
        return;
      }

      if (
        node.nodeType === TEXT_NODE ||
        node.nodeName === 'BR'
      ) {
        logicalOffset += this.contentOf(node).length;
        return;
      }

      for (
        let index = 0;
        index < node.childNodes.length;
        index += 1
      ) {
        visit(node.childNodes[index]);

        if (found) {
          return;
        }
      }
    };

    visit(this.root);
    return found ? logicalOffset : 0;
  }

  rangeAt(targetIndex: number): Range {
    this.synchronize();

    const document = this.root.ownerDocument ??
      (this.root as Document);

    const range = document.createRange();
    const maximum = this.textOf(this.root).length;
    const normalizedTarget = Number.isFinite(targetIndex)
      ? Math.trunc(targetIndex)
      : 0;

    const target = Math.min(
      maximum,
      Math.max(0, normalizedTarget)
    );

    let logicalOffset = 0;
    let rangeSet = false;

    const setStart = (node: Node, offset: number): void => {
      range.setStart(node, offset);
      range.collapse(true);
      rangeSet = true;
    };

    const setBefore = (node: Node): void => {
      range.setStartBefore(node);
      range.collapse(true);
      rangeSet = true;
    };

    const setAfter = (node: Node): void => {
      range.setStartAfter(node);
      range.collapse(true);
      rangeSet = true;
    };

    const visit = (node: Node): void => {
      if (rangeSet) return;

      const prefixLength = this.prefixLength(node);

      if (prefixLength > 0) {
        if (target === logicalOffset) {
          setBefore(node);
          return;
        }

        logicalOffset += prefixLength;

        if (target <= logicalOffset) {
          setStart(node, 0);
          return;
        }
      }

      if (node.nodeType === TEXT_NODE) {
        const rawText = node.textContent ?? '';
        const logicalLength = this.contentOf(node).length;

        if (target <= logicalOffset + logicalLength) {
          setStart(
            node,
            TextProjection.rawOffsetForVisibleOffset(
              rawText,
              target - logicalOffset
            )
          );
          return;
        }

        logicalOffset += logicalLength;
        return;
      }

      if (node.nodeName === 'BR') {
        if (target === logicalOffset) {
          setBefore(node);
          return;
        }

        logicalOffset += 1;

        if (target <= logicalOffset) {
          setAfter(node);
        }

        return;
      }

      if (
        node.childNodes.length === 0 &&
        target === logicalOffset
      ) {
        setStart(node, 0);
        return;
      }

      for (
        let index = 0;
        index < node.childNodes.length;
        index += 1
      ) {
        visit(node.childNodes[index]);

        if (rangeSet) {
          return;
        }
      }
    };

    visit(this.root);

    if (!rangeSet) {
      range.selectNodeContents(this.root);
      range.collapse(false);
    }

    return range;
  }

  private synchronize(): void {
    const pendingRecords = this.observer?.takeRecords();

    if (pendingRecords?.length) {
      this.invalidate(pendingRecords);
    }
  }

  private invalidate(records: readonly MutationRecord[]): void {
    for (const record of records) {
      this.invalidatePath(record.target);
    }
  }

  private invalidatePath(startNode: Node): void {
    let node: Node | null = startNode;
    let reachedRoot = false;

    while (node) {
      this.contentCache.delete(node);
      this.textCache.delete(node);

      if (node === this.root) {
        reachedRoot = true;
        break;
      }

      node = node.parentNode;
    }

    /*
     * A node can be detached before mutation delivery. In that case its
     * former ancestor path is unavailable, so the root is conservatively
     * invalidated while unaffected descendant caches remain reusable.
     */
    if (!reachedRoot) {
      this.contentCache.delete(this.root);
      this.textCache.delete(this.root);
    }
  }

  private contentOf(node: Node): string {
    const cached = this.contentCache.get(node);

    if (cached !== undefined) {
      return cached;
    }

    let content: string;

    if (node.nodeType === TEXT_NODE) {
      content = cleanText(node.textContent ?? '');
    } else if (node.nodeName === 'BR') {
      content = '\n';
    } else {
      const fragments: string[] = [];

      for (
        let index = 0;
        index < node.childNodes.length;
        index += 1
      ) {
        fragments.push(this.textOf(node.childNodes[index]));
      }

      content = fragments.join('');
    }

    this.contentCache.set(node, content);
    return content;
  }

  private textOf(node: Node): string {
    const cached = this.textCache.get(node);

    if (cached !== undefined) {
      return cached;
    }

    const content = this.contentOf(node);
    const requiresLeadingNewline =
      isBlockElement(node) &&
      node.previousSibling !== null &&
      node.previousSibling.nodeName !== 'BR' &&
      content.length > 0;

    const text = requiresLeadingNewline
      ? `\n${content}`
      : content;

    this.textCache.set(node, text);
    return text;
  }

  private prefixLength(node: Node): number {
    return this.textOf(node).length - this.contentOf(node).length;
  }

  private static rawOffsetForVisibleOffset(
    rawText: string,
    visibleOffset: number
  ): number {
    if (visibleOffset <= 0) {
      return 0;
    }

    let visibleCharacters = 0;

    for (
      let rawOffset = 0;
      rawOffset < rawText.length;
      rawOffset += 1
    ) {
      if (rawText[rawOffset] === ZERO_WIDTH_CHARACTER) {
        continue;
      }

      visibleCharacters += 1;

      if (visibleCharacters === visibleOffset) {
        return rawOffset + 1;
      }
    }

    return rawText.length;
  }
}

const PROJECTION_CACHE = new WeakMap<Node, TextProjection>();

function getTextProjection(root: Node): TextProjection {
  const Observer = getMutationObserverConstructor(root);

  /*
   * Persistent caching is safe only when mutations can be observed.
   * Older or non-browser environments receive a fresh immutable snapshot.
   */
  if (!Observer) {
    return new TextProjection(root);
  }

  const cached = PROJECTION_CACHE.get(root);

  if (cached) {
    return cached;
  }

  const projection = new TextProjection(root, Observer);
  PROJECTION_CACHE.set(root, projection);

  return projection;
}

export const Utils = {
  escapeHtml: (unsafe: string): string =>
    unsafe.replace(
      /[&<>"']/g,
      character => ESCAPE_MAP[character] ?? character
    ),

  getPlainText: (node: Node): string =>
    getTextProjection(node).read(),

  isBlockElement
};

export class CaretManager {
  static getCaretPosition(root: HTMLElement): number {
    const selection = root.ownerDocument.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return 0;
    }

    const range = selection.getRangeAt(0);

    return getTextProjection(root).offsetAt(
      range.startContainer,
      range.startOffset
    );
  }

  static setCaretPosition(
    root: HTMLElement,
    targetIndex: number
  ): void {
    const selection = root.ownerDocument.getSelection();

    if (!selection) {
      return;
    }

    const range = getTextProjection(root).rangeAt(targetIndex);

    selection.removeAllRanges();
    selection.addRange(range);
  }
}

export class Tokenizer {
  static parse(text: string): any[] {
    const tokens: InternalToken[] = [];
    const parts = text.split(GRAMMAR.CODE_BLOCK);

    for (
      let index = 0;
      index < parts.length;
      index += 1
    ) {
      const part = parts[index];

      if (!part) {
        continue;
      }

      if (
        part.startsWith(CODE_FENCE) &&
        (
          part.endsWith(CODE_FENCE) ||
          index === parts.length - 1
        )
      ) {
        const lines = part.split('\n');
        const marker = lines[0]
          .slice(CODE_FENCE.length)
          .trim();

        const lang = marker || 'plaintext';
        const content = lines
          .slice(
            1,
            part.endsWith(CODE_FENCE)
              ? -1
              : undefined
          )
          .join('\n');

        tokens.push({
          type: 'code-block',
          content,
          lang,
          marker
        });

        continue;
      }

      Tokenizer.parseInline(part, tokens);
    }

    return tokens;
  }

  private static parseInline(
    text: string,
    tokens: InternalToken[]
  ): void {
    const lines = text.split('\n');

    for (
      let index = 0;
      index < lines.length;
      index += 1
    ) {
      const line = lines[index];

      if (index > 0) {
        tokens.push({
          type: 'newline',
          content: ''
        });
      }

      if (!line) {
        continue;
      }

      const headingMatch = line.match(GRAMMAR.HEADING);

      if (headingMatch) {
        tokens.push({
          type: 'heading',
          content: line,
          level: headingMatch[1].length
        });

        continue;
      }

      const listMatch = line.match(GRAMMAR.LIST_ITEM);

      if (listMatch) {
        tokens.push({
          type: 'list-marker',
          content: listMatch[1]
        });

        Tokenizer.tokenizeString(listMatch[2], tokens);
        continue;
      }

      Tokenizer.tokenizeString(line, tokens);
    }
  }

  private static tokenizeString(
    text: string,
    tokens: InternalToken[]
  ): void {
    let cursor = 0;

    for (const match of text.matchAll(GRAMMAR.TOKENS)) {
      if (match.index > cursor) {
        tokens.push({
          type: 'text',
          content: text.slice(cursor, match.index)
        });
      }

      const content = match[0];

      tokens.push({
        type: Tokenizer.classify(content),
        content
      });

      cursor = match.index + content.length;
    }

    if (cursor < text.length) {
      tokens.push({
        type: 'text',
        content: text.slice(cursor)
      });
    }
  }

  private static classify(text: string): string {
    const types = GRAMMAR.TYPES;

    if (types.VAR.test(text)) return 'variable';
    if (types.TAG.test(text)) return 'tag';
    if (types.INST.test(text)) return 'instruction';
    if (types.CRIT.test(text)) return 'critical';
    if (types.CODE.test(text)) return 'code-inline';
    if (types.STR.test(text)) return 'string';
    if (types.POS.test(text)) return 'keyword-positive';
    if (types.NEG.test(text)) return 'keyword-negative';

    return 'text';
  }
}

function resolveHighlightLanguage(
  requestedLanguage: string
): string {
  try {
    return (
      requestedLanguage &&
      isLanguageSupported(requestedLanguage)
    )
      ? resolveLanguage(requestedLanguage)
      : 'plaintext';
  } catch {
    /*
     * Language registration belongs to the external highlighting system.
     * Plaintext is the deterministic local fallback.
     */
    return 'plaintext';
  }
}

function highlightCode(
  content: string,
  requestedLanguage: string
): HighlightedCode {
  const language =
    resolveHighlightLanguage(requestedLanguage);

  const escapedSource = Utils.escapeHtml(content);

  try {
    const highlightedDocument =
      highlightCodeSync(content, language);

    const codeMatch =
      highlightedDocument.match(CODE_ELEMENT_PATTERN);

    return {
      language,
      html: codeMatch?.[1] ?? escapedSource
    };
  } catch {
    /*
     * Highlighting is presentation-only. A failure must never destroy
     * source text or prevent the editor from rendering.
     */
    return {
      language,
      html: escapedSource
    };
  }
}

function sanitizeClassFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-') || 'plaintext';
}

function renderCodeBlock(token: InternalToken): string {
  const requestedLanguage = token.lang || 'plaintext';
  const sourceMarker = token.marker ?? token.lang ?? '';
  const highlighted = highlightCode(
    token.content,
    requestedLanguage
  );

  const languageClass = sanitizeClassFragment(
    highlighted.language
  );

  return [
    `<div class="token-code-marker">${CODE_FENCE}${Utils.escapeHtml(sourceMarker)}</div>`,
    `<pre class="shiki"><code class="language-${languageClass}">${highlighted.html}</code></pre>`,
    `<div class="token-code-marker">${CODE_FENCE}</div>`
  ].join('');
}

function renderHeading(token: InternalToken): string {
  const level = Math.min(
    6,
    Math.max(1, token.level ?? 1)
  );

  return `<span class="token-heading token-heading${level}">${Utils.escapeHtml(token.content)}</span>`;
}

function renderListMarker(token: InternalToken): string {
  return `<span class="token-list-marker">${Utils.escapeHtml(token.content)}</span>`;
}

function renderStyledToken(token: InternalToken): string {
  const type = sanitizeClassFragment(token.type);

  return `<span class="token-${type}">${Utils.escapeHtml(token.content)}</span>`;
}

const TOKEN_RENDERERS: Readonly<
  Record<string, TokenRenderer>
> = Object.freeze({
  newline: () => '<br>',
  text: token => Utils.escapeHtml(token.content),
  'code-block': renderCodeBlock,
  heading: renderHeading,
  'list-marker': renderListMarker
});

function renderToken(token: InternalToken): string {
  const renderer =
    TOKEN_RENDERERS[token.type] ?? renderStyledToken;

  return renderer(token);
}

export class Renderer {
  static render(tokens: any[]): string {
    return Array.isArray(tokens)
      ? (tokens as InternalToken[])
          .map(renderToken)
          .join('')
      : '';
  }
}