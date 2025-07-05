# `plan.md`: Implementation Plan for Feature Enhancement

This document provides a comprehensive, file-by-file guide for implementing the requested features: Pipeline Graph Visualization, Side-by-Side Diff Viewer, Collapsible Sidebar Sections, and a "Download & Run" package for React Mode.

## 1. Feature: Pipeline Graph Visualization (with React Flow)

### 1.1. Objective

To provide an alternative, intuitive graph/tree-based visualization for all pipeline workflows, helping researchers quickly understand the structure, status, and relationships between steps. This will be implemented using the `react-flow` library.

### 1.2. Dependency Installation

First, install the necessary libraries:

```bash
npm install react-flow
```

### 1.3. File-by-File Implementation Details

#### **File: `index.html`**

We need to add a container for the graph view and a toggle button to switch between the list and graph views.

```html
<!-- In main#main-content, just before #tabs-nav-container -->
<div id="main-view-controls" style="padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--border-secondary); display: flex; justify-content: flex-end; align-items: center; gap: var(--space-4);">
    <h2 id="main-content-heading" class="sr-only">Generation Pipelines Output</h2>
    
    <!-- View Toggle Button -->
    <div id="view-toggle-container" style="display: none;"> <!-- Initially hidden, shown by TSX when pipelines exist -->
        <label class="model-select-label" style="font-size: 0.85rem; margin-right: var(--space-2);">View:</label>
        <div class="view-toggle-buttons">
            <button id="view-toggle-list" class="button-base view-toggle-btn active" title="List View">
                <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z"/></svg>
            </button>
            <button id="view-toggle-graph" class="button-base view-toggle-btn" title="Graph View">
                <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M10 12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m-4 5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m8 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m-4-9c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2M6 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m8 1c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m-1-6.79c.92.43 1.5 1.45 1.5 2.58v.21H12V8h-1.5V6.21c0-1.13.58-2.15 1.5-2.58l.5-.21.5.21M8.5 8H10V6.21c0-1.13.58-2.15 1.5-2.58l.5-.21.5.21c.92.43 1.5 1.45 1.5 2.58V8h1.5v2H14v-1.79c0-.92-.43-1.7-1.06-2.22l-.44-.37-.44.37C11.43 6.8 11 7.57 11 8.5V10H8.5V8.5c0-.92-.43-1.7-1.06-2.22l-.44-.37-.44.37C5.93 6.8 5.5 7.57 5.5 8.5V10H4V8c0-1.13.58-2.15 1.5-2.58l.5-.21.5.21M12 17.79c-.92-.43-1.5-1.45-1.5-2.58V15h1.5v2h-1.5v1.79c0 1.13-.58 2.15-1.5 2.58l-.5.21-.5-.21c-.92-.43-1.5-1.45-1.5-2.58V18H4v2c0 1.13.58 2.15 1.5 2.58l.5.21.5-.21c.92-.43 1.5-1.45 1.5-2.58V20h1.5v1.79c0 1.13.58 2.15 1.5 2.58l.5.21.5-.21c.92-.43 1.5-1.45 1.5-2.58V20h1.5v-2h-1.5v1.5c0 .92.43 1.7 1.06 2.22l.44.37.44-.37c.63-.52 1.06-1.3 1.06-2.22V16h1.5v2h-1.5v1.5c0 .92-.43 1.7-1.06 2.22l-.44.37-.44-.37C14.07 19.2 13.5 18.43 13.5 17.5V16H12v1.79Z"/></svg>
            </button>
        </div>
    </div>
</div>

<!-- In main#main-content, replace #pipelines-content-container -->
<div id="view-container" style="flex-grow: 1; overflow: auto; position: relative;">
    <div id="pipelines-content-container" class="view-pane active">
        <!-- Existing pipeline content will be rendered here -->
    </div>
    <div id="graph-content-container" class="view-pane" style="height: 100%;">
        <!-- React Flow graph will be rendered here -->
    </div>
</div>
```

#### **File: `index.css`**

Add styles for the new controls and graph container.

