# **`plan.md`: Feature Enhancement Plan**

This document outlines the implementation of four high-impact features for the Iterative Studio. The focus is on *what* these features are, what they will look like, and how a user will interact with them, rather than the specific code implementation.

---

### **1. Feature: Pipeline Graph Visualization**

#### **1.1. Objective**

To provide a clear, intuitive, and interactive graph-based visualization of the application's workflows. This will replace the simple text list with a powerful visual map, making it easier for researchers to understand complex, parallel, and tree-structured processes at a glance.

#### **1.2. User Interaction & Layout**

1.  **View Toggling:**
    *   In the main content area, directly above the tabs for each pipeline variant, a new "View" toggle control will appear whenever a pipeline is active.
    *   This control will feature two icon buttons: "List View" (the current default) and "Graph View". The active view's button will be highlighted.
    *   Clicking the "Graph View" button will cause the current list of iterations to fade out and be replaced by the new interactive graph, which will automatically zoom to fit the entire workflow.

2.  **Graph Interaction:**
    *   Users can pan around the graph by clicking and dragging the background.
    *   Users can zoom in and out using their mouse wheel or the provided on-screen zoom controls.
    *   A mini-map will be visible in a corner of the screen, showing a high-level overview of the entire graph and the user's current position.
    *   Hovering over a node in the graph will show a tooltip with more details. Clicking a node will select it, which can be used for future features like opening a detailed side-panel.

#### **1.3. Design & Style**

The graph visualization will be seamlessly integrated into the existing "Nebula Flow" theme.

*   **Nodes (Workflow Steps):**
    *   Each step in the pipeline (e.g., an iteration, a strategy, an agent task) will be represented as a rectangular node with rounded corners.
    *   Nodes will use the `secondary-surface-bg` for their background, with a `border-primary` border. Selected nodes will have a `border-focus` colored border and a subtle glow.
    *   Each node will contain a clear title (e.g., "Step 1: Initial Gen"), a short descriptive label (e.g., "Refine & Suggest"), and a status badge (e.g., `completed`, `running`, `error`) that uses the same colors and styles as the existing status badges.

*   **Edges (Connections):**
    *   Lines connecting the nodes will be colored to represent the status of the process:
        *   **Green (`accent-secondary`):** Completed successfully.
        *   **Yellow/Gold (`accent-tertiary`):** Currently running or processing. These lines will have a subtle animation, like a slow-moving pulse, to indicate live activity.
        *   **Red (`accent-error`):** The process failed.
        *   **Gray (`text-secondary-color`):** Pending or cancelled.
    *   The edges will be slightly thick with rounded connections to the nodes, giving the graph a clean, modern feel.

#### **1.4. Mode-Specific Graph Structures**

The graph's structure will intelligently adapt to the selected application mode:

*   **Website / Creative / Agent Modes:** The graph will be a clear, top-to-bottom **linear chain**. It will start with a root node representing the "Variant" (e.g., "Variant 1, Temp: 0.7") and flow downwards through each iteration step, showing the simple, sequential nature of the process.

*   **Math Mode:** The graph will be a **tree structure**, perfectly visualizing the problem-solving strategy.
    *   **Root:** A single node at the top representing the "Original Problem".
    *   **Main Branches:** Branching out from the root will be nodes for each "Initial Strategy". This immediately shows the different high-level approaches being taken.
    *   **Sub-Branches:** Each "Initial Strategy" node will then branch out into its "Sub-Strategies", creating a second level of the tree.
    *   **Leaves:** The final nodes on each path will be the "Solution Attempts". This layout makes it instantly obvious which strategic paths were explored and which were successful, dead-ends, or errored out.

*   **React Mode:** The graph will be a **hub-and-spoke (or star) diagram**, illustrating the parallel agent architecture.
    *   **Center Hub:** A central "Orchestrator Agent" node.
    *   **Spokes:** Five "Worker Agent" nodes will be arranged around the orchestrator, with lines connecting from the center hub to each worker. This visualizes that the orchestrator initiates all parallel tasks.
    *   **Collector Node:** A final "Aggregated Output" node will appear at the bottom, with lines converging into it from all five worker agents, showing how their individual outputs combine to form the final result.

---

### **2. Feature: Side-by-Side Diff Viewer**

