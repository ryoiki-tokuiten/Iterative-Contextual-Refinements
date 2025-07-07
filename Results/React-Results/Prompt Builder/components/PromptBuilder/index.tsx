import React, { useState, useRef, useCallback, useMemo } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
} from 'reactflow';
import { GoogleGenAI } from '@google/genai';

import { BlockLibrary } from './BlockLibrary';
import { PropertiesPanel } from './PropertiesPanel';
import { AIFillModal } from './AIFillModal';
import { ConfirmationModal } from '../ConfirmationModal';
import { PROMPT_NODE_TYPE, initialNodes, getSortedNodes } from './constants';
import { PromptBlockNode } from './customNode';

const nodeTypes = { [PROMPT_NODE_TYPE]: PromptBlockNode };
import { PromptBlockData, AIFillWorkflow } from './types';
import { AppSettings, NotificationState } from '../../types';
import { ZapIcon, ExportIcon, ImportIcon, DeleteIcon, SaveIcon, PanelLeftOpenIcon, PanelLeftCloseIcon } from '../icons';

let id = initialNodes.length;
const getId = () => `dnd-node_${id++}`;

interface PromptBuilderProps {
  appSettings: AppSettings;
  showNotification: (message: string, type?: NotificationState['type'], duration?: number) => void;
  onSaveRequest: (livePrompt: string) => void;
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
}