```css
/* Add to Section 8: MAIN CONTENT AREA */

#main-view-controls {
    flex-shrink: 0; /* Prevent controls from shrinking */
}

.view-toggle-buttons {
    display: flex;
    background-color: var(--tertiary-surface-bg);
    border-radius: var(--radius-md);
    padding: var(--space-1);
    border: 1px solid var(--border-primary);
}

.view-toggle-btn {
    padding: var(--space-2);
    border: none;
    background-color: transparent;
    color: var(--text-secondary-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition-speed-fast) var(--easing-subtle);
    box-shadow: none;
}
.view-toggle-btn:hover {
    color: var(--text-color);
    background-color: color-mix(in srgb, var(--accent-primary) 15%, transparent);
}
.view-toggle-btn.active {
    background-color: var(--accent-primary);
    color: var(--text-title-color);
    box-shadow: var(--shadow-sm);
}

.view-pane {
    display: none;
}
.view-pane.active {
    display: block;
}
#pipelines-content-container.active {
    padding: var(--space-8);
}

/* Styles for React Flow Graph */
#graph-content-container .react-flow__panel {
    display: none; /* Hide default attribution */
}

#graph-content-container .react-flow__node {
    border-radius: var(--radius-md);
    border: 1px solid var(--border-primary);
    background: var(--secondary-surface-bg);
    color: var(--text-color);
    padding: var(--space-4);
    width: 250px;
    font-size: 0.9rem;
    box-shadow: var(--shadow-md);
    transition: all var(--transition-speed-base) var(--easing-subtle);
}
#graph-content-container .react-flow__node.selected {
    border-color: var(--border-focus);
    box-shadow: var(--shadow-lg), var(--shadow-focus-ring);
}
.graph-node-title {
    font-weight: 600;
    color: var(--text-title-color);
    padding-bottom: var(--space-2);
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-secondary);
}
.graph-node-body {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.graph-node-label {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.graph-node-status {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 500;
    margin-left: var(--space-3);
}

/* Status-specific edge colors */
.react-flow__edge.status-completed path { stroke: var(--accent-secondary); }
.react-flow__edge.status-running path,
.react-flow__edge.status-processing path { stroke: var(--accent-tertiary); }
.react-flow__edge.status-error path { stroke: var(--accent-error); }
.react-flow__edge.status-cancelled path { stroke: var(--text-secondary-color); }
.react-flow__edge path { stroke-width: 2; }
```

#### **File: `index.tsx`**

This is where the main logic will reside.

