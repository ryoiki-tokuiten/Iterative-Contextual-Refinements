#!/usr/bin/env python3
"""Persistent Python worker for one agent-scoped virtual filesystem session."""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import time
import traceback

CURRENT_ACCESSED_IMAGE_FILES: set[str] | None = None
CURRENT_WRITTEN_IMAGE_FILES: set[str] | None = None
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
WORKSPACE_ROOT = os.path.abspath(os.environ.get("VIRTUAL_FS_ROOT") or os.getcwd())
ORIGINAL_CHDIR = os.chdir


def ensure_workspace_cwd() -> None:
    os.makedirs(WORKSPACE_ROOT, exist_ok=True)
    ORIGINAL_CHDIR(WORKSPACE_ROOT)


def is_inside_workspace(pathname: str) -> bool:
    resolved = os.path.abspath(pathname)
    return resolved == WORKSPACE_ROOT or resolved.startswith(WORKSPACE_ROOT + os.sep)


def patch_os_chdir() -> None:
    if getattr(os.chdir, "_vfs_chdir_guard", False):
        return

    def guarded_chdir(pathname):
        target = os.path.abspath(os.fspath(pathname))
        if not is_inside_workspace(target):
            raise PermissionError(
                "Cannot change directory outside the Python virtual filesystem. "
                "Use relative paths inside the current workspace."
            )
        ORIGINAL_CHDIR(target)

    guarded_chdir._vfs_chdir_guard = True  # type: ignore[attr-defined]
    os.chdir = guarded_chdir


def configure_runtime() -> None:
    os.environ.setdefault("MPLBACKEND", "Agg")
    patch_os_chdir()
    try:
        import matplotlib

        matplotlib.use("Agg", force=True)
    except Exception:
        pass
    patch_image_access_tracking()
    patch_image_write_tracking()


def normalize_image_path(value: object) -> str | None:
    filename = value
    if not isinstance(filename, (str, os.PathLike)) and hasattr(filename, "name"):
        filename = getattr(filename, "name")
    if not isinstance(filename, (str, os.PathLike)):
        return None

    raw_path = os.fspath(filename)
    if not raw_path or os.path.splitext(raw_path)[1].lower() not in IMAGE_EXTENSIONS:
        return None

    absolute_path = os.path.abspath(raw_path)
    try:
        relative_path = os.path.relpath(absolute_path, WORKSPACE_ROOT)
    except ValueError:
        return None

    if relative_path == "." or relative_path.startswith(".."):
        return None
    return relative_path.replace(os.sep, "/")


def record_image_access(filename: object) -> None:
    if CURRENT_ACCESSED_IMAGE_FILES is None:
        return
    relative_path = normalize_image_path(filename)
    if relative_path:
        CURRENT_ACCESSED_IMAGE_FILES.add(relative_path)


def record_image_write(filename: object) -> None:
    if CURRENT_WRITTEN_IMAGE_FILES is None:
        return
    relative_path = normalize_image_path(filename)
    if relative_path:
        CURRENT_WRITTEN_IMAGE_FILES.add(relative_path)


def patch_image_access_tracking() -> None:
    try:
        from PIL import Image as PILImage

        original_open = PILImage.open
        if not getattr(original_open, "_vfs_access_tracking", False):
            def tracked_open(fp, *args, **kwargs):
                record_image_access(fp)
                return original_open(fp, *args, **kwargs)

            tracked_open._vfs_access_tracking = True  # type: ignore[attr-defined]
            PILImage.open = tracked_open
    except Exception:
        pass

    try:
        import cv2

        original_imread = cv2.imread
        if not getattr(original_imread, "_vfs_access_tracking", False):
            def tracked_imread(filename, *args, **kwargs):
                record_image_access(filename)
                return original_imread(filename, *args, **kwargs)

            tracked_imread._vfs_access_tracking = True  # type: ignore[attr-defined]
            cv2.imread = tracked_imread
    except Exception:
        pass


