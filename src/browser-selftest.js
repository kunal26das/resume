/* Inject into a built page, then await window.__browserSelftest().
   Exercises the actual controls; this file is not part of the published page. */
(function () {
  "use strict";

  window.__browserSelftest = async function () {
    var failures = [], checks = 0;
    var originalURL = location.href;
    var originalPanel = document.documentElement.getAttribute("data-panel");
    var originalFocus = document.activeElement;
    var side = document.querySelector(".v-side");
    var toggle = document.querySelector(".v-toggle");
    var hide = document.querySelector(".v-hide");
    var field = document.querySelector(".v-q");
    var storedPanel = null;
    try { storedPanel = localStorage.getItem("resume-panel"); } catch (e) {}

    function assert(value, message) {
      if (!value) throw new Error(message);
    }

    async function check(name, run) {
      checks++;
      try { await run(); }
      catch (e) { failures.push({ name: name, message: String(e.message || e) }); }
    }

    function settle() {
      return new Promise(function (resolve) { setTimeout(resolve, 300); });
    }

    function panel(open) {
      var isOpen = document.documentElement.getAttribute("data-panel") === "open";
      if (open !== isOpen) (open ? toggle : hide).click();
    }

    function search(value) {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function sheet() {
      return document.querySelector(".sheet").innerHTML;
    }

    function assertSearch(value, expectedSheet) {
      assert(field.value === value, "search field does not match the selected state");
      assert((new URLSearchParams(location.search).get("q") || "") === value,
        "URL contains a stale search");
      assert(sheet() === expectedSheet, "rendered resume reverted to a stale search");
    }

    try {
      panel(true);
      window.__versions.apply({});
      var baseline = sheet();

      await check("layout links survive navigation and Reset restores the source layout", function () {
        var defaultLayout = document.documentElement.getAttribute("data-layout");
        var chosen = defaultLayout === "plain" ? "column" : "plain";
        document.querySelector('[data-group="layout"][data-value="' + chosen + '"]').click();
        assert(new URLSearchParams(location.search).get("lay") === chosen,
          "selected layout is missing from the shared URL");
        var sharedURL = location.href;
        document.querySelector('[data-group="reset"]').click();
        assert(document.documentElement.getAttribute("data-layout") === defaultLayout,
          "Reset retained the selected layout instead of the source default");
        assert(!new URLSearchParams(location.search).has("lay"), "Reset retained the layout parameter");
        history.replaceState(null, "", sharedURL);
        window.dispatchEvent(new PopStateEvent("popstate"));
        assert(document.documentElement.getAttribute("data-layout") === chosen,
          "shared URL did not restore the chosen layout");
        assert(new URLSearchParams(location.search).get("lay") === chosen,
          "rendering erased the layout from the shared URL");
        document.querySelector('[data-group="reset"]').click();
      });

      await check("typing applies a search after the debounce", async function () {
        search("gradle");
        await settle();
        assert(field.value === "gradle", "search field lost the entered text");
        assert(new URLSearchParams(location.search).get("q") === "gradle",
          "typing did not update the URL");
        assert(sheet() !== baseline, "typing did not filter the resume");
        assert(document.querySelector(".sheet mark"), "search did not highlight a match");
      });

      await check("Reset cancels a pending search", async function () {
        window.__versions.apply({});
        search("gradle");
        document.querySelector('[data-group="reset"]').click();
        await settle();
        assertSearch("", baseline);
      });

      await check("history navigation cancels a pending search", async function () {
        window.__versions.apply({ q: "kotlin" });
        var targetURL = location.href, targetSheet = sheet();
        window.__versions.apply({});
        search("gradle");
        history.replaceState(null, "", targetURL);
        window.dispatchEvent(new PopStateEvent("popstate"));
        await settle();
        assertSearch("kotlin", targetSheet);
      });

      await check("external configuration cancels a pending search", async function () {
        window.__versions.apply({ q: "kotlin" });
        var targetSheet = sheet();
        search("gradle");
        window.__versions.apply({ q: "kotlin" });
        await settle();
        assertSearch("kotlin", targetSheet);
      });

      await check("React Native topic keeps its matching highlight", function () {
        window.__versions.apply({ len: "full", hide: [] });
        var highlights = Array.from(document.querySelectorAll(".hi ul > li"));
        var upgrade = highlights.find(function (li) {
          return li.textContent.indexOf("0.72.3") >= 0;
        });
        assert(upgrade, "the React Native upgrade highlight is missing from the full resume");
        var expected = upgrade.textContent;
        document.querySelector('[data-group="topic"][data-value="rn"]').click();
        assert(Array.from(document.querySelectorAll(".hi ul > li")).some(function (li) {
          return li.textContent === expected;
        }), "the React Native topic removed its matching upgrade highlight");
      });

      await check("one-page resume includes evidence for every listed role", function () {
        window.__versions.apply({ len: "one", hide: [] });
        document.querySelectorAll("article.role").forEach(function (role) {
          assert(role.querySelector(".bullets li"),
            role.querySelector(".org").textContent + " has no achievement on the one-page resume");
        });
      });

      await check("Hide returns focus to Filter and disables hidden controls", function () {
        panel(true);
        hide.focus();
        hide.click();
        assert(document.activeElement === toggle, "Hide left focus inside the closed panel");
        assert(toggle.getAttribute("aria-expanded") === "false", "Filter reports an open panel");
        var controls = side.querySelectorAll("button, input");
        for (var i = 0; i < controls.length; i++) {
          controls[i].focus();
          assert(!side.contains(document.activeElement),
            "a hidden panel control can still receive keyboard focus");
        }
      });

      await check("opening the panel moves focus to an available control", function () {
        panel(false);
        toggle.focus();
        toggle.click();
        assert(document.activeElement === hide, "Filter did not move focus into the panel");
        assert(toggle.getAttribute("aria-expanded") === "true", "Filter reports a closed panel");
        field.focus();
        assert(document.activeElement === field, "reopened panel controls remain disabled");
      });

      await check("Escape closes the panel and restores visible focus", function () {
        panel(true);
        field.focus();
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        assert(document.documentElement.getAttribute("data-panel") === "closed",
          "Escape did not close the panel");
        assert(document.activeElement === toggle, "Escape left focus inside the closed panel");
        field.focus();
        assert(document.activeElement !== field, "Escape left hidden controls focusable");
      });
    } finally {
      history.replaceState(null, "", originalURL);
      window.dispatchEvent(new PopStateEvent("popstate"));
      panel(originalPanel === "open");
      try {
        if (storedPanel === null) localStorage.removeItem("resume-panel");
        else localStorage.setItem("resume-panel", storedPanel);
      } catch (e) {}
      if (originalFocus && originalFocus.isConnected) originalFocus.focus({ preventScroll: true });
    }
    return { checks: checks, failures: failures };
  };
})();
