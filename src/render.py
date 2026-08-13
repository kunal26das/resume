#!/usr/bin/env python3
"""Render one arbitrary version of the resume to a file.

Usage:  python3 src/render.py --len short --lead android --hide wish --pdf
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile

import build

OUT = build.ROOT / "out"


def configure():
    p = argparse.ArgumentParser(
        prog="render.py",
        description="Render any combination of the axes to out/, which is gitignored. "
                    "The published page generates every rendition in the reader's "
                    "browser; this is the same thing without one.")
    p.add_argument("--len", dest="length", default="full", choices=list(build.VARIANTS))
    p.add_argument("--layout", default="datasheet", choices=list(build.LAYOUTS))
    p.add_argument("--lead", default="", choices=[""] + list(build.FOCUSES))
    p.add_argument("--hide", default="", help="comma-separated company slugs")
    p.add_argument("--theme", default="light", choices=["light", "dark"])
    p.add_argument("--name", default="", help="output stem (default: derived)")
    p.add_argument("--pages", type=int, default=None, help="assert this page count")
    p.add_argument("--pdf", action="store_true", help="also render a PDF")
    return p.parse_args()


def stem(a, orgs):
    if a.name:
        return a.name
    bits = [build.STEM, a.length]
    if a.layout != "datasheet":
        bits.append(a.layout)
    if a.lead:
        bits.append(a.lead)
    bits += [f"no-{o}" for o in sorted(orgs)]
    if a.theme == "dark":
        bits.append("dark")
    return "-".join(bits)


def known_orgs(source):
    import re
    return {m for m in re.findall(r'data-org="([a-z ]+)"', source) for m in m.split()}


def render(a):
    source = (build.SRC / "resume.html").read_text(encoding="utf-8")
    build.assert_balanced(source.split("</style>", 1)[1], "src/resume.html")
    build.check_page_rule(source)

    orgs = {o for o in a.hide.split(",") if o}
    unknown = orgs - known_orgs(source)
    if unknown:
        raise SystemExit(f"unknown company {sorted(unknown)} -- the source tags "
                         f"{sorted(known_orgs(source))}")

    title_src, body = build.split_title(source)
    text = build.compose(body, title_src, length=a.length, layout=a.layout,
                         focus=a.lead or None, hide=orgs, theme=a.theme,
                         source_numbers=build.numbers_in(build.visible_text(source)))

    OUT.mkdir(parents=True, exist_ok=True)
    name = stem(a, orgs)
    html = OUT / f"{name}.html"
    html.write_text(text, encoding="utf-8")
    print(f"{str(html.relative_to(build.ROOT)):<52}{len(text)/1024:>7.0f} KB")
    if a.pdf:
        to_pdf(text, OUT / f"{name}.pdf", a.pages)


def to_pdf(text, path, want_pages):
    if not build.chrome_bin:
        print(f"{str(path.relative_to(build.ROOT)):<52}  SKIPPED (no Chrome found)")
        return
    path.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory() as served:
        page = pathlib.Path(served) / "0.html"
        page.write_text(text.replace("@page{", f"@page{{size:{build.PAPER};", 1),
                        encoding="utf-8")
        server = subprocess.Popen(
            ["python3", "-m", "http.server", str(build.PORT), "--directory", served],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            build.wait_for_port(build.PORT)
            chrome = subprocess.Popen(
                [build.chrome_bin, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                 f"--print-to-pdf={path}", f"http://127.0.0.1:{build.PORT}/0.html"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                if not build.wait_until_written(path):
                    raise SystemExit(f"{path.name}: Chrome produced no PDF")
                n = build.check_pdf(path, want_pages)
                print(f"{str(path.relative_to(build.ROOT)):<52}{path.stat().st_size/1024:>7.0f} KB"
                      f"  ({build.PAPER}, {n} pages)")
            finally:
                if chrome.poll() is None:
                    chrome.terminate()
                    try:
                        chrome.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        chrome.kill()
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()


if __name__ == "__main__":
    render(configure())
