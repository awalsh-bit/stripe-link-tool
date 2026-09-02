#!/usr/bin/env python3
"""
Build a ONE-FILE copy of the field tool for a phone.

WHY THIS EXISTS
---------------
Cayden: "Is there a way to launch the field tool with a link you can send my
phone? I haven't been able to test it in a few days."

The prototype serves from a laptop, which means a LAN address, a firewall
prompt and a passcode before a phone can see it. This produces a single HTML
file with every script, stylesheet and icon inlined, so the field tool can be
opened from anywhere the file can be reached -- with no server at all.

IT IS GENERATED, NOT FORKED. Every line comes from the real assets. There is no
second copy of the field tool to keep in step, and a change to
tech-maintenance.js reaches the phone build the next time this runs. That matters
more here than anywhere: this codebase has been bitten repeatedly by two
implementations of one rule.

WHAT IS DIFFERENT IN THE PREVIEW, AND WHY
-----------------------------------------
  * `offline.js` is left out. It registers a service worker, and there is no
    sw.js next to a single file -- the registration would fail on load and the
    console error is the first thing a tester would see.
  * Photo upload has no endpoint. `photo-sync.js` posts to /api/photos, which
    does not exist here, so photographs stay in the browser's IndexedDB exactly
    as they do when a technician is out of signal. That is the offline path
    working, not a fault.
  * The invoice importer is a different page and is not included; it needs the
    Python parser.

Everything else -- protocols, scoring, water, brand lifespans, the equipment
card, autosave -- is the shipped code.

Usage:  python3 tools/build_field_preview.py [output.html]
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "tech-maintenance.html"
# offline.js is deliberately absent -- see the note above.
SKIP_SCRIPTS = {"assets/offline.js"}


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def data_uri(rel: str) -> str:
    path = ROOT / rel
    kind = "image/svg+xml" if path.suffix == ".svg" else "image/png"
    return "data:%s;base64,%s" % (kind, base64.b64encode(path.read_bytes()).decode("ascii"))


def inline_css_urls(css: str) -> str:
    """Stylesheet url(...) references are relative to assets/, not to the page."""
    def swap(match):
        ref = match.group(1).strip("'\"")
        if ref.startswith(("data:", "http:", "https:")):
            return match.group(0)
        target = (ROOT / "assets" / ref).resolve()
        if not target.exists():
            return match.group(0)
        return "url(%s)" % data_uri(str(target.relative_to(ROOT)))
    return re.sub(r"url\(([^)]+)\)", swap, css)


def build() -> str:
    html = read(PAGE.name)

    # 1. the stylesheet
    css = inline_css_urls(read("assets/wilson.css"))
    html = re.sub(r'<link rel="stylesheet" href="assets/wilson\.css">',
                  "<style>\n%s\n</style>" % css, html, count=1)

    # 2. every script, in the page's own order
    def swap_script(match):
        src = match.group(1)
        if src in SKIP_SCRIPTS:
            return ("<!-- %s omitted from the phone preview: it registers a "
                    "service worker, and there is no sw.js beside a single file -->" % src)
        return "<script>\n%s\n</script>" % read(src)
    html = re.sub(r'<script src="([^"]+)"></script>', swap_script, html)

    # 3. images the page and the scripts reach for by path
    refs = set(re.findall(r'["\'`(](assets/[A-Za-z0-9_./-]+\.(?:svg|png))["\'`)]', html))
    for rel in sorted(refs):
        if (ROOT / rel).exists():
            html = html.replace(rel, data_uri(rel))

    # 4. icons the code builds at RUNTIME from a template string --
    #    `assets/appliance-icons/${category.icon}` never appears as a literal
    #    path, so step 3 cannot see it. The lookup table is inlined and the two
    #    template expressions are rewritten to read from it.
    #
    #    Rewriting source text is a thing to do carefully: both targets are
    #    asserted below, so a rename in tech-maintenance.js fails this build
    #    loudly instead of shipping a page of broken images.
    icons = {}
    for path in sorted((ROOT / "assets" / "appliance-icons").glob("*.svg")):
        icons[path.name] = data_uri(str(path.relative_to(ROOT)))
    lookup = ("<script>window.WILSON_INLINE_ICONS=" +
              __import__("json").dumps(icons) + ";</script>\n")
    html = html.replace("<head>", "<head>\n" + lookup, 1)

    swaps = [
        ("return `assets/appliance-icons/${category.icon}`;",
         "return window.WILSON_INLINE_ICONS[category.icon]||\"\";"),
        ('return `assets/appliance-icons/${map[templateKey(asset)]||"refrigeration.svg"}`;',
         'return window.WILSON_INLINE_ICONS[map[templateKey(asset)]||"refrigeration.svg"]||"";'),
    ]
    for target, replacement in swaps:
        if target not in html:
            raise SystemExit(
                "build_field_preview: expected icon expression not found -- "
                "tech-maintenance.js changed and this script needs updating:\n  " + target)
        html = html.replace(target, replacement)

    # The manifest and the apple-touch-icon point at files that are not here.
    html = re.sub(r'\s*<link rel="manifest"[^>]*>', "", html)
    html = re.sub(r'\s*<link rel="apple-touch-icon"[^>]*>', "", html)

    # 5. A WAY IN.
    #
    # The field tool is always reached as `?visit=...` -- from the household
    # page's launch button, or from a dispatch. A single file opened from a link
    # has no query string and no household page to come from, so it lands on
    # "no maintenance visit was selected" with nothing to click.
    #
    # This shim is PREVIEW-ONLY SCAFFOLDING and it is deliberately additive: it
    # runs only when there is no visit in the URL, reads the store the same way
    # every other screen does, and links back into the real page. It does not
    # touch the field tool's own logic, because a preview that behaves
    # differently from the thing it previews is worth nothing.
    launcher = """
