/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§8.2, §8.3, §8.4).
 */

import type { ToolDefinition } from '@langchain/core/language_models/base';
import { z } from 'zod';

export const SHARED_WORKSPACE_TOOL_NAME = 'shared_workspace';
export const SHARED_WORKSPACE_FILENAME = 'shared_workspace.md';

export const sharedWorkspaceToolSchema = z.object({
  action: z.enum(['read', 'write', 'append']).describe(
    'The action to perform on the shared workspace document: read to get current content, write to replace full content, or append to add content at the end.'
  ),
  content: z.string().optional().describe(
    'The text content to write or append. Required when action is write or append.'
  ),
});

export const sharedWorkspaceToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: SHARED_WORKSPACE_TOOL_NAME,
    description: [
      'Read or edit the shared workspace document in real time.',
      'All agents across the system (except isolated hypothesis testers) share this document.',
      'Use this to share valuable discoveries, invariants, equations, verified lemmas, or coordinates with other agents.',
      'Actions: "read" returns the full document; "write" replaces the document; "append" adds text to the end.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'append'],
          description: 'The operation to perform: "read", "write", or "append".'
        },
        content: {
          type: 'string',
          description: 'Markdown content to write or append. Ignored when action is "read".'
        }
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
};

/**
 * Shared workspace state manager providing thread-safe realtime read/write
 * across concurrent agent executions (§8.4).
 */
export class SharedWorkspaceManager {
  private content = '# Shared Workspace\n\nLive collaboration document across agents.\n';
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly onDiskSync?: (content: string) => Promise<void>;

  constructor(onDiskSync?: (content: string) => Promise<void>) {
    this.onDiskSync = onDiskSync;
  }

  public async read(): Promise<string> {
    return this.content;
  }

  public async write(newContent: string): Promise<string> {
    return this.enqueue(async () => {
      this.content = newContent;
      if (this.onDiskSync) {
        await this.onDiskSync(this.content);
      }
      return this.content;
    });
  }

  public async append(addition: string): Promise<string> {
    return this.enqueue(async () => {
      this.content = `${this.content.trimEnd()}\n\n${addition.trim()}\n`;
      if (this.onDiskSync) {
        await this.onDiskSync(this.content);
      }
      return this.content;
    });
  }

  public async handleToolCall(input: { action: string; content?: string }): Promise<string> {
    switch (input.action) {
      case 'read':
        return this.read();
      case 'write':
        await this.write(input.content || '');
        return 'Successfully updated shared workspace content.';
      case 'append':
        await this.append(input.content || '');
        return 'Successfully appended to shared workspace.';
      default:
        throw new Error(`Unsupported shared_workspace action: ${input.action}`);
    }
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(op);
    this.writeQueue = next.then(() => {}, () => {});
    return next;
  }
}
