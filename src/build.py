"""Build the resume.

One source (`src/resume.html`) produces exactly one published file, `index.html`,
which carries the whole annotated document and the engine that filters it. Every
other rendition -- shorter, re-laid-out, tailored, PDF, text, Markdown, JSON,
Word -- is generated in the reader's browser at the moment they ask for it.

The condensed variant is a *strict subsequence* of the full one: it is produced
by deleting annotated subtrees and joining what is left, never by writing a
second copy of any sentence. That is what makes a figure unable to drift between
versions -- there is only ever one copy of each, in `src/resume.html`.

The page is self-contained: fonts are inlined as base64 woff2, so it has no
network dependencies and works offline or from a file:// URL.

Usage:  python3 src/build.py
"""
import base64
import io
import json
import pathlib
import re
import socket
import subprocess
import tempfile
import time
import zipfile
from datetime import date
from html import unescape
from html.parser import HTMLParser

SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parent
FONTS = SRC / "fonts"
LAYOUT_CSS = SRC / "layout"

SITE_URL = "https://kunal26das.github.io/resume/"
STEM = "kunal-das-resume"
PAPER = "A4"
A4_PT = (595, 842)
DESC = ("Senior mobile platform engineer working across Android, iOS, React Native "
        "and Kotlin Multiplatform. Six years, five production codebases.")

FONT_TOKENS = [("__ARCHIVO__", "archivo.woff2"),
               ("__PLEXSANS__", "plexsans.woff2"),
               ("__PLEXMONO4__", "plexmono400.woff2"),
               ("__PLEXMONO6__", "plexmono600.woff2")]

VARIANTS = {
    "full":  dict(keep=3, join=False, suffix="", sheet=""),
    "short": dict(keep=2, join=True,  suffix=" &#8212; Two-page", sheet=" compact"),
    "one":   dict(keep=0, join=True,  suffix=" &#8212; One-page", sheet=" compact solo"),
}
LAYOUTS = {"datasheet": dict(fonts=True), "column": dict(fonts=True),
           "plain": dict(fonts=False)}
FOCUSES = {
    "platform": dict(label="Platform",
                     promote={"platform"}, demote={"product"}),
    "product":  dict(label="Product",
                     promote={"product"},  demote={"platform"}),
    "android":  dict(label="Android",
                     promote={"android"}, demote={"ios", "rn", "kmp", "product"}),
    "rn":       dict(label="React Native",
                     promote={"rn"}, demote={"ios", "kmp", "product"}),
}
FOCUS_LENGTH = "short"

SHOW_ALL = "hide=none&contact=show"
PDF_JOBS = [
    (f"{STEM}.pdf",            "", 7),
    (f"{STEM}-short.pdf",      "len=short", 2),
    (f"{STEM}-ats.pdf",        "len=short&lay=plain", 2),
    (f"{STEM}-one.pdf",        "len=one", 1),
    (f"{STEM}-platform.pdf",   "len=short&lead=platform", 2),
    (f"{STEM}-product.pdf",    "len=short&lead=product", 2),
    (f"{STEM}-android.pdf",    "len=short&lead=android", 2),
    (f"{STEM}-dark.pdf",       "theme=dark", 7),
    (f"{STEM}-short-dark.pdf", "len=short&theme=dark", 2),
]

ANNOTATION_RE = re.compile(
    r"""\s+data-(?:t|td|join|only|lead|tag|org|off)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)""",
    re.I)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
TRANSPARENT = {"c"}


def strip_annotations(text):
    return ANNOTATION_RE.sub("", text)


def gated(value, active):
    if active is None:
        return True
    positive = hit = False
    for tok in value.split():
        if tok.startswith("!"):
            if tok[1:] in active:
                return False
        else:
            positive = True
            hit = hit or tok in active
    return hit or not positive