```typescript
// Add new imports at the top
import ReactFlow, { ReactFlowProvider, Background, Controls, MiniMap, Node, Edge } from 'react-flow';
import 'react-flow/dist/style.css';
import { dagreLayout } from './graphLayout'; // We will create this helper file

// ... existing interfaces ...

// Add a new type for the view mode
type ViewMode = 'list' | 'graph';

// Add new global state variable
let currentViewMode: ViewMode = 'list';

// Add new DOM element selectors
const viewToggleContainer = document.getElementById('view-toggle-container') as HTMLElement;
const viewToggleListBtn = document.getElementById('view-toggle-list') as HTMLButtonElement;
const viewToggleGraphBtn = document.getElementById('view-toggle-graph') as HTMLButtonElement;
const listViewContainer = document.getElementById('pipelines-content-container') as HTMLElement;
const graphViewContainer = document.getElementById('graph-content-container') as HTMLElement;

// --- Create a new helper file: `graphLayout.ts` ---
// This file will contain the logic to automatically layout the graph.
// Create a new file named `graphLayout.ts` in the same directory.
/*
// graphLayout.ts
import { Edge, Node, Position } from 'react-flow';
import Dagre from '@dagrejs/dagre';

const dagreGraph = new Dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 270;
const nodeHeight = 100;

export const dagreLayout = (nodes: Node[], edges: Edge[], direction = 'TB') => {
    dagreGraph.setGraph({ rankdir: direction });
    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });
    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });
    Dagre.layout(dagreGraph);

    nodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.targetPosition = Position.Top;
        node.sourcePosition = Position.Bottom;
        node.position = {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
        };
        return node;
    });

    return { nodes, edges };
};
*/
// You will need to install dagrejs: `npm install @dagrejs/dagre @types/dagre`

// --- Back in `index.tsx` ---

// Custom Node Component
const CustomGraphNode = ({ data }: { data: { title: string, label: string, status: string } }) => {
    return (
        <>
            <div className="graph-node-title">{data.title}</div>
            <div className="graph-node-body">
                <span className="graph-node-label">{data.label}</span>
                <span className={`status-badge graph-node-status status-${data.status}`}>{data.status}</span>
            </div>
        </>
    );
};

// Functions to convert pipeline state to graph data
function pipelineToGraphData(pipeline: PipelineState): { nodes: Node[], edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    const rootId = `p${pipeline.id}-root`;
    nodes.push({
        id: rootId,
        type: 'custom',
        data: { title: `Variant ${pipeline.id + 1}`, label: `T: ${pipeline.temperature}`, status: pipeline.status },
        position: { x: 0, y: 0 },
    });

    pipeline.iterations.forEach((iter, index) => {
        const nodeId = `p${pipeline.id}-i${iter.iterationNumber}`;
        nodes.push({
            id: nodeId,
            type: 'custom',
            data: { title: `Step ${index}`, label: iter.title, status: iter.status },
            position: { x: 0, y: 0 },
        });

        const sourceId = index === 0 ? rootId : `p${pipeline.id}-i${pipeline.iterations[index - 1].iterationNumber}`;
        edges.push({
            id: `e-${sourceId}-${nodeId}`,
            source: sourceId,
            target: nodeId,
            animated: iter.status === 'processing' || iter.status === 'retrying',
            className: `status-${iter.status}`
        });
    });

    return dagreLayout(nodes, edges);
}

function mathPipelineToGraphData(pipeline: MathPipelineState): { nodes: Node[], edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const rootId = 'math-root';
    nodes.push({
        id: rootId,
        type: 'custom',
        data: { title: 'Math Problem', label: pipeline.problemText.substring(0, 30) + '...', status: pipeline.status },
        position: { x: 0, y: 0 },
    });

    pipeline.initialStrategies.forEach(mainStrat => {
        const mainStratId = `ms-${mainStrat.id}`;
        nodes.push({
            id: mainStratId,
            type: 'custom',
            data: { title: `Strategy: ${mainStrat.id}`, label: mainStrat.strategyText.substring(0, 30) + '...', status: mainStrat.status },
            position: { x: 0, y: 0 },
        });
        edges.push({ id: `e-${rootId}-${mainStratId}`, source: rootId, target: mainStratId, className: `status-${mainStrat.status}` });

        mainStrat.subStrategies.forEach(subStrat => {
            const subStratId = `ss-${subStrat.id}`;
            nodes.push({
                id: subStratId,
                type: 'custom',
                data: { title: `Sub-Strategy: ${subStrat.id}`, label: subStrat.subStrategyText.substring(0, 30) + '...', status: subStrat.status },
                position: { x: 0, y: 0 },
            });
            edges.push({ id: `e-${mainStratId}-${subStratId}`, source: mainStratId, target: subStratId, animated: subStrat.status === 'processing', className: `status-${subStrat.status}` });
        });
    });
    
    return dagreLayout(nodes, edges);
}

function reactPipelineToGraphData(pipeline: ReactPipelineState): { nodes: Node[], edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const rootId = 'react-root';
    nodes.push({
        id: rootId,
        type: 'custom',
        data: { title: 'Orchestrator', label: pipeline.userRequest.substring(0, 30) + '...', status: pipeline.status },
        position: { x: 0, y: 0 },
    });

    pipeline.stages.forEach(stage => {
        const stageId = `react-s${stage.id}`;
        nodes.push({
            id: stageId,
            type: 'custom',
            data: { title: `Worker ${stage.id + 1}`, label: stage.title, status: stage.status },
            position: { x: 0, y: 0 },
        });
        edges.push({ id: `e-${rootId}-${stageId}`, source: rootId, target: stageId, animated: stage.status === 'processing', className: `status-${stage.status}` });
    });

    if (pipeline.finalAppendedCode) {
        const finalId = 'react-final';
        nodes.push({
            id: finalId,
            type: 'custom',
            data: { title: 'Final Output', label: 'Aggregated Code', status: 'completed' },
            position: { x: 0, y: 0 },
        });
        pipeline.stages.forEach(stage => {
            edges.push({ id: `e-s${stage.id}-${finalId}`, source: `react-s${stage.id}`, target: finalId, className: 'status-completed' });
        });
    }

    return dagreLayout(nodes, edges);
}

// Function to render the graph
function renderGraphView() {
    if (!graphViewContainer) return;
    graphViewContainer.innerHTML = ''; // Clear previous graph

    let graphData: { nodes: Node[], edges: Edge[] } | null = null;
    const activePipeline = pipelinesState.find(p => p.id === activePipelineId);

    if (currentMode === 'math' && activeMathPipeline) {
        graphData = mathPipelineToGraphData(activeMathPipeline);
    } else if (currentMode === 'react' && activeReactPipeline) {
        graphData = reactPipelineToGraphData(activeReactPipeline);
    } else if (activePipeline) {
        graphData = pipelineToGraphData(activePipeline);
    }

    if (graphData) {
        const { nodes, edges } = graphData;
        const nodeTypes = { custom: CustomGraphNode };

        const reactFlowInstance = (
            <ReactFlowProvider>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    fitView
                    className="bg-transparent"
                >
                    <Background />
                    <Controls />
                    <MiniMap />
                </ReactFlow>
            </ReactFlowProvider>
        );
        // This is a simplification. In a real React app, you'd mount this component.
        // For this vanilla JS project, we will have to use ReactDOM.render if it's not already set up.
        // Assuming a simple setup, we'll just indicate where it should go.
        // To make this work, the project needs to be structured to use React for rendering.
        // Let's assume we can use a library like `preact` or `react-dom/client` to mount this.
        // For the plan, let's assume `ReactDOM.createRoot(graphViewContainer).render(reactFlowInstance);`
    }
}

// Function to handle view switching
function setViewMode(mode: ViewMode) {
    currentViewMode = mode;
    if (mode === 'list') {
        listViewContainer.classList.add('active');
        graphViewContainer.classList.remove('active');
        viewToggleListBtn.classList.add('active');
        viewToggleGraphBtn.classList.remove('active');
    } else {
        listViewContainer.classList.remove('active');
        graphViewContainer.classList.add('active');
        viewToggleListBtn.classList.remove('active');
        viewToggleGraphBtn.classList.add('active');
        renderGraphView();
    }
}

// Update `initializeUI` to add event listeners
function initializeUI() {
    // ... existing code
    if (viewToggleListBtn && viewToggleGraphBtn) {
        viewToggleListBtn.addEventListener('click', () => setViewMode('list'));
        viewToggleGraphBtn.addEventListener('click', () => setViewMode('graph'));
    }
    // ... existing code
}

// Update the main render functions to show the toggle
function renderPipelines() {
    // ... at the start of the function
    if (viewToggleContainer) {
        viewToggleContainer.style.display = pipelinesState.length > 0 ? 'flex' : 'none';
    }
    // ... existing rendering logic
    if (currentViewMode === 'graph') {
        renderGraphView();
    }
}

// Do the same for `renderActiveMathPipeline` and `renderReactModePipeline`
function renderActiveMathPipeline() {
    // ... at the start of the function
    if (viewToggleContainer) {
        viewToggleContainer.style.display = activeMathPipeline ? 'flex' : 'none';
    }
    // ... existing rendering logic
    if (currentViewMode === 'graph') {
        renderGraphView();
    }
}
// ... and so on for React mode.
```

