import React from 'react';
import type { Node, Edge } from 'reactflow';
import type { LucideProps } from 'lucide-react';
import { PromptBlockData } from './types';
import {
    CogIcon,
    LightbulbIcon as Bot,
    UserIcon,
    BookTextIcon,
    ListChecksIcon,
    FileJsonIcon,
    SmileIcon,
    RulerIcon,
    BrainCircuitIcon,
    LanguagesIcon,
    QuoteIcon,
    BanIcon,
    HelpCircleIcon,
    GlobeIcon,
    ShieldIcon,
    Code2Icon,
    AlignLeftIcon,
    FeatherIcon,
    BinaryIcon,
} from '../icons';


export const PROMPT_NODE_TYPE = 'promptBlock';

interface BlockDefinition {
  type: string;
  name: string;
  description: string;
  icon: React.FC<LucideProps>;
  defaultContent: string;
}

export interface BlockCategory {
  name: string;
  blocks: BlockDefinition[];
}

export const BLOCK_CATEGORIES: BlockCategory[] = [
    {
        name: 'Core Components',
        blocks: [
            {
                type: 'System',
                name: 'System Instruction',
                description: 'High-level instructions for the entire workflow.',
                icon: CogIcon,
                defaultContent: 'You are a helpful and harmless AI assistant.'
            },
            {
                type: 'Persona',
                name: 'Persona / Role',
                description: 'Define the AI\'s character or role.',
                icon: Bot,
                defaultContent: 'Act as a senior software engineer with 10 years of experience in cloud computing.'
            },
            {
                type: 'Task',
                name: 'Main Task',
                description: 'Clearly define the primary task for the AI.',
                icon: ListChecksIcon,
                defaultContent: 'Your task is to analyze the user\'s request and provide a solution.'
            },
            {
                type: 'Context',
                name: 'Context / Background',
                description: 'Provide background or scenario context.',
                icon: BookTextIcon,
                defaultContent: 'The user is a beginner learning Python. The following is their code snippet:\n{{code_snippet}}'
            },
            {
                type: 'UserInput',
                name: 'User Input',
                description: 'Placeholder for the end-user\'s direct query.',
                icon: UserIcon,
                defaultContent: 'Here is the user\'s question:\n"""\n{{user_input}}\n"""'
            },
        ]
    },
    {
        name: 'Output Control',
        blocks: [
            {
                type: 'OutputFormatJson',
                name: 'JSON Output',
                description: 'Specify a JSON structure for the output.',
                icon: FileJsonIcon,
                defaultContent: 'Your final output must be a single valid JSON object. Do not include any other text or markdown formatting. The JSON schema is as follows:\n{\n  "key": "value_type",\n  "another_key": "another_value_type"\n}'
            },
            {
                type: 'OutputFormatMarkdown',
                name: 'Markdown Output',
                description: 'Request a response formatted in Markdown.',
                icon: AlignLeftIcon,
                defaultContent: 'Format your response using Markdown. Use headers for sections, bullet points for lists, and code blocks for code.'
            },
            {
                type: 'Tone',
                name: 'Tone & Style',
                description: 'Define the personality and style of the response.',
                icon: SmileIcon,
                defaultContent: 'Adopt a friendly and encouraging tone. Use emojis where appropriate.'
            },
            {
                type: 'Length',
                name: 'Length Constraint',
                description: 'Set a specific length for the response.',
                icon: RulerIcon,
                defaultContent: 'Keep your response concise, under 200 words.'
            },
            {
                type: 'Language',
                name: 'Language',
                description: 'Specify the output language.',
                icon: LanguagesIcon,
                defaultContent: 'Respond in French.'
            },
        ]
    },
    {
        name: 'Advanced Techniques',
        blocks: [
            {
                type: 'ChainOfThought',
                name: 'Chain of Thought',
                description: 'Instruct the model to think step-by-step.',
                icon: BrainCircuitIcon,
                defaultContent: 'Before providing the final answer, think step-by-step to outline your reasoning process. Enclose your reasoning in <thinking>...</thinking> tags.'
            },
            {
                type: 'FewShot',
                name: 'Few-Shot Examples',
                description: 'Provide input/output examples for guidance.',
                icon: QuoteIcon,
                defaultContent: 'Here are some examples of how to perform the task:\n\nExample 1:\nInput: "What is the capital of France?"\nOutput: "Paris"\n\nExample 2:\nInput: "What is the capital of Japan?"\nOutput: "Tokyo"'
            },
            {
                type: 'NegativeConstraints',
                name: 'Negative Constraints',
                description: 'Specify what the AI should NOT do.',
                icon: BanIcon,
                defaultContent: 'Do not apologize. Do not use overly complex jargon. Do not suggest solutions that involve paid software.'
            },
            {
                type: 'Clarification',
                name: 'Clarifying Questions',
                description: 'Ask for more details if the query is ambiguous.',
                icon: HelpCircleIcon,
                defaultContent: 'If the user\'s request is vague or ambiguous, ask clarifying questions before providing a solution.'
            },
            {
                type: 'Grounding',
                name: 'Grounding (Search)',
                description: 'Hint to use web search for up-to-date info.',
                icon: GlobeIcon,
                defaultContent: 'This question may require recent information. Use your knowledge from web searches to provide the most current and accurate answer.'
            },
            {
                type: 'Safety',
                name: 'Safety Guardrails',
                description: 'Reinforce safety and ethical guidelines.',
                icon: ShieldIcon,
                defaultContent: 'Ensure your response is safe, ethical, and does not contain any harmful, biased, or inappropriate content.'
            },
        ]
    },
    {
        name: 'Specialized Tasks',
        blocks: [
            {
                type: 'CodeGeneration',
                name: 'Code Generation',
                description: 'A template for generating code snippets.',
                icon: Code2Icon,
                defaultContent: 'You are a code generation assistant. Generate a code snippet in Python that accomplishes the following task: {{task_description}}.\n\nConstraints:\n- Use only standard libraries.\n- Include comments to explain the code.\n- Provide a usage example.'
            },
            {
                type: 'DataExtraction',
                name: 'Data Extraction',
                description: 'Extract structured information from text.',
                icon: BinaryIcon,
                defaultContent: 'From the following text, extract the specified entities and return them in a JSON format.\n\nEntities to extract:\n- Person Names\n- Locations\n- Dates\n\nText to analyze:\n"""\n{{source_text}}\n"""'
            },
            {
                type: 'CreativeWriting',
                name: 'Creative Writing',
                description: 'A starting point for creative content.',
                icon: FeatherIcon,
                defaultContent: 'Write a short story (around 500 words) based on the following premise: {{premise}}.\n\nThe story should have a clear beginning, middle, and end. Focus on character development and vivid descriptions.'
            },
        ]
    }
];