class Select(HTMLParser):

    JOIN_OPEN = "\x01{name}\x02{tag}\x03{conn}\x04"
    JOIN_CLOSE = "\x05{name}\x06"

    def __init__(self, keep, variant, join, focus=None, active=None, hide=()):
        super().__init__(convert_charrefs=False)
        self.keep, self.variant, self.join = keep, variant, join
        self.focus = focus or {}
        self.active = active
        self.hide = frozenset(hide)
        self.out = []
        self.tiers = [0]
        self.tags = [frozenset()]
        self.joins = []
        self.skip = 0

    def _drop(self, a):
        base = int(a["data-t"]) if "data-t" in a else self.tiers[-1]
        tags = self.tags[-1] | frozenset(a.get("data-lead", "").split())
        tier = base
        if self.focus:
            if tags & self.focus["promote"]:
                tier -= 1
            elif tags & self.focus["demote"]:
                tier += 1
        drop = tier > self.keep
        only = a.get("data-only")
        if only is not None and not gated(only, self.active):
            drop = True
        if self.hide & frozenset(a.get("data-org", "").split()):
            drop = True
        return drop, base, tags

    def _emit(self, s):
        if not self.skip:
            self.out.append(s)

    def handle_starttag(self, tag, attrs):
        if self.skip:
            if tag not in VOID:
                self.skip += 1
            return
        a = dict(attrs)
        drop, base, tags = self._drop(a)
        if drop:
            if tag not in VOID:
                self.skip = 1
            return
        text = "" if tag in TRANSPARENT else strip_annotations(self.get_starttag_text())
        joined = self.join and "data-join" in a
        if joined:
            text = self.JOIN_OPEN.format(name=tag, tag=text, conn=a["data-join"])
        if tag not in VOID:
            self.tiers.append(int(a["data-td"]) if "data-td" in a else base)
            self.tags.append(tags)
            self.joins.append(joined)
        self.out.append(text)

    def handle_startendtag(self, tag, attrs):
        if self.skip:
            return
        drop, _, _ = self._drop(dict(attrs))
        if not drop and tag not in TRANSPARENT:
            self.out.append(strip_annotations(self.get_starttag_text()))

    def handle_endtag(self, tag):
        if self.skip:
            if tag not in VOID:
                self.skip -= 1
            return
        if tag in VOID:
            self.out.append(f"</{tag}>")
            return
        self.tiers.pop()
        self.tags.pop()
        joined = self.joins.pop()
        if joined:
            self.out.append(self.JOIN_CLOSE.format(name=tag))
        elif tag not in TRANSPARENT:
            self.out.append(f"</{tag}>")

    def handle_data(self, d):        self._emit(d)
    def handle_entityref(self, n):   self._emit(f"&{n};")
    def handle_charref(self, n):     self._emit(f"&#{n};")
    def handle_decl(self, d):        self._emit(f"<!{d}>")
    def handle_pi(self, d):          self._emit(f"<?{d}>")

    def handle_comment(self, d):
        if self.skip or not self.out:
            return
        tail = self.out[-1]
        if not tail.strip() and "\n" in tail:
            self.out[-1] = tail[:tail.rindex("\n")]


def apply_joins(text):
    text = re.sub(r"\x05(\w+)\x06", lambda m: f"</{m.group(1)}>", text)
    text = re.sub(r"</(\w+)>\s*\x01\1\x02[^\x03]*\x03([^\x04]*)\x04",
                  lambda m: m.group(2), text)
    text, fell_back = re.subn(r"\x01[^\x02]*\x02([^\x03]*)\x03[^\x04]*\x04",
                              lambda m: m.group(1), text)
    return text, fell_back


EMPTY_GROUP = re.compile(
    r'\n?\s*<div class="group">\s*<ul class="bullets">\s*</ul>\s*</div>')


def prune_empty_groups(markup):
    return EMPTY_GROUP.subn("", markup)


def active_tags(variant, focus, hide):
    if variant is None:
        return None
    return {variant, focus or "nolead"} | {f"hide-{o}" for o in hide}


def select(markup, *, keep, variant, join, focus=None, hide=()):
    p = Select(keep, variant, join, FOCUSES[focus] if focus else None,
               active=active_tags(variant, focus, hide), hide=hide)
    p.feed(markup)
    p.close()
    if p.skip or len(p.tiers) != 1:
        raise SystemExit(f"variant {variant!r}: filter finished inside a dropped "
                         "subtree -- src/resume.html has an unclosed tag")
    where = f"{variant!r}" + (f"/{focus}" if focus else "") + \
            (f"/-{'-'.join(sorted(hide))}" if hide else "")
    text, pruned = prune_empty_groups("".join(p.out))
    text, fell_back = apply_joins(text)
    text = recount(text)
    if pruned:
        print(f"note: {pruned} group(s) in {where} came out empty and were dropped")
    if fell_back:
        print(f"note: {fell_back} data-join(s) in {where} had no preceding "
              "sibling to merge into and stand alone")
    return text


