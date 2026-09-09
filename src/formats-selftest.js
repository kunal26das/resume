#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = { window: {}, TextEncoder, Uint8Array };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "formats.js"), "utf8"), context);
const formats = context.window.__formats;

// A small DOM fixture exercises the parser as well as the four exporters.
function el(tag, attributes, ...children) {
  const nodes = children.map(child => typeof child === "string" ?
    { nodeType: 3, textContent: child } : child);
  const element = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: nodes,
    children: nodes.filter(node => node.nodeType === 1),
    get textContent() { return nodes.map(node => node.textContent).join(""); },
    getAttribute(name) { return attributes[name] || null; },
    classList: { contains(name) { return (attributes.class || "").split(/\s+/).includes(name); } },
    querySelectorAll(selector) {
      const match = /^([\w-]+)?(?:\.([\w-]+))?$/.exec(selector);
      assert.ok(match, "fixture selector is supported: " + selector);
      const found = [];
      function visit(parent) {
        parent.children.forEach(child => {
          if ((!match[1] || child.tagName === match[1].toUpperCase()) &&
              (!match[2] || child.classList.contains(match[2]))) found.push(child);
          visit(child);
        });
      }
      visit(this);
      return found;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  return element;
}

const multidex = "https://play.google.com/store/apps/details?id=io.github.kunal26das.multidex";
const yifyPlay = "https://play.google.com/store/apps/details?id=io.github.kunal26das.yify";
const yifyWeb = "https://kunal26das.github.io/yify/";
const yifySource = "https://github.com/kunal26das/yify";
const doom = "https://github.com/kunal26das/doom";
const longUrl = "https://example.com/" + "long-hyphenated-path/".repeat(8) + "?view=mobile&source=resume";
const label = "Tools [beta]";
const link = (href, text) => el("a", { href }, text);
const item = (title, description, ...sub) => el("li", {},
  el("span", { class: "t" }, title), description, el("span", { class: "s" }, ...sub));
const fixture = el("div", { class: "sheet" },
  el("h1", {}, "Example Engineer"),
  el("p", { class: "title-line" }, "Mobile Engineer / Android"),
  el("ul", { class: "contact" }, el("li", {}, link("mailto:engineer@example.com", "engineer@example.com"))),
  el("section", { class: "summary" }, el("p", {}, "A summary.")),
  el("footer", { class: "colophon" }, el("div", {},
    el("h3", {}, "Projects"), el("ul", {},
      item("Multidex", "Offline-first Pokédex", link(multidex, "Google Play")),
      item("Yify", "Movie catalogue", link(yifyPlay, "Google Play"), " · ", link(yifyWeb, "Web"), " · ", link(yifySource, "Source")),
      item("DOOM", "Kotlin Multiplatform", link(doom, "github.com/kunal26das/doom")),
      item("Tools", el("c", {}, "Inspect ", link(longUrl, label), " in the browser."), "Maintained"),
      item("Legacy", "An archived app", "Android · discontinued")))))
;
const doc = formats.parse(fixture);
const text = formats.text(doc);
const markdown = formats.markdown(doc);
const json = JSON.parse(formats.json(doc, "https://example.com/resume/"));
const urls = [multidex, yifyPlay, yifyWeb, yifySource, doom, longUrl];

for (const url of urls) {
  assert.ok(text.includes(url), "plain text retains an unbroken destination: " + url);
  assert.ok(markdown.includes("](" + url + ")"), "Markdown retains destination: " + url);
}
assert.ok(text.replace(/\s+/g, " ").includes("Google Play: " + multidex));
assert.equal(text.split(doom).length - 1, 1, "URL labels are not repeated in plain text");
assert.ok(markdown.includes("[Google Play](" + multidex + ")"));
assert.ok(markdown.includes("[Web](" + yifyWeb + ") · [Source](" + yifySource + ")"));
assert.ok(markdown.includes("[Tools \\[beta\\]](" + longUrl + ")"), "link labels escape Markdown punctuation");
assert.ok(markdown.includes("Inspect [Tools"), "links in descriptions keep surrounding whitespace");
assert.ok(markdown.includes("Android · discontinued"), "unlinked footer text remains present");
assert.equal(json.projects[0].url, multidex, "JSON retains its existing primary URL");

function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0, "DOCX entries remain uncompressed");
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const data = at + 30 + nameLength + extraLength;
    files[decoder.decode(bytes.slice(at + 30, at + 30 + nameLength))] = decoder.decode(bytes.slice(data, data + size));
    at = data + size;
  }
  return files;
}

const files = unzipStored(formats.docx(doc));
const document = files["word/document.xml"];
const relationships = files["word/_rels/document.xml.rels"];
const targets = new Map([...relationships.matchAll(/<Relationship Id="([^"]+)"[^>]* Target="([^"]+)"[^>]*\/>/g)]
  .map(match => [match[1], match[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"')]));
const hyperlinkIds = [...document.matchAll(/<w:hyperlink r:id="([^"]+)"/g)].map(match => match[1]);
assert.ok(document.includes('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'));
for (const id of hyperlinkIds) assert.ok(targets.has(id), "every Word hyperlink has a relationship");
for (const url of urls.concat("mailto:engineer@example.com")) {
  assert.ok(hyperlinkIds.some(id => targets.get(id) === url), "Word retains a clickable destination: " + url);
}
assert.ok(relationships.includes("view=mobile&amp;source=resume"), "relationship targets are XML-escaped");
assert.ok(document.includes('>Google Play</w:t>'), "Word links have readable labels");
assert.ok(!document.includes(multidex), "Word avoids repeating destinations after readable labels");
console.log("PASS  formats: parser, text destinations, Markdown links, JSON URL, Word hyperlinks");
