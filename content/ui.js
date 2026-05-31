(function () {
  "use strict";

  if (window.PagePilotUI) {
    return;
  }

  const ROOT_ID = "pagepilot-root";

  function createUI(options) {
    const callbacks = options.callbacks || {};
    const helpers = options.helpers;
    let root = null;
    let sidebar = null;
    let tab = null;
    let lastFocusedBeforeOpen = null;

    function mount() {
      if (document.getElementById(ROOT_ID)) {
        root = document.getElementById(ROOT_ID);
        sidebar = root.querySelector(".pp-sidebar");
        tab = root.querySelector(".pp-edge-tab");
        return;
      }

      root = document.createElement("div");
      root.id = ROOT_ID;
      root.innerHTML = shellTemplate();
      document.documentElement.appendChild(root);
      sidebar = root.querySelector(".pp-sidebar");
      tab = root.querySelector(".pp-edge-tab");
      attachEvents();
    }

    function render(model, viewState) {
      if (!root || !model) return;
      const mode = viewState.mode || "minimized";
      const profile = model.pageProfile || {};
      const quietMode = Boolean(profile.quietMode);
      const activeMode = mode === "open"
        ? "open"
        : mode === "snoozed"
          ? "snoozed"
          : quietMode
            ? "quiet"
            : "minimized";
      const bestSection = findSection(model, model.bestSectionId);
      const nextSection = findSection(model, model.nextImportantId);
      const sectionCount = model.sections.length;
      const importantCount = model.importantSections.length;
      const canJump = Boolean(bestSection && model.hasStrongTarget && !quietMode);
      const canNext = Boolean(nextSection && !quietMode);

      root.dataset.mode = activeMode;
      root.classList.toggle("pp-open", activeMode === "open");
      root.classList.toggle("pp-minimized", activeMode === "minimized");
      root.classList.toggle("pp-snoozed", activeMode === "snoozed");
      root.classList.toggle("pp-quiet", activeMode === "quiet");
      root.classList.toggle("pp-quiet-page", quietMode);
      root.classList.toggle("pp-show-tip", Boolean(viewState.showOnboarding && activeMode === "open"));
      tab.setAttribute("aria-expanded", String(activeMode === "open"));
      tab.setAttribute("aria-label", tabLabel(model, activeMode));
      setText(".pp-tab-title", tabTitle(model, activeMode));
      setText(".pp-tab-meta", tabMeta(model, activeMode));

      setText(".pp-brand-subtitle", quietMode ? "Quiet here" : "Navigation layer");
      setText(".pp-kicker", quietMode ? `${profile.label || "Page"} • quiet` : `${profile.label || "Page"} guide`);
      setText(".pp-hero-title", heroTitle(model, bestSection, quietMode));
      setText(".pp-summary-line", summaryLine(model, bestSection, quietMode));
      setText(".pp-meter-value", `${progressPercent()}%`);
      setText("[data-pp-stat='time']", readingTimeCopy(model));
      setText("[data-pp-stat='sections']", quietMode ? "Quiet" : String(sectionCount));
      setText("[data-pp-stat='important']", quietMode ? "Low" : String(importantCount));
      setText(".pp-important-count", String(importantCount));
      setText(".pp-section-count", String(sectionCount));

      const startCard = root.querySelector(".pp-start-card");
      startCard.dataset.sectionId = canJump ? bestSection.id : "";
      startCard.disabled = !canJump;
      startCard.setAttribute("aria-disabled", String(!canJump));
      setText(".pp-start-label", startLabel(model, canJump));
      setText(".pp-start-title", canJump ? bestSection.title : lowSignalTitle(model));
      setText(".pp-start-reason", canJump ? reasonForSection(bestSection) : lowSignalReason(model));

      const skipButton = root.querySelector(".pp-skip");
      const nextButton = root.querySelector(".pp-next");
      skipButton.disabled = !canJump;
      nextButton.disabled = !canNext;
      skipButton.setAttribute("aria-disabled", String(!canJump));
      nextButton.setAttribute("aria-disabled", String(!canNext));
      setText(".pp-next-label", canNext ? "Next important" : "No next jump");

      root.querySelector(".pp-overview").classList.toggle("pp-low-signal", quietMode || !model.hasStrongTarget);
      root.querySelector(".pp-important-panel").hidden = quietMode || !importantCount;
      renderImportantList(model);
      renderJumpList(model, viewState);
      updateActiveClasses(viewState.activeId);

      const live = root.querySelector(".pp-live");
      live.textContent = liveStatus(model, quietMode);
    }

    function attachEvents() {
      tab.addEventListener("click", () => callbacks.onOpen && callbacks.onOpen());

      root.querySelector(".pp-minimize").addEventListener("click", () => callbacks.onMinimize && callbacks.onMinimize());
      root.querySelector(".pp-snooze").addEventListener("click", () => callbacks.onSnooze && callbacks.onSnooze());
      root.querySelector(".pp-skip").addEventListener("click", () => callbacks.onJump && callbacks.onJump());
      root.querySelector(".pp-next").addEventListener("click", () => callbacks.onNext && callbacks.onNext());
      root.querySelector(".pp-tip-dismiss").addEventListener("click", () => callbacks.onDismissTip && callbacks.onDismissTip());

      root.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-toggle-section]");
        if (toggle) {
          event.preventDefault();
          event.stopPropagation();
          callbacks.onToggleCollapse && callbacks.onToggleCollapse(toggle.dataset.toggleSection);
          return;
        }

        const button = event.target.closest("[data-section-id]");
        if (button && button.dataset.sectionId) {
          callbacks.onSection && callbacks.onSection(button.dataset.sectionId, {
            highlight: button.classList.contains("pp-start-card")
          });
        }
      });

      root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          callbacks.onMinimize && callbacks.onMinimize();
          return;
        }

        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          return;
        }

        const current = event.target.closest && event.target.closest(".pp-section-item, .pp-collapse-toggle, .pp-start-card, .pp-skip, .pp-next");
        if (!current) return;
        const focusables = getFocusableItems();
        const index = focusables.indexOf(current);
        if (index === -1) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? focusables.length - 1
            : event.key === "ArrowDown"
              ? Math.min(focusables.length - 1, index + 1)
              : Math.max(0, index - 1);
        focusables[nextIndex].focus();
      });
    }

    function focusPanel() {
      if (!sidebar) return;
      lastFocusedBeforeOpen = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : lastFocusedBeforeOpen;
      sidebar.focus({ preventScroll: true });
    }

    function focusTab() {
      if (tab) {
        tab.focus({ preventScroll: true });
      } else if (lastFocusedBeforeOpen && lastFocusedBeforeOpen.focus) {
        lastFocusedBeforeOpen.focus({ preventScroll: true });
      }
    }

    function updateActiveClasses(activeId) {
      if (!root) return;
      root.querySelectorAll("[data-section-id]").forEach((button) => {
        button.classList.toggle("pp-active", Boolean(activeId && button.dataset.sectionId === activeId));
        if (button.classList.contains("pp-active")) {
          button.setAttribute("aria-current", "true");
        } else {
          button.removeAttribute("aria-current");
        }
      });
    }

    function updateProgress(model) {
      if (!root || !model) return;
      const progress = progressPercent();
      root.style.setProperty("--pp-progress", `${progress}%`);
      setText(".pp-meter-value", `${progress}%`);
      const remainingRatio = Math.max(0, 1 - progress / 100);
      const remainingWords = Math.ceil(model.totalReadableWords * remainingRatio);
      const remainingMinutes = Math.max(1, Math.ceil(remainingWords / 235));
      setText("[data-pp-stat='time']", progress >= 99 ? "Done" : `${remainingMinutes}m`);
    }

    function destroy() {
      if (root) {
        root.remove();
      }
      root = null;
      sidebar = null;
      tab = null;
    }

    function getFocusableItems() {
      return Array.from(root.querySelectorAll(".pp-start-card:not(:disabled), .pp-skip:not(:disabled), .pp-next:not(:disabled), .pp-collapse-toggle, .pp-section-item"))
        .filter((element) => !element.closest("[hidden]") && element.offsetParent !== null);
    }

    function setText(selector, value) {
      const element = root.querySelector(selector);
      if (element) {
        element.textContent = value;
      }
    }

    function renderImportantList(model) {
      const list = root.querySelector(".pp-important-list");
      if (!model.importantSections.length) {
        list.innerHTML = emptyTemplate("No clear standout", model.pageProfile.reason || "PagePilot is staying quiet here.");
        return;
      }
      list.innerHTML = model.importantSections
        .map((section) => sectionButtonTemplate(section, { showReason: true, showTree: false }))
        .join("");
    }

    function renderJumpList(model) {
      const list = root.querySelector(".pp-jump-list");
      const navSections = visibleSections(model.sections);
      if (!navSections.length) {
        list.innerHTML = emptyTemplate("Nothing to organize", "Try PagePilot on a longer page or conversation.");
        return;
      }
      list.innerHTML = navSections
        .map((section) => sectionButtonTemplate(section, { showReason: false, showTree: true }))
        .join("");
    }

    function visibleSections(sections) {
      const hiddenParents = new Set();
      return sections.filter((section) => {
        if (section.parentId && hiddenParents.has(section.parentId)) {
          hiddenParents.add(section.id);
          return false;
        }
        if (section.isCollapsed) {
          hiddenParents.add(section.id);
        }
        return true;
      });
    }

    function sectionButtonTemplate(section, settings) {
      const depth = Math.max(0, getSectionDepth(section));
      const hasChildren = section.childIds && section.childIds.length > 0;
      const label = section.label ? `<span class="pp-badge">${escape(section.label)}</span>` : "";
      const reason = settings.showReason ? `<span class="pp-reason">${escape(reasonForSection(section))}</span>` : "";
      const preview = !settings.showReason ? `<span class="pp-preview">${escape(sectionPreview(section))}</span>` : "";
      const importantClass = section.isImportant ? " pp-item-important" : "";
      const collapse = settings.showTree
        ? hasChildren
          ? `<button class="pp-collapse-toggle" type="button" data-toggle-section="${escape(section.id)}" aria-label="${escape(section.isCollapsed ? "Expand section" : "Collapse section")}" aria-expanded="${String(!section.isCollapsed)}">${icon(section.isCollapsed ? "chevronRight" : "chevronDown")}</button>`
          : `<span class="pp-collapse-spacer" aria-hidden="true"></span>`
        : "";
      const button = `
        <button class="pp-section-item${importantClass}" type="button" data-section-id="${escape(section.id)}">
          <span class="pp-item-main">
            <span class="pp-item-title">${escape(section.title)}</span>
            ${reason}
            ${preview}
          </span>
          ${label}
        </button>
      `;

      if (!settings.showTree) {
        return button;
      }

      return `
        <div class="pp-section-row" role="listitem" style="--pp-depth:${depth}">
          ${collapse}
          ${button}
        </div>
      `;
    }

    function escape(value) {
      return helpers.escapeHtml(value);
    }

    return {
      mount,
      render,
      updateActiveClasses,
      updateProgress,
      focusPanel,
      focusTab,
      destroy,
      getRoot() {
        return root;
      }
    };
  }

  function shellTemplate() {
    return `
      <button class="pp-edge-tab" type="button" aria-label="Open PagePilot" aria-expanded="false">
        <span class="pp-tab-mark" aria-hidden="true"></span>
        <span class="pp-tab-copy">
          <span class="pp-tab-title">PagePilot</span>
          <span class="pp-tab-meta">Ready</span>
        </span>
      </button>

      <aside class="pp-sidebar" aria-label="PagePilot navigation layer" tabindex="-1">
        <div class="pp-topbar">
          <div class="pp-brand">
            <span class="pp-brand-mark" aria-hidden="true"></span>
            <div>
              <div class="pp-brand-title">PagePilot</div>
              <div class="pp-brand-subtitle">Navigation layer</div>
            </div>
          </div>
          <div class="pp-window-actions">
            <button class="pp-icon-button pp-minimize" type="button" aria-label="Minimize PagePilot" title="Minimize">
              ${icon("minus")}
            </button>
            <button class="pp-icon-button pp-snooze" type="button" aria-label="Snooze PagePilot on this page" title="Snooze on this page">
              ${icon("moon")}
            </button>
          </div>
        </div>

        <div class="pp-scroll">
          <section class="pp-overview" aria-label="Page overview">
            <div class="pp-meter" aria-hidden="true">
              <div class="pp-meter-value">0%</div>
            </div>
            <div class="pp-overview-copy">
              <div class="pp-kicker">Page guide</div>
              <h2 class="pp-hero-title">Find the useful part.</h2>
              <p class="pp-summary-line">PagePilot is reading the structure of this page.</p>
            </div>

            <button class="pp-start-card" type="button" data-section-id="">
              <span class="pp-start-label">Best place to start</span>
              <strong class="pp-start-title">Finding the strongest section...</strong>
              <span class="pp-start-reason">Ranking this page locally.</span>
            </button>

            <div class="pp-stats" aria-label="Page stats">
              <div>
                <strong data-pp-stat="time">--</strong>
                <span>left</span>
              </div>
              <div>
                <strong data-pp-stat="sections">0</strong>
                <span>sections</span>
              </div>
              <div>
                <strong data-pp-stat="important">0</strong>
                <span>useful</span>
              </div>
            </div>

            <div class="pp-actions">
              <button class="pp-skip" type="button" title="Jump to useful part (Alt+J)">
                ${icon("arrowDown")}
                <span>Jump to useful part</span>
              </button>
              <button class="pp-next" type="button" title="Next important section (Alt+N)">
                ${icon("arrowDown")}
                <span class="pp-next-label">Next important</span>
              </button>
            </div>
          </section>

          <section class="pp-list-panel pp-important-panel">
            <div class="pp-section-heading">
              <h2>Best Path</h2>
              <span class="pp-count pp-important-count">0</span>
            </div>
            <div class="pp-important-list" role="list"></div>
          </section>

          <section class="pp-list-panel pp-jump-panel">
            <div class="pp-section-heading">
              <h2>Page Map</h2>
              <span class="pp-count pp-section-count">0</span>
            </div>
            <div class="pp-jump-list" role="list"></div>
          </section>
        </div>

        <div class="pp-onboarding" role="status" aria-live="polite">
          <strong>Start with the useful part</strong>
          <span>Use Alt+J to jump. Minimize anytime; the tab stays on the edge.</span>
          <button class="pp-tip-dismiss" type="button">Got it</button>
        </div>

        <div class="pp-live" aria-live="polite" aria-atomic="true"></div>
      </aside>
    `;
  }

  function heroTitle(model, bestSection, quietMode) {
    if (quietMode) return "Staying quiet here.";
    if (!model.hasStrongTarget || !bestSection) {
      return model.confidenceTier === "low" ? "No clear standout yet." : "Find the useful part.";
    }
    if (model.savedMinutes >= 2) return `Skip ${model.savedMinutes} minutes of scrolling.`;
    if (model.pageProfile.type === "chat") {
      if (bestSection.unitMeta && bestSection.unitMeta.hasRevision) return "Jump to the corrected answer.";
      if (bestSection.metrics.matched.finalCode) return "Jump to the final code.";
      if (bestSection.metrics.matched.summary) return "Jump to the summary.";
      return "Jump to the latest answer.";
    }
    if (bestSection.metrics.matched.summary) return "Jump to the summary.";
    if (bestSection.metrics.matched.completeCode) return "Find the complete code.";
    if (bestSection.metrics.matched.conciseAnswer || bestSection.metrics.matched.answer) return "Jump straight to the answer.";
    if (model.pageProfile.type === "docs" && (bestSection.metrics.codeBlocks > 0 || bestSection.metrics.matched.example)) return "Find the working example.";
    if (model.pageProfile.type === "recipe") return "Skip to the steps.";
    return "Jump to the useful part.";
  }

  function summaryLine(model, bestSection, quietMode) {
    if (quietMode) return model.pageProfile.reason || "Not much to organize on this page.";
    if (!bestSection || !model.hasStrongTarget) {
      if (model.confidenceTier === "low") return "PagePilot found structure, but no section clearly wins.";
      return "No clear standout section found.";
    }
    const usefulCount = model.importantSections.length || 1;
    const countCopy = `${usefulCount} useful ${usefulCount === 1 ? "section" : "sections"}`;
    const saveCopy = model.savedMinutes >= 1 ? ` About ${model.savedMinutes}m saved.` : "";
    return `${model.confidenceLabel}. ${countCopy}.${saveCopy}`;
  }

  function startLabel(model, canJump) {
    if (!canJump) return "No clear standout";
    return `${model.bestLabel} • ${model.confidenceLabel}`;
  }

  function lowSignalTitle(model) {
    if (model.pageProfile.quietMode) return "Not much to organize here";
    if (model.confidenceTier === "low") return "No clear best section";
    return "No strong jump target yet";
  }

  function lowSignalReason(model) {
    if (model.pageProfile.quietMode) return model.pageProfile.reason || "PagePilot will stay out of the way.";
    if (model.confidenceTier === "low") return "The page has structure, but nothing stands out enough to recommend.";
    return "Use the page map, or rescan after more content loads.";
  }

  function tabLabel(model, mode) {
    if (mode === "snoozed") return "Open PagePilot, snoozed on this page";
    if (mode === "quiet") return "Open PagePilot, quiet on this page";
    if (model.hasStrongTarget) return `Open PagePilot, ${model.bestLabel}`;
    return "Open PagePilot";
  }

  function tabTitle(model, mode) {
    if (mode === "snoozed") return "Snoozed";
    if (mode === "quiet") return "Quiet";
    if (model.hasStrongTarget) return "Ready";
    return "PagePilot";
  }

  function tabMeta(model, mode) {
    if (mode === "snoozed") return "Click to reopen";
    if (mode === "quiet") return model.pageProfile.quietReason || model.pageProfile.reason || "Staying out of the way";
    if (model.hasStrongTarget) return model.bestLabel;
    return `${model.sections.length} sections`;
  }

  function readingTimeCopy(model) {
    if (model.pageProfile.quietMode) return "--";
    return `${Math.max(1, model.readingMinutes || 1)}m`;
  }

  function liveStatus(model, quietMode) {
    if (quietMode) return model.pageProfile.reason || "PagePilot is quiet on this page.";
    if (model.hasStrongTarget) return `${model.bestLabel}: ${findSection(model, model.bestSectionId).title}`;
    return "No clear standout section found.";
  }

  function reasonForSection(section) {
    if (!section || !section.metrics) return "Useful section";
    if (section.metrics.matched.finalCode) return "Last substantial code block in the conversation";
    if (section.unitMeta && section.unitMeta.hasRevision && section.unitMeta.isLatestAssistant) return "Looks like the latest corrected answer";
    if (section.metrics.matched.completeCode) return "Looks like complete, usable code";
    if (section.metrics.matched.conciseAnswer) return "Opens with a concise answer";
    if (section.metrics.matched.summary) return "Summarizes the useful parts";
    if (section.metrics.matched.acceptedAnswer) return "Looks like the confirmed answer";
    if (section.metrics.matched.procedure) return "Contains step-by-step guidance";
    if (section.metrics.matched.directAction) return "Gives direct next actions";
    if (section.metrics.matched.troubleshooting) return "Points to a fix";
    if (section.metrics.matched.recommendation) return "Uses recommendation language";
    if (section.metrics.matched.answer) return "Has a direct answer signal";
    if (section.metrics.matched.action) return "Looks actionable";
    if (section.metrics.matched.codeExplanation) return "Explains a working code example";
    if (section.metrics.codeBlocks > 0) return "Includes a practical example";
    if (section.metrics.tables > 0) return "Summarizes details in a table";
    if (section.metrics.matched.comparison) return "Compares options clearly";
    if (section.metrics.matched.example) return "Shows an example or comparison";
    if (section.metrics.matched.warning) return "Flags a caveat";
    if (section.metrics.listItems >= 3) return "Structured for quick scanning";
    if (section.metrics.hasNumbers) return "Contains concrete details";
    return `${section.wordCount} focused words`;
  }

  function sectionPreview(section) {
    const text = String(section.text || "").replace(section.title, "").trim();
    const preview = text || reasonForSection(section);
    return preview.length > 126 ? `${preview.slice(0, 123).trim()}...` : preview;
  }

  function getSectionDepth(section) {
    let depth = 0;
    let current = section;
    const all = window.__PAGEPILOT_CURRENT_SECTIONS__ || [];
    while (current && current.parentId && depth < 5) {
      depth += 1;
      current = all.find((item) => item.id === current.parentId);
    }
    return depth;
  }

  function findSection(model, id) {
    return model.sections.find((section) => section.id === id) || null;
  }

  function emptyTemplate(title, copy) {
    return `
      <div class="pp-empty">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(copy)}</span>
      </div>
    `;
  }

  function progressPercent() {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(100, Math.round((window.scrollY / scrollable) * 100)));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function icon(name) {
    const paths = {
      minus: "<path d='M5 12h14'/>",
      moon: "<path d='M20 15.2A8 8 0 0 1 8.8 4 7 7 0 1 0 20 15.2Z'/>",
      arrowDown: "<path d='M12 5v14'/><path d='m19 12-7 7-7-7'/>",
      chevronRight: "<path d='m9 18 6-6-6-6'/>",
      chevronDown: "<path d='m6 9 6 6 6-6'/>"
    };
    return `<svg class="pp-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
  }

  window.PagePilotUI = {
    createUI
  };
})();