### 1.4. Rationale & Benefits

This approach provides a clean separation between list and graph views. Using `react-flow` gives us a powerful, customizable, and performant foundation for the graph. The `dagre` layout algorithm automates node positioning, which is crucial for dynamic graphs. The custom node component ensures the graph's visual style is consistent with the rest of the application's design system. This feature will massively improve the user's ability to comprehend complex, parallel AI workflows at a glance.

***

## 2. Feature: Side-by-Side Diff Viewer

### 2.1. Objective

Enable researchers to compare the generated output of any two iterations or variants, highlighting the differences to speed up analysis of prompt/parameter changes.

### 2.2. Dependency Installation

Install a lightweight diffing library.

```bash
npm install diff
```

### 2.3. File-by-File Implementation Details

#### **File: `index.html`**

1.  **Add a "Compare" button** to the iteration detail template.
2.  **Add a modal structure** for the diff viewer to the end of the `<body>`.

```html
<!-- In the prompts modal overlay section, AFTER the existing modal -->
<div id="diff-modal-overlay" class="prompts-modal-overlay">
    <div id="diff-modal-content" class="prompts-modal-content" role="dialog" aria-modal="true" aria-labelledby="diff-modal-title">
        <div class="prompts-modal-header">
            <h2 id="diff-modal-title" class="prompts-modal-title">Compare Outputs</h2>
            <button id="diff-modal-close-button" class="prompts-modal-close-button" aria-label="Close Comparison">×</button>
        </div>
        <div class="diff-modal-body">
            <div id="diff-selector-pane">
                <h3>Select item to compare against:</h3>
                <div id="diff-comparison-tree">
                    <!-- Tree of pipelines/iterations will be rendered here by TSX -->
                </div>
            </div>
            <div id="diff-viewer-pane">
                <div class="diff-header">
                    <div id="diff-source-header">Source</div>
                    <div id="diff-target-header">Comparison Target</div>
                </div>
                <div id="diff-output-container">
                    <!-- Diff results will be rendered here -->
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Inside the `renderIteration` function in `index.tsx`, find the download/copy buttons.
     Add a new 'Compare' button next to them. For example, for website mode: -->

<!-- ... inside the generatedOutputHtml variable for website mode ... -->
<button id="copy-html-${pipelineId}-${iter.iterationNumber}" ...>Copy HTML</button>
<button id="compare-output-${pipelineId}-${iter.iterationNumber}" class="button-base action-button" type="button" ${!iter.generatedHtml ? 'disabled' : ''}>Compare</button>
```

