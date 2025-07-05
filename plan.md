**YOU MUST LIST "ALL" THE FILES FIRST AND READ "ALL" OF THEM BEFORE PROCEEDING. This is mandatory and failure to do so will be considered as failure of the entire task."

# **Enhanced Implementation Plan: Iterative Studio Feature Overhaul**

This document provides a detailed, file-by-file implementation plan for the features outlined in the original proposal. It is designed to be used by an AI developer to perform the required updates across the entire codebase, ensuring a consistent and high-quality implementation.

---

### **1. Feature: Collapsible Sidebar Sections**

**Objective:** To improve UI/UX by making sidebar configuration groups collapsible, reducing visual clutter and allowing users to focus. This will be implemented using the native `<details>` and `<summary>` HTML elements for simplicity, accessibility, and performance.

**Affected Files:**
- `index.html`
- `index.css`
- `index.tsx` (for state persistence)

#### **1.1. `index.html` Modifications**

The structure of the controls sidebar will be refactored. Each `.input-group` that acts as a self-contained section will be converted into a `<details>` element.

**Action:**
1.  Locate the `<aside id="controls-sidebar">`.
2.  For each of the following sections, replace the wrapping `<div class="input-group">` with `<details class="input-group" id="section-ID">`, and the inner `<h3 class="section-subtitle">` with `<summary class="section-subtitle">`. Add a chevron icon for visual feedback.
    *   **API Key Configuration:** `id="section-api-key"`
    *   **Application Mode:** `id="section-app-mode"`
    *   **Main Input (Idea/Premise/Problem):** `id="section-main-input"` (The div containing `initial-idea-label` and `initial-idea`)
    *   **Math Image Upload:** `id="math-problem-image-input-container"` (This is already a div, convert it to `<details>`)
    *   **Model Selection:** `id="model-selection-container"` (Convert to `<details>`)
    *   **Temperature Selection:** `id="temperature-selection-container"` (Convert to `<details>`)
    *   **Configuration Import/Export:** `id="section-config-management"` (The div containing `config-buttons-container`)
    *   **Custom Prompts:** The existing `div#custom-prompts-container` should be converted to `<details class="input-group" id="section-custom-prompts">`. The inner `.custom-prompts-header` becomes the `<summary>`.

**Example Transformation:**
*   **Current:**
    ```html
    <div class="input-group">
        <h3 class="section-subtitle">Application Mode</h3>
        <!-- content -->
    </div>
    ```
*   **New Structure:**
    ```html
    <details class="input-group" id="section-app-mode" open>
        <summary class="section-subtitle">
            <span>Application Mode</span>
            <svg class="collapse-chevron" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor"><path d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z"></path></svg>
        </summary>
        <!-- content -->
    </details>
    ```
3.  Apply this pattern consistently to all designated sidebar sections. Use the `open` attribute to have them expanded by default on first load.

#### **1.2. `index.css` Modifications**

Add new CSS rules to style the `<details>` and `<summary>` elements correctly within our theme.

**Action:**
1.  Add a new section in `index.css`, perhaps within "4. LAYOUT & PANELS" or a new "Sidebar Enhancements" section.
2.  Add the following styles:
    ```css
    /* Sidebar Collapsible Sections */
    #controls-sidebar details.input-group {
        padding: 0; /* Padding will be on summary and content now */
    }

    #controls-sidebar summary.section-subtitle {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        list-style: none; /* Remove default marker */
        padding: var(--space-4) var(--space-6);
        transition: background-color var(--transition-speed-fast) ease-in-out;
        border-radius: var(--radius-lg);
    }

    #controls-sidebar summary.section-subtitle::-webkit-details-marker {
        display: none; /* Hide marker for Safari */
    }

    #controls-sidebar summary.section-subtitle:hover {
        background-color: color-mix(in srgb, var(--accent-primary) 8%, transparent);
    }

    #controls-sidebar .collapse-chevron {
        transition: transform 0.2s var(--easing-standard);
        color: var(--text-secondary-color);
    }

    #controls-sidebar details[open] > summary .collapse-chevron {
        transform: rotate(180deg);
    }

    /* Add padding back to the content inside the details element */
    #controls-sidebar details > *:not(summary) {
        padding: 0 var(--space-6) var(--space-5) var(--space-6);
    }

    /* For sections with nested content, ensure proper structure */
    #controls-sidebar details .api-key-buttons,
    #controls-sidebar details #app-mode-selector {
        margin-top: var(--space-4);
    }
    ```

#### **1.3. `index.tsx` (State Persistence Enhancement)**

To improve user experience, the open/closed state of each sidebar section will be saved to `localStorage`.

