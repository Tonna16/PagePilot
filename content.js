(function () {
  "use strict";

  const ROOT_ID = "pagepilot-root";
  const MUTATION_SCAN_DELAY_MS = 520;
  const FAST_MUTATION_SCAN_DELAY_MS = 220;
  const MIN_RESCAN_INTERVAL_MS = 1250;
  const FAST_RESCAN_INTERVAL_MS = 360;
  const URL_WATCH_INTERVAL_MS = 1200;
  const WARMUP_SCAN_DELAYS_MS = [700, 1800, 3600, 7200, 12000];
  const JUMP_EFFECT_DURATION_MS = 4200;
  const JUMP_EFFECT_SCROLL_LOCK_MS = 1200;
  const SNOOZE_TTL_MS = 2 * 60 * 60 * 1000;
  const VIEW_MODES = new Set(["open", "minimized", "quiet", "snoozed"]);
  const STORAGE_KEYS = {
    onboardingSeen: "pagepilot.onboardingSeen",
    pagePrefix: "pagepilot.page."
  };

  if (window.top !== window.self || window.__PAGEPILOT_LOADED__) {
    return;
  }

  if (!window.PagePilotAdapters || !window.PagePilotEngine || !window.PagePilotUI) {
    return;
  }

  window.__PAGEPILOT_LOADED__ = true;

  const runtime = {
    engine: null,
    ui: null,
    model: null,
    view: {
      mode: "minimized",
      activeId: null,
      showOnboarding: false,
      collapsedSectionIds: new Set()
    },
    currentUrl: "",
    scanTimer: null,
    warmupTimers: [],
    urlWatchTimer: null,
    mutationObserver: null,
    lastScanAt: 0,
    scrollTicking: false,
    resizeTicking: false,
    routeQueued: false,
    jumpEffectTimer: null,
    jumpEffectLockedUntil: 0,
    jumpEffectActive: false,
    highlightedElements: [],
    dimmedElements: [],
    listeners: []
  };

  const DEBUG_PREFIX = "[PagePilot]";

  onReady(init);

  function emitDebug(event, extra) {
    const model = runtime.model;
    const debugState = {
      event,
      url: getCurrentUrl(),
      title: document.title || "",
      time: new Date().toISOString(),
      ...extra,
      stats: getPublicStatsSafely(),
      diagnostics: model && model.diagnostics ? model.diagnostics : null
    };

    try {
      if (typeof console !== "undefined" && console.info) {
        console.info(`${DEBUG_PREFIX} ${event}`, debugState);
      }
    } catch (error) {
      // Logging should never break the page.
    }

    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "PAGEPILOT_DEBUG_EVENT", payload: debugState }, () => {
          void (chrome.runtime && chrome.runtime.lastError);
        });
      }
    } catch (error) {
      // Ignore environments where messaging is unavailable.
    }
  }

  function getPublicStatsSafely() {
    try {
      return getPublicStats();
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }

  onReady(init);

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  async function init() {
    if (!document.body || document.getElementById(ROOT_ID)) {
      return;
    }

    runtime.currentUrl = getCurrentUrl();
    runtime.engine = window.PagePilotEngine.createEngine({ window, document });
    emitDebug("init", {
      engineReady: Boolean(runtime.engine),
      currentUrl: runtime.currentUrl
    });
    scanPage("initial");
    runtime.view.showOnboarding = !(await storageGet(STORAGE_KEYS.onboardingSeen));
    await restorePageMode();
    runtime.ui = window.PagePilotUI.createUI({
      helpers: runtime.engine.helpers,
      callbacks: {
        onOpen: () => setMode("open", { focus: true, persist: true }),
        onMinimize: () => setMode(modeForClosedState(), { focusTab: true, persist: true }),
        onSnooze: () => setMode("snoozed", { focusTab: true, persist: true }),
        onJump: () => jumpToUsefulPart(),
        onNext: () => jumpToNextImportant(),
        onSection: (id, options) => scrollToSection(id, options),
        onToggleCollapse: (id) => toggleSectionCollapse(id),
        onDismissTip: () => dismissOnboarding()
      }
    });
    runtime.ui.mount();
    render();
    attachGlobalEvents();
    watchPageChanges();
    watchRouteChanges();
    refreshActiveSection();
    scheduleWarmupScans("initial");
  }

  function scanPage(reason) {
    if (!runtime.engine) return;
    const previousSignature = runtime.model ? runtime.model.structureSignature : "";
    const previousQuiet = runtime.model ? runtime.model.pageProfile.quietMode : null;

    try {
      runtime.model = runtime.engine.scan({
        collapsedSectionIds: runtime.view.collapsedSectionIds,
        reason
      });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      runtime.model = buildFallbackModel(reason, message);
      emitDebug(`scan:error:${reason}`, {
        reason,
        error: message,
        fallbackApplied: true
      });
    }

    runtime.lastScanAt = Date.now();

    runtime.view.mode = resolveMode(runtime.view.mode);

    emitDebug(`scan:${reason}`, {
      reason,
      changed: !(previousSignature && previousSignature === runtime.model.structureSignature && previousQuiet === runtime.model.pageProfile.quietMode)
    });

    if (
      previousSignature
      && previousSignature === runtime.model.structureSignature
      && previousQuiet === runtime.model.pageProfile.quietMode
    ) {
      refreshActiveSection();
      return;
    }

    render();
  }


  function buildFallbackModel(reason, errorMessage) {
    const quietReason = errorMessage
      ? `PagePilot hit an internal error while scanning: ${errorMessage}`
      : "PagePilot is not ready yet.";
    return {
      adapterName: "error",
      articleRoot: document.body,
      pageProfile: {
        type: "low_structure",
        label: "Page",
        readingConfidence: 0,
        quietMode: true,
        reason: quietReason,
        quietReason,
        adapterName: "error",
        diagnosticHint: errorMessage ? `Internal scan error: ${errorMessage}` : ""
      },
      sections: [],
      importantSections: [],
      bestSectionId: null,
      nextImportantId: null,
      skipTargetId: null,
      confidence: 0,
      confidenceTier: "low",
      confidenceLabel: "Unavailable",
      hasStrongTarget: false,
      bestLabel: "Best start",
      savedMinutes: 0,
      totalWords: 0,
      totalReadableWords: 0,
      readingMinutes: 0,
      routeKey: getCurrentUrl(),
      routeHash: "error",
      diagnostics: {
        adapterName: "error",
        adapterFamily: "error",
        rootTag: document.body && document.body.tagName ? document.body.tagName.toLowerCase() : "",
        rootId: document.body && document.body.id ? document.body.id : "",
        rootClass: document.body && document.body.className ? String(document.body.className).slice(0, 120) : "",
        rootWords: 0,
        adapterUnitsCount: 0,
        useAdapterUnits: false,
        headingSectionsCount: 0,
        fallbackSectionsCount: 0,
        unitSectionsCount: 0,
        rawSectionCount: 0,
        pageProfileBefore: null,
        pageProfileAfter: {
          type: "low_structure",
          label: "Page",
          quietMode: true,
          reason: quietReason,
          diagnosticHint: errorMessage ? `Internal scan error: ${errorMessage}` : ""
        }
      },
      structureSignature: `error:${errorMessage || reason || "unknown"}`
    };
  }

  function render() {
    if (!runtime.ui || !runtime.model) return;
    window.__PAGEPILOT_CURRENT_SECTIONS__ = runtime.model.sections;
    runtime.ui.render(runtime.model, runtime.view);
  }

  function setMode(mode, options) {
    if (!runtime.model) return;
    const nextMode = resolveMode(mode);
    runtime.view.mode = nextMode;

    if (nextMode === "open") {
      clearPageMode();
      refreshSectionPositions();
      refreshActiveSection();
    }

    if (options && options.persist) {
      persistPageMode(nextMode);
    }

    render();

    if (nextMode === "open" && options && options.focus) {
      runtime.ui.focusPanel();
    } else if (options && options.focusTab) {
      runtime.ui.focusTab();
    }
  }

  function modeForClosedState() {
    return resolveMode("minimized");
  }

  function resolveMode(mode) {
    const normalized = VIEW_MODES.has(mode) ? mode : "minimized";
    if (normalized === "open" || normalized === "snoozed") {
      return normalized;
    }
    return runtime.model && runtime.model.pageProfile.quietMode ? "quiet" : "minimized";
  }

  async function restorePageMode() {
    if (!runtime.model) return;
    const state = await storageGet(pageStorageKey());
    const expired = !state || !state.expiresAt || state.expiresAt <= Date.now();

    if (expired) {
      clearPageMode();
      runtime.view.mode = resolveMode("minimized");
      return;
    }

    runtime.view.mode = state.mode === "snoozed" ? "snoozed" : resolveMode(state.mode);
  }

  function persistPageMode(mode) {
    if (!runtime.model) return;
    if (mode === "snoozed") {
      storageSet(pageStorageKey(), {
        mode,
        expiresAt: Date.now() + SNOOZE_TTL_MS
      });
      return;
    }
    clearPageMode();
  }

  function clearPageMode() {
    if (!runtime.model) return;
    storageRemove(pageStorageKey());
  }

  function pageStorageKey() {
    return `${STORAGE_KEYS.pagePrefix}${runtime.model ? runtime.model.routeHash : "unknown"}`;
  }

  async function dismissOnboarding() {
    runtime.view.showOnboarding = false;
    await storageSet(STORAGE_KEYS.onboardingSeen, true);
    render();
  }

  function attachGlobalEvents() {
    addWindowListener("scroll", requestScrollUpdate, { passive: true });
    addWindowListener("resize", requestResizeUpdate, { passive: true });
    addWindowListener("keydown", handleShortcut, true);
    addWindowListener("wheel", clearJumpEffectFromUser, { passive: true });
    addWindowListener("touchstart", clearJumpEffectFromUser, { passive: true });
    addWindowListener("pagehide", (event) => {
      if (!event.persisted) {
        destroy();
      }
    }, { once: true });

    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(handleMessage);
      }
    } catch (error) {
      // Restricted pages can reject extension messaging while the injected UI remains usable.
    }
  }

  function addWindowListener(type, listener, options) {
    window.addEventListener(type, listener, options);
    runtime.listeners.push({ type, listener, options });
  }

  function handleMessage(message, sender, sendResponse) {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "PAGEPILOT_TOGGLE") {
      setMode(typeof message.open === "boolean" && message.open ? "open" : modeForClosedState(), { focus: Boolean(message.open), persist: true });
      sendResponse(getPublicStats());
      return true;
    }

    if (message.type === "PAGEPILOT_SCAN") {
      scanPage("popup");
      sendResponse(getPublicStats());
      return true;
    }

    if (message.type === "PAGEPILOT_JUMP_USEFUL") {
      setMode("open", { focus: true, persist: true });
      jumpToUsefulPart();
      sendResponse(getPublicStats());
      return true;
    }

    if (message.type === "PAGEPILOT_NEXT_IMPORTANT") {
      setMode("open", { focus: true, persist: true });
      jumpToNextImportant();
      sendResponse(getPublicStats());
      return true;
    }

    if (message.type === "PAGEPILOT_STATUS") {
      sendResponse(getPublicStats());
      return true;
    }

    return false;
  }

  function watchPageChanges() {
    runtime.mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationLooksMeaningful)) {
        scheduleScan("mutation");
      }
    });

    runtime.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-label", "class", "data-message-author-role", "data-role", "data-testid", "role"],
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  function watchRouteChanges() {
    patchHistory();
    runtime.urlWatchTimer = window.setInterval(() => {
      const nextUrl = getCurrentUrl();
      if (nextUrl !== runtime.currentUrl) {
        handleRouteChange(nextUrl);
      }
    }, URL_WATCH_INTERVAL_MS);

    addWindowListener("popstate", () => queueRouteCheck(), { passive: true });
    addWindowListener("hashchange", () => queueRouteCheck(), { passive: true });
    addWindowListener("pagepilot:routechange", () => queueRouteCheck(), { passive: true });
  }

  function patchHistory() {
    if (window.__PAGEPILOT_HISTORY_PATCHED__) return;
    window.__PAGEPILOT_HISTORY_PATCHED__ = true;
    ["pushState", "replaceState"].forEach((name) => {
      const original = history[name];
      history[name] = function patchedHistoryMethod() {
        const result = original.apply(this, arguments);
        window.dispatchEvent(new Event("pagepilot:routechange"));
        return result;
      };
    });
  }

  function queueRouteCheck() {
    if (runtime.routeQueued) return;
    runtime.routeQueued = true;
    window.setTimeout(() => {
      runtime.routeQueued = false;
      const nextUrl = getCurrentUrl();
      if (nextUrl !== runtime.currentUrl) {
        handleRouteChange(nextUrl);
      }
    }, 80);
  }

  async function handleRouteChange(nextUrl) {
    runtime.currentUrl = nextUrl;
    runtime.view.mode = "minimized";
    runtime.view.activeId = null;
    runtime.view.collapsedSectionIds.clear();
    clearJumpEffect();
    scanPage("route");
    await restorePageMode();
    render();
    scheduleWarmupScans("route");
  }

  function getCurrentUrl() {
    const routeHash = /^(#\/|#!|#chat|#conversation|#page=)/i.test(window.location.hash) ? window.location.hash : "";
    return `${window.location.origin}${window.location.pathname}${window.location.search}${routeHash}`;
  }

  function mutationLooksMeaningful(mutation) {
    const root = runtime.ui && runtime.ui.getRoot ? runtime.ui.getRoot() : document.getElementById(ROOT_ID);

    if (root && mutation.target && root.contains(mutation.target)) {
      return false;
    }

    const targetElement = mutation.target && mutation.target.nodeType === Node.TEXT_NODE
      ? mutation.target.parentElement
      : mutation.target;
    if (root && targetElement && root.contains(targetElement)) {
      return false;
    }

    if (mutation.type === "characterData") {
      const text = runtime.engine.helpers.cleanText(mutation.target.textContent || "");
      if (runtime.engine.helpers.countWords(text) < 3) return false;
      return isChatLikePage() || isPdfLikePage() || elementLooksConversationLike(targetElement) || elementLooksPdfLike(targetElement);
    }

    if (mutation.type === "attributes") {
      return elementLooksConversationLike(targetElement) || elementLooksPdfLike(targetElement);
    }

    return Array.from(mutation.addedNodes).some((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const element = node;
      if (root && (element === root || root.contains(element) || element.contains(root))) return false;
      if (runtime.engine.helpers.isLowValueElement(element)) return false;
      const text = runtime.engine.helpers.cleanText(element.innerText || element.textContent || "");
      const words = runtime.engine.helpers.countWords(text);
      if ((isChatLikePage() || elementLooksConversationLike(element)) && words >= 3) {
        return true;
      }
      if ((isPdfLikePage() || elementLooksPdfLike(element)) && words >= 4) {
        return true;
      }
      if (words < 32) return false;
      return !/\b(cookie|subscribe|newsletter|advertisement|sponsored|sign up)\b/i.test(text.slice(0, 1200));
    });
  }

  function scheduleScan(reason) {
    window.clearTimeout(runtime.scanTimer);
    const elapsed = Date.now() - runtime.lastScanAt;
    const fastScan = isChatLikePage()
      || isPdfLikePage()
      || /\b(chat|conversation|stream|pdf|warmup)\b/i.test(String(reason || ""));
    const delay = Math.max(
      fastScan ? FAST_MUTATION_SCAN_DELAY_MS : MUTATION_SCAN_DELAY_MS,
      (fastScan ? FAST_RESCAN_INTERVAL_MS : MIN_RESCAN_INTERVAL_MS) - elapsed
    );

    runtime.scanTimer = window.setTimeout(() => {
      const run = () => scanPage(reason);
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(run, { timeout: 1000 });
      } else {
        run();
      }
    }, delay);
  }

  function scheduleWarmupScans(reason) {
    clearWarmupScans();
    if (!shouldWarmupScan()) return;
    runtime.warmupTimers = WARMUP_SCAN_DELAYS_MS.map((delay) => window.setTimeout(() => {
      scanPage(`${reason}-warmup`);
    }, delay));
  }

  function clearWarmupScans() {
    runtime.warmupTimers.forEach((timer) => window.clearTimeout(timer));
    runtime.warmupTimers = [];
  }

  function shouldWarmupScan() {
    return isKnownAiHost()
      || isPdfLikePage()
      || (runtime.model && ["chat", "pdf"].includes(runtime.model.pageProfile.type))
      || Boolean(document.querySelector(".textLayer, [data-page-number], pdf-viewer, embed[type='application/pdf'], iframe[src*='.pdf']"));
  }

  function isChatLikePage() {
    return isKnownAiHost()
      || Boolean(runtime.model && runtime.model.pageProfile.type === "chat")
      || Boolean(document.querySelector("[data-message-author-role], [data-testid*='conversation'], [data-testid*='chat-message'], [class*='conversation' i] [class*='message' i], [class*='chat' i] [class*='message' i]"));
  }

  function isKnownAiHost() {
    const host = window.location.hostname.toLowerCase();
    return /(^|\.)((chatgpt|claude|perplexity|grok)\.(com|ai)|chat\.openai\.com|gemini\.google\.com|copilot\.microsoft\.com|copilot\.com)$/i.test(host)
      || (host === "github.com" && /\/copilot|copilot-chat/i.test(window.location.pathname));
  }

  function isPdfLikePage() {
    return Boolean(runtime.model && runtime.model.pageProfile.type === "pdf")
      || /\.pdf(?:$|[?#])/i.test(window.location.href)
      || Boolean(document.querySelector(".textLayer, [data-page-number], pdf-viewer, embed[type='application/pdf'], embed[type='application/x-google-chrome-pdf'], iframe[src*='.pdf']"));
  }

  function elementLooksConversationLike(element) {
    if (!element || !(element instanceof Element)) return false;
    const trail = `${element.id || ""} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-testid") || ""} ${element.getAttribute("data-message-author-role") || ""} ${element.getAttribute("data-role") || ""}`;
    return /\b(conversation|chat|message|assistant|user|prompt|response|answer|reply|markdown|prose)\b/i.test(trail)
      || Boolean(element.closest("[data-message-author-role], [data-testid*='conversation'], [data-testid*='chat-message'], [data-testid*='message'], [aria-label*='assistant' i], [aria-label*='user' i], [class*='conversation' i], [class*='chat' i]"));
  }

  function elementLooksPdfLike(element) {
    if (!element || !(element instanceof Element)) return false;
    return Boolean(element.closest(".textLayer, [data-page-number], .page, #viewer, pdf-viewer"))
      || /\b(textLayer|page|pdf|viewer)\b/i.test(`${element.id || ""} ${element.className || ""}`);
  }

  function jumpToUsefulPart() {
    if (!runtime.model || !runtime.model.hasStrongTarget) {
      return false;
    }

    const targetId = runtime.model.bestSectionId || runtime.model.skipTargetId || runtime.model.nextImportantId;
    return scrollToSection(targetId, { highlight: true });
  }

  function jumpToNextImportant() {
    refreshActiveSection();
    if (!runtime.model || runtime.model.pageProfile.quietMode) return false;
    const targetId = runtime.model.nextImportantId
      || runtime.model.importantSections.find((section) => section.id !== runtime.view.activeId)?.id;
    return scrollToSection(targetId, { highlight: true });
  }

  function scrollToSection(id, options) {
    const section = runtime.model && runtime.model.sections.find((item) => item.id === id);
    if (!section || !section.anchor) {
      return false;
    }

    clearJumpEffect();
    const navigatedToExternalTarget = navigateToSectionTarget(section);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = Math.max(0, section.anchor.getBoundingClientRect().top + window.scrollY - runtime.engine.getScrollOffset());

    if (!navigatedToExternalTarget || section.anchor !== document.body) {
      window.scrollTo({
        top: target,
        behavior: prefersReducedMotion ? "auto" : "smooth"
      });
    }

    runtime.view.activeId = section.id;
    if (expandAncestors(section.id)) {
      render();
    } else {
      runtime.ui.updateActiveClasses(runtime.view.activeId);
    }

    if (options && options.highlight) {
      runtime.jumpEffectTimer = window.setTimeout(() => activateJumpEffect(section), prefersReducedMotion ? 60 : 480);
    }

    return true;
  }

  function navigateToSectionTarget(section) {
    const target = section.navigationTarget || section.unitMeta && section.unitMeta.navigationTarget;
    if (!target || typeof target !== "string") return false;
    if (target.charAt(0) === "#") {
      if (window.location.hash !== target) {
        window.location.hash = target;
      }
      return true;
    }
    return false;
  }

  function toggleSectionCollapse(id) {
    const section = runtime.model && runtime.model.sections.find((item) => item.id === id);
    if (!section || !section.childIds || !section.childIds.length) return;

    if (runtime.view.collapsedSectionIds.has(id)) {
      runtime.view.collapsedSectionIds.delete(id);
      section.isCollapsed = false;
    } else {
      if (runtime.view.activeId && isSectionDescendantOf(runtime.view.activeId, id)) return;
      runtime.view.collapsedSectionIds.add(id);
      section.isCollapsed = true;
    }

    render();
  }

  function isSectionDescendantOf(childId, parentId) {
    let current = runtime.model.sections.find((section) => section.id === childId);
    while (current && current.parentId) {
      if (current.parentId === parentId) return true;
      current = runtime.model.sections.find((section) => section.id === current.parentId);
    }
    return false;
  }

  function expandAncestors(sectionId) {
    let changed = false;
    let current = runtime.model.sections.find((section) => section.id === sectionId);
    while (current && current.parentId) {
      const parent = runtime.model.sections.find((section) => section.id === current.parentId);
      if (!parent) break;
      if (runtime.view.collapsedSectionIds.has(parent.id)) {
        runtime.view.collapsedSectionIds.delete(parent.id);
        parent.isCollapsed = false;
        changed = true;
      }
      current = parent;
    }
    return changed;
  }

  function requestScrollUpdate() {
    if (runtime.scrollTicking) return;
    runtime.scrollTicking = true;
    window.requestAnimationFrame(() => {
      runtime.scrollTicking = false;
      clearJumpEffectFromUser();
      refreshActiveSection();
      runtime.ui.updateProgress(runtime.model);
    });
  }

  function requestResizeUpdate() {
    if (runtime.resizeTicking) return;
    runtime.resizeTicking = true;
    window.requestAnimationFrame(() => {
      runtime.resizeTicking = false;
      refreshSectionPositions();
      refreshActiveSection();
    });
  }

  function refreshSectionPositions() {
    if (!runtime.model) return;
    runtime.engine.refreshSectionPositions(runtime.model.sections);
  }

  function refreshActiveSection() {
    if (!runtime.model || !runtime.model.sections.length) {
      if (runtime.ui && runtime.model) runtime.ui.updateProgress(runtime.model);
      return;
    }

    refreshSectionPositions();
    const marker = window.scrollY + Math.min(window.innerHeight * 0.36, 300);
    let active = runtime.model.sections[0];
    runtime.model.sections.forEach((section) => {
      if (section.top <= marker) active = section;
    });

    const nextImportant = runtime.model.importantSections.find((section) => section.top > marker + 80 && section.id !== active.id);
    runtime.model.nextImportantId = nextImportant ? nextImportant.id : null;

    if (active && active.id !== runtime.view.activeId) {
      runtime.view.activeId = active.id;
      if (expandAncestors(active.id)) {
        render();
      } else if (runtime.ui) {
        runtime.ui.updateActiveClasses(runtime.view.activeId);
      }
    }

    if (runtime.ui) runtime.ui.updateProgress(runtime.model);
  }

  function activateJumpEffect(section) {
    if (!section || !section.anchor) return;
    clearJumpEffect();
    runtime.jumpEffectActive = true;
    runtime.jumpEffectLockedUntil = Date.now() + JUMP_EFFECT_SCROLL_LOCK_MS;
    const targetElements = uniqueElements([section.anchor].concat(section.blocks || []));

    targetElements.slice(0, 8).forEach((element) => {
      element.classList.add("pagepilot-answer-target");
      runtime.highlightedElements.push(element);
    });

    const dimCandidates = runtime.model.sections
      .filter((item) => item.id !== section.id)
      .filter((item) => {
        const beforeTarget = item.top < section.top && item.score < section.score - 24;
        const clearFluff = item.metrics.fluffScore >= 44 || item.metrics.isDenseLinks || item.metrics.negativePatternHit;
        const lowSignal = item.score < 20 && item.wordCount < 220;
        return clearFluff || beforeTarget || lowSignal;
      })
      .flatMap((item) => [item.anchor].concat(item.blocks || []));

    uniqueElements(dimCandidates)
      .filter((element) => !targetElements.some((target) => target === element || target.contains(element) || element.contains(target)))
      .slice(0, 70)
      .forEach((element) => {
        element.classList.add("pagepilot-fluff-dim");
        runtime.dimmedElements.push(element);
      });

    runtime.jumpEffectTimer = window.setTimeout(clearJumpEffect, JUMP_EFFECT_DURATION_MS);
  }

  function clearJumpEffectFromUser() {
    if (runtime.jumpEffectActive && Date.now() > runtime.jumpEffectLockedUntil) {
      clearJumpEffect();
    }
  }

  function clearJumpEffect() {
    window.clearTimeout(runtime.jumpEffectTimer);
    runtime.jumpEffectTimer = null;
    runtime.jumpEffectActive = false;
    runtime.jumpEffectLockedUntil = 0;
    runtime.highlightedElements.forEach((element) => element.classList.remove("pagepilot-answer-target"));
    runtime.dimmedElements.forEach((element) => element.classList.remove("pagepilot-fluff-dim"));
    runtime.highlightedElements = [];
    runtime.dimmedElements = [];
  }

  function handleShortcut(event) {
    const key = String(event.key || "").toLowerCase();
    if (isTypingTarget(event.target) && !(runtime.ui && runtime.ui.getRoot() && runtime.ui.getRoot().contains(event.target))) {
      return;
    }

    if (key === "escape" && runtime.view.mode === "open") {
      event.preventDefault();
      setMode(modeForClosedState(), { focusTab: true, persist: true });
      return;
    }

    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["j", "n"].includes(key)) {
      return;
    }

    event.preventDefault();
    setMode("open", { focus: true, persist: true });
    if (key === "n") {
      jumpToNextImportant();
    } else {
      jumpToUsefulPart();
    }
  }

  function isTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
  }

  function getPublicStats() {
    const model = runtime.model;
    if (!model) {
      return { ok: false, error: "PagePilot is still starting." };
    }
    const bestSection = model.sections.find((section) => section.id === model.bestSectionId) || null;
    const nextImportant = model.sections.find((section) => section.id === model.nextImportantId) || null;
    const quietMode = model.pageProfile.quietMode;

    const shortPage = model.totalReadableWords < window.PagePilotEngine.constants.MIN_USEFUL_WORDS
      || (model.sections.length < 2 && !model.hasStrongTarget);

    return {
      ok: true,
      open: runtime.view.mode === "open",
      mode: runtime.view.mode,
      hiddenOnPage: runtime.view.mode === "snoozed",
      snoozed: runtime.view.mode === "snoozed",
      sections: model.sections.length,
      important: model.importantSections.length,
      words: model.totalReadableWords,
      shortPage,
      quietMode,
      pageType: model.pageProfile.type,
      pageLabel: model.pageProfile.label,
      readingConfidence: model.pageProfile.readingConfidence,
      confidence: model.confidence,
      confidenceTier: model.confidenceTier,
      confidenceLabel: model.confidenceLabel,
      hasStrongTarget: model.hasStrongTarget,
      canJump: Boolean(bestSection && model.hasStrongTarget && !quietMode),
      canJumpNext: Boolean(nextImportant && !quietMode),
      nextImportantTitle: nextImportant ? nextImportant.title : "",
      bestTitle: bestSection && model.hasStrongTarget ? bestSection.title : "",
      bestReason: bestSection && model.hasStrongTarget ? reasonForPublicSection(bestSection) : model.pageProfile.reason,
      quietReason: model.pageProfile.quietReason || model.pageProfile.reason || "",
      archetype: model.pageProfile.type,
      bestLabel: model.bestLabel,
      bestKind: model.bestKind || "",
      targetConfidenceReason: model.targetConfidenceReason || "",
      savedMinutes: model.savedMinutes
    };
  }

  function reasonForPublicSection(section) {
    if (section.metrics.matched.finalCode) return "Last substantial code block";
    if (section.unitMeta && section.unitMeta.hasRevision) return "Looks like the latest corrected answer";
    if (section.metrics.matched.completeCode) return "Looks like complete, usable code";
    if (section.metrics.matched.conciseAnswer) return "Opens with a concise answer";
    if (section.metrics.matched.summary) return "Summarizes the useful parts";
    if (section.metrics.matched.procedure) return "Contains step-by-step guidance";
    if (section.metrics.matched.directAction) return "Gives direct next actions";
    if (section.metrics.matched.codeExplanation || section.metrics.codeBlocks > 0) return "Includes a practical example";
    if (section.metrics.matched.answer) return "Has a direct answer signal";
    if (section.metrics.matched.recommendation) return "Uses recommendation language";
    return "Looks like the most useful section";
  }

  function uniqueElements(elements) {
    return elements.filter((element, index, list) => element && element.classList && list.indexOf(element) === index);
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(null);
          return;
        }
        chrome.storage.local.get(key, (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result ? result[key] : null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(false);
          return;
        }
        chrome.storage.local.set({ [key]: value }, () => resolve(!chrome.runtime.lastError));
      } catch (error) {
        resolve(false);
      }
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(false);
          return;
        }
        chrome.storage.local.remove(key, () => resolve(!chrome.runtime.lastError));
      } catch (error) {
        resolve(false);
      }
    });
  }

  function destroy() {
    emitDebug("destroy", {
      activeMode: runtime.view.mode,
      lastUrl: runtime.currentUrl
    });
    window.clearTimeout(runtime.scanTimer);
    clearWarmupScans();
    window.clearInterval(runtime.urlWatchTimer);
    clearJumpEffect();
    if (runtime.mutationObserver) runtime.mutationObserver.disconnect();
    runtime.listeners.forEach((entry) => window.removeEventListener(entry.type, entry.listener, entry.options));
    runtime.listeners = [];
    if (runtime.ui) runtime.ui.destroy();
    window.__PAGEPILOT_LOADED__ = false;
  }
})();
