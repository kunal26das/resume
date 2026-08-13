(function () {
  "use strict";

  var WIDTH = 96;
  var MIDDOT = "\u00b7";
  var EMDASH = "\u2014";
  var BULLET = "\u2022";
  var EMSPACE = "\u2003";
  var NORMALISE = [["\u2011", "-"], ["\u00a0", " "], ["\u2009", " "], ["\u200b", ""]];
  var MONTHS = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
  };
  var COUNTRY = { India: "IN" };

  function plain(text) {
    var s = text === null || text === undefined ? "" : String(text), i;
    for (i = 0; i < NORMALISE.length; i++) {
      s = s.split(NORMALISE[i][0]).join(NORMALISE[i][1]);
    }
    return s.replace(/\s+/g, " ").trim();
  }

  function nonEmpty(s) { return !!s; }

  function repeat(ch, n) { return new Array(n + 1).join(ch); }

  function push(into, more) {
    for (var i = 0; i < more.length; i++) into.push(more[i]);
    return into;
  }

  function list(nodes) {
    var out = [], i;
    for (i = 0; i < nodes.length; i++) out.push(nodes[i]);
    return out;
  }

  function textOf(el) { return el ? plain(el.textContent) : ""; }

  function need(el, what) {
    if (!el) {
      throw new Error("the document has no " + what + " -- every rendition is read " +
        "out of the markup by class name, so a renamed or removed one empties a " +
        "section instead of failing");
    }
    return el;
  }

  function tagged(node, names) {
    for (var i = 0; i < names.length; i++) {
      if (node.classList.contains(names[i])) return true;
    }
    return false;
  }

  function textWithout(el, names) {
    var out = "", i, node;
    for (i = 0; i < el.childNodes.length; i++) {
      node = el.childNodes[i];
      if (node.nodeType === 1) {
        if (tagged(node, names)) continue;
      } else if (node.nodeType !== 3) {
        continue;
      }
      out += node.textContent;
    }
    return plain(out);
  }

  function hrefs(el) {
    return list(el.querySelectorAll("a")).map(function (a) {
      return a.getAttribute("href");
    });
  }

  function capabilityValues(dd) {
    var out = [], cur = "", i, node;
    if (!dd) return out;
    for (i = 0; i < dd.childNodes.length; i++) {
      node = dd.childNodes[i];
      if (node.nodeType === 1 && node.tagName === "I") {
        out.push(plain(cur));
        cur = "";
        continue;
      }
      if (node.nodeType !== 1 && node.nodeType !== 3) continue;
      cur += node.textContent;
    }
    out.push(plain(cur));
    return out.filter(nonEmpty);
  }

  function unmasked(li) {
    var real = li.getAttribute("data-real"), holder;
    if (!real) return li;
    holder = document.createElement("li");
    holder.innerHTML = window.atob(real);
    return holder;
  }

  function contacts(root) {
    var ul = need(root.querySelector("ul.contact"), "ul.contact"), out = [];
    list(ul.querySelectorAll("li")).forEach(function (li) {
      var source = unmasked(li);
      var anchor = source.querySelector("a");
      var href = anchor ? anchor.getAttribute("href") : null;
      if ((href || "").toLowerCase().slice(-4) === ".pdf") return;
      out.push({ text: textOf(source), href: href });
    });
    return out;
  }

  function metrics(band) {
    if (!band) return [];
    return list(band.querySelectorAll("div.metric")).map(function (m) {
      return { value: textOf(m.querySelector("span.v")),
               label: textOf(m.querySelector("span.l")) };
    });
  }

  function highlights(root) {
    var hi = root.querySelector("div.hi");
    if (!hi) return null;
    return {
      heading: textOf(need(hi.querySelector("h3"), "a heading on div.hi")),
      items: list(hi.querySelectorAll("li")).map(function (li) {
        return { key: textOf(li.querySelector("span.k")),
                 text: textWithout(li, ["k"]) };
      })
    };
  }

  function groups(role) {
    return list(role.querySelectorAll("div.group")).map(function (g) {
      return {
        heading: textOf(g.querySelector("h4")),
        bullets: list(g.querySelectorAll("li")).map(textOf)
      };
    });
  }

  function experience(root) {
    return list(root.querySelectorAll("article.role")).map(function (role) {
      var meta = need(role.querySelector("div.role-meta"), "div.role-meta on a role");
      var head = need(role.querySelector("div.role-head"), "div.role-head on a role");
      var stacks = meta.querySelector("div.stacks");
      return {
        position: textOf(need(head.querySelector("h3"), "a title in div.role-head")),
        org: textOf(need(head.querySelector("span.org"), "span.org on a role")),
        dates: textOf(need(meta.querySelector("div.dates"), "div.dates on a role")),
        where: textOf(meta.querySelector("div.where")),
        tag: textOf(meta.querySelector("div.tag")),
        stacks: stacks ? list(stacks.querySelectorAll("span")).map(textOf) : [],
        note: textOf(role.querySelector("p.role-note")),
        groups: groups(role)
      };
    });
  }

  function colophonItem(li) {
    return {
      title: textOf(li.querySelector("span.t")),
      text: textWithout(li, ["t", "s"]),
      sub: textOf(li.querySelector("span.s")),
      links: hrefs(li)
    };
  }

  function colophon(root) {
    var out = [], footer = root.querySelector("footer.colophon");
    if (!footer) return out;
    list(footer.children).forEach(function (col) {
      var heading = null;
      list(col.children).forEach(function (kid) {
        if (kid.tagName === "H3" || kid.tagName === "H4") {
          heading = textOf(kid);
        } else if (kid.tagName === "UL") {
          if (heading === null) {
            throw new Error("colophon column has a list with no heading -- the " +
              "colophon is read by heading tag, so a heading tiered away from its " +
              "own list silently drops the column");
          }
          out.push({ heading: heading,
                     items: list(kid.querySelectorAll("li")).map(colophonItem) });
        }
      });
    });
    return out;
  }

  function parse(sheet) {
    var band = sheet.querySelector("section.band");
    var summary = sheet.querySelector("section.summary");
    var doc = {};
    doc.name = textOf(need(sheet.querySelector("h1"), "an h1 name"));
    doc.title = textOf(need(sheet.querySelector("p.title-line"), "p.title-line"));
    doc.contact = contacts(sheet);
    doc.band = {
      caption: band ? textOf(band.querySelector("p.band-cap")) : "",
      metrics: metrics(band)
    };
    doc.summary = summary ? list(summary.querySelectorAll("p")).map(textOf) : [];
    doc.highlights = highlights(sheet);
    doc.experience = experience(sheet);
    doc.capabilities = list(sheet.querySelectorAll("div.cap")).map(function (cap) {
      return { label: textOf(need(cap.querySelector("dt"), "a dt in div.cap")),
               values: capabilityValues(need(cap.querySelector("dd"), "a dd in div.cap")) };
    });
    doc.colophon = colophon(sheet);
    return doc;
  }

  var LETTER = /[\p{L}_]/u;
  var WORDCHAR = /[\p{L}\p{N}_]/u;
  var WORDPUNCT = /[\p{L}\p{N}_!"'&.,?]/u;

  function charAt(s, i) { return i >= 0 && i < s.length ? s.charAt(i) : ""; }

  function isSpace(ch) {
    return ch === " " || ch === "\t" || ch === "\n" ||
           ch === "\u000b" || ch === "\u000c" || ch === "\r";
  }

  function isLetter(s, i) {
    var ch = charAt(s, i);
    return ch !== "" && LETTER.test(ch);
  }

  function dashRun(s, i) {
    var j = i;
    while (charAt(s, j) === "-") j++;
    return j - i >= 2 && j < s.length && WORDCHAR.test(s.charAt(j));
  }

  function hyphenBreak(s, p) {
    var behind = (isLetter(s, p - 2) && isLetter(s, p - 1)) ||
      (isLetter(s, p - 3) && charAt(s, p - 2) === "-" && isLetter(s, p - 1));
    var ahead = isLetter(s, p + 1) &&
      (isLetter(s, p + 2) || (charAt(s, p + 2) === "-" && isLetter(s, p + 3)));
    return behind && ahead;
  }

  function splitChunks(text) {
    var out = [], i = 0, n = text.length, j, p;
    while (i < n) {
      if (isSpace(text.charAt(i))) {
        j = i;
        while (j < n && isSpace(text.charAt(j))) j++;
        out.push(text.slice(i, j));
        i = j;
        continue;
      }
      if (i > 0 && WORDPUNCT.test(text.charAt(i - 1)) && dashRun(text, i)) {
        j = i;
        while (charAt(text, j) === "-") j++;
        out.push(text.slice(i, j));
        i = j;
        continue;
      }
      p = i + 1;
      for (;;) {
        if (p >= n || isSpace(text.charAt(p))) break;
        if (text.charAt(p) === "-" && hyphenBreak(text, p)) { p++; break; }
        if (WORDPUNCT.test(text.charAt(p - 1)) && dashRun(text, p)) break;
        p++;
      }
      out.push(text.slice(i, p));
      i = p;
    }
    return out;
  }

  function breakLongWord(chunks, line, used, room) {
    var space = room < 1 ? 1 : room - used;
    var chunk = chunks[chunks.length - 1], end = space, hyphen, head;
    if (space <= 0) return;
    if (chunk.length > space) {
      hyphen = chunk.lastIndexOf("-", space - 1);
      head = chunk.slice(0, hyphen);
      if (hyphen > 0 && head.replace(/-/g, "") !== "") end = hyphen + 1;
    }
    line.push(chunk.slice(0, end));
    chunks[chunks.length - 1] = chunk.slice(end);
  }

  function wrapChunks(chunks, width, indent) {
    var lines = [], line, used, prefix, room, i;
    chunks = chunks.slice().reverse();
    while (chunks.length) {
      line = [];
      used = 0;
      prefix = lines.length ? indent : "";
      room = width - prefix.length;
      if (lines.length && chunks[chunks.length - 1].trim() === "") chunks.pop();
      while (chunks.length && used + chunks[chunks.length - 1].length <= room) {
        used += chunks[chunks.length - 1].length;
        line.push(chunks.pop());
      }
      if (chunks.length && chunks[chunks.length - 1].length > room) {
        breakLongWord(chunks, line, used, room);
        used = 0;
        for (i = 0; i < line.length; i++) used += line[i].length;
      }
      if (line.length && line[line.length - 1].trim() === "") line.pop();
      if (line.length) lines.push(prefix + line.join(""));
    }
    return lines;
  }

  function wrap(line, width, indent) {
    var flat = line.replace(/[\t\n\u000b\u000c\r]/g, " ");
    var lines = wrapChunks(splitChunks(flat).filter(nonEmpty), width, indent);
    return lines.length ? lines : [""];
  }

  function wrapAll(paragraphs, width) {
    var out = [];
    paragraphs.forEach(function (p) {
      push(out, wrap(p, width, ""));
      out.push("");
    });
    return out.length ? out.slice(0, out.length - 1) : out;
  }

  function trimEnd(s) { return s.replace(/\s+$/, ""); }

  function toText(doc, width) {
    var w = width || WIDTH;
    var rule = repeat("=", w);
    var out = [doc.name, doc.title.split(" / ").join(" | "), ""];

    out.push(doc.contact.map(function (c) { return c.text; }).join(" | "));
    push(out, ["", rule, "PROFILE", rule]);
    push(out, wrapAll(doc.summary, w));

    if (doc.band.metrics.length) {
      push(out, ["", rule, doc.band.caption.toUpperCase(), rule]);
      push(out, doc.band.metrics.map(function (m) {
        return "  " + m.value + "  " + m.label;
      }));
    }

    if (doc.highlights) {
      push(out, ["", rule, "SELECTED HIGHLIGHTS", rule]);
      doc.highlights.items.forEach(function (item) {
        push(out, wrap("  " + item.key + "  " + item.text, w, "      "));
      });
    }

    push(out, ["", rule, "EXPERIENCE", rule]);
    doc.experience.forEach(function (role) {
      var meta = [role.dates, role.where, role.tag];
      push(out, ["", role.position + " - " + role.org]);
      if (role.stacks.length) meta.push(role.stacks.join(", "));
      out.push("  " + meta.filter(nonEmpty).join("  |  "));
      if (role.note) push(out, wrap("  " + role.note, w, "  "));
      role.groups.forEach(function (g) {
        if (!g.bullets.length) return;
        if (g.heading) out.push("  " + g.heading);
        g.bullets.forEach(function (b) {
          push(out, wrap("  * " + b, w, "    "));
        });
      });
    });

    push(out, ["", rule, "CAPABILITIES", rule]);
    doc.capabilities.forEach(function (cap) {
      push(out, wrap("  " + cap.label + ": " + cap.values.join(" * "), w, "    "));
    });

    doc.colophon.forEach(function (col) {
      push(out, ["", rule, col.heading.toUpperCase(), rule]);
      col.items.forEach(function (item) {
        var line = "  " + [item.title, item.text, item.sub]
          .filter(nonEmpty).join(" - ");
        push(out, wrap(line, w, "    "));
      });
    });
    return trimEnd(out.join("\n")) + "\n";
  }

  function toMarkdown(doc) {
    var out = ["# " + doc.name, "", "**" + doc.title + "**", ""];

    out.push(doc.contact.map(function (c) {
      return c.href ? "[" + c.text + "](" + c.href + ")" : c.text;
    }).join(" " + MIDDOT + " "));
    push(out, ["", "## Profile", ""]);
    push(out, doc.summary.map(function (p) { return p + "\n"; }));

    if (doc.band.metrics.length) {
      push(out, ["## " + doc.band.caption, "", "| | |", "|---|---|"]);
      push(out, doc.band.metrics.map(function (m) {
        return "| **" + m.value + "** | " + m.label + " |";
      }));
      out.push("");
    }

    if (doc.highlights) {
      push(out, ["## Selected Highlights", ""]);
      push(out, doc.highlights.items.map(function (i) {
        return "- **" + i.key + "** " + EMDASH + " " + i.text;
      }));
      out.push("");
    }

    push(out, ["## Experience", ""]);
    doc.experience.forEach(function (role) {
      var meta = [role.dates, role.where, role.tag];
      out.push("### " + role.position + " " + EMDASH + " " + role.org);
      if (role.stacks.length) meta.push(role.stacks.join(", "));
      push(out, ["", "*" + meta.filter(nonEmpty).join(" " + MIDDOT + " ") + "*", ""]);
      if (role.note) push(out, [role.note, ""]);
      role.groups.forEach(function (g) {
        if (!g.bullets.length) return;
        if (g.heading) push(out, ["**" + g.heading + "**", ""]);
        push(out, g.bullets.map(function (b) { return "- " + b; }));
        out.push("");
      });
    });

    push(out, ["## Capabilities", ""]);
    doc.capabilities.forEach(function (cap) {
      out.push("- **" + cap.label + "** " + EMDASH + " " +
        cap.values.join(" " + MIDDOT + " "));
    });
    out.push("");

    doc.colophon.forEach(function (col) {
      push(out, ["## " + col.heading, ""]);
      col.items.forEach(function (item) {
        var bits = [item.title ? "**" + item.title + "**" : "", item.text, item.sub];
        out.push("- " + bits.filter(nonEmpty).join(" " + EMDASH + " "));
      });
      out.push("");
    });
    return trimEnd(out.join("\n")) + "\n";
  }

  function partition(text, sep) {
    var i = text.indexOf(sep);
    if (i < 0) return [text, "", ""];
    return [text.slice(0, i), sep, text.slice(i + sep.length)];
  }

  function dateOf(part) {
    var s = part.trim(), m = /^([A-Z][a-z]{2})\s+(\d{4})$/.exec(s);
    if (m) {
      if (!MONTHS[m[1]]) throw new Error("unknown month " + m[1] + " in a role date");
      return m[2] + "-" + MONTHS[m[1]];
    }
    m = /^(\d{4})$/.exec(s);
    return m ? m[1] : null;
  }

  function unqualified(value) {
    return value.split(" " + EMDASH + " ")[0].trim();
  }

  function has(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  function toJson(doc, siteUrl) {
    var keys = [], values = [], email = "", phone = "", place = "", profiles = [];
    var work, education = [], projects = [], certificates = [], shipped = {};
    var city, country, location, i;

    doc.contact.forEach(function (c) {
      var at = keys.indexOf(c.text);
      if (at < 0) { keys.push(c.text); values.push(c.href); } else { values[at] = c.href; }
    });
    for (i = 0; i < keys.length; i++) {
      if (!email && keys[i].indexOf("@") >= 0) email = keys[i];
      if (!phone && keys[i].charAt(0) === "+") phone = keys[i];
      if (!place && keys[i].indexOf(",") >= 0 && keys[i].indexOf("@") < 0) place = keys[i];
    }
    for (i = 0; i < keys.length; i++) {
      if (values[i] && (values[i].indexOf("linkedin.com") >= 0 ||
                        values[i].indexOf("github.com") >= 0)) {
        profiles.push({
          network: values[i].indexOf("linkedin") >= 0 ? "LinkedIn" : "GitHub",
          username: keys[i].slice(keys[i].lastIndexOf("/") + 1),
          url: values[i]
        });
      }
    }

    work = doc.experience.map(function (role) {
      var split = partition(role.dates, EMDASH), summary = role.note, entry;
      if (!split[2]) split = partition(role.dates, "-");
      if (role.tag) summary = summary ? role.tag + ". " + summary : role.tag;
      entry = {
        name: role.org,
        position: role.position,
        summary: summary,
        highlights: []
      };
      role.groups.forEach(function (g) { push(entry.highlights, g.bullets); });
      if (dateOf(split[0])) entry.startDate = dateOf(split[0]);
      if (dateOf(split[2])) entry.endDate = dateOf(split[2]);
      if (role.where) entry.location = role.where;
      return entry;
    });

    doc.colophon.forEach(function (col) {
      var head = (col.heading || "").toLowerCase();
      if (head === "certification") {
        col.items.forEach(function (item) {
          var entry = { name: item.title };
          if (item.sub) entry.issuer = item.sub;
          certificates.push(entry);
        });
      } else if (head === "shipped") {
        col.items.forEach(function (item) {
          if (item.links.length) {
            shipped[item.title.split(" ")[0].toLowerCase()] = item.links[0];
          }
        });
      } else if (head === "education") {
        col.items.forEach(function (item) {
          var split = partition(item.title, ", ");
          var years = item.sub.match(/\d{4}/g) || [];
          var entry = { institution: item.text, studyType: split[0],
                        area: split[2] || split[0] };
          if (years.length) {
            entry.startDate = years[0];
            entry.endDate = years[years.length - 1];
          }
          education.push(entry);
        });
      } else if (head === "projects") {
        col.items.forEach(function (item) {
          var entry = { name: item.title, description: item.text };
          if (item.links.length) entry.url = item.links[0];
          projects.push(entry);
        });
      } else {
        throw new Error("unmapped colophon column '" + col.heading + "' -- " +
          "json() reads the colophon by heading, so a renamed or added column " +
          "silently empties a section");
      }
    });

    work.forEach(function (entry) {
      var key = entry.name.split(" ")[0].toLowerCase();
      if (has(shipped, key) && shipped[key]) entry.url = shipped[key];
    });

    city = partition(place, ", ")[0];
    country = partition(place, ", ")[2];
    location = { address: place };
    if (city) location.city = city;
    if (country) location.countryCode = has(COUNTRY, country) ? COUNTRY[country] : country;

    return JSON.stringify({
      "$schema": "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
      basics: {
        name: doc.name,
        label: doc.title.split(" / ")[0],
        email: email,
        phone: phone,
        url: siteUrl,
        summary: doc.summary.join(" "),
        location: location,
        profiles: profiles
      },
      work: work,
      education: education,
      certificates: certificates,
      skills: doc.capabilities.map(function (c) {
        return { name: unqualified(c.label), keywords: c.values.map(unqualified) };
      }),
      projects: projects,
      meta: {
        canonical: siteUrl,
        version: "v1.0.0",
        metrics: doc.band.metrics.map(function (m) {
          return { value: m.value, label: m.label };
        }),
        highlights: doc.highlights ? doc.highlights.items.map(function (i) {
          return { figure: i.key, text: i.text };
        }) : []
      }
    }, null, 2) + "\n";
  }

  var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  var CONTENT_TYPES = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    "</Types>"
  ].join("\n");

  var RELS = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>"
  ].join("\n");

  var DOC_RELS = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    "</Relationships>"
  ].join("\n");

  function style(id, name, size, opt) {
    var o = opt || {};
    var after = o.after === undefined ? 60 : o.after;
    var before = o.before === undefined ? 0 : o.before;
    var run = '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>';
    if (o.bold) run += "<w:b/>";
    if (o.caps) run += "<w:caps/>";
    if (o.color) run += '<w:color w:val="' + o.color + '"/>';
    return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' +
      '<w:pPr><w:spacing w:before="' + before + '" w:after="' + after + '"/></w:pPr>' +
      "<w:rPr>" + run + "</w:rPr></w:style>";
  }

  var STYLES = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="' + W + '">',
    "<w:docDefaults><w:rPrDefault><w:rPr>",
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/>',
    "</w:rPr></w:rPrDefault></w:docDefaults>",
    style("Title", "Title", 44, { bold: true, after: 40 }),
    style("Subtitle", "Subtitle", 22, { after: 40, color: "444444" }),
    style("Contact", "Contact", 18, { after: 200, color: "444444" }),
    style("Heading1", "heading 1", 24, { bold: true, before: 240, after: 80, caps: true }),
    style("Heading2", "heading 2", 22, { bold: true, before: 160, after: 40 }),
    style("Meta", "Meta", 18, { after: 40, color: "444444" }),
    style("Body", "Body", 20, { after: 80 }),
    style("Bullet", "Bullet", 20, { after: 60 }),
    "</w:styles>"
  ].join("\n");

  function esc(text) {
    return text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
  }

  function para(text, name, bullet) {
    var ind = bullet ? '<w:ind w:left="360" w:hanging="180"/>' : "";
    var body = bullet ? BULLET + EMSPACE + text : text;
    return '<w:p><w:pPr><w:pStyle w:val="' + (name || "Body") + '"/>' + ind + "</w:pPr>" +
      '<w:r><w:t xml:space="preserve">' + esc(body) + "</w:t></w:r></w:p>";
  }

  function documentXml(doc) {
    var parts = [para(doc.name, "Title"), para(doc.title, "Subtitle"),
                 para(doc.contact.map(function (c) { return c.text; }).join("  |  "),
                      "Contact")];

    parts.push(para("Profile", "Heading1"));
    push(parts, doc.summary.map(function (p) { return para(p, "Body"); }));

    if (doc.band.metrics.length) {
      parts.push(para(doc.band.caption, "Heading1"));
      push(parts, doc.band.metrics.map(function (m) {
        return para(m.value + "  " + m.label, "Body", true);
      }));
    }

    if (doc.highlights) {
      parts.push(para("Selected Highlights", "Heading1"));
      push(parts, doc.highlights.items.map(function (i) {
        return para(i.key + "  " + i.text, "Body", true);
      }));
    }

    parts.push(para("Experience", "Heading1"));
    doc.experience.forEach(function (role) {
      var meta = [role.dates, role.where, role.tag];
      parts.push(para(role.position + " " + EMDASH + " " + role.org, "Heading2"));
      if (role.stacks.length) meta.push(role.stacks.join(", "));
      parts.push(para(meta.filter(nonEmpty).join("  " + MIDDOT + "  "), "Meta"));
      if (role.note) parts.push(para(role.note, "Meta"));
      role.groups.forEach(function (g) {
        if (!g.bullets.length) return;
        if (g.heading) parts.push(para(g.heading, "Meta"));
        push(parts, g.bullets.map(function (b) { return para(b, "Bullet", true); }));
      });
    });

    parts.push(para("Capabilities", "Heading1"));
    doc.capabilities.forEach(function (cap) {
      parts.push(para(cap.label + ": " + cap.values.join(" " + MIDDOT + " "), "Body", true));
    });

    doc.colophon.forEach(function (col) {
      parts.push(para(col.heading, "Heading1"));
      col.items.forEach(function (item) {
        parts.push(para([item.title, item.text, item.sub]
          .filter(nonEmpty).join(" " + EMDASH + " "), "Body", true));
      });
    });

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="' + W + '"><w:body>' + parts.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>' +
      "</w:sectPr></w:body></w:document>";
  }

  var ZIP_TIME = 0;
  var ZIP_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
  var CRC_TABLE = null;

  function crcTable() {
    var table = [], value, n, k;
    if (CRC_TABLE) return CRC_TABLE;
    for (n = 0; n < 256; n++) {
      value = n;
      for (k = 0; k < 8; k++) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[n] = value >>> 0;
    }
    CRC_TABLE = table;
    return table;
  }

  function crc32(bytes) {
    var table = crcTable(), value = 0xFFFFFFFF, i;
    for (i = 0; i < bytes.length; i++) {
      value = table[(value ^ bytes[i]) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(text) { return new TextEncoder().encode(text); }

  function put(bytes, offset, value, size) {
    for (var i = 0; i < size; i++) bytes[offset + i] = (value >>> (8 * i)) & 0xFF;
  }

  function concat(blocks) {
    var total = 0, out, at = 0, i;
    for (i = 0; i < blocks.length; i++) total += blocks[i].length;
    out = new Uint8Array(total);
    for (i = 0; i < blocks.length; i++) {
      out.set(blocks[i], at);
      at += blocks[i].length;
    }
    return out;
  }

  function zip(entries) {
    var body = [], directory = [], offset = 0, size = 0, end, i;
    for (i = 0; i < entries.length; i++) {
      var name = utf8(entries[i][0]);
      var data = utf8(entries[i][1]);
      var sum = crc32(data);
      var local = new Uint8Array(30 + name.length);
      var central = new Uint8Array(46 + name.length);
      put(local, 0, 0x04034b50, 4);
      put(local, 4, 20, 2);
      put(local, 6, 0, 2);
      put(local, 8, 0, 2);
      put(local, 10, ZIP_TIME, 2);
      put(local, 12, ZIP_DATE, 2);
      put(local, 14, sum, 4);
      put(local, 18, data.length, 4);
      put(local, 22, data.length, 4);
      put(local, 26, name.length, 2);
      put(local, 28, 0, 2);
      local.set(name, 30);
      put(central, 0, 0x02014b50, 4);
      put(central, 4, 20, 2);
      put(central, 6, 20, 2);
      put(central, 8, 0, 2);
      put(central, 10, 0, 2);
      put(central, 12, ZIP_TIME, 2);
      put(central, 14, ZIP_DATE, 2);
      put(central, 16, sum, 4);
      put(central, 20, data.length, 4);
      put(central, 24, data.length, 4);
      put(central, 28, name.length, 2);
      put(central, 30, 0, 2);
      put(central, 32, 0, 2);
      put(central, 34, 0, 2);
      put(central, 36, 0, 2);
      put(central, 38, 0, 4);
      put(central, 42, offset, 4);
      central.set(name, 46);
      body.push(local, data);
      directory.push(central);
      offset += local.length + data.length;
    }
    for (i = 0; i < directory.length; i++) size += directory[i].length;
    end = new Uint8Array(22);
    put(end, 0, 0x06054b50, 4);
    put(end, 4, 0, 2);
    put(end, 6, 0, 2);
    put(end, 8, entries.length, 2);
    put(end, 10, entries.length, 2);
    put(end, 12, size, 4);
    put(end, 16, offset, 4);
    put(end, 20, 0, 2);
    return concat(body.concat(directory).concat([end]));
  }

  function toDocx(doc) {
    return zip([
      ["[Content_Types].xml", CONTENT_TYPES],
      ["_rels/.rels", RELS],
      ["word/_rels/document.xml.rels", DOC_RELS],
      ["word/styles.xml", STYLES],
      ["word/document.xml", documentXml(doc)]
    ]);
  }

  window.__formats = {
    parse: parse,
    text: toText,
    markdown: toMarkdown,
    json: toJson,
    docx: toDocx
  };
})();