**Action:**
1.  Create a new function `initializeSidebarState()`.
2.  Inside this function, retrieve a JSON object from `localStorage` (e.g., key `sidebarState`).
3.  Iterate over all `<details>` elements in the sidebar. For each one, if its `id` exists as a key in the stored state, set its `open` property accordingly.
4.  Create a function `saveSidebarState(detailsElement)`.
5.  This function will be called by an event listener. It gets the current state from `localStorage`, updates the key corresponding to the `detailsElement.id` with its new `open` status, and saves it back.
6.  In the main `DOMContentLoaded` or `initializeUI` function, add event listeners to all sidebar `<details>` elements. On a `toggle` event, call `saveSidebarState(event.target)`.
7.  Call `initializeSidebarState()` once at startup.

```typescript
// Add this inside index.tsx

function initializeSidebarStatePersistence() {
    const sidebar = document.getElementById('controls-sidebar');
    if (!sidebar) return;

    const detailsElements = sidebar.querySelectorAll<HTMLDetailsElement>('details.input-group');
    const storageKey = 'sidebarSectionState';

    // Load state on startup
    try {
        const savedState = JSON.parse(localStorage.getItem(storageKey) || '{}');
        detailsElements.forEach(el => {
            if (el.id && savedState[el.id] !== undefined) {
                el.open = savedState[el.id];
            }
        });
    } catch (e) {
        console.error("Could not load sidebar state:", e);
    }

    // Save state on toggle
    detailsElements.forEach(el => {
        el.addEventListener('toggle', () => {
            if (!el.id) return;
            try {
                const currentState = JSON.parse(localStorage.getItem(storageKey) || '{}');
                currentState[el.id] = el.open;
                localStorage.setItem(storageKey, JSON.stringify(currentState));
            } catch (e) {
                console.error("Could not save sidebar state:", e);
            }
        });
    });
}

// Call this function within initializeUI()
// initializeUI() {
//   ...
//   initializeSidebarStatePersistence();
//   ...
// }
```

---

### **2. Feature: Pipeline Graph Visualization**

**Objective:** To provide an intuitive, interactive graph-based visualization of application workflows, dynamically adapting to the selected mode.

**Dependencies:**
-   Add the **Mermaid.js** library for rendering graphs.

#### **2.1. `package.json` Modifications**

**Action:**
-   Add `mermaid` to the `dependencies`.
    ```json
    "dependencies": {
      "@google/genai": "^1.4.0",
      "mermaid": "^10.9.1"
    },
    ```
-   Run `npm install` to update `package-lock.json`.

#### **2.2. `index.html` Modifications**

**Action:**
1.  Add a view-toggle container above the tabs in `#main-content`.
2.  Add a dedicated container for the graph view within `#pipelines-content-container`.

```html
<!-- Inside <main id="main-content"> -->
<div class="main-content-header">
    <div id="view-toggle-container" class="view-toggle">
        <button id="view-toggle-list" class="view-toggle-btn active" aria-label="Switch to List View">List</button>
        <button id="view-toggle-graph" class="view-toggle-btn" aria-label="Switch to Graph View">Graph</button>
    </div>
    <div id="tabs-nav-container" role="tablist" aria-label="Generation Variants">
    </div>
</div>
<div id="pipelines-content-container">
    <!-- Existing .pipeline-content divs will be here -->
    <div id="graph-view-container" style="display: none;"></div>
</div>
```

#### **2.3. `index.css` Modifications**

**Action:** Add styles for the toggle, graph container, and Mermaid nodes/edges.

```css
/* Add to Section 8: MAIN CONTENT AREA */
.main-content-header {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-secondary);
    padding: 0 var(--space-6);
}

#tabs-nav-container {
    flex-grow: 1;
    border-bottom: none;
    padding: 0;
}

.view-toggle {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    margin-right: var(--space-6);
}

.view-toggle-btn {
    padding: var(--space-2) var(--space-4);
    font-size: 0.85rem;
    font-weight: 500;
    border: 1px solid var(--border-primary);
    background-color: var(--secondary-surface-bg);
    color: var(--text-secondary-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.2s ease;
}

.view-toggle-btn:hover {
    background-color: var(--tertiary-surface-bg);
    color: var(--text-color);
}

.view-toggle-btn.active {
    background-color: var(--accent-primary);
    color: var(--text-title-color);
    font-weight: 600;
    border-color: var(--accent-primary);
}

#graph-view-container {
    width: 100%;
    height: 100%;
    overflow: auto;
    padding: var(--space-8);
}

/* Mermaid.js Theme Styles */
.mermaid-node-default {
    fill: var(--secondary-surface-bg) !important;
    stroke: var(--border-primary) !important;
    color: var(--text-color) !important;
}
.mermaid-node-running {
    fill: color-mix(in srgb, var(--accent-tertiary) 15%, transparent) !important;
    stroke: var(--accent-tertiary) !important;
    color: var(--accent-tertiary) !important;
}
.mermaid-node-completed {
    fill: color-mix(in srgb, var(--accent-secondary) 15%, transparent) !important;
    stroke: var(--accent-secondary) !important;
    color: var(--accent-secondary) !important;
}
.mermaid-node-error {
    fill: color-mix(in srgb, var(--accent-error) 15%, transparent) !important;
    stroke: var(--accent-error) !important;
    color: var(--accent-error) !important;
}
.mermaid-edge {
    stroke: var(--text-secondary-color) !important;
}
.mermaid-edge-running {
    stroke: var(--accent-tertiary) !important;
}
.mermaid-edge-completed {
    stroke: var(--accent-secondary) !important;
}
.mermaid-edge-error {
    stroke: var(--accent-error) !important;
}
.edge-label {
    background-color: var(--primary-surface-bg) !important;
}
```

