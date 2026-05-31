/* eslint-disable no-console */
"use strict";

const PREFIX = "[PagePilot]";

function log(message, payload) {
  try {
    if (payload !== undefined) {
      console.info(`${PREFIX} ${message}`, payload);
    } else {
      console.info(`${PREFIX} ${message}`);
    }
  } catch (error) {
    // Ignore logging failures.
  }
}

function manifestVersion() {
  try {
    return chrome.runtime.getManifest().version || "unknown";
  } catch (error) {
    return "unknown";
  }
}

log("service worker loaded", { version: manifestVersion() });

try {
  chrome.runtime.onInstalled.addListener((details) => {
    log("installed", { reason: details && details.reason, version: manifestVersion() });
  });
  chrome.runtime.onStartup.addListener(() => {
    log("startup", { version: manifestVersion() });
  });
} catch (error) {
  log("failed to attach lifecycle listeners", { error: String(error && error.message ? error.message : error) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "PAGEPILOT_DEBUG_EVENT") {
    const payload = message.payload || {};
    log("debug event", {
      event: payload.event || "unknown",
      url: payload.url || "",
      title: payload.title || "",
      pageType: payload.stats && payload.stats.pageType ? payload.stats.pageType : "",
      pageLabel: payload.stats && payload.stats.pageLabel ? payload.stats.pageLabel : "",
      quietMode: payload.stats ? payload.stats.quietMode : undefined,
      sections: payload.stats ? payload.stats.sections : undefined,
      important: payload.stats ? payload.stats.important : undefined,
      words: payload.stats ? payload.stats.words : undefined,
      confidence: payload.stats ? payload.stats.confidence : undefined,
      confidenceLabel: payload.stats ? payload.stats.confidenceLabel : undefined,
      bestLabel: payload.stats ? payload.stats.bestLabel : undefined,
      reason: payload.stats ? payload.stats.quietReason || payload.stats.bestReason || "" : "",
      diagnosticHint: payload.diagnostics && payload.diagnostics.pageProfileAfter ? payload.diagnostics.pageProfileAfter.diagnosticHint || "" : "",
      profileBefore: payload.diagnostics && payload.diagnostics.pageProfileBefore ? {
        type: payload.diagnostics.pageProfileBefore.type || "",
        label: payload.diagnostics.pageProfileBefore.label || "",
        quietMode: payload.diagnostics.pageProfileBefore.quietMode,
        reason: payload.diagnostics.pageProfileBefore.reason || ""
      } : null,
      profileAfter: payload.diagnostics && payload.diagnostics.pageProfileAfter ? {
        type: payload.diagnostics.pageProfileAfter.type || "",
        label: payload.diagnostics.pageProfileAfter.label || "",
        quietMode: payload.diagnostics.pageProfileAfter.quietMode,
        reason: payload.diagnostics.pageProfileAfter.reason || "",
        diagnosticHint: payload.diagnostics.pageProfileAfter.diagnosticHint || ""
      } : null,
      diagnostics: payload.diagnostics || null
    });
    if (typeof sendResponse === "function") {
      sendResponse({ ok: true });
    }
    return true;
  }

  if (message.type === "PAGEPILOT_DEBUG_PING") {
    log("debug ping", message.payload || {});
    if (typeof sendResponse === "function") {
      sendResponse({ ok: true });
    }
    return true;
  }

  return false;
});
