"""Watched-folder importer (spec §3.2). Mirrors the sales-side pattern in C:\\WilsonRouting\\import_epass.py:
a Task Scheduler job runs `python -m wilson_service.cli watch --once` every 5 minutes; it finds the newest
DispatchTrackDetail_*.csv not yet in import_batch, imports it, and logs one line.

The ExportInvoice xlsx is uploaded by hand today; `watch` also looks for ExportInvoice_*.xlsx in an optional
second folder (`import.ei_folder` setting) so the same task handles both once ePASS drops it there.
"""
from __future__ import annotations

import datetime as _dt
import fnmatch
import logging
import os
from typing import Optional

from .db import DB
from .importers import dispatchtrack, exportinvoice

log = logging.getLogger("wilson_service.watch")


def list_candidates(folder: str, pattern: str) -> list[str]:
    try:
        names = [n for n in os.listdir(folder) if fnmatch.fnmatch(n, pattern)]
    except FileNotFoundError:
        log.error("folder not found: %s", folder)
        return []
    names.sort(key=lambda n: os.path.getmtime(os.path.join(folder, n)))  # oldest first
    return [os.path.join(folder, n) for n in names]


def unimported(db: DB, paths: list[str]) -> list[str]:
    done = {r["file_name"] for r in db.fetchall("SELECT file_name FROM import_batch WHERE status IN ('ok','running')")}
    return [p for p in paths if os.path.basename(p) not in done]


def run_once(db: DB, *, dt_folder: Optional[str] = None, dt_pattern: Optional[str] = None, ei_folder: Optional[str] = None, all_files: Optional[bool] = None,
             now: Optional[_dt.datetime] = None) -> list[str]:
    """Import what is new. Returns one summary line per file processed."""
    out = []
    dt_folder = dt_folder or db.setting("import.dt_folder")
    dt_pattern = dt_pattern or db.setting("import.dt_pattern", "DispatchTrackDetail_*.csv")
    all_files = db.setting("import.dt_watch_all", False) if all_files is None else all_files
    todo = unimported(db, list_candidates(dt_folder, dt_pattern)) if dt_folder else []
    if todo and not all_files:
        todo = todo[-1:]  # full snapshot: only the newest matters
    for p in todo:
        out.append(_import(db, dispatchtrack, p, now))
    ei_folder = ei_folder or db.setting("import.ei_folder")
    if ei_folder:
        for p in unimported(db, list_candidates(ei_folder, "ExportInvoice_*.xlsx"))[-1:]:
            out.append(_import(db, exportinvoice, p, now))
    if not out:
        out.append("nothing new")
    else:
        # 9/14: routes just changed — re-score every penciled install (moves only when clearly better, pencil.move_threshold_min)
        from . import placement
        try:
            n = placement.repencil_all(db, "watcher", now=now)
            db.commit()
            out.append(f"PENCIL {n} install(s) re-scored")
        except Exception as e:  # never let the pencil break the import loop
            db.rollback()
            log.exception("repencil failed")
            out.append(f"PENCIL failed: {type(e).__name__}: {e}")
    for line in out:
        log.info(line)
    return out


def _import(db: DB, mod, path: str, now) -> str:
    try:
        res = mod.import_file(db, path, now=now)
        return "OK   " + res.summary()
    except (dispatchtrack.AlreadyImported, exportinvoice.AlreadyImported):
        return f"SKIP {os.path.basename(path)} already imported"
    except Exception as e:  # recorded on the batch row already
        log.exception("import failed: %s", path)
        return f"FAIL {os.path.basename(path)}: {type(e).__name__}: {e}"
