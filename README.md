# Resume — Kunal Das

Live at **<https://kunal26das.github.io/resume/>**

One hand-written source, `src/resume.html`, and one published file, `index.html`. Every other
rendition of this document — shorter, re-laid-out, tailored to a role, as a PDF, a Word file,
plain text, Markdown or JSON — is built in your browser at the moment you ask for it. Fonts
are inlined as base64 woff2, so the page renders identically offline, from `file://`, or
behind any host, with nothing to break when a CDN changes.

## The page filters itself

`/` ships the whole annotated document — every bullet carrying the tags that decide when it
survives — plus a 53 KB engine that does in the browser exactly what the build used to do on
my machine: drop the subtrees a shorter version does not admit, join the bullets that merge
into their neighbour, re-count the sentences that count themselves. 324 KB, no network calls,
no framework.

The controls live in a panel down the left edge, behind a chip in the corner on a narrow
screen. It sits outside the resume — appended to the page, never mounted inside the document
it filters — which is why nothing it does can turn up in a file you save, and why the search
field keeps your cursor while the document rebuilds underneath it. Every control writes itself
into the query string, so whatever view you arrive at is a link you can send.

**Jump to** at the top of the panel is the document's own table of contents, built from
whatever survived the current filter — cut to the one-page length and it drops from eight
links to five, because there are five sections left. Whichever section you are reading is
marked as you scroll.