#### **File: `index.css`**

Add styles for the diff modal and its contents.

```css
/* Add to Section 9: PROMPTS MODAL (or a new section) */
.diff-modal-body {
    display: flex;
    padding: 0;
    overflow: hidden;
    height: 100%;
}

#diff-selector-pane {
    width: 350px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-secondary);
    padding: var(--space-6);
    overflow-y: auto;
}

#diff-selector-pane h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: var(--space-4);
}

#diff-comparison-tree {
    /* Styles for the selection tree */
}
#diff-comparison-tree ul {
    list-style: none;
    padding-left: var(--space-4);
}
#diff-comparison-tree li {
    margin-bottom: var(--space-2);
}
#diff-comparison-tree .pipeline-node > span {
    font-weight: 600;
    color: var(--text-title-color);
}
#diff-comparison-tree .iteration-node {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color var(--transition-speed-fast) ease;
}
#diff-comparison-tree .iteration-node:hover {
    background-color: var(--accent-primary);
}
#diff-comparison-tree .iteration-node.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: transparent;
}


#diff-viewer-pane {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.diff-header {
    display: grid;
    grid-template-columns: 1fr 1fr;
    text-align: center;
    padding: var(--space-4);
    background-color: var(--tertiary-surface-bg);
    border-bottom: 1px solid var(--border-secondary);
    font-weight: 600;
}

#diff-output-container {
    flex-grow: 1;
    overflow: auto;
    font-family: var(--font-family-mono);
    white-space: pre-wrap;
    font-size: 0.9rem;
    line-height: 1.7;
    background-color: var(--tertiary-surface-bg);
}
#diff-output-container pre {
    padding: var(--space-6);
}
#diff-output-container del {
    background-color: color-mix(in srgb, var(--accent-error) 20%, transparent);
    text-decoration: none;
}
#diff-output-container ins {
    background-color: color-mix(in srgb, var(--accent-secondary) 20%, transparent);
    text-decoration: none;
}
```

#### **File: `index.tsx`**

Implement the logic for the diff viewer.