const PromptBuilderUI: React.FC<PromptBuilderProps> = ({ appSettings, showNotification, onSaveRequest, onToggleSidebar, isSidebarCollapsed }) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [isAIFillModalOpen, setIsAIFillModalOpen] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);

  const { deleteElements, getNodes, getEdges } = useReactFlow();

  

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowInstance || !reactFlowWrapper.current) {
        return;
      }

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const blockDefinitionString = event.dataTransfer.getData('application/reactflow');

      if (!blockDefinitionString) return;

      const blockDefinition = JSON.parse(blockDefinitionString);
      
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode: Node<PromptBlockData> = {
        id: getId(),
        type: PROMPT_NODE_TYPE,
        position,
        data: {
          type: blockDefinition.type,
          name: blockDefinition.name,
          content: blockDefinition.defaultContent || `This is a ${blockDefinition.name} block.`,
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );
  
  const selectedNode = useMemo(() => nodes.find(n => n.selected), [nodes]);

  const onNodeDataChange = (nodeId: string, newData: Partial<PromptBlockData>) => {
      setNodes((nds) => 
        nds.map((node) => {
            if (node.id === nodeId) {
                return {
                    ...node,
                    data: {
                        ...node.data,
                        ...newData
                    }
                }
            }
            return node;
        })
      );
  }

  const handleAIFill = useCallback((workflow: AIFillWorkflow) => {
    if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
        showNotification('AI Fill returned an invalid workflow structure.', 'error');
        return;
    }
    setNodes(workflow.nodes);
    setEdges(workflow.edges.map(e => ({...e, animated: true})));
    setIsAIFillModalOpen(false);
    showNotification('AI workflow generated successfully!', 'success');

    setTimeout(() => {
        if (reactFlowInstance) {
            reactFlowInstance.fitView({ padding: 0.1 });
        }
    }, 100);
  }, [reactFlowInstance, setNodes, setEdges, showNotification]);

  const handleExport = () => {
    if (nodes.length === 0) {
      showNotification("Canvas is empty. There is nothing to export.", "warning");
      return;
    }
    const workflow = { nodes, edges };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(workflow, null, 2))}`;
    const link = document.createElement('a');
    link.href = jsonString;
    link.download = `prompt_workflow_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showNotification("Workflow exported successfully.", "success");
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            const importedData = JSON.parse(text);

            if (importedData && Array.isArray(importedData.nodes) && Array.isArray(importedData.edges)) {
                setNodes(importedData.nodes);
                setEdges(importedData.edges.map((e: Edge) => ({...e, animated: true})));
                showNotification("Workflow imported successfully.", "success");
                setTimeout(() => reactFlowInstance?.fitView({ padding: 0.1 }), 100);
            } else {
                showNotification("Invalid workflow file format. The file must contain 'nodes' and 'edges' arrays.", "error", 5000);
            }
        } catch (error) {
            console.error("Error importing workflow:", error);
            showNotification("Failed to import workflow file. It may be corrupted or not valid JSON.", "error", 5000);
        } finally {
            if (importFileRef.current) {
                importFileRef.current.value = "";
            }
        }
    };
    reader.readAsText(file);
  };
  
  const handleClear = () => {
    if (nodes.length === 0 && edges.length === 0) {
        showNotification("Canvas is already empty.", "info");
        return;
    }
    setIsClearConfirmationOpen(true);
  };

  const executeClear = () => {
    setNodes([]);
    setEdges([]);
    showNotification("Canvas cleared.", "success");
    setIsClearConfirmationOpen(false);
  }

  const handleDeleteAction = () => {
    const nodesToDelete = getNodes().filter((node) => node.selected);
    const edgesToDelete = getEdges().filter((edge) => edge.selected);

    if (nodesToDelete.length > 0 || edgesToDelete.length > 0) {
      deleteElements({ nodes: nodesToDelete, edges: edgesToDelete });
    } else {
      handleClear();
    }
  };

  const handleSave = () => {
    const sorted = getSortedNodes(nodes, edges);
    const livePrompt = sorted.map(node => node.data.content).join('\n\n---\n\n');
    onSaveRequest(livePrompt);
  };

  return (
    <main className="app-main app-main--builder">
        <div className="prompt-builder">
        <BlockLibrary />
        <div className="prompt-builder__canvas-wrapper" ref={reactFlowWrapper}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={setReactFlowInstance}
                onDrop={onDrop}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                fitView
                defaultEdgeOptions={{ animated: true }}
                proOptions={{ hideAttribution: true }}
            >
                <Controls />
                <Background gap={16} color="var(--surface-tertiary)" />
                    <div className="prompt-builder__sidebar-toggle">
                    <button className="btn btn--secondary btn--icon" onClick={onToggleSidebar} title={isSidebarCollapsed ? "Show Organizer Panel" : "Hide Organizer Panel"}>
                        {isSidebarCollapsed ? <PanelLeftOpenIcon className="icon" /> : <PanelLeftCloseIcon className="icon" />}
                    </button>
                </div>
                <div className="prompt-builder__canvas-actions">
                    <button className="btn btn--primary" onClick={() => setIsAIFillModalOpen(true)}>
                        <ZapIcon className="icon" />
                        AI Fill
                    </button>
                    <button className="btn btn--primary" onClick={handleSave}>
                        <SaveIcon className="icon" />
                        Save
                    </button>
                    <input type="file" ref={importFileRef} onChange={handleImportFile} accept=".json" style={{ display: 'none' }} />
                    <button className="btn btn--secondary btn--icon" onClick={handleImportClick} title="Import Workflow">
                        <ImportIcon className="icon" />
                    </button>
                    <button className="btn btn--secondary btn--icon" onClick={handleExport} title="Export Workflow">
                        <ExportIcon className="icon" />
                    </button>
                    <button className="btn btn--danger btn--icon" onClick={handleDeleteAction} title="Delete Selected / Clear Canvas">
                        <DeleteIcon className="icon" />
                    </button>
                </div>
            </ReactFlow>
        </div>
        <PropertiesPanel
            selectedNode={selectedNode}
            onNodeDataChange={onNodeDataChange}
            nodes={nodes}
            edges={edges}
        />
        </div>
        <AIFillModal 
            isOpen={isAIFillModalOpen}
            onClose={() => setIsAIFillModalOpen(false)}
            onConfirm={handleAIFill}
            geminiApiKey={appSettings.geminiApiKey}
            modelId={appSettings.defaultGeminiModelId}
            showNotification={showNotification}
        />
        {isClearConfirmationOpen && (
            <ConfirmationModal
                isOpen={true}
                onClose={() => setIsClearConfirmationOpen(false)}
                onConfirm={executeClear}
                title="Clear Canvas"
                message={<p>Are you sure you want to clear the entire canvas? This will delete all nodes and edges and cannot be undone.</p>}
                confirmButtonText="Clear Canvas"
            />
        )}
    </main>
  );
};

export const PromptBuilder: React.FC<PromptBuilderProps> = (props) => {
    return (
        <ReactFlowProvider>
            <PromptBuilderUI {...props} />
        </ReactFlowProvider>
    );
}