def unfiltered(markup):
    text = re.sub(r"\n[ \t]*<!--.*?-->", "", markup, flags=re.S)
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def reference(markup):
    text = re.sub(r"\n[ \t]*<!--.*?-->", "", strip_annotations(markup), flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return re.sub(r"</?c(?:\s[^>]*)?>", "", text)


def assert_balanced(markup, what):
    stack = []

    class Check(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag not in VOID:
                stack.append(tag)

        def handle_endtag(self, tag):
            if tag in VOID:
                return
            if not stack:
                raise SystemExit(f"{what}: stray </{tag}>")
            if stack[-1] != tag:
                raise SystemExit(f"{what}: </{tag}> closes <{stack[-1]}>")
            stack.pop()

    c = Check(convert_charrefs=False)
    c.feed(markup)
    c.close()
    if stack:
        raise SystemExit(f"{what}: unclosed <{stack[-1]}>")


def inline_fonts(markup):
    for token, filename in FONT_TOKENS:
        n = markup.count(token)
        if n != 1:
            raise SystemExit(f"expected exactly 1 {token}, found {n}")
        markup = markup.replace(
            token, base64.b64encode((FONTS / filename).read_bytes()).decode())
    return markup


def drop_font_faces(markup):
    markup, n = re.subn(r"@font-face\{[^}]*\}\n?", "", markup)
    if n != len(FONT_TOKENS):
        raise SystemExit(f"expected {len(FONT_TOKENS)} @font-face rules, removed {n}")
    return markup


def check_css(css, layout):
    if re.search(r"@page\b", css):
        raise SystemExit(f"{layout}.css declares @page -- paper size is the build's, "
                         "spliced into the single rule in resume.html")
    if re.search(r":root\b", css):
        raise SystemExit(f"{layout}.css targets :root -- a layout restyles the document, "
                         "so its tokens belong on .sheet; at :root it also repaints the "
                         "control panel, which is not part of any layout")
    bad = [c for c in css if ord(c) >= 128]
    if bad:
        raise SystemExit(f"{layout}.css has non-ASCII {bad[:3]!r} -- the artifact "
                         "target cannot declare a charset; use numeric entities")


def splice_layout(markup, layout):
    css = (LAYOUT_CSS / f"{layout}.css").read_text()
    check_css(css, layout)
    if markup.count("</style>") != 1:
        raise SystemExit(f"expected exactly one </style>, found {markup.count('</style>')}")
    if not re.sub(r"/\*.*?\*/", "", css, flags=re.S).strip():
        return markup
    return markup.replace("</style>", f"\n/* ---- layout: {layout} ---- */\n{css}</style>", 1)


def check_page_rule(markup):
    css = re.sub(r"/\*.*?\*/", "", markup, flags=re.S)
    rules = list(re.finditer(r"@page\b([^{]*)\{([^}]*)\}", css))
    if len(rules) != 1:
        raise SystemExit(f"expected exactly one @page rule, found {len(rules)}")
    qualifier, body = rules[0].group(1).strip(), rules[0].group(2)
    if qualifier:
        raise SystemExit(f"@page is qualified ({qualifier!r}); the size splice needs a bare rule")
    if "size" in body:
        raise SystemExit("@page already declares size -- that is the build's to set, so "
                         "the hosted page prints on the reader's own paper")


PROTECTED = [
    ("0.84.1",  "green on the branch",
     "without it the 0.77.3 -> 0.84.1 ladder reads as shipped work"),
    ("2 weeks", "then grew it",
     "without it, 2 weeks and 28 Gradle modules collide into one claim"),
    ("50,000",  "the attribution behind the campaign",
     "without it this reads as having taken the product to 50,000 users"),
    ("418",     "over two years",
     "without it 418 pull requests is a bare total with no period"),
    ("10,966",  "holds them together",
     "without it the band claims four module graphs and the page evidences three"),
    ("1,246",   "left zero Java files behind",
     "the file count is the evidence for the migration, not a separate claim"),
]
NUMBER_RE = re.compile(r"\d[\d,.]*\d|\d")
WORDS = {0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
         6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven",
         12: "twelve"}
THIS_YEAR = date.today().year


def recount(markup):
    roles = len(re.findall(r'<article[^>]*class="role"', markup))
    years = []
    for m in re.finditer(r'<div class="dates"[^>]*>(.*?)</div>', markup, re.S):
        text = unescape(re.sub(r"<[^>]+>", "", m.group(1)))
        years += [int(y) for y in re.findall(r"\d{4}", text)]
        if "present" in text.lower():
            years.append(THIS_YEAR)
    span = max(years) - min(years) if years else 0
    hi = re.search(r'<div class="hi">.*?<ul[^>]*>(.*?)</ul>', markup, re.S)
    counts = {
        "n-roles": WORDS.get(roles, str(roles)),
        "n-from": str(min(years)) if years else "",
        "n-span": f"{WORDS.get(span, span)} years",
        "n-years": WORDS.get(span, str(span)),
        "n-hi": WORDS.get(len(re.findall(r"<li\b", hi.group(1))), "") if hi else "",
    }
    for cls, value in counts.items():
        if not value:
            continue

        def fill(m, value=value):
            return m.group(1) + (value[:1].upper() + value[1:]
                                 if m.group(2)[:1].isupper() else value) + m.group(3)

        markup = re.sub(rf'(<span class="{cls}">)(.*?)(</span>)', fill, markup, flags=re.S)
    return markup


def visible_text(markup):
    body = markup.split("</style>", 1)[1] if "</style>" in markup else markup
    return unescape(re.sub(r"<[^>]+>", " ", body))


def numbers_in(text):
    return {m.group() for m in NUMBER_RE.finditer(text)}


def check_claims(variant, markup, source_numbers):
    text = visible_text(markup)
    flat = re.sub(r"\s+", " ", text)

    invented = numbers_in(text) - source_numbers
    if invented:
        raise SystemExit(f"{variant}: figure(s) {sorted(invented)} appear in this "
                         "variant but not in src/resume.html")

    for anchor, required, why in PROTECTED:
        if anchor in flat and required not in flat:
            raise SystemExit(f"{variant}: {anchor!r} survived but {required!r} did "
                             f"not -- {why}")

    def counted(label, word, text, noun, n, what):
        if word is None:
            raise SystemExit(f"{variant}: the {label} counts {n} {what} -- no word "
                             "form to check the self-counting prose against")
        plain = unescape(re.sub(r"<[^>]+>", "", text))
        m = re.match(rf"\s*(\w+)\s+{noun}", plain, re.I)
        if not m or m.group(1).lower() != word:
            raise SystemExit(f"{variant}: the {label} says {text.strip()!r} "
                             f"over {n} {what}")

    hi = re.search(r'<div class="hi">\s*<h3>(.*?)</h3>(.*?)</div>', markup, re.S)
    if hi:
        n = len(re.findall(r"<li\b", hi.group(2)))
        counted("highlights heading", WORDS.get(n),
                re.sub(r"^\s*The\b", "", hi.group(1), flags=re.I),
                r"I would lead with", n, "entries")
    cap = re.search(r'<p class="band-cap"[^>]*>(.*?)</p>', markup, re.S)
    if cap:
        n = len(re.findall(r'<article[^>]*class="role"', markup))
        counted("band caption", WORDS.get(n), cap.group(1),
                r"production codebases", n, "roles")


def ascii_only(text):
    return "".join(c if ord(c) < 128 else f"&#{ord(c)};" for c in text)


def split_title(body):
    m = re.match(r"\s*<title>(.*?)</title>\n", body, re.S)
    if not m:
        raise SystemExit("src/resume.html must open with a <title> element")
    return m.group(1), body[:m.start()] + body[m.end():]


FAVICON = ("data:image/svg+xml,"
           "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
           "<text y='.9em' font-size='90'>&#128208;</text></svg>")


BULLET = "&#8226;"
CONTACT_UL = re.compile(r'(<ul class="contact">)(.*?)(</ul>)', re.S)
CONTACT_LI = re.compile(r"<li>(.*?)</li>", re.S)


def _mask_email(address):
    local, _, domain = address.partition("@")
    return local[:1] + BULLET * max(len(local) - 1, 3) + "@" + domain


def _mask_phone(number):
    head, _, rest = number.partition(" ")
    return head + " " + re.sub(r"\d", BULLET, rest)


def mask_contacts(body):
    masked = [0]

    def one(m):
        inner = m.group(1)
        text = unescape(re.sub(r"<[^>]+>", "", inner)).strip()
        if "mailto:" in inner:
            shown = _mask_email(text)
        elif re.fullmatch(r"\+[\d ]+", text):
            shown = _mask_phone(text)
        else:
            return m.group(0)
        masked[0] += 1
        payload = base64.b64encode(inner.encode("ascii")).decode()
        return f'<li data-real="{payload}">{shown}</li>'

    def block(m):
        return m.group(1) + CONTACT_LI.sub(one, m.group(2)) + m.group(3)

    body, found = CONTACT_UL.subn(block, body)
    if found != 1:
        raise SystemExit(f"expected exactly one <ul class=\"contact\">, found {found}")
    if not masked[0]:
        raise SystemExit("no contact entry was masked -- the live page would publish "
                         "the address and phone number in plain text")
    return body, masked[0]


def script(name):
    text = (SRC / name).read_text()
    bad = [c for c in text if ord(c) >= 128]
    if bad:
        raise SystemExit(f"{name} has non-ASCII {bad[:3]!r} -- every target is "
                         "escaped to numeric entities, which would corrupt a script")
    stray = re.search(r"</\s*(?:script|body|html)\b", text, re.I)
    if stray:
        raise SystemExit(f"{name} contains the literal {stray.group()!r} -- a close tag "
                         "inside an inlined script ends the element early or steals the "
                         f"one the build appends to; write it as <\\{stray.group()[1:]}")
    return text


def layout_styles():
    extra = []
    for name in LAYOUTS:
        css = (LAYOUT_CSS / f"{name}.css").read_text()
        check_css(css, name)
        if not re.sub(r"/\*.*?\*/", "", css, flags=re.S).strip():
            continue
        extra.append(f'</style>\n<style data-layout="{name}" media="not all">\n{css}')
    return "".join(extra)


def emit_live(source_body, title_src):
    body = unfiltered(source_body)
    if body.count("</style>") != 1:
        raise SystemExit(f"expected exactly one </style>, found {body.count('</style>')}")
    body = body.replace("</style>", layout_styles() + "</style>", 1)
    body = inline_fonts(body)
    left = re.findall(r"__[A-Z][A-Z0-9_]*__", body.split("</style>")[0])
    if left:
        raise SystemExit(f"live: unsubstituted placeholder(s) {left}")

    body, masked = mask_contacts(body)
    body = ascii_only(body)
    for name in ("formats.js", "versions.js"):
        body += f"\n<script>\n{script(name)}</script>"
    title = ascii_only(title_src)
    text = page(body, title, url=SITE_URL, canonical=SITE_URL,
                attrs=' data-len="full" data-layout="datasheet" data-lead=""')
    (ROOT / "index.html").write_text(text, encoding="utf-8")
    print(f"{'index.html':<30}{len(text)/1024:>6.0f} KB  "
          f"({masked} contact entries masked)")


def page(body, title, *, url, canonical, attrs=""):
    head = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{title}</title>",
        f'<meta name="description" content="{DESC}">',
        '<meta name="author" content="Kunal Das">',
        f'<link rel="canonical" href="{canonical}">',
        f'<link rel="icon" href="{FAVICON}">',
        '<meta property="og:type" content="profile">',
        f'<meta property="og:title" content="{title}">',
        f'<meta property="og:description" content="{DESC}">',
        f'<meta property="og:url" content="{url}">',
        '<meta name="twitter:card" content="summary">',
    ]
    return f"""<!doctype html>
<html lang="en"{attrs}>
<head>
{chr(10).join(head)}
</head>
<body>
{body}
</body>
</html>
"""


def compose(source_body, title_src, *, length, layout, focus=None, hide=(),
            theme=None, source_numbers=None):
    v = VARIANTS[length]
    picked = select(source_body, keep=v["keep"], variant=length, join=v["join"],
                    focus=focus or None, hide=hide)
    where = f"{length}/{layout}" + (f"/{focus}" if focus else "")
    assert_balanced(picked.split("</style>", 1)[1], where)
    if source_numbers is not None:
        check_claims(where, picked, source_numbers)
    if v["sheet"]:
        if picked.count('<div class="sheet">') != 1:
            raise SystemExit("expected exactly one .sheet to mark compact")
        picked = picked.replace('<div class="sheet">',
                                f'<div class="sheet{v["sheet"]}">', 1)
    markup = splice_layout(picked, layout)
    markup = inline_fonts(markup) if LAYOUTS[layout]["fonts"] else drop_font_faces(markup)
    left = re.findall(r"__[A-Z][A-Z0-9_]*__", markup.split("</style>")[0])
    if left:
        raise SystemExit(f"{where}: unsubstituted placeholder(s) {left}")
    title = ascii_only(title_src) + v["suffix"]
    if focus:
        title += f' &#8212; {FOCUSES[focus]["label"]}'
    attrs = f' data-theme="{theme}"' if theme and theme != "auto" else ""
    return page(ascii_only(markup), title, url=SITE_URL, canonical=SITE_URL,
                attrs=attrs)


def build():
    source = (SRC / "resume.html").read_text()
    assert_balanced(source.split("</style>", 1)[1], "src/resume.html")
    check_page_rule(source)

    if select(source, keep=3, variant=None, join=False) != reference(source):
        raise SystemExit("the filter is not byte-exact on its own source")

    title_src, source_body = split_title(source)
    source_numbers = numbers_in(visible_text(source))

    for variant, v in VARIANTS.items():
        picked = select(source_body, keep=v["keep"], variant=variant, join=v["join"])
        assert_balanced(picked.split("</style>", 1)[1], f"variant {variant}")
        check_claims(variant, picked, source_numbers)

    fv = VARIANTS[FOCUS_LENGTH]
    for focus in FOCUSES:
        picked = select(source_body, keep=fv["keep"], variant=FOCUS_LENGTH,
                        join=fv["join"], focus=focus)
        assert_balanced(picked.split("</style>", 1)[1], f"focus {focus}")
        check_claims(f"{FOCUS_LENGTH}/{focus}", picked, source_numbers)

    emit_live(source_body, title_src)
    return source, source_numbers, source_body


CHROMES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]
PORT = 8732
chrome_bin = next((c for c in CHROMES if pathlib.Path(c).exists()), None)


