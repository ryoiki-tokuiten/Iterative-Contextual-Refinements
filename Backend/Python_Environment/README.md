# Python Tool Environment

This directory contains the Python tool environment used by Iterative
Corrections mode.

The backend prefers `Backend/Python_Environment/.venv/bin/python` when present,
then falls back to `python3` or `python` from the host. Install
`requirements.txt` into that virtual environment when you want the full
scientific/image stack available to agents.

`python_session_worker.py` runs as a persistent worker per agent session.
Variables, imports, functions, classes, and files persist across tool calls
inside that one session. Separate agents receive separate session ids, so
parallel agents do not share Python globals. If a session times out, only that
session worker is killed and restarted.

In Contextual mode, each agent role has its own persistent session across
iterations:

- Main Generator keeps its own Python memory and virtual filesystem.
- Solution Critique / Iterative Agent keeps its own Python memory and virtual
  filesystem.
- Strategic Pool Agent keeps its own Python memory and virtual filesystem.
- Memory Agent keeps its own Python memory and virtual filesystem.

Generated files are not shared between those agent filesystems. An agent can
load files from its own previous tool calls by filename. If it needs an artifact
shown in another agent's transcript, it should recreate the artifact in its own
session from the original uploaded image/data and save its own copy.

Agents can call `reset_python_session()` from inside the Python tool to soft
clear memory. `clear_python_memory()` is an equivalent alias. Soft clearing:

- Removes user-defined names from that agent session, including variables,
  imported module bindings, helper functions, classes, and cached objects.
- Keeps virtual filesystem files and returns the current working directory to
  the virtual filesystem root.
- Does not delete, rename, or modify images, uploaded files, generated plots,
  CSVs, or other files.
- Requires the agent to reimport libraries and recreate/reload any variables it
  still needs after the clear.

The current virtual filesystem contract intentionally exposes image files only:
uploaded images are seeded into the workspace, and generated or modified image
files are returned to the model as native image inputs plus filename references.
Each execution starts in the virtual filesystem root. `os.chdir(...)` is allowed
only inside that workspace; attempts to change into external directories such as
`/tmp` or `/mnt/data` fail loudly instead of creating invisible artifacts.
Existing image files opened through common APIs such as `PIL.Image.open(...)`
and `cv2.imread(...)` are also returned as viewed images, so read-only visual
inspection appears in the UI and is sent back to the model as native image
input without requiring base64 text.

Images shown in the transcript are served from immutable artifact snapshots, not
from the mutable live VFS path, so old UI previews keep rendering even if later
Python code deletes or overwrites the live workspace file.
