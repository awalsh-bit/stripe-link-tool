#!/usr/bin/env python3
"""
Offline app shell.

A precache list is the kind of thing that rots quietly. Add a script to a page,
forget to add it to sw.js, and the page works perfectly at the desk and breaks
in a basement -- which is the worst possible place to discover it, and the one
place nobody tests. So the list is checked against the real files here.

This deliberately verifies in both directions:
  - everything a page loads is in the shell  (or the field tool breaks offline)
  - everything in the shell exists on disk   (or install logs warnings forever)

Run: python3 _qa/verify-offline-shell.py
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

failures: list[str] = []
checks = 0


def check(label, got, want):
    global checks
    checks += 1
    ok = got == want
    if not ok:
        failures.append(f"{label}: got {got!r}, want {want!r}")
    print(f"{'ok  ' if ok else 'FAIL'}  {label:<62} {got!r}")
    return ok


def note(label, value):
    print(f"      {label:<62} {value}")


def strip_comments(js: str) -> str:
    """Code only.

    The first version of this file checked for substrings in the raw source and
    got two false failures off the source's own commentary -- sw.js explains why
    it avoids `cache.addAll`, and offline.js explains why the banner must never
    say "will sync". A check that reads the comment explaining a rule as a
    violation of that rule is worse than no check: it trains you to ignore it.
    """
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    js = re.sub(r"^\s*//.*$", "", js, flags=re.M)
    return js


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def main() -> int:
    sw_source = read("sw.js")
    sw = strip_comments(sw_source)

    # ---- the shell list, as the service worker actually sees it -------------
    body = re.search(r"const SHELL = \[(.*?)\n\];", sw, re.S)
    if not body:
        print("FAIL  could not find the SHELL list in sw.js")
        return 1
    shell = set(re.findall(r'"([^"]+)"', body.group(1)))
    note("shell entries", len(shell))

    # ---- every shell entry must exist --------------------------------------
    missing = sorted(p for p in shell if not os.path.exists(os.path.join(ROOT, p)))
    check("every precached path exists on disk", missing, [])

    # ---- every page, and everything every page loads ------------------------
    #
    # `field-preview.html` is a BUILD ARTIFACT, not a page of the app: it is the
    # whole field tool inlined into one self-contained file so Cayden can open
    # it on a phone with no server (tools/build_field_preview.py). It must not
    # be precached -- it is 800KB and duplicates every asset in the shell -- and
    # scanning it for asset references produces nonsense, because 800KB of
    # inlined JS contains template literals whose `${...}` placeholders look
    # like paths. Both of those showed up as failures the first time the file
    # was built before a QA run rather than after one.
    GENERATED = {"field-preview.html"}
    pages = sorted(f for f in os.listdir(ROOT) if f.endswith(".html") and f not in GENERATED)
    note("pages found", len(pages))
    check("every page is precached", sorted(p for p in pages if p not in shell), [])

    referenced: set[str] = set()
    for page in pages:
        html = read(page)
        # Inline <script> BODIES are not markup: filter-finder.html builds its
        # result panel from template literals containing href="${...}", which
        # are JS placeholders, not asset references. The tags themselves stay,
        # because a <script src="..."> is exactly what this scan is for.
        html = re.sub(r"(<script[^>]*>).*?(</script>)", r"\1\2", html, flags=re.S)
        for attr in re.findall(r'(?:src|href)="([^"]+)"', html):
            # Skip absolute URLs, anchors, and the pages themselves (already checked).
            if attr.startswith(("http", "#", "mailto:", "data:")):
                continue
            path = attr.split("?", 1)[0].split("#", 1)[0]
            if not path or path.endswith(".html"):
                continue
            referenced.add(path)

    unshelled = sorted(p for p in referenced if p not in shell)
    check("every asset any page loads is precached", unshelled, [])

    # ---- the strategy invariants that make it safe -------------------------
    check("the cache name is versioned", bool(re.search(r'CACHE_VERSION = "wilson-v[\d.]+"', sw)), True)
    version = re.search(r'CACHE_VERSION = "(wilson-v[\d.]+)"', sw)
    note("cache version", version.group(1) if version else "?")

    # A stale worker serving last release's files is the specific footgun of a
    # prototype re-unzipped onto the same origin every version.
    check("old caches are deleted on activate", "caches.delete" in sw, True)
    check("the new worker takes over without closing every tab",
          "skipWaiting" in sw and "clients.claim" in sw, True)

    # The invoice import needs the Python server; a cached response would be a
    # lie, and caching a POST is not possible anyway.
    check("non-GET requests are left to the network", 'request.method !== "GET"' in sw, True)
    check("the API path is never served from cache", '"/api/"' in sw, True)
    check("cross-origin requests are not intercepted", "url.origin !== self.location.origin" in sw, True)

    # ?v= query strings on a precached asset would miss the cache entry.
    check("cache lookups ignore query strings", "ignoreSearch: true" in sw, True)
    stale_busters = sorted(
        page for page in pages
        if re.search(r'(?:src|href)="assets/[^"]+\?v=', read(page))
    )
    check("no page still hand-rolls a ?v= cache-buster", stale_busters, [])

    # A whole install must not fail over one missing icon.
    check("precaching survives an individual failure",
          "cache.addAll" not in sw and "cache.add(" in sw, True)

    # ---- the manifest ------------------------------------------------------
    manifest = json.loads(read("app.webmanifest"))
    check("the manifest installs as an app", manifest.get("display"), "standalone")
    icon_paths = [i["src"] for i in manifest.get("icons", [])]
    check("every manifest icon exists",
          sorted(p for p in icon_paths if not os.path.exists(os.path.join(ROOT, p))), [])
    check("every manifest icon is precached", sorted(p for p in icon_paths if p not in shell), [])
    # Android crops the icon to a circle; without a maskable icon the logo gets
    # its edges cut off on the home screen.
    check("a maskable icon is provided",
          any(i.get("purpose") == "maskable" for i in manifest.get("icons", [])), True)
    check("the manifest start page is precached", manifest.get("start_url") in shell, True)
    for shortcut in manifest.get("shortcuts", []):
        check(f"shortcut target {shortcut['url']} is precached", shortcut["url"] in shell, True)

    # ---- the wording, which is the part that can mislead someone -----------
    offline_js = strip_comments(read("assets", "offline.js"))
    # There is no upload path in this prototype. A banner promising a sync would
    # have a technician believe their photographs are safe on a server.
    for promise in ["will sync", "will be uploaded", "syncing", "will upload"]:
        check(f"the offline banner never promises to {promise!r}",
              promise in offline_js.lower(), False)
    check("it says the work is held on the device", "have not been sent anywhere yet" in offline_js, True)
    check("it counts what is held rather than asserting it",
          "pendingUpload" in offline_js and "techInspections" in offline_js, True)
    check("service worker registration is guarded by secure context",
          "isSecureContext" in offline_js, True)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S) of {checks} checks:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"ALL {checks} OFFLINE SHELL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
