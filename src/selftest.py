"""Tests for the content filter.

The filter is the one piece of this build that can fail silently: a subtree it
mishandles does not raise, it just goes missing from a 260 KB generated file. The
full variant is protected by being a byte-exact no-op, but the condensed variant
has no such reference, so its mechanics are pinned here instead.

Usage:  python3 src/selftest.py
"""
import sys

from build import reference, select

CASES = []


def case(name, markup, *, keep, variant, join, want):
    CASES.append((name, markup, keep, variant, join, want))


case("identity: entities and attributes survive verbatim",
     '<ul class="bullets"><li>a &mdash; b &#8209; c</li></ul>',
     keep=3, variant=None, join=False,
     want='<ul class="bullets"><li>a &mdash; b &#8209; c</li></ul>')

case("tier: unmarked children of a data-td container drop",
     '<ul data-td="3"><li data-t="2">keep <strong>bold</strong></li><li>drop</li></ul>',
     keep=2, variant="short", join=True,
     want='<ul><li>keep <strong>bold</strong></li></ul>')
case("tier: the same source is untouched at full length",
     '<ul data-td="3"><li data-t="2">keep <strong>bold</strong></li><li>drop</li></ul>',
     keep=3, variant="full", join=False,
     want='<ul><li>keep <strong>bold</strong></li><li>drop</li></ul>')

case("clause: wrapper is transparent at full length",
     '<li>core<c data-t="3"> and a tail clause</c>.</li>',
     keep=3, variant="full", join=False, want='<li>core and a tail clause.</li>')
case("clause: wrapper and contents both go when condensed",
     '<li>core<c data-t="3"> and a tail clause</c>.</li>',
     keep=2, variant="short", join=True, want='<li>core.</li>')

case("join: inert at full length",
     '<ul data-td="2"><li>A</li>\n  <li data-join=" and ">B</li></ul>',
     keep=3, variant="full", join=False,
     want='<ul><li>A</li>\n  <li>B</li></ul>')
case("join: merges into the preceding sibling when condensed",
     '<ul data-td="2"><li>A</li>\n  <li data-join=" and ">B</li></ul>',
     keep=2, variant="short", join=True, want='<ul><li>A and B</li></ul>')
case("join: falls back to standing alone if its predecessor was dropped",
     '<ul data-td="3"><li>A</li><li data-t="2" data-join=" and ">B</li></ul>',
     keep=2, variant="short", join=True, want='<ul><li>B</li></ul>')
case("join: a chain of three collapses into one item",
     '<ul data-td="2"><li>A</li><li data-join=" + ">B</li><li data-join=" + ">C</li></ul>',
     keep=2, variant="short", join=True, want='<ul><li>A + B + C</li></ul>')
case("join: a chain skips over an item dropped from its middle",
     '<ul data-td="2"><li>A</li><li data-t="3">X</li><li data-join=" + ">C</li></ul>',
     keep=2, variant="short", join=True, want='<ul><li>A + C</li></ul>')
case("join: only merges into a sibling of the same tag",
     '<div data-td="2"><p>A</p><li data-join=" and ">B</li></div>',
     keep=2, variant="short", join=True, want='<div><p>A</p><li>B</li></div>')

case("only: full sees its own copy",
     '<p>see <c data-only="full">A</c><c data-only="short">B</c></p>',
     keep=3, variant="full", join=False, want='<p>see A</p>')
case("only: short sees its own copy",
     '<p>see <c data-only="full">A</c><c data-only="short">B</c></p>',
     keep=2, variant="short", join=True, want='<p>see B</p>')
case("only: ignored entirely in identity mode",
     '<p><c data-only="full">A</c></p>',
     keep=3, variant=None, join=False, want='<p>A</p>')

case("nesting: a tier-1 descendant cannot rescue a dropped ancestor",
     '<div data-t="3"><p><span data-t="1">x</span></p></div>after',
     keep=2, variant="short", join=True, want='after')