| Control | Param | Try it |
|---|---|---|
| **Length** — full, two-page, one-page | `len` | [`?len=one`](https://kunal26das.github.io/resume/?len=one) |
| **Layout** — datasheet, column, plain | `lay` | [`?lay=plain`](https://kunal26das.github.io/resume/?lay=plain) |
| **Lead with** — platform, product, android, rn | `lead` | [`?lead=android`](https://kunal26das.github.io/resume/?lead=android) |
| **Only show** — 14 topic tags | `only` | [`?only=kmp,ios`](https://kunal26das.github.io/resume/?only=kmp,ios) |
| **Companies** — hide any of the five | `hide` | [`?hide=none`](https://kunal26das.github.io/resume/?hide=none) |
| **Search** — highlights as it filters | `q` | [`?q=gradle`](https://kunal26das.github.io/resume/?q=gradle) |
| **Contact** — masked or shown on screen | `contact` | [`?contact=show`](https://kunal26das.github.io/resume/?contact=show) |
| **Theme** — auto, light, dark, paper, contrast, slate, terminal | `theme` | [`?theme=terminal`](https://kunal26das.github.io/resume/?theme=terminal) |

They compose:
[`?len=short&lead=android&lay=plain`](https://kunal26das.github.io/resume/?len=short&lead=android&lay=plain)
is the two-page Android copy with no colour in it.

**Lead** and **only** are different tools. *Lead with* hides nothing — it shifts a tagged
bullet one step up or down the priority order, so at a shorter length the work you care about
survives a cut it would otherwise lose, and the spine of the document stays put. *Only show*
is the blunt instrument: it filters, and the counts in the panel tell you how much is left.

Wish starts hidden — it was a contract engagement and most readers do not need it — so the
page you land on shows four companies. `?hide=none` brings all five back, and so does the
chip. Hiding a company hides it in your copy of the page, not in the page as served: the
markup is still there. If it needs to be gone, save the file rather than sending the link.

With JavaScript off, the page is the full resume. The engine only ever removes.

## The file is made at the moment you ask for it

**Save as PDF** at the foot of the panel — or ⌘P — renders whatever is on screen through the
same `@media print` stylesheet the build asserts page counts against. It is named after the
view it came from, `kunal-das-resume-short-android-no-wish.pdf`, and it carries the full
contact details whatever the screen is showing. A PDF is what people ask for, so it is the
only button.

The page can also write itself out as a self-contained HTML file, as Word, as plain text, as
Markdown and as [JSON Resume](https://jsonresume.org) — same code, same view, no library and
no network, `window.__versions.download("docx")` from the console. Those generators are a port
of the Python that used to run at build time and commit these files into the repository, and
were checked byte-for-byte against it — text, Markdown, JSON, and all five parts of the Word
file — before the Python was deleted. They stay because the build still tests them on every
run; they are not in the panel because nobody was going to press them.

## Nothing is committed but the page

There is no PDF here, no `.docx`, no `.txt`, no `resume.json`, and no second HTML page.
**If you have a link to one, it no longer resolves**: `/short/`, `/column/`, `/column-short/`,
`/plain/`, `/plain-short/`, `/for-platform/`, `/for-product/`, `kunal-das-resume.pdf` and its
`.docx`, `.txt` and `.md` siblings are all gone. The page makes any of them.

The build still renders nine PDFs locally on every run — full, two-page, ATS-plain, one-page,
platform, product, android, and dark versions of the first two — and asserts the page count
and the paper size of each. They are now printed from the published page itself
(`index.html?len=short&lead=android`), so those assertions cover the engine and the print
stylesheet a reader actually gets, which is the reason to render them at all: it is the only
thing that catches a content edit quietly spilling a two-page version onto a third page.
They are simply not committed. Three and a half megabytes of binary per revision is not worth
carrying to publish something the reader's own browser produces better.

## Contact details are masked on the page

The email address and the phone number are not in the served HTML as text. Each sits base64 in
a `data-real` attribute and comes back when you click it, when you print, or with
`?contact=show`; every file you save carries them in full regardless. Revealing them is the
engine's job, so with JavaScript off the mask stays on. It is obfuscation and not a lock — it
costs an address-harvesting crawler everything and a human one click.

## Every previous version

Kept, but not published. `archive/` holds nine versions, newest first, each one a rendered
page next to the source it was built from; `./src/snapshot.sh "what changed"` adds the current
build to it. It is gitignored and lives only on my machine — a record of what this document
used to claim is not something a reader needs to diff against what it claims now.

## Build

```sh
python3 src/build.py     # about 25 seconds

# any one-off copy, into gitignored out/ — the same renditions without a browser
python3 src/render.py --len short --lead android --hide wish --theme dark --pdf
python3 src/selftest.py  # 31 checks, instant
```

No dependencies beyond Python 3, and a local Chrome or Chromium — without one the build prints
`SKIPPED` and still succeeds. Composing the page takes well under a second; the rest of that
time is ten headless Chrome runs — nine PDFs, and one that drives the download generators over
five different views.

Edit `src/resume.html`, rebuild, commit `index.html`.

## One branch, one commit

`main` is the whole repository, and it keeps exactly one commit. The resume is a living
document, the generated files are megabytes per revision, and there is no history worth
preserving in git when `/archive/` is the readable version of it — so every change is
squashed into the single root commit and force-pushed over the remote. GitHub Pages serves
the root as-is: no CI, no build step, no second branch.

331 KB of source, 147 KB of it woff2, produces one 324 KB page, and that page is the site.

## How the versions stay honest

None of these is a second document. Every one of them is the same source with subtrees dropped
and neighbouring bullets joined, chosen by tier attributes that never reach anything you save.
Leading with different work shifts a tagged bullet's tier by one, so a tailored copy can open
on different evidence without a word being rewritten. Nothing is ever written twice, so no
figure can drift between any version of this.

The build enforces that rather than trusting it. It refuses a variant containing a number that
is not in the source; it refuses to separate a figure from the clause that qualifies it — drop
"green on the branch" and an in-progress upgrade ladder starts reading as shipped work; and it
refuses to let a sentence that counts the document, "the eight I would lead with", go stale
when filtering changes the count. The renditions are made in the browser now, so the build
drives them there: a headless run generates all four downloads across five different views,
then checks the text and Markdown for invented figures, the JSON for a section gone silently
empty, and the Word file for its five parts. `src/selftest.py` breaks each of those rules on
purpose and checks that the build says no.

Every figure on the resume is measured from the underlying repository's git history. Nothing
is estimated, rounded up, or extrapolated.

## Design notes

Themed through CSS custom properties declared once for light on a bare `:root`, again under
`prefers-color-scheme: dark` guarded against an explicit light override, and again for each
named palette — dark, paper, contrast, slate, terminal — so the page is legible whichever way
a browser resolves the question, and the panel's own choice wins over all of them. Every
contrast pair was computed rather than eyeballed. Leave the theme on auto and the page prints
light, which is what a print stylesheet is for; pick one and it prints as you picked it.

Amber is reserved for measured quantities and nothing else, which is what makes the numbers
scannable at a glance; ordinary emphasis is bold. The `plain` layout has no colour at all,
which keeps the reservation by having nothing to reserve. A layout file may not touch `:root`
and the build refuses one that does: a layout restyles the document, never the controls
around it.

Typefaces: [Archivo](https://github.com/Omnibus-Type/Archivo) for display,
[IBM Plex Sans](https://github.com/IBM/plex) for body and IBM Plex Mono for labels and data —
147 KB of woff2, inlined. Both are SIL OFL 1.1 and the licences ship in `src/fonts/`. The
`plain` layout uses system fonts instead, and the ATS-plain PDF is rendered from it.

## What is in here

```
src/resume.html        THE SOURCE                edit this
src/layout/*.css       one file per layout       datasheet, column, plain
src/versions.js        the live filter engine
src/formats.js         text, Markdown, JSON and Word, written in the browser
src/build.py           the build
src/selftest.py        tests for the content filter and the content rules
src/render.py          renders one arbitrary version into out/
src/archive.py         snapshots a build into archive/
src/snapshot.sh        archive.py + the commands to publish the resume
src/fonts/             woff2 originals + OFL licences
.nojekyll              tells Pages to serve the files as-is

index.html             the published page — generated, do not edit
```

## Contact

kunal26das@gmail.com · [linkedin.com/in/kunal26das](https://linkedin.com/in/kunal26das) ·
[github.com/kunal26das](https://github.com/kunal26das)
