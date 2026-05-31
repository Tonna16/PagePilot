# PagePilot

Navigate long web pages and AI chats. PagePilot finds the useful part and stays out of the way.

PagePilot is a local-only Chrome MV3 extension: no signup, no backend, no analytics, and no remote AI calls. It adds a lightweight navigation layer for articles, docs, tutorials, research pages, recipes, discussions, and long AI conversations.

## What It Does

- Finds a useful starting point only when confidence is strong enough.
- Stays quiet on dashboards, admin panels, search results, product pages, short pages, and low-structure pages.
- Creates structure for long AI chats on ChatGPT, Claude, Gemini, Perplexity, Copilot, Grok, GitHub Copilot web, and generic browser chat surfaces.
- Detects assistant/user turns, final answers, revised answers, summaries, topic changes, and substantial code blocks locally.
- Provides a nested Page Map with collapsible subsections and current-section tracking.
- Supports `Alt+J` / `Option+J` for the best useful jump and `Alt+N` / `Option+N` for the next important section.
- Uses a small edge tab when minimized or quiet so PagePilot can be dismissed without feeling lost.

## Install Locally

1. Open Chrome and visit `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the local folder that contains `manifest.json`.
5. Open a long web page or AI conversation.

## Release Checks

Run:

```sh
npm run check
npm run package
```

The package script validates the manifest, required files, syntax checks, fixture tests, icons, and then writes `dist/pagepilot-1.0.0.zip`.

## Privacy

PagePilot analyzes page structure locally in the content script. Page content is never sent to a server.

Permissions:

- `activeTab`: lets the popup talk to the current tab.
- `scripting`: lets the popup recover PagePilot on tabs where the automatic content script has not finished loading.
- `storage`: remembers lightweight local UI state, such as first-use tips and temporary per-page snooze state.

Stored page state is local to the browser and expires for snoozed pages. PagePilot does not collect analytics or transmit browsing data.