<script>
/* Preview-only: pick a visit, because there is no household page to come from. */
(function () {
  if (new URLSearchParams(window.location.search).get("visit")) return;
  function paint() {
    var state = window.WilsonStore ? window.WilsonStore.load() : null;
    var main = document.querySelector("main");
    if (!state || !main) return;
    var open = (state.visits || []).filter(function (v) { return v.status !== "Completed"; })
      .sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    var rows = open.map(function (v) {
      var h = (state.households || []).find(function (x) { return x.id === v.householdId; }) || {};
      var n = (state.assets || []).filter(function (a) { return a.householdId === v.householdId; }).length;
      return '<a class="fp-visit" href="?visit=' + v.id + '">' +
        '<strong>' + (h.name || "Household") + '</strong>' +
        '<span>' + (v.season || "Visit") + ' \u00b7 due ' + v.dueDate + '</span>' +
        '<span>' + n + ' appliance' + (n === 1 ? "" : "s") + ' \u00b7 ' + (v.assetScope || "") + '</span></a>';
    }).join("");
    main.innerHTML =
      '<div class="page-shell fp-pick">' +
      '<h1>Pick a visit</h1>' +
      '<p>This is the Wilson field tool as a technician sees it, running entirely in this browser on demo data. ' +
      'Normally you would arrive here from a household&rsquo;s launch button.</p>' +
      '<div class="fp-list">' + rows + '</div>' +
      '<p class="fp-note">Photographs are kept on this device only \u2014 there is no server behind this copy, ' +
      'which is the same path the tool takes when a technician has no signal. ' +
      'Everything else is the shipped code.</p></div>';
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
})();
</script>
<style>
.fp-pick { padding: 26px 18px 60px; }
.fp-pick h1 { margin: 0 0 8px; }
.fp-pick p { color: #5d6b60; font-size: 14.5px; line-height: 1.55; max-width: 60ch; }
.fp-list { display: grid; gap: 10px; margin: 20px 0; }
.fp-visit {
  display: grid; gap: 3px; padding: 14px 16px; min-height: 44px;
  border: 1px solid #dfe3dc; border-radius: 8px; background: #fff;
  text-decoration: none; color: inherit;
}
.fp-visit strong { font-size: 16px; }
.fp-visit span { font-size: 13px; color: #5d6b60; }
.fp-note { font-size: 13px; border-top: 1px solid #eceee8; padding-top: 14px; }
</style>
"""
    html = html.replace("</body>", launcher + "</body>", 1)

    banner = (
        "<!--\n"
        "  WILSON FIELD TOOL - SINGLE-FILE PHONE PREVIEW\n"
        "  Generated by tools/build_field_preview.py from the shipped assets.\n"
        "  Do not edit this file. Edit the source and run the script again.\n"
        "-->\n")
    return banner + html


def as_fragment(html: str) -> str:
    """
    Strip the document wrapper.

    Some hosts supply their own <!doctype>/<head>/<body> and take the page as a
    fragment. The body's own attributes are load-bearing here -- ui.js reads
    `data-mode` to decide whether it is drawing the internal or the public
    chrome, and `data-page-title` for the header -- so they are re-applied by
    script rather than dropped with the tag.
    """
    body_open = re.search(r"<body([^>]*)>", html)
    if not body_open:
        raise SystemExit("build_field_preview: no <body> tag to unwrap")
    attrs = dict(re.findall(r'([a-zA-Z-]+)="([^"]*)"', body_open.group(1)))

    head = html[html.index("<head>") + len("<head>"):html.index("</head>")]
    body = html[body_open.end():html.rindex("</body>")]

    restore = ["<script>(function(){var b=document.body;"]
    for key, value in attrs.items():
        restore.append("b.setAttribute(%s,%s);" % (__import__("json").dumps(key),
                                                   __import__("json").dumps(value)))
    restore.append("})();</script>")
    # The attributes must exist BEFORE the field tool's scripts read them.
    return head + "\n" + "".join(restore) + "\n" + body


if __name__ == "__main__":
    fragment = "--fragment" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = pathlib.Path(args[0]) if args else ROOT / "field-preview.html"
    page = build()
    out.write_text(as_fragment(page) if fragment else page, encoding="utf-8")
    print("wrote %s (%.1f KB)%s" % (out, out.stat().st_size / 1024,
                                    " [fragment]" if fragment else ""))