```typescript
// Add new import
import { diffChars } from 'diff';

// Add new global state
let diffSource = { pipelineId: -1, iterationNumber: -1, content: '' };

// Add new DOM element selectors
const diffModalOverlay = document.getElementById('diff-modal-overlay') as HTMLElement;
const diffModalCloseButton = document.getElementById('diff-modal-close-button') as HTMLButtonElement;
const diffComparisonTreeContainer = document.getElementById('diff-comparison-tree') as HTMLElement;
const diffOutputContainer = document.getElementById('diff-output-container') as HTMLElement;
const diffSourceHeader = document.getElementById('diff-source-header') as HTMLElement;
const diffTargetHeader = document.getElementById('diff-target-header') as HTMLElement;


// Function to show/hide the diff modal
function setDiffModalVisible(visible: boolean) {
    // Similar logic to setPromptsModalVisible
    if (diffModalOverlay) {
        if (visible) {
            diffModalOverlay.style.display = 'flex';
            setTimeout(() => diffModalOverlay.classList.add('is-visible'), 10);
        } else {
            diffModalOverlay.classList.remove('is-visible');
            // Use transitionend listener to set display: none
        }
    }
}

// Function to render the comparison selection tree
function renderComparisonTree() {
    let treeHtml = '<ul>';
    pipelinesState.forEach(p => {
        treeHtml += `<li class="pipeline-node"><span>Variant ${p.id + 1} (T: ${p.temperature})</span><ul>`;
        p.iterations.forEach(iter => {
            const isSource = p.id === diffSource.pipelineId && iter.iterationNumber === diffSource.iterationNumber;
            const content = iter.generatedHtml || iter.generatedOrRevisedText || iter.generatedMainContent || '';
            const hasContent = !!content;
            treeHtml += `
                <li 
                    class="iteration-node ${isSource || !hasContent ? 'disabled' : ''}" 
                    data-pipeline-id="${p.id}" 
                    data-iteration-number="${iter.iterationNumber}"
                    title="${isSource ? 'This is the source item' : !hasContent ? 'No content to compare' : `Compare with Iteration ${iter.iterationNumber}`}"
                >
                    ${iter.title}
                </li>`;
        });
        treeHtml += '</ul></li>';
    });
    treeHtml += '</ul>';
    diffComparisonTreeContainer.innerHTML = treeHtml;

    // Add event listeners to the tree nodes
    diffComparisonTreeContainer.querySelectorAll('.iteration-node:not(.disabled)').forEach(node => {
        node.addEventListener('click', (e) => {
            const targetNode = e.currentTarget as HTMLElement;
            const pipelineId = parseInt(targetNode.dataset.pipelineId!);
            const iterationNumber = parseInt(targetNode.dataset.iterationNumber!);
            const targetPipeline = pipelinesState.find(p => p.id === pipelineId);
            const targetIteration = targetPipeline?.iterations.find(i => i.iterationNumber === iterationNumber);
            
            const targetContent = targetIteration?.generatedHtml || targetIteration?.generatedOrRevisedText || targetIteration?.generatedMainContent || '';
            runAndRenderDiff(diffSource.content, targetContent);
            diffTargetHeader.textContent = `Variant ${pipelineId+1} - Iter ${iterationNumber}`;
        });
    });
}

// Function to perform and render the diff
function runAndRenderDiff(source: string, target: string) {
    const diff = diffChars(source, target);
    let diffHtml = '';
    diff.forEach(part => {
        const colorClass = part.added ? 'ins' : part.removed ? 'del' : 'span';
        diffHtml += `<${colorClass}>${escapeHtml(part.value)}</${colorClass}>`;
    });
    diffOutputContainer.innerHTML = `<pre>${diffHtml}</pre>`;
}

// Function to open the diff modal
function openDiffModal(pipelineId: number, iterationNumber: number) {
    const pipeline = pipelinesState.find(p => p.id === pipelineId);
    const iteration = pipeline?.iterations.find(i => i.iterationNumber === iterationNumber);
    if (!iteration) return;

    const content = iteration.generatedHtml || iteration.generatedOrRevisedText || iteration.generatedMainContent || '';
    
    diffSource = { pipelineId, iterationNumber, content };
    
    // Reset view
    diffOutputContainer.innerHTML = '<p style="padding: 2rem; text-align: center; color: var(--text-secondary-color);">Select an item from the left to compare.</p>';
    diffSourceHeader.textContent = `Source: Variant ${pipelineId+1} - Iter ${iterationNumber}`;
    diffTargetHeader.textContent = 'Comparison Target';

    renderComparisonTree();
    setDiffModalVisible(true);
}

// Update `attachIterationActionButtons`
function attachIterationActionButtons(pipelineId: number, iterationNumber: number) {
    // ... existing button logic
    const compareButton = document.querySelector<HTMLButtonElement>(`#compare-output-${pipelineId}-${iterationNumber}`);
    if (compareButton) {
        compareButton.addEventListener('click', () => {
            openDiffModal(pipelineId, iterationNumber);
        });
    }
}

