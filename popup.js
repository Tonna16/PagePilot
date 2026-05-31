"use strict";

const statusEls = {
  sections: document.getElementById("sections"),
  important: document.getElementById("important"),
  words: document.getElementById("words"),
  bestLabel: document.getElementById("bestLabel"),
  bestTitle: document.getElementById("bestTitle"),
  bestReason: document.getElementById("bestReason"),
  message: document.getElementById("message")
};

const actionEls = {
  jumpUseful: document.getElementById("jumpUseful"),
  nextImportant: document.getElementById("nextImportant"),
  openSidebar: document.getElementById("openSidebar"),
  rescanPage: document.getElementById("rescanPage")
};

const CONTENT_FILES = ["content/adapters.js", "content/engine.js", "content/ui.js", "content.js"];

actionEls.jumpUseful.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const result = await sendOrInject(tab.id, { type: "PAGEPILOT_JUMP_USEFUL" });
  updateStatus(result);
});

actionEls.nextImportant.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const result = await sendOrInject(tab.id, { type: "PAGEPILOT_NEXT_IMPORTANT" });
  updateStatus(result);
});

actionEls.openSidebar.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const result = await sendOrInject(tab.id, { type: "PAGEPILOT_TOGGLE", open: true });
  updateStatus(result);
});

actionEls.rescanPage.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const result = await sendOrInject(tab.id, { type: "PAGEPILOT_SCAN" });
  updateStatus(result);
});

init();

async function init() {
  const tab = await getActiveTab();
  if (!tab) return;
  const result = await sendMessage(tab.id, { type: "PAGEPILOT_STATUS" });
  updateStatus(result);
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

async function sendOrInject(tabId, message) {
  let response = await sendMessage(tabId, message);

  if (response && response.ok) {
    return response;
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_FILES
    });
    response = await waitAndSend(tabId, message);
    return response;
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "PagePilot cannot run on this page."
    };
  }
}

function waitAndSend(tabId, message) {
  return new Promise((resolve) => {
    let attempts = 0;
    const trySend = async () => {
      attempts += 1;
      const response = await sendMessage(tabId, message);

      if (response && response.ok) {
        resolve(response);
        return;
      }

      if (attempts >= 8) {
        resolve(response || {
          ok: false,
          error: "PagePilot is still loading on this page. Try again in a moment."
        });
        return;
      }

      window.setTimeout(trySend, 90 + attempts * 40);
    };

    trySend();
  });
}

function sendMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

function updateStatus(result) {
  if (!result || !result.ok) {
    statusEls.sections.textContent = "--";
    statusEls.important.textContent = "--";
    statusEls.words.textContent = "--";
    statusEls.bestLabel.textContent = "Best start";
    statusEls.bestTitle.textContent = "Not available here";
    statusEls.bestReason.textContent = "Open a long web page or AI conversation.";
    statusEls.message.textContent = result && result.error
      ? result.error
      : "Open PagePilot on a long web page or AI conversation.";
    return;
  }

  statusEls.sections.textContent = String(result.sections);
  statusEls.important.textContent = String(result.important);
  statusEls.words.textContent = result.words > 999 ? `${Math.round(result.words / 100) / 10}k` : String(result.words);
  actionEls.jumpUseful.disabled = !result.canJump;
  actionEls.nextImportant.disabled = !result.canJumpNext;
  statusEls.bestLabel.textContent = result.quietMode ? "Quiet here" : result.bestLabel || "Best place to start";
  statusEls.bestTitle.textContent = result.bestTitle || "Nothing strong to map here";
  statusEls.bestReason.textContent = result.quietMode
    ? (result.quietReason || result.bestReason || "PagePilot will stay out of the way here.")
    : [result.bestReason, result.confidenceLabel, result.targetConfidenceReason].filter(Boolean).join(" • ")
      || "Use the sidebar page map to move around this page.";
  statusEls.message.textContent = result.quietMode
    ? "Not much to organize here. PagePilot is staying quiet."
    : result.shortPage
    ? "This page is brief, so PagePilot will stay out of the way and track your place."
    : result.canJump
      ? readyMessage(result)
      : "PagePilot found structure, but no section clearly stands out.";
}

function readyMessage(result) {
  if (result.savedMinutes >= 2) {
    return `Ready. PagePilot can skip about ${result.savedMinutes} minutes of scrolling.`;
  }

  if (result.bestLabel && /answer/i.test(result.bestLabel)) {
    return "Ready. PagePilot can jump straight to the answer.";
  }

    return "Ready. PagePilot found a useful place to start.";
}