def wait_for_port(port, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    raise RuntimeError(f"port {port} never opened")


def wait_until_written(path, timeout=60.0):
    deadline, last = time.time() + timeout, -1
    while time.time() < deadline:
        if path.exists():
            size = path.stat().st_size
            if size > 0 and size == last and path.read_bytes().rstrip().endswith(b"%%EOF"):
                return True
            last = size
        time.sleep(0.4)
    return False


def check_pdf(path, want_pages):
    data = path.read_bytes()
    n = len(re.findall(rb"/Type\s*/Page(?![s])", data))
    box = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", data)
    if not box:
        raise SystemExit(f"{path.name}: no MediaBox")
    w, h = (round(float(box.group(1))), round(float(box.group(2))))
    if (w, h) != A4_PT:
        raise SystemExit(f"{path.name}: {w}x{h}pt, expected {PAPER} {A4_PT[0]}x{A4_PT[1]}pt")
    if want_pages is not None and n != want_pages:
        raise SystemExit(f"{path.name}: {n} pages, expected {want_pages}")
    return n


PROBE_VIEWS = [
    ("full", dict(len="full", hide=[]), dict(length="full"), False),
    ("short", dict(len="short", hide=[]), dict(length="short"), False),
    ("one", dict(len="one", hide=[]), dict(length="one"), False),
    ("short/android", dict(len="short", lead="android", hide=[]),
     dict(length="short", focus="android"), True),
    ("full/-wish", dict(len="full", hide=["wish"]),
     dict(length="full", hide=("wish",)), False),
]
PROBE_JS = """
(function () {
 function run() {
  var views = __VIEWS__;
  var out = [];
  try {
    for (var i = 0; i < views.length; i++) {
      window.__versions.apply(views[i].cfg);
      var sheet = document.querySelector(".sheet");
      var doc = window.__formats.parse(sheet);
      var bytes = window.__formats.docx(doc), bin = "";
      for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
      out.push({
        label: views[i].label,
        shape: {
          bullets: sheet.querySelectorAll(".bullets li").length,
          paras: sheet.querySelectorAll("section.summary p").length,
          roles: sheet.querySelectorAll("article.role").length,
          highlights: sheet.querySelectorAll(".hi ul > li").length,
          caps: sheet.querySelectorAll("div.cap").length
        },
        text: window.__formats.text(doc),
        md: window.__formats.markdown(doc),
        json: window.__formats.json(doc, "PROBE"),
        docx: window.btoa(bin),
        page: views[i].page ? window.__versions.page() : ""
      });
    }
  } catch (e) {
    out = {error: String(e && e.stack || e)};
  }
  var el = document.createElement("script");
  el.type = "application/json";
  el.id = "probe";
  el.textContent = window.btoa(unescape(encodeURIComponent(JSON.stringify(out))));
  document.body.appendChild(el);
 }
 if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", run);
 } else { run(); }
})();
"""
PROBE_RE = re.compile(r'<script[^>]*id="probe"[^>]*>([A-Za-z0-9+/=]*)</script>')
REQUIRED_TEXT = ("PROFILE", "EXPERIENCE", "CAPABILITIES")
REQUIRED_JSON = ("work", "education", "skills")
FULL_ONLY_JSON = ("projects", "certificates")


def private_details(source):
    found = re.findall(r'<ul class="contact">(.*?)</ul>', source, re.S)
    inner = found[0] if found else ""
    email = re.search(r"mailto:([^\"]+)", inner)
    phone = re.search(r"<li>(\+[\d ]+)</li>", inner)
    if not email or not phone:
        raise SystemExit("could not find the email and phone in the contact list -- "
                         "the masking and the reveal path have nothing to be checked against")
    return [email.group(1), unescape(phone.group(1))]


def read_probe(url):
    run = subprocess.run(
        [chrome_bin, "--headless", "--disable-gpu", "--virtual-time-budget=8000",
         "--dump-dom", url],
        capture_output=True, text=True, timeout=180)
    m = PROBE_RE.search(run.stdout)
    if not m:
        raise SystemExit("the format probe produced nothing -- the generators on the "
                         "live page did not run")
    return json.loads(base64.b64decode(m.group(1)).decode("utf-8"))


BULLETS_RE = re.compile(r'<ul class="bullets"[^>]*>(.*?)</ul>', re.S)
SUMMARY_RE = re.compile(r'<section class="summary"[^>]*>(.*?)</section>', re.S)
HI_RE = re.compile(r'<div class="hi">(.*?)</div>', re.S)
LI_RE = re.compile(r"<li\b")


def shape(markup):
    hi = HI_RE.search(markup)
    summary = SUMMARY_RE.search(markup)
    return {
        "bullets": sum(len(LI_RE.findall(m)) for m in BULLETS_RE.findall(markup)),
        "paras": len(re.findall(r"<p\b", summary.group(1))) if summary else 0,
        "roles": len(re.findall(r'<article[^>]*class="role"', markup)),
        "highlights": len(LI_RE.findall(hi.group(1))) if hi else 0,
        "caps": len(re.findall(r'<div class="cap"', markup)),
    }


def check_parity(where, seen, want):
    off = {k: (seen.get(k), v) for k, v in want.items() if seen.get(k) != v}
    if off:
        detail = ", ".join(f"{k}: page has {a}, build makes {b}" for k, (a, b) in off.items())
        raise SystemExit(f"{where}: versions.js and select() disagree about what this "
                         f"variant contains -- {detail}")


STANDALONE_WANTED = ("@font-face", "data:font/woff2", '<div class="sheet')


def check_standalone(where, page, details):
    left = ANNOTATION_RE.search(page) or re.search(r"\sdata-(?:off|real)=", page)
    if left:
        raise SystemExit(f"{where}: the single-file page still carries {left.group().strip()!r} "
                         "-- the CSS gates surviving annotations, so a saved copy that keeps "
                         "one renders with that element hidden")
    if re.search(r'class="v-', page) or "<c>" in page:
        raise SystemExit(f"{where}: the single-file page carries the control panel or an "
                         "unwrapped clause element")
    for want in STANDALONE_WANTED:
        if want not in page:
            raise SystemExit(f"{where}: the single-file page has no {want!r} -- it is not "
                             "self-contained, so it will not render away from this host")
    for detail in details:
        if detail not in page:
            raise SystemExit(f"{where}: the single-file page is missing {detail!r}")
    sheet = page.split("</style>", 1)[1].split("</body>")[0]
    assert_balanced(sheet, f"{where} single-file page")


def check_formats(views, source_numbers, details, shapes):
    if isinstance(views, dict):
        raise SystemExit(f"the format generators threw: {views.get('error')}")
    for view in views:
        where = f"formats/{view['label']}"
        check_parity(where, view["shape"], shapes[view["label"]])
        for kind in ("text", "md"):
            invented = numbers_in(view[kind]) - source_numbers
            if invented:
                raise SystemExit(f"{where}: {kind} states figure(s) {sorted(invented)} "
                                 "that are not in src/resume.html")
        for want in REQUIRED_TEXT:
            if want not in view["text"]:
                raise SystemExit(f"{where}: the text rendition has no {want} section -- "
                                 "a renamed class empties a section silently")
        parsed = json.loads(view["json"])
        wanted = REQUIRED_JSON + (FULL_ONLY_JSON if view["label"] == "full" else ())
        for key in wanted:
            if not parsed.get(key):
                raise SystemExit(f"{where}: the JSON rendition has an empty {key!r} -- "
                                 "formats.js reads that section by class name")
        blob = base64.b64decode(view["docx"])
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            missing = {"[Content_Types].xml", "_rels/.rels", "word/styles.xml",
                       "word/document.xml"} - set(z.namelist())
            if missing:
                raise SystemExit(f"{where}: the Word file is missing {sorted(missing)}")
            document = z.read("word/document.xml").decode("utf-8")
        for detail in details:
            for kind, body in (("text", view["text"]), ("md", view["md"]),
                               ("json", view["json"]), ("docx", document)):
                if detail not in body:
                    raise SystemExit(f"{where}: {kind} is missing {detail!r} -- a "
                                     "generated file must carry the real contact "
                                     "details even though the page masks them")
        page = view.get("page") or ""
        if page:
            check_standalone(where, page, details)
        print(f"{where:<30}{len(view['text'])/1024:>6.0f} KB text  "
              f"{len(view['md'])/1024:.0f} KB md  {len(view['json'])/1024:.0f} KB json  "
              f"{len(blob)/1024:.0f} KB docx"
              + (f"  {len(page.encode())/1024:.0f} KB html" if page else ""))


def probe_script():
    views = [{"label": label, "cfg": cfg, "page": 1 if page else 0}
             for label, cfg, _, page in PROBE_VIEWS]
    return PROBE_JS.replace("__VIEWS__", json.dumps(views))


def expected_shapes(source_body):
    out = {}
    for label, _, picked, _ in PROBE_VIEWS:
        v = VARIANTS[picked["length"]]
        markup = select(source_body, keep=v["keep"], variant=picked["length"],
                        join=v["join"], focus=picked.get("focus"),
                        hide=picked.get("hide", ()))
        out[label] = shape(markup)
    return out


def publish(source, source_numbers, source_body):
    for name, _, _ in PDF_JOBS:
        (ROOT / name).unlink(missing_ok=True)
    if not chrome_bin:
        print(f"{'formats':<30} SKIPPED (no Chrome found)")
        for name, _, _ in PDF_JOBS:
            print(f"{name:<30} SKIPPED (no Chrome found)")
        return
    live = (ROOT / "index.html").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as served:
        root = pathlib.Path(served)
        (root / "page.html").write_text(
            live.replace("@page{", f"@page{{size:{PAPER};", 1), encoding="utf-8")
        cut = live.rindex("</body>")
        (root / "probe.html").write_text(
            live[:cut] + f"<script>{probe_script()}</script>\n" + live[cut:],
            encoding="utf-8")
        server = subprocess.Popen(
            ["python3", "-m", "http.server", str(PORT), "--directory", served],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for_port(PORT)
            base = f"http://127.0.0.1:{PORT}"
            check_formats(read_probe(f"{base}/probe.html"), source_numbers,
                          private_details(source), expected_shapes(source_body))
            for name, query, want_pages in PDF_JOBS:
                pdf = ROOT / name
                url = f"{base}/page.html?" + "&".join(q for q in (query, SHOW_ALL) if q)
                chrome = subprocess.Popen(
                    [chrome_bin, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                     f"--print-to-pdf={pdf}", url],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    if not wait_until_written(pdf):
                        raise SystemExit(f"{name}: Chrome produced no PDF")
                    n = check_pdf(pdf, want_pages)
                    print(f"{name:<30}{pdf.stat().st_size/1024:>6.0f} KB  ({PAPER}, {n} pages)")
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
    publish(*build())