def patch_image_write_tracking() -> None:
    try:
        from matplotlib.figure import Figure

        original_savefig = Figure.savefig
        if not getattr(original_savefig, "_vfs_write_tracking", False):
            def tracked_savefig(self, fname, *args, **kwargs):
                record_image_write(fname)
                return original_savefig(self, fname, *args, **kwargs)

            tracked_savefig._vfs_write_tracking = True  # type: ignore[attr-defined]
            Figure.savefig = tracked_savefig
    except Exception:
        pass

    try:
        from PIL import Image as PILImage

        original_save = PILImage.Image.save
        if not getattr(original_save, "_vfs_write_tracking", False):
            def tracked_save(self, fp, *args, **kwargs):
                record_image_write(fp)
                return original_save(self, fp, *args, **kwargs)

            tracked_save._vfs_write_tracking = True  # type: ignore[attr-defined]
            PILImage.Image.save = tracked_save
    except Exception:
        pass

    try:
        import cv2

        original_imwrite = cv2.imwrite
        if not getattr(original_imwrite, "_vfs_write_tracking", False):
            def tracked_imwrite(filename, *args, **kwargs):
                record_image_write(filename)
                return original_imwrite(filename, *args, **kwargs)

            tracked_imwrite._vfs_write_tracking = True  # type: ignore[attr-defined]
            cv2.imwrite = tracked_imwrite
    except Exception:
        pass


def coerce_exit_code(value: object) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    return 1


def execute_code(code: str, globals_dict: dict[str, object]) -> dict[str, object]:
    global CURRENT_ACCESSED_IMAGE_FILES, CURRENT_WRITTEN_IMAGE_FILES
    started_at = time.time()
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    accessed_image_files: set[str] = set()
    written_image_files: set[str] = set()
    exit_code = 0
    error = None

    try:
        ensure_workspace_cwd()
        CURRENT_ACCESSED_IMAGE_FILES = accessed_image_files
        CURRENT_WRITTEN_IMAGE_FILES = written_image_files
        compiled = compile(code, "<python_virtual_filesystem>", "exec")
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            exec(compiled, globals_dict, globals_dict)
    except SystemExit as exc:
        exit_code = coerce_exit_code(exc.code)
        if exit_code != 0:
            error = f"SystemExit({exc.code!r})"
    except Exception:
        exit_code = 1
        error = traceback.format_exc()
    finally:
        CURRENT_ACCESSED_IMAGE_FILES = None
        CURRENT_WRITTEN_IMAGE_FILES = None
        with contextlib.suppress(Exception):
            ensure_workspace_cwd()

    duration_ms = int((time.time() - started_at) * 1000)
    return {
        "ok": exit_code == 0,
        "exitCode": exit_code,
        "stdout": stdout_buffer.getvalue(),
        "stderr": stderr_buffer.getvalue(),
        "error": error,
        "durationMs": duration_ms,
        "accessedImageFiles": sorted(accessed_image_files),
        "writtenImageFiles": sorted(written_image_files),
    }


def make_error_response(message: str) -> dict[str, object]:
    return {
        "ok": False,
        "exitCode": 1,
        "stdout": "",
        "stderr": message,
        "error": message,
        "durationMs": 0,
    }


def write_response(response: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def create_globals_dict() -> dict[str, object]:
    globals_dict: dict[str, object] = {
        "__name__": "__main__",
        "__file__": os.path.join(WORKSPACE_ROOT, "agent_tool_session.py"),
    }
    protected_names = set(globals_dict) | {"__builtins__", "reset_python_session", "clear_python_memory"}

    def reset_python_session() -> None:
        """Clear Python globals for this session without deleting virtual filesystem files."""
        for name in list(globals_dict):
            if name not in protected_names:
                del globals_dict[name]
        ensure_workspace_cwd()

    globals_dict["reset_python_session"] = reset_python_session
    globals_dict["clear_python_memory"] = reset_python_session
    return globals_dict


def main() -> int:
    ensure_workspace_cwd()
    configure_runtime()

    globals_dict = create_globals_dict()

    for line in sys.stdin:
        try:
            payload = json.loads(line)
        except Exception:
            write_response(make_error_response("Failed to parse execution payload."))
            continue

        code = payload.get("code", "")
        if not isinstance(code, str) or not code.strip():
            write_response(make_error_response("No Python code was provided."))
            continue

        write_response(execute_code(code, globals_dict))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
