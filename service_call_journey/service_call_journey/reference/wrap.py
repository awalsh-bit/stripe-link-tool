"""Wrap the unwrapped prototype bodies into standalone HTML files under repo/prototypes/.

The Artifact tool publishes the unwrapped file and adds the page skeleton itself; a file opened from
C:\\Dev needs its own <!doctype>/<head>/<body>. Same content either way. The office tool and the board load
their generated data from sibling files (proto_*.js, gitignored like reference/data) which ride next to them.
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "repo", "prototypes")
FILES = [
    ("prototype.html", "dispatch_board_and_tracker.html", "Wilson service dashboard · dispatch board & tracker"),
    ("fieldtool.html", "field_tool.html", "Wilson service dashboard · field tool"),
    ("office.html", "office_queues.html", "Wilson service dashboard · office"),
    ("devspec.html", "developer_spec_page.html", "Wilson service dashboard · developer spec"),
    ("blueprint.html", "blueprint_page.html", "Wilson service dashboard · blueprint"),
]
SIDE = ["proto_index.js", "proto_history.js", "proto_board.js", "proto_links_board.js", "proto_dmg.js"]


def wrap(body, title):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{title}</title></head><body style="margin:0">\n' + body + '\n</body></html>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    for src, dst, title in FILES:
        body = open(os.path.join(HERE, src), encoding="utf-8").read()
        with open(os.path.join(OUT, dst), "w", encoding="utf-8") as f:
            f.write(wrap(body, title))
        print(f"  {dst:<34} {os.path.getsize(os.path.join(OUT, dst)):>9,} bytes")
    for side in SIDE:
        shutil.copy(os.path.join(HERE, side), os.path.join(OUT, side))
        print(f"  {side:<34} {os.path.getsize(os.path.join(OUT, side)):>9,} bytes  (data)")


if __name__ == "__main__":
    main()
