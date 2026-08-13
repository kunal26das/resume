"""Usage:  python3 src/archive.py ["what changed"]"""
import datetime
import json
import html
import pathlib
import shutil
import subprocess
import sys

SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parent
ARCHIVE = ROOT / "archive"
MANIFEST = ARCHIVE / "manifest.json"
MANUAL = ROOT / "CLAUDE.md"


def load():
    if not MANIFEST.exists():
        return []
    return json.loads(MANIFEST.read_text())


def snapshot_page():
    sys.path.insert(0, str(SRC))
    import build
    source = (SRC / "resume.html").read_text(encoding="utf-8")
    title_src, body = build.split_title(source)
    return build.compose(body, title_src, length="full", layout="plain",
                         source_numbers=build.numbers_in(build.visible_text(source)))


def add(subject):
    subprocess.run([sys.executable, str(SRC / "build.py")], cwd=ROOT, check=True,
                   capture_output=True, text=True)

    rows = load()
    today = datetime.date.today().isoformat()
    n = sum(1 for r in rows if r["date"] == today)
    slug = today if not n else f"{today}-{n + 1}"
    dest = ARCHIVE / slug
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "index.html").write_text(snapshot_page(), encoding="utf-8")
    shutil.copyfile(SRC / "resume.html", dest / "source.html")
    if MANUAL.exists():
        shutil.copyfile(MANUAL, dest / "manual.md")
    else:
        print(f"WARNING: {MANUAL.name} is missing, so this snapshot carries no manual "
              f"and no other copy of it exists", file=sys.stderr)

    rows.insert(0, {"slug": slug, "date": today, "subject": subject})
    MANIFEST.write_text(json.dumps(rows, indent=2) + "\n")
    size = (dest / "index.html").stat().st_size
    print(f"{slug:<24}{size/1024:>6.0f} KB  {subject}")
    return rows


def index(rows):
    items = []
    for r in rows:
        page = ARCHIVE / r["slug"] / "index.html"
        if not page.exists():
            continue
        source = ARCHIVE / r["slug"] / "source.html"
        extra = (f' &#183; <a href="{r["slug"]}/source.html">source</a>'
                 if source.exists() else "")
        if (ARCHIVE / r["slug"] / "manual.md").exists():
            extra += f' &#183; <a href="{r["slug"]}/manual.md">manual</a>'
        items.append(
            f'<li><time>{r["date"]}</time>'
            f'<a href="{r["slug"]}/">{html.escape(r["subject"])}</a>'
            f'<em>{page.stat().st_size/1024:.0f} KB{extra}</em></li>')
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    (ARCHIVE / "index.html").write_text(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kunal Das &#8212; resume archive</title>
<meta name="robots" content="noindex">
<style>
:root{{color-scheme:light dark;--ink:#14181A;--ink-3:#5F6A6E;--rule:#D5D9D8;
--sheet:#FBFBFA;--ground:#E9EBEA;--signal:#8A5008;}}
@media (prefers-color-scheme:dark){{:root{{--ink:#E7EAE9;--ink-3:#8A9599;
--rule:#2A3134;--sheet:#15191B;--ground:#0D1011;--signal:#E8AE5C;}}}}
body{{margin:0;background:var(--ground);color:var(--ink);
font:15px/1.55 ui-sans-serif,system-ui,sans-serif;}}
main{{max-width:760px;margin:0 auto;padding:clamp(22px,4.4vw,60px);
background:var(--sheet);min-height:100vh;}}
h1{{font-size:1.6rem;margin:0 0 .3rem;letter-spacing:-.01em;}}
p.lead{{margin:0 0 2rem;color:var(--ink-3);font-size:.9rem;max-width:58ch;}}
ul{{list-style:none;margin:0;padding:0;}}
li{{display:grid;grid-template-columns:6.5rem minmax(0,1fr) auto;gap:1rem;
align-items:baseline;padding:.7rem 0;border-top:1px solid var(--rule);}}
time{{font:600 .68rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;
letter-spacing:.08em;color:var(--ink-3);}}
a{{color:var(--signal);text-decoration:none;border-bottom:1px solid var(--rule);}}
a:hover{{border-bottom-color:var(--signal);}}
em{{font-style:normal;font-size:.68rem;color:var(--ink-3);}}
@media (max-width:560px){{li{{grid-template-columns:1fr;gap:.15rem;}}}}
</style>
</head>
<body>
<main>
<h1>Resume archive</h1>
<p class="lead">Every version of this resume, newest first. Each is the plain layout,
which carries no embedded fonts and is the smallest of the three, alongside the
hand-written source it was built from and the build manual as it read that day.</p>
<ul>
{chr(10).join(items)}
</ul>
<p class="lead"><a href="../">Back to the resume</a></p>
</main>
</body>
</html>
""", encoding="utf-8")
    print(f"{len(items)} versions -> archive/index.html")


if __name__ == "__main__":
    rows = add(sys.argv[1]) if len(sys.argv) > 1 else load()
    index(rows)
