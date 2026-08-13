(function () {
  "use strict";

  var LENGTHS = {
    full:  { keep: 3, join: false, sheet: "",             label: "Full" },
    short: { keep: 2, join: true,  sheet: "compact",      label: "Two-page" },
    one:   { keep: 0, join: true,  sheet: "compact solo", label: "One-page" }
  };
  var LAYOUTS = { datasheet: "Datasheet", column: "Column", plain: "Plain" };
  var LEADS = {
    "":       { label: "Everything",   promote: [], demote: [] },
    platform: { label: "Platform",     promote: ["platform"], demote: ["product"] },
    product:  { label: "Product",      promote: ["product"],  demote: ["platform"] },
    android:  { label: "Android",      promote: ["android"],  demote: ["ios", "rn", "kmp", "product"] },
    rn:       { label: "React Native", promote: ["rn"],       demote: ["ios", "kmp", "product"] }
  };
  var THEMES = {
    auto:     { label: "Auto",     dark: false },
    light:    { label: "Light",    dark: false },
    dark:     { label: "Dark",     dark: true },
    paper:    { label: "Paper",    dark: false },
    contrast: { label: "Contrast", dark: false },
    slate:    { label: "Slate",    dark: true },
    terminal: { label: "Terminal", dark: true }
  };
  var CONTACT = { hide: "Masked", show: "Shown" };
  var WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven",
               "eight", "nine", "ten", "eleven", "twelve"];
  var TAGS = {
    android: "Android", ios: "iOS", rn: "React Native", kmp: "Multiplatform",
    build: "Build", release: "Release", perf: "Performance",
    reliability: "Reliability", product: "Product", platform: "Platform",
    ai: "AI", chat: "Chat", analytics: "Analytics", ui: "UI"
  };
  var FILES = [
    { kind: "pdf",  label: "Save as PDF" },
    { kind: "html", label: "Web page" },
    { kind: "docx", label: "Word" },
    { kind: "txt",  label: "Text" },
    { kind: "md",   label: "Markdown" },
    { kind: "json", label: "JSON" }
  ];
  var OFFERED = ["pdf"];
  var MIME = {
    html: "text/html;charset=utf-8",
    txt: "text/plain;charset=utf-8",
    md: "text/markdown;charset=utf-8",
    json: "application/json;charset=utf-8",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  var ANNOTATIONS = ["data-t", "data-td", "data-join", "data-only", "data-lead",
                     "data-tag", "data-org", "data-off"];

  var MASTER = null, MOUNT = null, PANEL = null, JUMPS = [];
  var ORGS = [], TOPICS = [], STEM = "resume";
  var cfg = null, stats = { shown: 0, total: 0 }, timer = null, ticking = false;

  function defaults() {
    var el = document.documentElement, off = [];
    ORGS.forEach(function (o) { if (o.off) off.push(o.slug); });
    return {
      len: el.getAttribute("data-len") || "full",
      layout: el.getAttribute("data-layout") || "datasheet",
      lead: el.getAttribute("data-lead") || "",
      theme: "auto", contact: "hide", hide: off,
      only: [], q: ""
    };
  }

  function csv(v, ok) {
    return (v || "").split(",").map(function (s) { return s.trim(); })
      .filter(function (s) { return s && (!ok || ok(s)); });
  }

  function sorted(list) {
    return list.slice().sort().join(",");
  }

  function read() {
    var c = defaults(), q = new URLSearchParams(location.search);
    if (LENGTHS[q.get("len")]) c.len = q.get("len");
    if (LAYOUTS[q.get("lay")]) c.layout = q.get("lay");
    if (q.has("lead") && LEADS[q.get("lead")] !== undefined) c.lead = q.get("lead");
    if (THEMES[q.get("theme")]) c.theme = q.get("theme");
    if (CONTACT[q.get("contact")]) c.contact = q.get("contact");
    if (q.has("hide")) {
      c.hide = q.get("hide") === "none" ? [] : csv(q.get("hide"), function (s) {
        return ORGS.some(function (o) { return o.slug === s; }); });
    }
    c.only = csv(q.get("only"), function (s) { return TOPICS.indexOf(s) >= 0; });
    c.q = (q.get("q") || "").slice(0, 80);
    return c;
  }

  function write() {
    var d = defaults(), q = new URLSearchParams();
    if (cfg.len !== d.len) q.set("len", cfg.len);
    if (cfg.layout !== d.layout) q.set("lay", cfg.layout);
    if (cfg.lead !== d.lead) q.set("lead", cfg.lead);
    if (cfg.theme !== d.theme) q.set("theme", cfg.theme);
    if (cfg.contact !== d.contact) q.set("contact", cfg.contact);
    if (sorted(cfg.hide) !== sorted(d.hide)) {
      q.set("hide", cfg.hide.length ? sorted(cfg.hide) : "none");
    }
    if (cfg.only.length) q.set("only", sorted(cfg.only));
    if (cfg.q) q.set("q", cfg.q);
    var s = q.toString();
    history.replaceState(null, "", s ? "?" + s : location.pathname);
  }

  function filtering(c) {
    return c.only.length > 0 || !!c.q;
  }

  function tagsOf(c) {
    var t = {};
    t[c.len] = 1;
    t[c.lead || "nolead"] = 1;
    c.hide.forEach(function (o) { t["hide-" + o] = 1; });
    return t;
  }

  function gated(value, active) {
    var pos = false, hit = false, ok = true;
    value.split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      if (tok.charAt(0) === "!") { if (active[tok.slice(1)]) ok = false; }
      else { pos = true; if (active[tok]) hit = true; }
    });
    return ok && (!pos || hit);
  }

  function attrList(el, name) {
    var v = el.getAttribute(name);
    return v ? v.split(/\s+/).filter(Boolean) : [];
  }

  function drop(el, parentTier, parentTags, keep, lead, active) {
    var t = el.getAttribute("data-t");
    var base = t === null ? parentTier : parseInt(t, 10);
    var own = attrList(el, "data-lead"), tags = parentTags;
    if (own.length) {
      tags = parentTags.slice();
      own.forEach(function (x) { if (tags.indexOf(x) < 0) tags.push(x); });
    }
    var tier = base;
    if (lead.promote.length || lead.demote.length) {
      if (lead.promote.some(function (x) { return tags.indexOf(x) >= 0; })) tier -= 1;
      else if (lead.demote.some(function (x) { return tags.indexOf(x) >= 0; })) tier += 1;
    }
    var only = el.getAttribute("data-only");
    var orgs = attrList(el, "data-org");
    var out = tier > keep ||
      (only !== null && !gated(only, active)) ||
      orgs.some(function (o) { return active["hide-" + o]; });
    return { drop: out, base: base, tags: tags };
  }

  function cut(root, c) {
    var L = LENGTHS[c.len], lead = LEADS[c.lead] || LEADS[""], active = tagsOf(c);
    (function walk(el, parentTier, parentTags) {
      var kids = [], i;
      for (i = 0; i < el.children.length; i++) kids.push(el.children[i]);
      for (i = 0; i < kids.length; i++) {
        var kid = kids[i];
        var d = drop(kid, parentTier, parentTags, L.keep, lead, active);
        if (d.drop) { kid.remove(); continue; }
        var td = kid.getAttribute("data-td");
        walk(kid, td === null ? d.base : parseInt(td, 10), d.tags);
        if (kid.tagName === "C") {
          var frag = document.createDocumentFragment();
          while (kid.firstChild) frag.appendChild(kid.firstChild);
          kid.parentNode.replaceChild(frag, kid);
        }
      }
    })(root, 0, []);
    return root;
  }

  function years(el) {
    var d = el.querySelector(".dates");
    if (!d) return null;
    var ys = (d.textContent.match(/\d{4}/g) || []).map(Number);
    if (/present/i.test(d.textContent)) ys.push(new Date().getFullYear());
    return ys.length ? [Math.min.apply(null, ys), Math.max.apply(null, ys)] : null;
  }

  function jumps(root) {
    var out = [], i, h;
    var summary = root.querySelector("section.summary");
    if (summary) out.push({ label: "Profile", node: summary });
    var heads = root.querySelectorAll(".sec-head");
    for (i = 0; i < heads.length; i++) {
      h = heads[i].querySelector("h2");
      if (h) out.push({ label: h.textContent.trim(), node: heads[i] });
    }
    var ends = root.querySelectorAll("footer.colophon h3");
    for (i = 0; i < ends.length; i++) {
      out.push({ label: ends[i].textContent.trim(), node: ends[i] });
    }
    return out;
  }

  function here() {
    if (!PANEL || !JUMPS.length) return;
    var at = -1, i;
    for (i = 0; i < JUMPS.length; i++) {
      if (JUMPS[i].node.getBoundingClientRect().top <= 90) at = i;
    }
    if (window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4) at = JUMPS.length - 1;
    var links = PANEL.querySelectorAll(".v-jump");
    for (i = 0; i < links.length; i++) {
      if (i === at) links[i].setAttribute("aria-current", "location");
      else links[i].removeAttribute("aria-current");
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { ticking = false; here(); });
  }

  function motion() {
    return window.matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth";
  }

  function reveal(root) {
    var list = root.querySelectorAll(".contact li[data-real]"), i;
    for (i = 0; i < list.length; i++) {
      list[i].innerHTML = window.atob(list[i].getAttribute("data-real"));
      list[i].removeAttribute("data-real");
    }
  }

  function applyFilters(root, c) {
    stats.total = root.querySelectorAll(".bullets li, .hi ul > li").length;
    if (!filtering(c)) { stats.shown = stats.total; return; }
    var needle = c.q.toLowerCase(), j;

    var items = root.querySelectorAll(".bullets li, .hi ul > li");
    for (j = 0; j < items.length; j++) {
      var li = items[j], keep = true;
      if (c.only.length) {
        var has = attrList(li, "data-tag");
        keep = c.only.some(function (t) { return has.indexOf(t) >= 0; });
      }
      if (keep && needle) keep = li.textContent.toLowerCase().indexOf(needle) >= 0;
      if (!keep) li.remove();
    }
    stats.shown = root.querySelectorAll(".bullets li, .hi ul > li").length;
    if (needle) mark(root, c.q);
  }

  function mark(root, term) {
    var rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    var scope = root.querySelectorAll(
      ".bullets li, .hi ul > li, .summary p, .cap dd, .role-head, .role-note");
    for (var i = 0; i < scope.length; i++) {
      var w = document.createTreeWalker(scope[i], NodeFilter.SHOW_TEXT), nodes = [], n;
      while ((n = w.nextNode())) { rx.lastIndex = 0; if (rx.test(n.nodeValue)) nodes.push(n); }
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j], frag = document.createDocumentFragment(), last = 0, m;
        rx.lastIndex = 0;
        while ((m = rx.exec(node.nodeValue))) {
          if (!m[0].length) { rx.lastIndex++; continue; }
          frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
          var el = document.createElement("mark");
          el.textContent = m[0];
          frag.appendChild(el);
          last = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  function prune(root, hard) {
    var groups = root.querySelectorAll(".group"), i;
    for (i = 0; i < groups.length; i++) {
      var ul = groups[i].querySelector("ul.bullets");
      if (ul && !ul.querySelector("li")) groups[i].remove();
    }
    var hi = root.querySelector(".hi");
    if (hi && !hi.querySelector("ul > li")) (hi.closest("section") || hi).remove();
    if (!hard) return;
    var roles = root.querySelectorAll("article.role");
    for (i = 0; i < roles.length; i++) {
      if (!roles[i].querySelector(".group")) roles[i].remove();
    }
  }

  function joins(root) {
    var list = root.querySelectorAll("[data-join]");
    for (var i = 0; i < list.length; i++) {
      var el = list[i], prev = el.previousElementSibling;
      if (!prev || prev.tagName !== el.tagName) continue;
      prev.appendChild(document.createTextNode(el.getAttribute("data-join")));
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.remove();
    }
  }

  function recount(root) {
    var roles = root.querySelectorAll("article.role"), all = [], i;
    for (i = 0; i < roles.length; i++) {
      var y = years(roles[i]);
      if (y) { all.push(y[0]); all.push(y[1]); }
    }
    var lo = all.length ? Math.min.apply(null, all) : 0;
    var span = all.length ? Math.max.apply(null, all) - lo : 0;
    set(root, ".n-hi", WORDS[root.querySelectorAll(".hi ul > li").length] || "");
    set(root, ".n-roles", WORDS[roles.length] || String(roles.length));
    set(root, ".n-from", all.length ? String(lo) : "");
    set(root, ".n-span", (WORDS[span] || String(span)) + " years");
    set(root, ".n-years", WORDS[span] || String(span));
  }

  function set(root, sel, text) {
    var els = root.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      if (!text) continue;
      var upper = /^[A-Z]/.test(els[i].textContent);
      els[i].textContent = upper ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    }
  }

  function compose(c) {
    var root = MASTER.cloneNode(true);
    cut(root, c);
    applyFilters(root, c);
    prune(root, filtering(c));
    if (LENGTHS[c.len].join) joins(root);
    recount(root);
    if (c.contact === "show") reveal(root);
    root.className = ("sheet " + LENGTHS[c.len].sheet).trim();
    return root;
  }

  function render() {
    var root = compose(cfg);
    var el = document.documentElement;
    el.setAttribute("data-layout", cfg.layout);
    if (cfg.theme === "auto") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", cfg.theme);

    var styles = document.querySelectorAll("style[data-layout]");
    for (var i = 0; i < styles.length; i++) {
      styles[i].media =
        styles[i].getAttribute("data-layout") === cfg.layout ? "all" : "not all";
    }

    var old = document.querySelector(".sheet");
    old.parentNode.replaceChild(root, old);
    MOUNT = root;
    JUMPS = jumps(root);
    update();
    write();
  }

  function chip(group, value, label, on) {
    return '<button type="button" class="v-chip" data-group="' + group +
      '" data-value="' + value + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      label + "</button>";
  }

  function row(label, html, hint) {
    return '<div class="v-row"><span class="v-lab">' + label +
      (hint ? "<em>" + hint + "</em>" : "") + '</span><span class="v-opts">' +
      html + "</span></div>";
  }

  function keyed(group, table, current) {
    return Object.keys(table).map(function (k) {
      var v = table[k];
      return chip(group, k, v && v.label ? v.label : v, current === k);
    }).join("");
  }

  function panelHTML() {
    var h = '<div class="v-row"><span class="v-lab">Jump to</span>' +
            '<span class="v-opts v-nav"></span></div>';
    h += row("Length", keyed("len", LENGTHS, cfg.len));
    h += row("Layout", keyed("layout", LAYOUTS, cfg.layout));
    h += row("Lead with", keyed("lead", LEADS, cfg.lead), "emphasis");
    if (TOPICS.length) {
      h += row("Only show",
        chip("all-topics", "", "All", cfg.only.length === 0) +
        TOPICS.map(function (t) {
          return chip("topic", t, TAGS[t] || t, cfg.only.indexOf(t) >= 0);
        }).join(""), "filter");
    }
    if (ORGS.length) {
      h += row("Companies", ORGS.map(function (o) {
        return chip("org", o.slug, o.name, cfg.hide.indexOf(o.slug) < 0);
      }).join(""), "shown");
    }
    h += row("Search",
      '<input class="v-q" type="search" data-field="q" placeholder="Kotlin, crash, Gradle&#8230;"' +
      ' value="' + cfg.q.replace(/"/g, "&quot;") + '" aria-label="Search the resume">', "filter");
    h += row("Contact", keyed("contact", CONTACT, cfg.contact), "on screen");
    h += row("Theme", keyed("theme", THEMES, cfg.theme));
    return h;
  }

  function note() {
    if (!filtering(cfg)) return "";
    return stats.shown + " of " + stats.total + " entries shown.";
  }

  function summary() {
    var bits = [LENGTHS[cfg.len].label, LAYOUTS[cfg.layout]];
    if (cfg.lead) bits.push(LEADS[cfg.lead].label);
    if (cfg.only.length) bits.push(cfg.only.map(function (t) {
      return TAGS[t] || t; }).join(" + "));
    if (cfg.hide.length) bits.push(cfg.hide.length + " hidden");
    if (cfg.q) bits.push("\u201c" + cfg.q + "\u201d");
    if (cfg.theme !== "auto") bits.push(THEMES[cfg.theme].label);
    return bits.join(" \u00b7 ");
  }

  function buildPanel() {
    PANEL = document.createElement("div");
    PANEL.className = "v-ui";
    PANEL.innerHTML =
      '<button type="button" class="v-toggle" data-group="panel">Filter</button>' +
      '<aside class="v-side" aria-label="Versions">' +
      '<div class="v-head"><span class="v-title">Versions</span>' +
      '<button type="button" class="v-btn v-hide" data-group="panel">Hide</button>' +
      '<span class="v-now"></span></div>' +
      '<div class="v-body">' + panelHTML() + "</div>" +
      '<div class="v-foot">' +
      FILES.filter(function (f) {
        return OFFERED.indexOf(f.kind) >= 0;
      }).map(function (f) {
        return '<button type="button" class="' + (f.kind === "pdf" ? "v-dl" : "v-file") +
          '" data-download="' + f.kind + '">' + f.label + "</button>";
      }).join("") +
      '<button type="button" class="v-btn" data-group="copy">Copy link</button>' +
      '<button type="button" class="v-btn" data-group="reset">Reset</button>' +
      '<p class="v-note"></p></div></aside>';
    document.body.appendChild(PANEL);
  }

  function update(syncFields) {
    if (!PANEL) return;
    var chips = PANEL.querySelectorAll(".v-chip"), i;
    for (i = 0; i < chips.length; i++) {
      var g = chips[i].getAttribute("data-group"), v = chips[i].getAttribute("data-value");
      var on = false;
      if (g === "len") on = cfg.len === v;
      else if (g === "layout") on = cfg.layout === v;
      else if (g === "lead") on = cfg.lead === v;
      else if (g === "theme") on = cfg.theme === v;
      else if (g === "contact") on = cfg.contact === v;
      else if (g === "topic") on = cfg.only.indexOf(v) >= 0;
      else if (g === "all-topics") on = cfg.only.length === 0;
      else if (g === "org") on = cfg.hide.indexOf(v) < 0;
      chips[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var nav = PANEL.querySelector(".v-nav");
    nav.innerHTML = JUMPS.map(function (j, n) {
      return '<button type="button" class="v-jump" data-group="jump" data-value="' + n +
        '">' + attribute(j.label) + "</button>";
    }).join("");
    PANEL.querySelector(".v-now").textContent = summary();
    PANEL.querySelector(".v-note").textContent = note();
    here();
    if (!syncFields) return;
    var fields = PANEL.querySelectorAll("[data-field]");
    for (i = 0; i < fields.length; i++) fields[i].value = cfg.q;
  }

  function site() {
    var link = document.querySelector('link[rel="canonical"]');
    return link ? link.href : location.origin + location.pathname;
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function stem() {
    var bits = [STEM, cfg.len];
    if (cfg.layout !== "datasheet") bits.push(cfg.layout);
    if (cfg.lead) bits.push(cfg.lead);
    cfg.hide.slice().sort().forEach(function (o) { bits.push("no-" + o); });
    if (THEMES[cfg.theme].dark) bits.push("dark");
    return bits.join("-");
  }

  function attribute(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function head() {
    var described = document.querySelector('meta[name="description"]');
    var icon = document.querySelector('link[rel="icon"]');
    var out = '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      "<title>" + attribute(document.title) + "<\/title>";
    if (described) {
      out += '\n<meta name="description" content="' +
        attribute(described.getAttribute("content")) + '">';
    }
    if (icon) out += '\n<link rel="icon" href="' + attribute(icon.getAttribute("href")) + '">';
    return out;
  }

  function standalone() {
    var sheet = MOUNT.cloneNode(true), i, j;
    reveal(sheet);
    var all = sheet.querySelectorAll("*");
    for (i = 0; i < all.length; i++) {
      for (j = 0; j < ANNOTATIONS.length; j++) all[i].removeAttribute(ANNOTATIONS[j]);
    }
    var doc = document.querySelector("style[data-doc]");
    if (!doc) throw new Error("the document stylesheet is not on the page");
    var layout = document.querySelector('style[data-layout="' + cfg.layout + '"]');
    var attrs = cfg.theme === "auto" ? "" : ' data-theme="' + cfg.theme + '"';
    return "<!doctype html>\n<html lang=\"en\"" + attrs + ">\n<head>\n" + head() +
      "\n<\/head>\n<body>\n<style>" + doc.textContent +
      (layout ? "\n" + layout.textContent : "") + "<\/style>\n" +
      sheet.outerHTML + "\n<\/body>\n<\/html>\n";
  }

  function save(name, mime, data) {
    var url = URL.createObjectURL(new Blob([data], { type: mime }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function download(kind) {
    if (kind === "pdf") { window.print(); return; }
    if (kind === "html") { save(stem() + ".html", MIME.html, standalone()); return; }
    var f = window.__formats, doc = f.parse(MOUNT);
    if (kind === "txt") save(stem() + ".txt", MIME.txt, f.text(doc));
    else if (kind === "md") save(stem() + ".md", MIME.md, f.markdown(doc));
    else if (kind === "json") save(stem() + ".json", MIME.json, f.json(doc, site()));
    else if (kind === "docx") save(stem() + ".docx", MIME.docx, f.docx(doc));
  }

  function apply(fn, syncFields) {
    var y = window.scrollY;
    fn();
    render();
    update(syncFields);
    window.scrollTo(0, y);
  }

  function toggle(list, v) {
    var i = list.indexOf(v);
    if (i < 0) list.push(v); else list.splice(i, 1);
  }

  function overlaid() {
    return !window.matchMedia("(min-width:1180px)").matches;
  }

  function onClick(e) {
    var dl = e.target.closest("[data-download]");
    if (dl) { e.preventDefault(); download(dl.getAttribute("data-download")); return; }
    if (e.target.closest(".contact li[data-real]")) {
      apply(function () { cfg.contact = "show"; });
      return;
    }
    if (overlaid() && document.documentElement.getAttribute("data-panel") === "open" &&
        !e.target.closest(".v-side") && !e.target.closest(".v-toggle")) {
      setPanel(false);
      return;
    }
    var btn = e.target.closest("[data-group]");
    if (!btn) return;
    var g = btn.getAttribute("data-group"), v = btn.getAttribute("data-value");
    if (g === "panel") { setPanel(document.documentElement
        .getAttribute("data-panel") !== "open"); return; }
    if (g === "jump") {
      var target = JUMPS[parseInt(v, 10)];
      if (!target) return;
      if (overlaid()) setPanel(false);
      target.node.scrollIntoView({ behavior: motion(), block: "start" });
      return;
    }
    if (g === "copy") {
      if (navigator.clipboard) navigator.clipboard.writeText(location.href);
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = "Copy link"; }, 1400);
      return;
    }
    apply(function () {
      if (g === "reset") cfg = defaults();
      else if (g === "org") toggle(cfg.hide, v);
      else if (g === "topic") toggle(cfg.only, v);
      else if (g === "all-topics") cfg.only = [];
      else if (g === "layout") cfg.layout = v;
      else if (g === "len" || g === "lead" || g === "theme" || g === "contact") cfg[g] = v;
    }, g === "reset");
  }

  function onInput(e) {
    if (e.target.getAttribute("data-field") !== "q") return;
    clearTimeout(timer);
    var val = e.target.value;
    timer = setTimeout(function () {
      apply(function () { cfg.q = val.slice(0, 80); });
    }, 200);
  }

  function discover() {
    var seen = {}, orgs = [], i;
    var roles = MASTER.querySelectorAll("article.role");
    for (i = 0; i < roles.length; i++) {
      var slugName = (roles[i].getAttribute("data-org") || "").split(/\s+/)[0];
      if (!slugName || seen[slugName]) continue;
      seen[slugName] = 1;
      var org = roles[i].querySelector(".org");
      orgs.push({ slug: slugName,
                  off: roles[i].getAttribute("data-off") !== null,
                  name: org ? org.textContent.split("\u00b7")[0].trim() : slugName });
    }
    ORGS = orgs;

    var name = MASTER.querySelector(".name");
    STEM = (name ? slug(name.textContent) : "resume") + "-resume";

    var tagged = MASTER.querySelectorAll("[data-tag]"), order = [];
    for (i = 0; i < tagged.length; i++) {
      attrList(tagged[i], "data-tag").forEach(function (t) {
        if (order.indexOf(t) < 0) order.push(t);
      });
    }
    TOPICS = order.sort(function (a, b) {
      return (TAGS[a] || a).localeCompare(TAGS[b] || b);
    });
  }

  function setPanel(open) {
    document.documentElement.setAttribute("data-panel", open ? "open" : "closed");
    try { localStorage.setItem("resume-panel", open ? "open" : "closed"); } catch (e) {}
  }

  function init() {
    var sheet = document.querySelector(".sheet");
    if (!sheet) return;
    MASTER = sheet.cloneNode(true);
    discover();
    cfg = read();
    buildPanel();
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" &&
          document.documentElement.getAttribute("data-panel") === "open") setPanel(false);
    });
    document.addEventListener("input", onInput);
    window.addEventListener("popstate", function () { cfg = read(); render(); update(true); });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("beforeprint", function () { reveal(document); });
    window.addEventListener("afterprint", function () {
      if (cfg.contact !== "show") render();
    });
    document.documentElement.setAttribute("data-versions", "on");
    var saved = null;
    try { saved = localStorage.getItem("resume-panel"); } catch (e) {}
    setPanel(saved ? saved === "open" : window.innerWidth >= 1180);
    render();
    update(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }

  window.__versions = {
    apply: function (c) {
      cfg = Object.assign(defaults(), c);
      render();
      update(true);
      return document.querySelector(".sheet").outerHTML;
    },
    download: download,
    page: standalone,
    axes: { LENGTHS: LENGTHS, LAYOUTS: LAYOUTS, LEADS: LEADS, THEMES: THEMES,
            TOPICS: TOPICS, ORGS: ORGS.map(function (o) { return o.slug; }) }
  };
})();