export const BLOCK_CATEGORIES_FOR_PROMPT = BLOCK_CATEGORIES.flatMap(category =>
    category.blocks.map(
        def => `- type: "${def.type}", name: "${def.name}", description: "${def.description}"`
    )
).join('\n');

export const AI_FILL_SYSTEM_INSTRUCTION = `
You are an expert AI workflow designer for a tool called React Flow. Your task is to generate a visual prompt engineering workflow based on a user's high-level description.

You MUST output a single, valid JSON object and nothing else. The JSON object must strictly adhere to the following schema:
{
  "workflowName": "string (optional)",
  "nodes": [
    {
      "id": "string (unique)",
      "type": "promptBlock",
      "position": { "x": number, "y": number },
      "data": {
        "type": "string (must be one of the available block types)",
        "name": "string (a descriptive name for the node)",
        "content": "string (the detailed prompt content for this block)"
      }
    }
  ],
  "edges": [
    {
      "id": "string (unique, e.g., 'e1-2')",
      "source": "string (source node id)",
      "target": "string (target node id)",
      "animated": true
    }
  ]
}

Key Instructions:
1.  **Nodes:** Create between 2 and 5 nodes to represent the workflow.
2.  **Node IDs:** Use simple, unique string identifiers for each node (e.g., "1", "2", "persona_node").
3.  **Content:** The 'content' field in each node's data should be a well-written, detailed prompt snippet that fulfills the role of that block.
4.  **Positions:** Arrange the nodes on the canvas with reasonable 'position' coordinates. The canvas is roughly 800px wide and 600px tall. Stagger them for readability (e.g., {x: 50, y: 100}, {x: 350, y: 100}).
5.  **Edges:** Connect the nodes logically using edges to represent the flow of the prompt. Ensure 'source' and 'target' in edges correctly reference node IDs. ALWAYS set 'animated' to true for edges.
6.  **Block Types:** You can only use the 'type's specified in the "AVAILABLE BLOCK TYPES" list provided below.
7.  **Output:** Your entire response must be ONLY the raw JSON object, without any markdown formatting, comments, or explanatory text.
`;


export const initialNodes: Node<PromptBlockData>[] = [
  {
    id: '1',
    type: PROMPT_NODE_TYPE,
    data: { 
        type: 'Persona',
        name: 'Helpful Assistant Persona',
        content: 'You are a world-class AI assistant, designed to be helpful, clear, and concise.'
    },
    position: { x: 50, y: 100 },
  },
  {
    id: '2',
    type: PROMPT_NODE_TYPE,
    data: { 
        type: 'Task',
        name: 'Primary Task',
        content: 'Your primary task is to answer the user\'s question based on the provided context.'
    },
    position: { x: 350, y: 100 },
  },
];

// Helper function to sort nodes based on edges for linear flow
export const getSortedNodes = (nodes: Node<PromptBlockData>[], edges: Edge[]): Node<PromptBlockData>[] => {
  if (nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edgeMap = new Map(edges.map(edge => [edge.source, edge.target]));
  const inDegree = new Map(nodes.map(node => [node.id, 0]));

  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sortedNodes: Node<PromptBlockData>[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (node) sortedNodes.push(node);

    const targetId = edgeMap.get(nodeId);
    if (targetId) {
      const newDegree = (inDegree.get(targetId) || 1) - 1;
      inDegree.set(targetId, newDegree);
      if (newDegree === 0) {
        queue.push(targetId);
      }
    }
  }
  
  // Add any disconnected nodes to the end
  const sortedNodeIds = new Set(sortedNodes.map(n => n.id));
  for (const node of nodes) {
      if(!sortedNodeIds.has(node.id)) {
          sortedNodes.push(node);
      }
  }

  return sortedNodes;
};