#### **2.1. Objective**

To allow researchers to directly compare the output of any two generation steps, making it easy to see the exact changes and analyze the impact of different prompts or parameters.

#### **2.2. User Interaction & Layout**

1.  **Initiating a Comparison:**
    *   Inside the details of any completed iteration that has generated content (HTML, text, or code), a new "Compare" button will be added next to the existing "Download" and "Copy" buttons.
    *   Clicking this "Compare" button will open a large, full-screen modal window, similar to the "Custom Prompts" editor. The item clicked will be designated as the "Source" for the comparison.

2.  **The Diff Modal Layout:**
    *   The modal will be divided into two main panels:
        *   **Left Panel (Selector):** A narrow panel (approx. 25% of the width) will display a collapsible tree view of all other available outputs from all pipeline variants. The user can navigate this tree and click on any other iteration to select it as the "Comparison Target". Items that are the source or have no content will be disabled.
        *   **Right Panel (Viewer):** This larger panel will initially be empty. Once the user selects a "Comparison Target" from the left panel, this area will populate with the side-by-side diff.

3.  **Viewing the Diff:**
    *   The right panel will show the two text blocks side-by-side. Lines that were removed from the source will be highlighted in red, and lines that were added in the target will be highlighted in green. Unchanged lines will have a neutral background.
    *   The user can scroll through the diff to examine all changes.

#### **2.3. Design & Style**

*   The modal will use the same blurred backdrop and panel styles as the "Custom Prompts" modal for a consistent user experience.
*   The diff highlighting will use translucent versions of the theme's accent colors:
    *   **Additions:** A light green background (e.g., `accent-secondary` at 20% opacity).
    *   **Deletions:** A light red background (e.g., `accent-error` at 20% opacity).
*   The text inside the diff viewer will use the theme's monospace font (`Fira Code`) for clear alignment and readability of code and text.

---

### **3. Feature: Collapsible Sidebar Sections**

#### **3.1. Objective**

To streamline the main controls sidebar by making configuration groups collapsible, reducing visual clutter and allowing the user to focus on the most relevant settings.

#### **3.2. User Interaction & Layout**

*   The main configuration groups in the sidebar ("API Key Configuration", "Application Mode", "Model Selection", etc.) will be converted into collapsible sections.
*   The title of each section will now be a clickable header.
*   By default, all sections will be open when the application loads.
*   When a user clicks on a section's header, the content within that section will smoothly animate, collapsing upwards to hide it. The header will remain visible.
*   Clicking the header again will expand the section to reveal its content.

#### **3.3. Design & Style**

*   A small, animated chevron icon (`▶`) will be placed to the right of each section title.
*   When a section is collapsed, the chevron will point to the right.
*   When a section is expanded, the chevron will rotate smoothly to point downwards (`▼`).
*   The section headers will have a subtle background color change on hover to indicate they are clickable, consistent with other interactive elements in the app.

---

### **4. Feature: "Download & Run" Package for React Mode**

#### **4.1. Objective**

To elevate the React Mode's output from a single text file of concatenated code into a fully structured, instantly runnable Vite + React project, downloadable as a single `.zip` file.

#### **4.2. User Interaction & Layout**

*   The user interaction for this feature is very straightforward and requires minimal UI change.
*   In the React Mode's final output view, where the aggregated code is displayed, the existing download button will be updated.
*   Its text will change from "Download Full App Code" to **"Download Runnable Project (.zip)"**.
*   When the user clicks this button, their browser will initiate the download of a single file (e.g., `my-react-app.zip`).

#### **4.3. What the User Gets**

*   Upon unzipping the downloaded file, the user will find a standard, complete React project folder structure, exactly as defined by the orchestrator agent's `plan.txt`. This includes:
    *   `package.json` (with all necessary dependencies like React, Vite, etc.)
    *   `vite.config.ts`
    *   `index.html` (the root HTML file)
    *   `.gitignore`
    *   A `src/` directory containing all the components, services, styles, and other files generated by the five worker agents, placed in their correct sub-folders (e.g., `src/components/`, `src/store/`).
*   The user can then immediately navigate to this folder in their terminal, run `npm install` to install dependencies, and then `npm run dev` to start the local development server and view their generated application in the browser.
