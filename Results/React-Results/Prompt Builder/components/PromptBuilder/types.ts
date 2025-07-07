import type { Node, Edge } from 'reactflow';

export interface PromptBlockData {
    type: string;
    name: string;
    content: string;
}

export interface AIFillWorkflow {
  workflowName?: string;
  nodes: Node<PromptBlockData>[];
  edges: Edge[];
}