// Update `initializeUI` to add modal close listeners
function initializeUI() {
    // ... existing code
    if (diffModalCloseButton) {
        diffModalCloseButton.addEventListener('click', () => setDiffModalVisible(false));
    }
    if (diffModalOverlay) {
        diffModalOverlay.addEventListener('click', e => {
            if (e.target === diffModalOverlay) setDiffModalVisible(false);
        });
    }
    // ... existing code
}
```

***

## 3. Feature: Collapsible Sidebar Sections

### 3.1. Objective

Improve the usability of the controls sidebar by making the main configuration groups collapsible, reducing visual clutter.

### 3.2. File-by-File Implementation Details

#### **File: `index.html`**

This is primarily an HTML structural change. We'll wrap the `input-group` divs in `<details>` tags and move the `h3.section-subtitle` into a `<summary>` tag.

```html
<!-- In aside#controls-sidebar, modify the input-group sections -->

<details class="input-group" open> <!-- 'open' makes it expanded by default -->
    <summary>
        <h3 class="section-subtitle">API Key Configuration</h3>
        <span class="collapse-icon-details" aria-hidden="true"></span>
    </summary>
    <div class="details-content">
        <label for="api-key-input" class="model-select-label">Gemini API Key:</label>
        <input type="password" id="api-key-input" class="input-base" placeholder="Enter your API Key">
        <!-- ... rest of the API key content ... -->
    </div>
</details>

<details class="input-group" open>
    <summary>
        <h3 class="section-subtitle">Application Mode</h3>
        <span class="collapse-icon-details" aria-hidden="true"></span>
    </summary>
    <div class="details-content">
        <div id="app-mode-selector" role="radiogroup" aria-label="Select Application Mode">
            <!-- ... radio buttons ... -->
        </div>
    </div>
</details>

<!-- Repeat this pattern for all major input-group sections -->
<!-- The main prompt input and generate button can remain outside a details element -->
<div class="input-group">
    <label for="initial-idea" id="initial-idea-label" class="model-select-label">HTML Idea:</label>
    <textarea id="initial-idea" class="input-base" placeholder="E.g., a personal blog about cooking..." rows="5"></textarea>
</div>
<!-- ... -->
<div class="input-group">
     <button id="generate-button" class="button-base" type="button">Generate HTML</button>
</div>
```

#### **File: `index.css`**

Add styles for the `<details>` and `<summary>` elements to integrate them into the design system.

```css
/* Add to Section 4: LAYOUT & PANELS */

.input-group summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    list-style: none; /* Remove default marker */
    padding: var(--space-2) 0;
}

.input-group summary::-webkit-details-marker {
    display: none;
}

.input-group summary .section-subtitle {
    /* Reset margins and borders as they are now part of the summary */
    margin: 0;
    padding: 0;
    border: none;
}

.collapse-icon-details {
    width: 1em;
    height: 1em;
    transition: transform var(--transition-speed-base) var(--easing-standard);
    color: var(--text-secondary-color);
}
.collapse-icon-details::before {
    content: '▶';
    display: inline-block;
    font-size: 0.7em;
    transform: translateY(-1px);
}
details[open] > summary .collapse-icon-details {
    transform: rotate(90deg);
}

/* Add some padding to the content inside the details */
.details-content {
    padding-top: var(--space-4);
}
```

### 3.3. Rationale & Benefits

Using the native `<details>` element is semantic, accessible, and requires minimal JavaScript. The CSS provides a clean, animated chevron for the open/close indicator, fully integrating it into the existing design. This will make the sidebar much cleaner, especially as more modes and configuration options are added in the future.

***

## 4. Feature: "Download & Run" for React Mode

### 4.1. Objective

Transform the React mode's text output into a fully structured, runnable Vite + React + TypeScript project, downloadable as a single `.zip` file.

### 4.2. Dependency Installation

Install JSZip for client-side zip file creation.

```bash
npm install jszip
```

### 4.3. File-by-File Implementation Details

#### **File: `index.tsx`**

We will create a new handler function for the download button and define the necessary boilerplate files.

```typescript
// Add new import
import JSZip from 'jszip';

// ... somewhere in the file, define the boilerplate content
const BOILERPLATE_FILES = {
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,

  'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})`,

  'package.json': `{
  "name": "generated-react-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@typescript-eslint/eslint-plugin": "^7.2.0",
    "@typescript-eslint/parser": "^7.2.0",
    "@vitejs/plugin-react": "^4.2.1",
    "eslint": "^8.57.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.6",
    "typescript": "^5.2.2",
    "vite": "^5.2.0"
  }
}`,

  '.gitignore': `node_modules
dist
.env
.DS_Store`
};