#### **2.4. `index.tsx` Modifications**

**Action:**
1.  Import Mermaid.js: `import mermaid from 'mermaid';`
2.  Initialize Mermaid in `initializeUI`:
    ```typescript
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
            // Use CSS variables for theming
            background: 'var(--primary-surface-bg)',
            primaryColor: 'var(--secondary-surface-bg)',
            primaryTextColor: 'var(--text-color)',
            primaryBorderColor: 'var(--border-primary)',
            lineColor: 'var(--text-secondary-color)',
            textColor: 'var(--text-secondary-color)',
            // ... add more if needed
        }
    });
    ```
3.  Add logic for the view toggle buttons to show/hide `#graph-view-container` vs. the standard content panes.
4.  Create a function `generateGraphDefinition(): string`. This function will check `currentMode` and call mode-specific helper functions (`generateWebsiteGraph`, `generateMathGraph`, `generateReactGraph`).
5.  Implement the mode-specific graph generation functions. They will iterate through the relevant state (`pipelinesState`, `activeMathPipeline`, `activeReactPipeline`) and build a Mermaid syntax string.
    -   **Website/Creative/Agent:** Will generate a `graph TD;` (top-down) linear chain. Nodes should be styled based on status.
    -   **Math:** Will generate a `graph TD;` tree structure. Root is the problem, branches are strategies, sub-branches are sub-strategies, leaves are solutions.
    -   **React:** Will generate a `graph TD;` hub-and-spoke diagram. Orchestrator at the top, spokes to 5 workers, which then all connect to a final "Aggregated Output" node.
6.  Create an `async function renderGraphView()` that gets the definition from `generateGraphDefinition`, inserts it into the `#graph-view-container` inside a `<pre class="mermaid">` tag, and then calls `await mermaid.run();`.
7.  Call `renderGraphView()` whenever the view is switched to "Graph" and whenever pipeline state is updated significantly.

---

### **3. Feature: Side-by-Side Diff Viewer**

**Objective:** To enable direct comparison of text/code outputs between any two steps in the process via a side-by-side diff view in a modal.

**Dependencies:**
-   Add the **`diff`** library for calculating differences.

#### **3.1. `package.json` Modifications**

**Action:**
-   Add `diff` to the `dependencies` and `@types/diff` to `devDependencies`.
    ```json
    "dependencies": {
        // ... existing
        "diff": "^5.2.0"
    },
    "devDependencies": {
        // ... existing
        "@types/diff": "^5.2.1"
    }
    ```
-   Run `npm install`.

#### **3.2. `index.html` Modifications**

**Action:**
1.  Add the HTML structure for the diff modal at the bottom of `<body>`, similar to the prompts modal.

    ```html
    <!-- Diff Viewer Modal -->
    <div id="diff-modal-overlay" class="prompts-modal-overlay">
        <div class="prompts-modal-content" role="dialog" aria-modal="true" aria-labelledby="diff-modal-title">
            <div class="prompts-modal-header">
                <h2 id="diff-modal-title" class="prompts-modal-title">Compare Outputs</h2>
                <button id="diff-modal-close-button" class="prompts-modal-close-button" aria-label="Close Diff Viewer">×</button>
            </div>
            <div id="diff-modal-body" class="diff-modal-body">
                <div id="diff-selector-panel">
                    <div id="diff-source-display">
                        <h4>Source (A)</h4>
                        <p id="diff-source-label">None selected</p>
                    </div>
                    <hr/>
                    <h4>Select Target (B)</h4>
                    <div id="diff-target-tree"></div>
                </div>
                <div id="diff-viewer-panel">
                    <div class="diff-no-selection">
                        <p>Select a source and target to view differences.</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    ```

#### **3.3. `index.css` Modifications**

**Action:** Add styles for the diff modal and its contents.

