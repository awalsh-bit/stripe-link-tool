#!/usr/bin/env python3
"""
THE PHONE BUILD IS GENERATED, NOT FORKED

Cayden: "Is there a way to launch the field tool with a link you can send my
phone? I haven't been able to test it in a few days."

tools/build_field_preview.py inlines every script, stylesheet and icon into one
HTML file so the field tool can be opened from a link with no server behind it.

The danger in that is obvious and this codebase has been bitten by it before: a
second copy of the field tool that drifts from the first. These checks exist to
keep the build a DERIVATION.

  1. Every byte comes from the shipped assets. Nothing is authored in the
     builder except the preview-only launcher, which is additive and labelled.
  2. Nothing is left pointing at a file that will not be there -- one missed
     relative path is a broken page on somebody's phone with no console to read.
  3. The two runtime icon expressions it rewrites still exist in the source. If
     tech-maintenance.js renames them, the build must FAIL rather than quietly
     produce a page of broken images.
  4. The parts that cannot work without a server are omitted deliberately and
     say so, rather than erroring on load.

Run: python3 _qa/verify-field-preview.py
"""
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILDER = ROOT / "tools" / "build_field_preview.py"

checks = 0
failures = []


def check(label, got, want):
    global checks
    checks += 1
    ok = got == want
    if not ok:
        failures.append(f"{label}: got {got!r}, want {want!r}")
    print(("ok   " if ok else "FAIL ") + label.ljust(70) + ("" if ok else f" {got!r}"))


def note(label, value):
    print("     " + str(label).ljust(70) + " " + str(value))


print("=== the builder runs, and produces one file ===")
check("the builder is in the package", BUILDER.exists(), True)

with tempfile.TemporaryDirectory() as tmp:
    out = pathlib.Path(tmp) / "field-preview.html"
    result = subprocess.run([sys.executable, str(BUILDER), str(out)],
                            capture_output=True, text=True)
    check("it exits clean", result.returncode, 0)
    if result.returncode != 0:
        print(result.stdout, result.stderr)
        sys.exit(1)
    page = out.read_text(encoding="utf-8")
    note("page size", f"{len(page) / 1024:.0f} KB")

    frag_path = pathlib.Path(tmp) / "fragment.html"
    frag_result = subprocess.run([sys.executable, str(BUILDER), str(frag_path), "--fragment"],
                                 capture_output=True, text=True)
    check("and the fragment form builds too", frag_result.returncode, 0)
    fragment = frag_path.read_text(encoding="utf-8")

    print("\n=== nothing is left pointing at a file that will not be there ===")
    # `assets/offline.js` survives only inside the comment explaining its absence.
    dangling = sorted(set(re.findall(r'(?<!-)\b(assets/[A-Za-z0-9_./-]+\.(?:js|css|svg|png))', page)))
    dangling = [d for d in dangling if f"<!-- {d} omitted" not in page]
    check("no live reference to a file next to the page", dangling, [])
    check("no manifest link", "rel=\"manifest\"" in page, False)
    check("no apple-touch-icon link", "apple-touch-icon" in page, False)
    check("no service worker registration is attempted",
          "assets/offline.js\"" in page.replace("<!-- assets/offline.js omitted", ""), False)
    check("and its absence is explained rather than silent",
          "omitted from the phone preview" in page, True)

    print("\n=== every script the page declares is actually inlined ===")
    declared = re.findall(r'<script src="([^"]+)"></script>', (ROOT / "tech-maintenance.html").read_text(encoding="utf-8"))
    note("scripts on the real page", len(declared))
    missing = []
    for src in declared:
        if src == "assets/offline.js":
            continue
        # A distinctive first line from each file must appear in the build.
        body = (ROOT / src).read_text(encoding="utf-8")
        marker = body.strip().splitlines()[0].strip()
        if marker and marker not in page:
            missing.append(src)
    check("each one's source is present", missing, [])
    check("the stylesheet is inlined too",
          "<style>" in page and ".tech-equip-card" in page, True)

    print("\n=== the icon rewrite is asserted, not hoped for ===")
    tech = (ROOT / "assets" / "tech-maintenance.js").read_text(encoding="utf-8")
    for expression in ["return `assets/appliance-icons/${category.icon}`;",
                       'return `assets/appliance-icons/${map[templateKey(asset)]||"refrigeration.svg"}`;']:
        check("the builder's target still exists in tech-maintenance.js",
              expression in tech, True)
    check("and neither survives into the build",
          "appliance-icons/${" in page, False)
    check("the icon lookup is inlined instead",
          "WILSON_INLINE_ICONS" in page, True)
    icon_count = len(list((ROOT / "assets" / "appliance-icons").glob("*.svg")))
    note("icons inlined", icon_count)
    check("every icon file made it",
          all(f'"{p.name}"' in page for p in (ROOT / "assets" / "appliance-icons").glob("*.svg")), True)

    print("\n=== the preview-only scaffolding is additive and labelled ===")
    check("a visit picker exists, because there is no household page to arrive from",
          "fp-visit" in page, True)
    check("it is marked as preview-only in the source",
          "Preview-only" in page, True)
    check("it only runs when no visit is in the URL",
          'if (new URLSearchParams(window.location.search).get("visit")) return;' in page, True)
    check("and it says photographs stay on the device",
          "kept on this device only" in page, True)

    print("\n=== the fragment form keeps what the body tag carried ===")
    # ui.js reads data-mode to choose the internal chrome; losing it silently
    # would render the customer-facing header on a technician's screen.
    check("no wrapper tags survive",
          any(tag in fragment for tag in ["<!doctype", "<html", "<body", "</body>"]), False)
    check("data-mode is restored by script", '"data-mode"' in fragment, True)
    check("so is the page title", '"data-page-title"' in fragment, True)
    check("and the body class the field tool styles depend on",
          '"tech-mode"' in fragment, True)

print("")
if failures:
    print(f"{len(failures)} FAILURE(S) of {checks} checks:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print(f"ALL {checks} FIELD PREVIEW CHECKS PASSED")