// New function to handle downloading the zip project
async function handleDownloadReactProject() {
    if (!activeReactPipeline || !activeReactPipeline.finalAppendedCode) {
        alert("No final code available to package.");
        return;
    }

    const zip = new JSZip();
    
    // Add boilerplate files
    for (const [fileName, content] of Object.entries(BOILERPLATE_FILES)) {
        zip.file(fileName, content);
    }
    
    // Parse the aggregated code and add to zip
    const fileRegex = /\/\/\s*---\s*FILE:\s*([^\s-]+)\s*---/g;
    let lastIndex = 0;
    let match;

    while ((match = fileRegex.exec(activeReactPipeline.finalAppendedCode)) !== null) {
        if (match.index > lastIndex) {
            // This captures content between the previous file and this one
            const filePath = activeReactPipeline.finalAppendedCode.substring(lastIndex).match(fileRegex)![1];
            const fileContent = activeReactPipeline.finalAppendedCode.substring(lastIndex + match[0].length, match.index);
            // Ensure src directory is created
            if (filePath.startsWith('src/')) {
                zip.folder('src');
            }
            zip.file(filePath, fileContent.trim());
        }
        lastIndex = match.index;
    }
    
    // Capture the last file
    if (lastIndex > 0) {
        const lastMatch = [...activeReactPipeline.finalAppendedCode.matchAll(fileRegex)].pop();
        if (lastMatch) {
            const filePath = lastMatch[1];
            const fileContent = activeReactPipeline.finalAppendedCode.substring(lastMatch.index + lastMatch[0].length);
             if (filePath.startsWith('src/')) {
                zip.folder('src');
            }
            zip.file(filePath, fileContent.trim());
        }
    }


    try {
        const content = await zip.generateAsync({ type: "blob" });
        const appName = activeReactPipeline.userRequest.substring(0, 20).replace(/\s/g, '_') || 'react_app';
        downloadFile(content, `${appName}.zip`, 'application/zip');
    } catch (err) {
        console.error("Failed to generate zip file", err);
        alert("Error creating zip file. Check the console for details.");
    }
}

// Update `renderReactModePipeline` to change the button and its listener
function renderReactModePipeline() {
    // ... inside the function, when rendering the final output pane
    if (pipeline.finalAppendedCode) {
        const finalOutputPane = document.createElement('div');
        // ...
        finalOutputPane.innerHTML = `
            <h3>Final Aggregated Application Code</h3>
            <p>...</p>
            <pre ...>${escapeHtml(pipeline.finalAppendedCode)}</pre>
            <button id="download-react-project-zip-button" class="button-base action-button" type="button">Download Runnable Project (.zip)</button>
        `;
        pipelinesContentContainer.appendChild(finalOutputPane);

        const downloadAppButton = document.getElementById('download-react-project-zip-button');
        if (downloadAppButton) {
            downloadAppButton.addEventListener('click', handleDownloadReactProject);
        }
    }
    // ...
}
```

#### **File: `prompts.ts`**

It's a small but important change to update the orchestrator's awareness.

```typescript
// In `defaultCustomPromptsReact`, find the `sys_orchestrator` prompt.
// Add a bullet point to its "Key Considerations" or "Awareness of Environment" section:

// ... inside sys_orchestrator string ...
// Example addition:
/*
*   **Awareness of Environment & Final Output:** You, the Orchestrator, must be aware that the final output from all agents will be aggregated and packaged into a runnable Vite + React + TypeScript project. Your plan and agent instructions MUST generate the necessary root files (like `package.json`, `vite.config.ts`, `index.html`, `src/main.tsx`) and ensure all specified libraries are included in `package.json`. Agent 5 is a good candidate for generating these root-level configuration and entrypoint files.
*/
```

### 4.4. Rationale & Benefits

This implementation makes the React mode exponentially more useful. Instead of a simple text dump, the user gets a fully-formed project structure they can immediately `unzip`, `npm install`, and `npm run dev`. This provides instant feedback and a real-world starting point. Using JSZip handles this entirely on the client-side, requiring no backend. The parsing logic leverages the existing `// --- FILE:` convention, making it a robust extension of the current architecture.

***