case("nesting: sibling content after a dropped subtree is unaffected",
     '<ul data-td="3"><li>a</li><li data-t="1">b</li><li>c</li></ul>tail',
     keep=2, variant="short", join=True, want='<ul><li>b</li></ul>tail')


STYLE = "<style>x</style>"
SOURCE_NUMBERS = {"7", "0.84.1", "2", "8", "418", "5"}

REFUSALS = [
    ("refuses a figure that is not in the source",
     f"{STYLE}<li>shipped 1,999 modules</li>", "1,999"),
    ("refuses 0.84.1 without 'green on the branch'",
     f"{STYLE}<li>Authored the 0.84.1 ladder.</li>", "green on the branch"),
    ("refuses 418 without 'over two years'",
     f"{STYLE}<li>Reviewed 418 pull requests.</li>", "over two years"),
    ("refuses a highlights heading that miscounts its own list",
     f'{STYLE}<div class="hi"><h3>The eight I would lead with</h3>'
     f"<ul><li>a</li><li>b</li></ul></div>", "highlights heading"),
    ("refuses a band caption that miscounts the roles",
     f'{STYLE}<p class="band-cap">Five production codebases</p>'
     f'<article class="role">x</article><article class="role">y</article>', "band caption"),
]


def structural_refusals():
    import build
    checks = [
        ("refuses a layout that declares its own @page",
         lambda: build.check_css("@page{size:letter}", "x"), "@page"),
        ("refuses a layout with non-ASCII in it",
         lambda: build.check_css(".a{content:'—'}", "x"), "non-ASCII"),
        ("refuses a second @page rule",
         lambda: build.check_page_rule("@page{margin:1mm}@page{margin:2mm}"), "exactly one"),
        ("refuses an @page that already sets the paper size",
         lambda: build.check_page_rule("@page{size:A4;margin:1mm}"), "already declares size"),
        ("refuses a qualified @page",
         lambda: build.check_page_rule("@page :first{margin:1mm}"), "qualified"),
        ("refuses a missing font placeholder",
         lambda: build.inline_fonts("no tokens here"), "expected exactly 1"),
        ("refuses a duplicated font placeholder",
         lambda: build.inline_fonts("__ARCHIVO__ __ARCHIVO__"), "found 2"),
        ("refuses an unclosed tag",
         lambda: build.assert_balanced("<div><p>x</div>", "t"), "closes"),
        ("refuses a stray close tag",
         lambda: build.assert_balanced("<div>x</div></p>", "t"), "stray"),
    ]
    failures = 0
    for name, fn, expect in checks:
        try:
            fn()
        except SystemExit as e:
            ok = expect in str(e)
            print(f"{'PASS' if ok else 'FAIL'}  {name}")
            if not ok:
                print(f"      raised, but for the wrong reason: {e}")
                failures += 1
        else:
            print(f"FAIL  {name} -- the build accepted it")
            failures += 1
    return failures, len(checks)


def check_refusals():
    import build
    failures = 0
    for name, markup, expect in REFUSALS:
        try:
            build.check_claims("test", markup, SOURCE_NUMBERS)
        except SystemExit as e:
            ok = expect in str(e)
            print(f"{'PASS' if ok else 'FAIL'}  {name}")
            if not ok:
                print(f"      raised, but for the wrong reason: {e}")
                failures += 1
        else:
            print(f"FAIL  {name} -- the build accepted it")
            failures += 1
    return failures


def main():
    failures = 0
    for name, markup, keep, variant, join, want in CASES:
        got = select(markup, keep=keep, variant=variant, join=join)
        ok = got == want
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            print(f"      want {want!r}")
            print(f"      got  {got!r}")

    m = '<li data-t="2">a<c data-t="3">b</c></li>'
    ok = reference(m) == "<li>ab</li>"
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'}  reference: strips annotations and unwraps clauses")

    failures += check_refusals()
    struct_failures, struct_total = structural_refusals()
    failures += struct_failures
    total = len(CASES) + 1 + len(REFUSALS) + struct_total
    print(f"\n{total - failures}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