```css
/* Add to end of CSS file or new Section */
/* Diff Modal */
.diff-modal-body {
    display: flex;
    gap: var(--space-6);
    padding: 0;
    height: 100%;
}

#diff-selector-panel {
    width: 320px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-secondary);
    padding: var(--space-6);
    overflow-y: auto;
}

#diff-viewer-panel {
    flex-grow: 1;
    overflow: auto;
    font-family: var(--font-family-mono);
    font-size: 0.9rem;
    padding: var(--space-6);
}

#diff-source-display p {
    background-color: var(--tertiary-surface-bg);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-primary);
}

#diff-target-tree .tree-item {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 0.15s ease;
}
#diff-target-tree .tree-item:hover {
    background-color: color-mix(in srgb, var(--accent-primary) 15%, transparent);
}
#diff-target-tree .tree-item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: transparent;
}

.diff-view {
    white-space: pre;
}
.diff-view span {
    display: block;
    padding: 0.1em 0.5em;
}
.diff-view .diff-added {
    background-color: color-mix(in srgb, var(--accent-secondary) 20%, transparent);
}
.diff-view .diff-removed {
    background-color: color-mix(in srgb, var(--accent-error) 20%, transparent);
}
.diff-view .diff-neutral {
    color: var(--text-secondary-color);
}
```

#### **3.4. `index.tsx` Modifications**

**Action:**
1.  Import `diff`: `import * as Diff from 'diff';`
2.  In `renderIteration`, add a "Compare" button to generated content sections (HTML, text). Give it `data-*` attributes for `pipelineId` and `iterationNumber`.
3.  Add logic to open the modal, populating the source and the target tree.
4.  Implement a `renderDiff(sourceText, targetText)` function that uses `Diff.diffLines()`, then iterates the result to build an HTML string with `<span>`s and the appropriate classes (`diff-added`, `diff-removed`, `diff-neutral`), and injects it into `#diff-viewer-panel`.
5.  Hook up all the event listeners for opening the modal and selecting targets.

---

### **4. Feature: "Download & Run" Package for React Mode**

**Objective:** To package the React mode output into a complete, downloadable, and instantly runnable Vite + React project as a `.zip` file.

**Dependencies:**
-   Add the **`jszip`** library for creating zip files on the client.

#### **4.1. `package.json` Modifications**

**Action:**
-   Add `jszip` to `dependencies` and `@types/jszip` to `devDependencies`.
    ```json
    "dependencies": {
        // ... existing
        "jszip": "^3.10.1"
    },
    "devDependencies": {
        // ... existing
        "@types/jszip": "^3.4.1"
    }
    ```
-   Run `npm install`.

#### **4.2. `prompts.ts` Modifications**

**Action:**
-   Enhance the `sys_orchestrator` prompt in `defaultCustomPromptsReact`. Instruct the orchestrator that one agent (e.g., Agent 5) should be responsible for generating project boilerplate files like `package.json`, `vite.config.ts`, and `index.html`. This makes the AI responsible for the project setup.

    **Example addition to `sys_orchestrator`'s Agent 5 description:**
    > "...Agent 5 is responsible for creating the root-level project files required for a Vite + React + TypeScript application. This INCLUDES generating a complete `package.json` with all necessary dependencies (e.g., react, react-dom, vite, typescript, etc.), a functional `vite.config.ts`, and the root `public/index.html` file..."

#### **4.3. `index.tsx` Modifications**

**Action:**
1.  Import JSZip: `import JSZip from 'jszip';`
2.  Modify the event listener for the `#download-react-app-code` button (which should be renamed/re-labeled in `renderReactModePipeline` to "Download Runnable Project (.zip)").
3.  Create an `async function createAndDownloadReactProjectZip()` to be called by the listener.
4.  Inside this function:
    a.  Check if `activeReactPipeline` and `activeReactPipeline.finalAppendedCode` exist.
    b.  Instantiate JSZip: `const zip = new JSZip();`
    c.  **Parse the aggregated code:** Create a robust parser function that splits `finalAppendedCode` by the `// --- FILE: ... ---` markers into an array of `{ path: string, content: string }` objects.
    d.  **Add files to zip:** Loop through the parsed file objects and use `zip.file(file.path, file.content)` to add them to the zip archive, creating the correct directory structure.
    e.  **Generate and download:**
        ```typescript
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, `react-app-${activeReactPipeline.id}.zip`, 'application/zip');
        ```
    f.  The `downloadFile` function needs to be updated to handle a `Blob` as input, not just a string.

**Updated `downloadFile` function:**
```typescript
// Modify the existing downloadFile function in index.tsx
function downloadFile(content: string | Blob, fileName: string, contentType: string) {
    const a = document.createElement("a");
    const file = (content instanceof Blob) ? content : new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
}
```


-------------------------
