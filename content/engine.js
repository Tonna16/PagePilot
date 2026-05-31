(function () {
  "use strict";

  if (window.PagePilotEngine) {
    return;
  }

  const MIN_USEFUL_WORDS = 160;
  const READING_SPEED_WPM = 235;
  const STRONG_TARGET_CONFIDENCE = 62;
  const HIGH_CONFIDENCE = 78;
  const LOW_CONFIDENCE = 46;
  const MAX_CONTENT_BLOCKS = 850;
  const MAX_HEADINGS = 260;
  const MAX_SECTIONS = 180;
  const LOW_CONFIDENCE_PAGE_TYPES = new Set(["search_results", "shopping_product", "app_dashboard", "low_structure"]);
  const QUIET_PAGE_TYPES = new Set(["search_results", "shopping_product", "app_dashboard", "low_structure"]);
  const AMBIGUOUS_PAGE_TYPES = new Set(["search_results", "shopping_product", "app_dashboard", "low_structure"]);

  const LOW_VALUE_SELECTOR = [
    "nav",
    "footer",
    "form",
    "aside",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[aria-modal='true']",
    "[class*='cookie' i]",
    "[id*='cookie' i]",
    "[class*='banner' i]",
    "[id*='banner' i]",
    "[class*='advert' i]",
    "[id*='advert' i]",
    "[class*='sponsor' i]",
    "[id*='sponsor' i]",
    "[class*='newsletter' i]",
    "[id*='newsletter' i]",
    "[class*='subscribe' i]",
    "[id*='subscribe' i]",
    "[class*='promo' i]",
    "[id*='promo' i]",
    "[class*='upsell' i]",
    "[id*='upsell' i]",
    "[class*='author-bio' i]",
    "[class*='author-box' i]",
    "[id*='author-bio' i]",
    "[id*='author-box' i]",
    "[class*='byline' i]",
    "[class*='disclosure' i]",
    "[class*='affiliate' i]",
    "[class*='comment' i]",
    "[id*='comment' i]",
    "[class*='share' i]",
    "[class*='social' i]",
    "[class*='related' i]",
    "[class*='recommend' i]",
    "[class*='also-read' i]",
    "[class*='read-more' i]",
    "[class*='more-stories' i]",
    "[class*='trending' i]",
    "[class*='outbrain' i]",
    "[class*='taboola' i]",
    "[class*='paywall' i]",
    "[aria-label*='breadcrumb' i]"
  ].join(",");

  const POSITIVE_PATTERNS = {
    useful: /\b(summary|conclusion|key takeaway|takeaways|tl;dr|tldr|bottom line|verdict|results?|findings?|recommendation|what matters|in short|final thoughts?|recap|wrap-up|at a glance|quick answer|the gist|executive summary)\b/i,
    answer: /\b(answer|solution|solved|fix|explained|why it matters|what to do|the point|in practice|best option|short answer|the takeaway|here'?s why|start here|actual answer|final answer)\b/i,
    action: /\b(steps?|how to|guide|checklist|instructions?|recipe|playbook|setup|install|configure|use this|do this|workflow|process|quick start|getting started|implementation|walkthrough|tutorial|copy and paste|replace|run this|change this)\b/i,
    definition: /\b(what is|definition|means|refers to|defined as|is a|are a|concept|overview)\b/i,
    warning: /\b(warning|caution|important|avoid|risk|mistake|pitfall|note|before you|watch out|do not|limitation|gotcha|breaking change|security|deprecated)\b/i,
    example: /\b(example|for example|case study|sample|snippet|code|demo|template|numbers?|data|benchmark|comparison|compare|versus|vs\.?|pros and cons|trade-?offs?)\b/i,
    recommendation: /\b(best|recommended|recommend|top pick|our pick|use this|prefer|should use|worth it|winner|ranked|must-have)\b/i,
    finality: /\b(final|finally|complete|done|result|outcome|finished|end state|working version|production-ready|latest answer|corrected answer|final version|use this version)\b/i
  };

  const NEGATIVE_PATTERNS = /\b(advertisement|sponsored|sponsor|affiliate|subscribe|newsletter|sign up|cookie|privacy preferences|accept all|related posts?|recommended articles?|share this|follow us|comments?|leave a reply|table of contents|also read|read more|author bio|about the author|disclosure|partners?|promotion|limited offer|promo code|buy now|shop now|deal|giveaway|webinar|download our|join our|privacy policy|terms of service)\b/i;
  const FLUFF_PATTERNS = /\b(in this article|in this post|before we dive in|let'?s dive in|when i first|i remember|back in|my journey|ever wondered|you'?re not alone|without further ado|it depends on your needs|as you may know|these days|nowadays|in today'?s world|ultimate guide|comprehensive guide|everything you need to know|we may earn|our editorial process|why you should trust us)\b/i;
  const INTRO_PATTERNS = /\b(welcome to|introduction|intro|overview|background|what we'?ll cover|table of contents|prerequisites|before you start)\b/i;
  const CONCLUSION_PATTERNS = /\b(conclusion|summary|recap|bottom line|key takeaway|final answer|final thoughts|what to do next|in short)\b/i;
  const PROCEDURE_PATTERN = /(^|\n)\s*(step\s+\d+|\d+\.|[a-z]\))\s+\S|\b(first|second|third|next|then|finally)[:,]\s/i;

  function createEngine(options) {
    const context = createContext(options);
    const helpers = createHelpers(context);
    const registry = window.PagePilotAdapters.createRegistry(context, helpers);

    function scan(scanOptions) {
      helpers.resetScanCaches();
      const collapsedSectionIds = scanOptions && scanOptions.collapsedSectionIds
        ? scanOptions.collapsedSectionIds
        : new Set();
      const adapter = registry.pick();
      const root = pickRoot(adapter);
      root.__pagePilotHelpers = helpers;
      window.__PAGEPILOT_ACTIVE_HELPERS__ = helpers;
      const rootText = helpers.getReadableText(root);
      const rootWords = helpers.countWords(rootText);
      const rawProfile = safeCall(() => adapter.profile(context, helpers, root), {
        type: "low_structure",
        label: "Page",
        readingConfidence: 30,
        quietMode: true,
        reason: "Nothing strong to map here",
        adapterName: adapter.name
      });
      let pageProfile = normalizeProfile(rawProfile, adapter);
      const adapterUnits = safeCall(() => adapter.collectUnits(root, context, helpers), null);
      const useAdapterUnits = adapterUnits && (adapterUnits.length >= 2 || ((pageProfile.type === "chat" || pageProfile.type === "pdf") && adapterUnits.length >= 1));
      const headingSections = useAdapterUnits
        ? []
        : collectHeadingSections(root, adapter, pageProfile).slice(0, MAX_SECTIONS);
      const fallbackSections = useAdapterUnits
        ? []
        : collectBlockSections(root, adapter, pageProfile).slice(0, MAX_SECTIONS);
      const unitSections = useAdapterUnits
        ? adapterUnitsToSections(adapterUnits, adapter, pageProfile)
        : [];
      const rawSections = unitSections.length
        ? unitSections
        : headingSections.length >= 3
          ? headingSections
          : mergeSections(headingSections, fallbackSections);

      applyAdapterScores(rawSections, adapter, pageProfile);
      let rankedSections = rankSections(rawSections, pageProfile);
      pageProfile = finalizePageProfile(pageProfile, rankedSections, headingSections, fallbackSections, root);
      rankedSections = rankSections(rankedSections, pageProfile);
      const sections = buildSectionHierarchy(rankedSections, collapsedSectionIds);
      refreshSectionPositions(sections);
      const importantSections = pickImportantSections(sections, pageProfile);
      const recommendation = buildRecommendation(sections, importantSections, pageProfile);
      const targets = pickNavigationTargets(sections, importantSections, recommendation.bestSectionId);
      const totalWords = helpers.countWords(rootText);
      const totalReadableWords = Math.max(totalWords, sections.reduce((sum, section) => sum + section.wordCount, 0));
      const routeKey = safeCall(() => adapter.routeKey(context), `${context.location.origin}${context.location.pathname}${context.location.search}`);

      return {
        adapterName: adapter.name,
        articleRoot: root,
        pageProfile,
        sections,
        importantSections,
        bestSectionId: recommendation.bestSectionId,
        nextImportantId: targets.nextImportantId,
        skipTargetId: targets.skipTargetId,
        confidence: recommendation.confidence,
        confidenceTier: recommendation.confidenceTier,
        confidenceLabel: recommendation.confidenceLabel,
        hasStrongTarget: recommendation.hasStrongTarget,
        bestLabel: recommendation.bestLabel,
        savedMinutes: recommendation.savedMinutes,
        totalWords,
        totalReadableWords,
        readingMinutes: Math.max(1, Math.ceil(totalReadableWords / READING_SPEED_WPM)),
        routeKey,
        routeHash: helpers.hashText(routeKey),
        diagnostics: {
          adapterName: adapter.name,
          adapterFamily: adapter.family || "",
          rootTag: root && root.tagName ? root.tagName.toLowerCase() : "",
          rootId: root && root.id ? root.id : "",
          rootClass: root && root.className ? String(root.className).slice(0, 120) : "",
          rootWords,
          adapterUnitsCount: adapterUnits ? adapterUnits.length : 0,
          useAdapterUnits,
          headingSectionsCount: headingSections.length,
          fallbackSectionsCount: fallbackSections.length,
          unitSectionsCount: unitSections.length,
          rawSectionCount: rawSections.length,
          pageProfileBefore: rawProfile,
          pageProfileAfter: pageProfile
        },
        structureSignature: getStructureSignature(pageProfile, sections)
      };
    }

    function pickRoot(adapter) {
      const root = safeCall(() => adapter.getRoot(context, helpers), null);
      const fallback = pickArticleRoot(context, helpers);

      if (root && root !== context.document.documentElement && helpers.isVisible(root)) {
        const rootWords = helpers.countWords(helpers.getReadableText(root).slice(0, 12000));
        const fallbackWords = fallback && fallback !== root
          ? helpers.countWords(helpers.getReadableText(fallback).slice(0, 12000))
          : 0;
        const shouldUseFallback = fallback && fallback !== root && (
          rootWords < 20 && fallbackWords >= 60
          || ((adapter.family === "chat" || adapter.family === "pdf") && rootWords < 64 && fallbackWords >= 80)
          || (fallbackWords > rootWords * 1.45 && fallbackWords >= 100)
        );

        if (shouldUseFallback) {
          return fallback;
        }

        return root;
      }

      return fallback || context.document.body;
    }

    return {
      scan,
      helpers,
      refreshSectionPositions,
      getScrollOffset() {
        return getScrollOffset(context, helpers);
      },
      constants: {
        MIN_USEFUL_WORDS,
        READING_SPEED_WPM,
        STRONG_TARGET_CONFIDENCE,
        HIGH_CONFIDENCE,
        LOW_CONFIDENCE
      }
    };
  }

  function createContext(options) {
    const win = options && options.window ? options.window : window;
    const doc = options && options.document ? options.document : win.document;
    return {
      window: win,
      document: doc,
      location: win.location
    };
  }

  function createHelpers(context) {
    let textCache = new WeakMap();
    let rectCache = new WeakMap();
    let visibleCache = new WeakMap();

    function resetScanCaches() {
      textCache = new WeakMap();
      rectCache = new WeakMap();
      visibleCache = new WeakMap();
    }

    function cleanText(text) {
      return String(text || "")
        .replace(/\s+/g, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
    }

    function countWords(text) {
      const matches = cleanText(text).match(/\b[\w'-]+\b/g);
      return matches ? matches.length : 0;
    }

    function getReadableText(element) {
      if (!element) {
        return "";
      }
      if (textCache.has(element)) {
        return textCache.get(element);
      }

      const parts = [];
      const seen = new Set();

      function visit(node) {
        if (!node || seen.has(node)) {
          return;
        }
        seen.add(node);

        try {
          if (node.nodeType === 3) {
            const text = cleanText(node.nodeValue || "");
            if (text) parts.push(text);
            return;
          }

          if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) {
            return;
          }

          if (node.nodeType === 1 && node !== element && isLowValueElement(node)) {
            return;
          }

          if (node.nodeType === 1) {
            const tagName = String(node.tagName || "").toLowerCase();
            if (["script", "style", "noscript", "svg", "canvas", "template", "meta", "link"].includes(tagName)) {
              return;
            }
          }

          if (typeof node.assignedNodes === "function") {
            try {
              node.assignedNodes({ flatten: true }).forEach(visit);
            } catch (error) {
              try {
                node.assignedNodes().forEach(visit);
              } catch (innerError) {
                void innerError;
              }
            }
          }

          if (node.shadowRoot) {
            visit(node.shadowRoot);
          }

          if (node.tagName === "IFRAME") {
            try {
              if (node.contentDocument && node.contentDocument.body) {
                visit(node.contentDocument.body);
              }
            } catch (error) {
              // Ignore cross-origin frames.
            }
          }

          const children = node.childNodes ? Array.from(node.childNodes) : [];
          children.forEach((child) => {
            if (child && child.nodeType === 1) {
              const tagName = String(child.tagName || "").toLowerCase();
              if (["script", "style", "noscript", "svg", "canvas", "template", "meta", "link"].includes(tagName)) {
                return;
              }
              if (child !== element && isLowValueElement(child)) {
                return;
              }
            }
            visit(child);
          });
        } catch (error) {
          // Ignore traversal errors and keep collecting the rest.
        }
      }

      visit(element);
      const value = cleanText(parts.join(" "));
      textCache.set(element, value);
      return value;
    }

    function isVisible(element) {
      if (!element || !(element instanceof context.window.Element)) {
        return false;
      }
      if (visibleCache.has(element)) {
        return visibleCache.get(element);
      }
      const style = context.window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
      visibleCache.set(element, visible);
      rectCache.set(element, rect);
      return visible;
    }

    function getPageTop(element) {
      if (!element || !element.getBoundingClientRect) {
        return 0;
      }
      const rect = rectCache.get(element) || element.getBoundingClientRect();
      rectCache.set(element, rect);
      return rect.top + context.window.scrollY;
    }

    function isLowValueElement(element) {
      if (!element || !(element instanceof context.window.Element)) {
        return false;
      }
      return Boolean(element.closest(LOW_VALUE_SELECTOR));
    }

    function querySelectorAllDeep(root, selector) {
      const results = [];
      const seen = new Set();

      function visit(scope) {
        if (!scope || !scope.querySelectorAll) return;

        Array.from(scope.querySelectorAll(selector)).forEach((element) => {
          if (!seen.has(element)) {
            seen.add(element);
            results.push(element);
          }
        });

        Array.from(scope.querySelectorAll("*")).slice(0, 1300).forEach((element) => {
          if (element.shadowRoot) {
            visit(element.shadowRoot);
          }

          if (element.tagName === "IFRAME") {
            try {
              if (element.contentDocument && element.contentDocument.body) {
                visit(element.contentDocument.body);
              }
            } catch (error) {
              // Ignore cross-origin frames.
            }
          }
        });
      }

      visit(root);
      return results;
    }

    function hashText(text) {
      let hash = 0;
      const value = String(text || "");
      for (let index = 0; index < value.length; index += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(index);
        hash |= 0;
      }
      return Math.abs(hash).toString(36);
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    return {
      resetScanCaches,
      cleanText,
      countWords,
      getReadableText,
      isVisible,
      getPageTop,
      isLowValueElement,
      querySelectorAllDeep,
      hashText,
      escapeHtml
    };
  }

  function pickArticleRoot(context, helpers) {
    const selectors = [
      "article",
      "main",
      "[role='main']",
      ".post-content",
      ".entry-content",
      ".article-content",
      ".article-body",
      ".story-body",
      ".content",
      "#content"
    ];

    const candidates = selectors
      .flatMap((selector) => Array.from(context.document.querySelectorAll(selector)))
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter((element) => isUsableContainer(element, helpers));

    candidates.push(context.document.body);
    let best = context.document.body;
    let bestScore = 0;

    candidates.forEach((candidate) => {
      const text = helpers.getReadableText(candidate);
      const words = helpers.countWords(text);
      const linkWords = helpers.countWords(Array.from(candidate.querySelectorAll("a")).map((link) => link.innerText || "").join(" "));
      const linkDensity = words ? linkWords / words : 1;
      const rect = candidate.getBoundingClientRect();
      const sizeBonus = Math.min(90, Math.max(0, rect.width * rect.height / 30000));
      const score = words - linkDensity * 560 + sizeBonus;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best || context.document.body;
  }

  function isUsableContainer(element, helpers) {
    if (!element || helpers.isLowValueElement(element)) {
      return false;
    }
    return helpers.countWords(helpers.getReadableText(element)) >= MIN_USEFUL_WORDS && helpers.isVisible(element);
  }

  function normalizeProfile(profile, adapter) {
    return {
      type: profile.type || "low_structure",
      label: profile.label || "Page",
      readingConfidence: Number.isFinite(profile.readingConfidence) ? profile.readingConfidence : 34,
      quietMode: Boolean(profile.quietMode),
      reason: profile.reason || "Nothing strong to map here",
      adapterName: profile.adapterName || adapter.name
    };
  }

  function collectHeadingSections(root, adapter, profile) {
    const helpers = getHelpersFromRoot(root);
    const headings = helpers.querySelectorAllDeep(root, "h1, h2, h3, h4")
      .filter((heading) => helpers.isVisible(heading) && !helpers.isLowValueElement(heading))
      .filter((heading) => helpers.cleanText(heading.innerText || heading.textContent).length >= 3)
      .map((heading, index) => ({
        heading,
        index,
        level: Number(heading.tagName.slice(1)),
        top: helpers.getPageTop(heading),
        title: cleanTitle(helpers.cleanText(heading.innerText || heading.textContent))
      }))
      .filter((item, index, list) => {
        const previous = list[index - 1];
        return !previous || previous.title.toLowerCase() !== item.title.toLowerCase() || Math.abs(previous.top - item.top) > 80;
      })
      .sort((a, b) => a.top - b.top)
      .slice(0, MAX_HEADINGS);
    const blocks = getContentBlocks(root, helpers);

    return headings
      .map((item, index) => {
        const next = headings.slice(index + 1).find((candidate) => candidate.level <= item.level) || headings[index + 1];
        const end = next ? next.top : Number.POSITIVE_INFINITY;
        const sectionBlocks = blocks.filter((block) => {
          const top = helpers.getPageTop(block);
          return top >= item.top - 4 && top < end - 4;
        });

        return makeSection({
          title: item.title,
          anchor: item.heading,
          blocks: sectionBlocks,
          source: "heading",
          index,
          level: item.level,
          adapter,
          profile,
          helpers,
          unitMeta: {}
        });
      })
      .filter(Boolean);
  }

  function collectBlockSections(root, adapter, profile) {
    const helpers = getHelpersFromRoot(root);
    const blocks = getContentBlocks(root, helpers);
    const sections = [];
    let bucket = [];
    let bucketWords = 0;

    blocks.forEach((block) => {
      const text = helpers.cleanText(block.innerText || block.textContent);
      const words = helpers.countWords(text);
      const isStandalone = block.matches("pre, table, blockquote, ul, ol") || words > 190;

      if (isStandalone && bucket.length) {
        sections.push(makeSectionFromBucket(bucket, sections.length, adapter, profile, helpers));
        bucket = [];
        bucketWords = 0;
      }

      bucket.push(block);
      bucketWords += words;

      if (isStandalone || bucketWords >= 165) {
        sections.push(makeSectionFromBucket(bucket, sections.length, adapter, profile, helpers));
        bucket = [];
        bucketWords = 0;
      }
    });

    if (bucket.length) {
      sections.push(makeSectionFromBucket(bucket, sections.length, adapter, profile, helpers));
    }

    return sections.filter(Boolean);
  }

  function adapterUnitsToSections(units, adapter, profile) {
    if (!units.length) return [];
    const helpers = getHelpersFromRoot(units[0].anchor);
    return units.map((unit, index) => makeSection({
      title: unit.title,
      anchor: unit.anchor,
      blocks: unit.blocks || [unit.anchor],
      source: unit.source || "adapter",
      index,
      level: Number.isFinite(unit.level) ? unit.level : 2,
      pageNumber: unit.pageNumber || unit.meta && unit.meta.pageNumber,
      navigationTarget: unit.navigationTarget || unit.meta && unit.meta.navigationTarget,
      adapter,
      profile,
      helpers,
      unitMeta: safeCall(() => adapter.classifyUnit(unit), unit.meta || {})
    })).filter(Boolean);
  }

  function getHelpersFromRoot(root) {
    let current = root;
    while (current && !current.__pagePilotHelpers) {
      current = current.parentNode || current.host;
    }
    if (current && current.__pagePilotHelpers) {
      return current.__pagePilotHelpers;
    }
    return window.__PAGEPILOT_ACTIVE_HELPERS__;
  }

  function getContentBlocks(root, helpers) {
    if (!root || !helpers) return [];
    root.__pagePilotHelpers = helpers;
    window.__PAGEPILOT_ACTIVE_HELPERS__ = helpers;
    const selector = [
      "p",
      "li",
      "pre",
      "blockquote",
      "table",
      "figure",
      "[role='note']"
    ].join(",");

    return helpers.querySelectorAllDeep(root, selector)
      .filter((element) => helpers.isVisible(element) && !helpers.isLowValueElement(element))
      .filter((element) => {
        const text = helpers.cleanText(element.innerText || element.textContent);
        if (element.matches("figure")) return text.length >= 45;
        return helpers.countWords(text) >= 8 || element.matches("pre, table");
      })
      .filter((element, index, list) => {
        const previous = list[index - 1];
        return !previous || !previous.contains(element);
      })
      .slice(0, MAX_CONTENT_BLOCKS);
  }

  function makeSectionFromBucket(bucket, index, adapter, profile, helpers) {
    return makeSection({
      title: inferTitle(bucket, helpers),
      anchor: bucket[0],
      blocks: bucket,
      source: "block",
      index,
      level: inferSectionLevel(bucket, helpers),
      adapter,
      profile,
      helpers,
      unitMeta: {}
    });
  }

  function makeSection(options) {
    const text = options.helpers.cleanText(
      [options.title].concat((options.blocks || []).map((block) => block.innerText || block.textContent || "")).join(" ")
    );
    const wordCount = options.helpers.countWords(text);

    if (!options.anchor || wordCount < 14) {
      return null;
    }

    const id = `pp-section-${options.index}-${options.helpers.hashText(`${options.title}:${wordCount}:${options.source}:${options.level}`)}`;
    options.anchor.dataset.pagepilotSection = id;
    const metrics = getSectionMetrics({
      anchor: options.anchor,
      blocks: options.blocks || [],
      title: options.title,
      text,
      index: options.index,
      helpers: options.helpers,
      profile: options.profile,
      unitMeta: options.unitMeta || {}
    });

    return {
      id,
      title: cleanTitle(options.title || "Useful section"),
      anchor: options.anchor,
      blocks: options.blocks || [],
      source: options.source,
      pageNumber: options.pageNumber || options.unitMeta && options.unitMeta.pageNumber || null,
      navigationTarget: options.navigationTarget || options.unitMeta && options.unitMeta.navigationTarget || "",
      index: options.index,
      level: Number.isFinite(options.level) ? options.level : 2,
      parentId: null,
      childIds: [],
      isCollapsed: false,
      text,
      wordCount,
      top: options.helpers.getPageTop(options.anchor),
      unitMeta: options.unitMeta || {},
      metrics,
      score: metrics.score,
      usefulScore: metrics.usefulScore,
      importanceScore: metrics.importanceScore,
      label: "",
      isImportant: false,
      isBest: false
    };
  }

  function getSectionMetrics(details) {
    const blockStats = getBlockStats(details);
    const textSignals = scoreTextSignals({
      title: details.title,
      text: details.text,
      index: details.index,
      profile: details.profile,
      unitMeta: details.unitMeta,
      blockStats,
      classTrail: getClassTrail(details.anchor, details.helpers),
      isElementLowValue: details.helpers.isLowValueElement(details.anchor)
    });

    return Object.assign({}, blockStats, textSignals);
  }

  function getBlockStats(details) {
    const helpers = details.helpers;
    const blocks = details.blocks || [];
    const wordCount = helpers.countWords(details.text);
    const paragraphs = blocks.filter((block) => block.matches && block.matches("p, blockquote")).length;
    const listItems = blocks.filter((block) => block.matches && block.matches("li, [role='listitem']")).length;
    const numberedItems = blocks.filter((block) => /^\s*(\d+\.|step\s+\d+|first|second|third|next|finally)\b/i.test(block.innerText || block.textContent || "")).length;
    const codeBlocks = blocks.filter((block) => block.matches && block.matches("pre, code")).length
      + (details.anchor.matches && details.anchor.matches("pre, code") ? 1 : 0);
    const tables = blocks.filter((block) => block.matches && block.matches("table")).length;
    const boldCount = blocks.reduce((sum, block) => sum + (block.querySelectorAll ? block.querySelectorAll("strong, b").length : 0), 0);
    const links = blocks.reduce((sum, block) => sum + (block.querySelectorAll ? block.querySelectorAll("a").length : 0), 0);
    const linkWords = blocks.reduce((sum, block) => {
      if (!block.querySelectorAll) return sum;
      return sum + Array.from(block.querySelectorAll("a")).reduce((linkSum, link) => linkSum + helpers.countWords(link.innerText || link.textContent), 0);
    }, 0);

    return {
      wordCount,
      paragraphs,
      listItems,
      numberedItems,
      codeBlocks,
      tables,
      boldCount,
      links,
      linkDensity: wordCount ? linkWords / wordCount : 0,
      hasNumbers: /\b\d+([.,]\d+)?%?\b/.test(details.text),
      hasReadableParagraphs: paragraphs > 0 && wordCount / Math.max(1, paragraphs) <= 145
    };
  }

  function scoreTextSignals(input) {
    const title = cleanText(input.title);
    const headingText = title.toLowerCase();
    const fullText = cleanText(input.text);
    const lower = fullText.toLowerCase();
    const headingAndText = `${headingText} ${lower}`;
    const stats = input.blockStats || {};
    const wordCount = stats.wordCount || countWords(fullText);
    const startsWithQuestion = /^(what|why|how|when|where|which|should|can)\b/.test(headingText);
    const isCompact = wordCount >= 45 && wordCount <= 280;
    const hasNumberedProcedure = (stats.numberedItems || 0) >= 2 || PROCEDURE_PATTERN.test(fullText);
    const hasConciseAnswer = /\b(tl;dr|tldr|short answer|quick answer|bottom line|the answer is|in short)\b/i.test(fullText.slice(0, 800));
    const hasSummary = /\b(summary|recap|key takeaways?|tl;dr|tldr|bottom line|in short|executive summary|what matters)\b/i.test(headingAndText);
    const hasDirectAction = /\b(use this|do this|copy(?: and paste)?|paste this|run this|replace(?: that| it)?|change(?: that| it)?|set this|configure|install|deploy|ship|update|remove|add|create|select this option)\b/i.test(fullText);
    const hasComparison = /\b(vs\.?|versus|compared with|compared to|comparison|pros and cons|trade-?offs?|difference between|better than)\b/i.test(fullText);
    const hasAcceptedAnswer = /\b(accepted answer|top answer|top comment|marked as solution|solved|worked for me|this fixed it|confirmed fix)\b/i.test(fullText);
    const hasTroubleshooting = /\b(error|bug|issue|problem|fix|fixed|workaround|troubleshoot|root cause|resolved|solution)\b/i.test(fullText);
    const hasNegatedAnswer = /\b(?:not|isn'?t|is not|wasn'?t|was not|never|isn’t|wasn’t)\s+(?:the\s+)?(?:actual\s+)?(?:answer|solution|fix|final answer|recommended option)\b/i.test(fullText);
    const codeHasExplanation = (stats.codeBlocks || 0) > 0 && ((stats.paragraphs || 0) > 0 || /\b(example|usage|run|returns?|outputs?|copy|paste|configure|install)\b/i.test(fullText));
    const hasCompleteCode = (stats.codeBlocks || 0) > 0
      && /\b(final|complete|full|working version|copy and paste|paste this|production-ready|drop-in)\b/i.test(fullText);
    const hasSupersededDraft = Boolean(input.unitMeta && input.unitMeta.isSuperseded)
      || /\b(earlier answer|previous answer|ignore that|not quite|that was wrong|may not handle|first attempt|one possible fix|draft)\b/i.test(fullText);
    const negativePatternHit = NEGATIVE_PATTERNS.test(headingAndText);
    const fluffPatternHit = FLUFF_PATTERNS.test(headingAndText);
    const introPatternHit = INTRO_PATTERNS.test(headingText) || (input.index <= 1 && INTRO_PATTERNS.test(headingAndText));
    const conclusionHit = CONCLUSION_PATTERNS.test(headingAndText);
    const isDenseLinks = (stats.linkDensity || 0) > 0.34 || ((stats.links || 0) > 12 && wordCount < 180);
    const isLongSoftIntro = input.index <= 1 && wordCount > 240 && !hasConciseAnswer && !hasNumberedProcedure && !(stats.codeBlocks || 0) && !(stats.tables || 0);
    const unitMeta = input.unitMeta || {};

    const matched = {
      useful: POSITIVE_PATTERNS.useful.test(headingText) || POSITIVE_PATTERNS.useful.test(lower),
      answer: !hasNegatedAnswer && (POSITIVE_PATTERNS.answer.test(headingText) || POSITIVE_PATTERNS.answer.test(lower)),
      action: POSITIVE_PATTERNS.action.test(headingText) || POSITIVE_PATTERNS.action.test(lower),
      definition: POSITIVE_PATTERNS.definition.test(headingText) || POSITIVE_PATTERNS.definition.test(lower),
      warning: POSITIVE_PATTERNS.warning.test(headingText) || POSITIVE_PATTERNS.warning.test(lower),
      example: POSITIVE_PATTERNS.example.test(headingText) || POSITIVE_PATTERNS.example.test(lower),
      recommendation: !hasNegatedAnswer && (POSITIVE_PATTERNS.recommendation.test(headingText) || POSITIVE_PATTERNS.recommendation.test(lower)),
      finality: !hasNegatedAnswer && (POSITIVE_PATTERNS.finality.test(headingText) || POSITIVE_PATTERNS.finality.test(lower) || conclusionHit),
      procedure: hasNumberedProcedure,
      conciseAnswer: hasConciseAnswer,
      summary: hasSummary,
      directAction: hasDirectAction,
      comparison: hasComparison,
      codeExplanation: codeHasExplanation,
      completeCode: hasCompleteCode,
      acceptedAnswer: hasAcceptedAnswer,
      troubleshooting: hasTroubleshooting,
      revision: Boolean(unitMeta.hasRevision),
      finalCode: Boolean(unitMeta.finalCode),
      supersededDraft: hasSupersededDraft
    };

    let usefulScore = 0;
    let importanceScore = 0;
    let structureScore = 0;
    const responsePriority = Number.isFinite(unitMeta.responsePriority) ? unitMeta.responsePriority : 0;

    if (matched.conciseAnswer) usefulScore += 52;
    if (matched.answer) usefulScore += 46;
    if (matched.procedure) usefulScore += 42;
    if (matched.action) usefulScore += 38;
    if (matched.directAction) usefulScore += 34;
    if (matched.codeExplanation) usefulScore += 34;
    if (matched.completeCode) usefulScore += 48;
    if (matched.acceptedAnswer) usefulScore += 46;
    if (matched.recommendation) usefulScore += 30;
    if (matched.finality) usefulScore += 30;
    if (matched.summary) usefulScore += matched.conciseAnswer || matched.answer ? 18 : 36;
    if (matched.example) usefulScore += 24;
    if (matched.revision) usefulScore += 28;
    if (matched.finalCode) usefulScore += 54;
    if (responsePriority > 0) usefulScore += Math.min(52, responsePriority);
    if (matched.supersededDraft) usefulScore -= 38;

    if (matched.useful) importanceScore += 38;
    if (matched.definition) importanceScore += 24;
    if (matched.warning) importanceScore += 24;
    if (matched.comparison) importanceScore += 22;
    if (matched.directAction) importanceScore += 18;
    if (matched.completeCode) importanceScore += 22;
    if (matched.troubleshooting && (matched.answer || matched.action || matched.procedure)) importanceScore += 18;
    if (matched.summary && !matched.conciseAnswer) importanceScore += 16;
    if (matched.supersededDraft) importanceScore -= 28;
    if (startsWithQuestion) importanceScore += 10;
    if ((stats.listItems || 0) >= 3) structureScore += Math.min(34, 12 + stats.listItems * 2);
    if ((stats.codeBlocks || 0) > 0) structureScore += 28;
    if ((stats.tables || 0) > 0) structureScore += 18;
    if ((stats.boldCount || 0) > 0) structureScore += Math.min(18, 5 + stats.boldCount * 2);
    if (stats.hasNumbers) structureScore += 12;
    if (stats.hasReadableParagraphs) structureScore += 10;
    if (isCompact) structureScore += 12;

    const fluffScore = getFluffScore({
      lower,
      headingAndText,
      classTrail: input.classTrail || "",
      index: input.index,
      wordCount,
      linkDensity: stats.linkDensity || 0,
      links: stats.links || 0,
      negativePatternHit,
      fluffPatternHit,
      introPatternHit,
      isDenseLinks,
      isLongSoftIntro,
      isElementLowValue: Boolean(input.isElementLowValue),
      matched
    });

    if (wordCount > 620 && !matched.procedure && !matched.codeExplanation) usefulScore -= 14;
    if (input.index === 0 && wordCount > 220 && !matched.answer && !matched.useful && !matched.action) usefulScore -= 24;

    const score = Math.round(usefulScore * 0.86 + importanceScore * 0.48 + structureScore * 0.58 - fluffScore);

    return {
      score,
      usefulScore: Math.max(0, usefulScore),
      importanceScore: Math.max(0, importanceScore + structureScore),
      matched,
      startsWithQuestion,
      isCompact,
      fluffScore,
      negativePatternHit,
      fluffPatternHit,
      introPatternHit,
      isDenseLinks,
      chatRole: unitMeta.role || ""
    };
  }

  function getFluffScore(metrics) {
    let fluffScore = 0;
    if (metrics.negativePatternHit) fluffScore += 58;
    if (metrics.fluffPatternHit) fluffScore += 26;
    if (metrics.introPatternHit && metrics.index <= 1 && !metrics.matched.conciseAnswer) fluffScore += 26;
    if (metrics.isDenseLinks) fluffScore += metrics.linkDensity > 0.55 ? 76 : 50;
    if (metrics.links > 18 && metrics.wordCount < 260) fluffScore += 30;
    if (metrics.isLongSoftIntro) fluffScore += 38;
    if (metrics.isElementLowValue) fluffScore += 66;
    if (/\b(nav|menu|breadcrumb|toc|footer|sidebar|share|social|related|comment|promo|newsletter|subscribe|advert|sponsor|affiliate|cookie|consent|byline|author)\b/i.test(metrics.classTrail)) {
      fluffScore += 40;
    }
    if (/\b(disclosure|this post may contain affiliate|as an amazon associate|reader-supported|commission)\b/i.test(metrics.headingAndText)) {
      fluffScore += 76;
    }
    if (/^\s*(home|about|contact|privacy|terms|login|sign up|subscribe)\b/i.test(metrics.lower) && metrics.wordCount < 80) {
      fluffScore += 44;
    }
    return fluffScore;
  }

  function applyAdapterScores(sections, adapter, profile) {
    sections.forEach((section) => {
      const adapterScore = safeCall(() => adapter.scoreAdjustments(section, profile), 0);
      section.metrics.adapterScore = adapterScore;
      section.score += adapterScore;
      section.usefulScore += Math.max(0, adapterScore * 0.5);
    });
  }

  function rankSections(sections, profile) {
    const minimumWords = profile.type === "chat" || profile.type === "pdf" || profile.type === "low_structure" ? 8 : 18;
    const maxSections = profile.type === "chat" || profile.type === "pdf" ? 260 : MAX_SECTIONS;
    const filtered = sections
      .filter((section) => section.wordCount >= minimumWords)
      .sort((a, b) => a.top - b.top)
      .slice(0, maxSections);
    const weakPage = Boolean(profile.quietMode) || LOW_CONFIDENCE_PAGE_TYPES.has(profile.type);
    const bestThreshold = weakPage ? 92 : profile.type === "chat" ? 58 : 42;
    const ranked = filtered
      .filter((section) => section.metrics.fluffScore < 82 || section.score >= 96 || section.metrics.matched.finalCode)
      .sort((a, b) => b.score - a.score);
    const topSection = ranked.find((section) => {
      const usefulEnough = section.usefulScore >= (profile.type === "chat" ? 34 : 26) || section.metrics.matched.finalCode;
      return section.score >= bestThreshold && usefulEnough;
    }) || null;
    const importantLimit = Math.min(9, Math.max(3, Math.ceil(filtered.length * 0.28)));
    const cutoffIndex = Math.min(importantLimit - 1, ranked.length - 1);
    const cutoffFloor = weakPage ? 78 : 34;
    const cutoff = Math.max(cutoffFloor, ranked[cutoffIndex] ? ranked[cutoffIndex].score : cutoffFloor);

    filtered.forEach((section) => {
      section.isBest = section === topSection;
      const usefulEnough = section.usefulScore >= 20
        || section.metrics.matched.conciseAnswer
        || section.metrics.matched.summary
        || section.metrics.matched.directAction
        || section.metrics.matched.completeCode
        || section.metrics.matched.finalCode
        || (section.metrics.codeBlocks > 0 && profile.type !== "search_results");
      const isImportant = section.score >= cutoff || section.isBest || (section.score >= 42 && section.metrics.codeBlocks > 0);
      const enoughSubstance = section.wordCount >= 28
        || (section.isBest && section.wordCount >= 16)
        || (section.metrics.matched.conciseAnswer && section.wordCount >= 14)
        || (section.metrics.codeBlocks > 0 && section.wordCount >= 10);
      section.isImportant = Boolean(isImportant && enoughSubstance && usefulEnough && (section.metrics.fluffScore < 82 || section.isBest));
      section.label = getSectionLabel(section);
    });

    return filtered;
  }

  function getSectionLabel(section) {
    if (!section.isImportant && !section.isBest) return "";
    if (section.metrics.matched.finalCode) return "Final code";
    if (section.source === "pdf" && section.pageNumber) return `Page ${section.pageNumber}`;
    if (section.unitMeta && section.unitMeta.hasRevision && section.unitMeta.isLatestAssistant) return "Corrected";
    if (section.metrics.matched.completeCode) return "Complete code";
    if (section.metrics.matched.conciseAnswer) return "Answer";
    if (section.metrics.matched.summary) return "Summary";
    if (section.metrics.matched.acceptedAnswer) return "Confirmed";
    if (section.metrics.matched.procedure || section.metrics.matched.action || section.metrics.matched.directAction) return "Steps";
    if (section.metrics.matched.codeExplanation || section.metrics.codeBlocks > 0) return "Example";
    if (section.metrics.matched.recommendation) return "Recommended";
    if (section.metrics.matched.finality || section.metrics.matched.useful) return "Takeaway";
    if (section.metrics.matched.warning) return "Watch out";
    return section.isBest ? "Useful" : "";
  }

  function finalizePageProfile(profile, sections, headingSections, fallbackSections, root) {
    const helpers = getHelpersFromRoot(root);
    const text = helpers.getReadableText(root);
    const words = helpers.countWords(text);
    const sectionCount = sections.length;
    const strongSignals = sections.filter((section) => section.score >= 58 && section.metrics.fluffScore < 58 && section.usefulScore >= 24).length;
    const linkWords = helpers.countWords(Array.from(root.querySelectorAll ? root.querySelectorAll("a") : []).map((link) => link.innerText || "").join(" "));
    const linkDensity = words ? linkWords / words : 0;
    const formControls = root.ownerDocument.querySelectorAll("input, textarea, select, button, [role='button'], [role='tab']").length;
    const headings = headingSections.length;
    const fallbackOnly = headings < 2 && fallbackSections.length < 3 && profile.type !== "chat";
    const readableBlocks = fallbackSections.length || headingSections.length;
    const cardLikeCount = root.querySelectorAll ? root.querySelectorAll("[class*='card' i], [class*='tile' i], [class*='grid' i], [role='listitem']").length : 0;
    const pageEvidence = getPageEvidence({
      root,
      profile,
      sections,
      headingSections,
      fallbackSections,
      words,
      linkDensity,
      formControls,
      headings,
      cardLikeCount,
      helpers
    });
    return resolvePageProfile(profile, sections, {
      words,
      sectionCount,
      strongSignals,
      linkDensity,
      formControls,
      headings,
      fallbackOnly,
      readableBlocks,
      cardLikeCount,
      pageEvidence
    });
  }


function resolvePageProfile(profile, sections, details) {
  const words = details.words || 0;
  const sectionCount = Number.isFinite(details.sectionCount) ? details.sectionCount : sections.length;
  const strongSignals = Number.isFinite(details.strongSignals)
    ? details.strongSignals
    : sections.filter((section) => section.score >= 58 && section.metrics.fluffScore < 58 && section.usefulScore >= 24).length;
  const linkDensity = details.linkDensity || 0;
  const formControls = details.formControls || 0;
  const fallbackOnly = Boolean(details.fallbackOnly);
  const readableBlocks = details.readableBlocks || sectionCount;
  const cardLikeCount = details.cardLikeCount || 0;
  const pageEvidence = details.pageEvidence || {
    articleEvidence: 0,
    conversationEvidence: 0,
    conversationNodes: 0,
    assistantHits: 0,
    userHits: 0,
    codeBlocks: 0,
    quietEvidence: 0,
    paragraphs: 0,
    reason: "This page is better left quiet"
  };
  let readingConfidence = profile.readingConfidence;

  const initialIsChat = profile.type === "chat";
  const initialIsPdf = profile.type === "pdf";
  const conversationLikeEvidence = (pageEvidence.conversationEvidence || 0) >= 4
    || ((pageEvidence.conversationNodes || 0) >= 4 && (pageEvidence.assistantHits || 0) >= 1 && (pageEvidence.userHits || 0) >= 1)
    || ((pageEvidence.conversationEvidence || 0) >= 3 && (pageEvidence.codeBlocks || 0) > 0)
    || ((pageEvidence.conversationEvidence || 0) >= 3 && (pageEvidence.prefixCount || 0) >= 2);

  const chatHasAssistantResponse = sections.some((section) => {
    const meta = section.unitMeta || {};
    return (initialIsChat || conversationLikeEvidence) && meta.role === "assistant";
  });
  const chatHasTargetSignal = sections.some((section) => {
    if (!initialIsChat && !conversationLikeEvidence) return false;
    if (section.unitMeta && section.unitMeta.role === "user") return false;
    const matched = section.metrics && section.metrics.matched ? section.metrics.matched : {};
    return section.score >= 58
      || section.usefulScore >= 34
      || section.metrics.codeBlocks > 0
      || matched.finalCode
      || matched.completeCode
      || matched.revision
      || matched.conciseAnswer
      || matched.summary
      || matched.answer
      || matched.directAction;
  });
  const chatHasUsableResponse = (initialIsChat || conversationLikeEvidence)
    && sectionCount >= 1
    && words >= 80
    && (chatHasAssistantResponse || chatHasTargetSignal);
  const pdfReadable = initialIsPdf
    && sectionCount >= 1
    && words >= 80;

  const cleanParagraphLongform = !initialIsChat
    && words >= 900
    && pageEvidence.paragraphs >= 5
    && linkDensity < 0.22
    && formControls <= 18
    && (pageEvidence.quietEvidence || 0) <= 2;
  const veryLongReadableText = !initialIsChat
    && words >= 1400
    && pageEvidence.paragraphs >= 4
    && linkDensity < 0.24
    && formControls <= 18
    && (pageEvidence.quietEvidence || 0) <= 3;
  const articleLikeEvidence = !initialIsChat
    && (
      ((pageEvidence.articleEvidence || 0) >= 4 && (pageEvidence.quietEvidence || 0) <= 5)
      || cleanParagraphLongform
      || veryLongReadableText
      || (words >= 700 && pageEvidence.paragraphs >= 4 && (pageEvidence.articleEvidence || 0) >= 3 && (pageEvidence.quietEvidence || 0) <= 5)
    );

  if ((initialIsChat || conversationLikeEvidence) && sectionCount >= 3) readingConfidence += 10;
  if (chatHasUsableResponse) readingConfidence += 10;
  if (pdfReadable) readingConfidence += 24;
  if (cleanParagraphLongform || veryLongReadableText) readingConfidence += 12;
  if (words >= 520) readingConfidence += 10;
  if (words >= 1200) readingConfidence += 8;
  if (sectionCount >= 4) readingConfidence += 10;
  if (sectionCount >= 8) readingConfidence += 5;
  if (strongSignals >= 1) readingConfidence += 8;
  if (strongSignals >= 3) readingConfidence += 7;
  if (conversationLikeEvidence) readingConfidence += 12;
  if (linkDensity > 0.34) readingConfidence -= 18;
  if (linkDensity > 0.52) readingConfidence -= 22;
  if (formControls > 28 && words < 1000) readingConfidence -= 22;
  if (fallbackOnly) readingConfidence -= 16;
  if (cardLikeCount > 34 && readableBlocks < 8) readingConfidence -= 14;
  if ((pageEvidence.quietEvidence || 0) >= 6 && (pageEvidence.articleEvidence || 0) <= 3) readingConfidence -= 18;
  if ((pageEvidence.quietEvidence || 0) >= 9) readingConfidence -= 14;
  if ((pageEvidence.articleEvidence || 0) >= 6 && (pageEvidence.quietEvidence || 0) <= 4) readingConfidence += 10;
  if (articleLikeEvidence) readingConfidence += 16;
  if (words < MIN_USEFUL_WORDS && !initialIsChat && !initialIsPdf) readingConfidence -= 24;
  if (sectionCount < 2 && !chatHasUsableResponse && !pdfReadable) readingConfidence -= 22;

  readingConfidence = Math.max(0, Math.min(96, Math.round(readingConfidence)));
  let type = profile.type;
  let label = profile.label;
  let reason = profile.reason;
  let quietReason = "";
  const readableLongform = !initialIsChat
    && words >= 780
    && pageEvidence.paragraphs >= 5
    && linkDensity < 0.3
    && formControls <= 24
    && (pageEvidence.quietEvidence || 0) <= 5
    && sectionCount >= 1
    && (
      (pageEvidence.articleEvidence || 0) >= 5
      || cleanParagraphLongform
      || veryLongReadableText
      || strongSignals >= 1
    );
  const articleShield = !initialIsChat
    && ((pageEvidence.articleEvidence || 0) >= 6 || readableLongform)
    && words >= 360
    && (sectionCount >= 2 || pageEvidence.paragraphs >= 5);
  const chatOverride = !initialIsChat
    && conversationLikeEvidence
    && words >= 80
    && (sectionCount >= 1 || strongSignals >= 1)
    && (pageEvidence.quietEvidence || 0) <= 6;
  const articleOverride = !initialIsChat
    && AMBIGUOUS_PAGE_TYPES.has(type)
    && (
      (pageEvidence.articleEvidence || 0) >= 4
      || readableLongform
      || veryLongReadableText
    )
    && (pageEvidence.quietEvidence || 0) <= (type === "low_structure" ? 7 : type === "shopping_product" ? 5 : 4)
    && (strongSignals >= 1 || readableLongform || articleLikeEvidence)
    && readingConfidence >= (type === "low_structure" ? 50 : type === "shopping_product" ? 46 : 52);

  if (chatOverride) {
    type = "chat";
    label = "AI chat";
    reason = "Conversation structure found";
    readingConfidence = Math.max(readingConfidence, 66);
  }

  if (articleOverride && type !== "chat") {
    type = "article";
    label = "Page";
    reason = "Readable sections found";
    readingConfidence = Math.max(readingConfidence, 64);
  }

  if (pdfReadable) {
    type = "pdf";
    label = "PDF";
    reason = "Selectable PDF text found";
    readingConfidence = Math.max(readingConfidence, 66);
  }

  const chatMode = type === "chat";
  const chatShield = chatMode || conversationLikeEvidence || chatHasUsableResponse;
  const strongStructureOverride = articleShield || articleOverride || chatOverride || chatHasUsableResponse || pdfReadable || articleLikeEvidence;
  const quietByEvidence = !chatMode && (pageEvidence.quietEvidence || 0) >= 8 && (pageEvidence.articleEvidence || 0) <= 4 && !articleShield;

  const quietMode = !strongStructureOverride && (
    QUIET_PAGE_TYPES.has(type)
    || (!chatShield && words < MIN_USEFUL_WORDS && !articleShield)
    || (sectionCount < 2 && !articleShield && !chatHasUsableResponse && !pdfReadable && (pageEvidence.conversationEvidence || 0) < 3)
    || (readingConfidence < 44 && !articleShield && !chatHasUsableResponse && !pdfReadable && (pageEvidence.conversationEvidence || 0) < 3)
    || quietByEvidence
    || (LOW_CONFIDENCE_PAGE_TYPES.has(type) && readingConfidence < 62 && !articleShield && (pageEvidence.conversationEvidence || 0) < 3)
  );

  if (quietByEvidence) {
    reason = quietReason;
  } else if (QUIET_PAGE_TYPES.has(type)) {
    quietReason = reason || "This page is better left quiet";
  } else if (initialIsPdf && words < 20) {
    quietReason = profile.quietReason || "PDF text is still loading, or this PDF has no selectable text";
  } else if (initialIsChat && !chatHasUsableResponse) {
    quietReason = "Waiting for an assistant answer to map";
  } else if (!chatShield && words < MIN_USEFUL_WORDS && !articleShield && !initialIsPdf) {
    quietReason = "This page is too short to map reliably";
  } else if (sectionCount < 2 && !articleShield && !chatHasUsableResponse && !pdfReadable) {
    quietReason = "Not enough sections to map";
  } else if (readingConfidence < 44 && !articleShield && !chatHasUsableResponse) {
    quietReason = "No section clearly stands out";
  }

  if (quietMode && quietByEvidence) {
    reason = quietReason;
  }

  if (quietMode && (initialIsChat || initialIsPdf) && quietReason) {
    reason = quietReason;
  }

  if (quietMode && !initialIsChat && !initialIsPdf && !QUIET_PAGE_TYPES.has(type) && readingConfidence < 38) {
    type = "low_structure";
    label = "Page";
    reason = quietReason || "Nothing strong to map here";
  } else if (quietMode && !reason) {
    reason = quietReason || "Nothing strong to map here";
  }

  let diagnosticHint = "";
  if (initialIsPdf && words < 80) {
    diagnosticHint = "PDF text was not exposed clearly enough for PagePilot to extract sections.";
  } else if ((initialIsChat || conversationLikeEvidence) && sectionCount === 0) {
    diagnosticHint = "Conversation-like content was detected, but no chat turns were converted into sections.";
  } else if (articleLikeEvidence && sectionCount === 0) {
    diagnosticHint = "Readable article-like text was detected, but headings/blocks did not produce sections.";
  } else if (quietByEvidence) {
    diagnosticHint = "The page still looks like a quiet page type (search, shopping, app, or low-structure).";
  } else if (initialIsChat && !chatHasUsableResponse) {
    diagnosticHint = "A chat surface was found, but no assistant answer was strong enough to promote.";
  } else if (!initialIsChat && !initialIsPdf && words < MIN_USEFUL_WORDS) {
    diagnosticHint = "The page is too short or too thin to map reliably.";
  } else if (sectionCount === 0) {
    diagnosticHint = "Text was extracted, but PagePilot could not build any usable sections from it.";
  }

  return {
    type,
    label,
    readingConfidence,
    quietMode,
    reason,
    quietReason: quietReason || (quietMode ? reason : ""),
    diagnosticHint,
    pageEvidence,
    isAmbiguous: AMBIGUOUS_PAGE_TYPES.has(type) || quietByEvidence,
    adapterName: profile.adapterName
  };
}

  
function getPageEvidence(details) {
    const root = details.root;
    const doc = root.ownerDocument || document;
    const profile = details.profile || {};
    const evidenceDiagnosticHint = profile.diagnosticHint || "";
    const text = details.helpers.cleanText(details.helpers.getReadableText(root).slice(0, 9000));
    const lower = text.toLowerCase();
    const paragraphs = root.querySelectorAll ? root.querySelectorAll("article p, main p, p").length : 0;
    const controls = details.formControls || 0;
    const links = root.querySelectorAll ? root.querySelectorAll("a").length : 0;
    const resultItems = root.querySelectorAll
      ? root.querySelectorAll("[role='listitem'], article h3 a, [data-testid*='result' i], [class*='result' i], [class*='listing' i]").length
      : 0;
    const commerceNodes = doc.querySelectorAll
      ? doc.querySelectorAll("[itemtype*='Product' i], [class*='product' i], [class*='price' i], [class*='cart' i], [data-testid*='price' i], [data-testid*='cart' i]").length
      : 0;
    const appShellNodes = doc.querySelectorAll
      ? doc.querySelectorAll("[class*='dashboard' i], [class*='settings' i], [class*='app-shell' i], [class*='workspace' i], [role='tablist'], [role='toolbar'], [aria-label*='sidebar' i]").length
      : 0;
    const searchNodes = doc.querySelectorAll
      ? doc.querySelectorAll("[role='search'], input[type='search'], [class*='search' i], [data-testid*='search' i]").length
      : 0;
    const conversationSelector = [
      "[data-message-author-role]",
      "[data-testid*='conversation-turn']",
      "[data-testid*='conversation']",
      "[data-testid*='user-message']",
      "[data-testid*='assistant-message']",
      "[data-testid*='chat-message']",
      "[data-testid*='message']",
      "[data-testid*='prompt']",
      "[data-testid*='response']",
      "[data-author]",
      "[data-role]",
      "[data-content*='message' i]",
      "[aria-label*='assistant' i]",
      "[aria-label*='user' i]",
      "[class*='assistant' i]",
      "[class*='response' i]",
      "[class*='prompt' i]",
      "[class*='conversation' i] [class*='message' i]",
      "[class*='chat' i] [class*='message' i]",
      "[class*='markdown' i]",
      "[class*='prose' i]"
    ].join(", ");
    const conversationNodes = doc.querySelectorAll
      ? doc.querySelectorAll(conversationSelector).length
      : 0;
    const conversationAssistantHits = countPatternHits(lower, /\b(assistant|model|response|reply|bot|generated|copilot|gemini|grok|claude|chatgpt|perplexity)\b/g);
    const conversationUserHits = countPatternHits(lower, /\b(user|human|prompt|question|you|me|ask|asked)\b/g);
    const conversationCueHits = countPatternHits(lower, /\b(final answer|latest answer|corrected|correction|working version|copy code|copy and paste|regenerate|reply|chat|conversation|summary|final code|assistant|response|question|answer|follow up|revision|revised)\b/g);
    const prefixLines = countPatternHits(text, /(?:^|\n)\s*(user|assistant|human|model|bot|you|me|question|answer|response|reply|prompt|q|a)\s*[:\-]/gim);
    const codeBlocks = root.querySelectorAll ? root.querySelectorAll("pre, code").length : 0;
    let conversationEvidence = 0;
    if (conversationNodes >= 4) conversationEvidence += 2;
    if (conversationAssistantHits >= 2 && conversationUserHits >= 2) conversationEvidence += 2;
    if (prefixLines >= 2) conversationEvidence += 2;
    if (codeBlocks > 0) conversationEvidence += 1;
    if (conversationCueHits >= 3) conversationEvidence += 1;
    if ((profile.type === "chat" || profile.adapterName === "generic-chat") && (conversationNodes >= 2 || prefixLines >= 1 || conversationCueHits >= 1)) conversationEvidence += 2;

    const articleSignals = (root.matches && root.matches("article") ? 2 : 0)
      + (root.querySelector && root.querySelector("article") ? 2 : 0)
      + (details.words >= 520 ? 1 : 0)
      + (details.words >= 1200 ? 1 : 0)
      + (details.headings >= 3 ? 1 : 0)
      + (details.sections.filter((section) => section.metrics.fluffScore < 58 && section.usefulScore >= 24).length >= 1 ? 1 : 0)
      + (paragraphs >= 7 ? 1 : 0)
      + (details.linkDensity < 0.24 ? 1 : 0)
      + (controls <= 18 ? 1 : 0);
    let quietSignals = (details.linkDensity > 0.34 ? 2 : 0)
      + (details.linkDensity > 0.52 ? 2 : 0)
      + (controls > 28 ? 2 : 0)
      + (controls > 48 ? 2 : 0)
      + (details.cardLikeCount > 28 && paragraphs < 10 ? 2 : 0)
      + (resultItems > 18 && details.linkDensity > 0.22 ? 2 : 0)
      + (commerceNodes >= 3 ? 2 : 0)
      + (countPatternHits(lower, /\b(add to cart|buy now|checkout|shipping|returns?|in stock|out of stock|sku|price|\$\d+|customers also bought|recommended products?)\b/g) >= 2 ? 2 : 0)
      + (appShellNodes >= 2 ? 2 : 0)
      + (countPatternHits(lower, /\b(dashboard|settings|billing|workspace|analytics|reports?|saved views?|export|permissions|account)\b/g) >= 5 && controls > 14 ? 2 : 0)
      + (searchNodes >= 2 && (countPatternHits(lower, /\b(search results|results for|all results|filters|sort by|sponsored result|people also ask)\b/g) >= 1 || resultItems > 10) ? 2 : 0)
      + (links > Math.max(42, details.headings * 14) && paragraphs < 12 ? 1 : 0);

    if (conversationEvidence >= 3) {
      quietSignals = Math.max(0, quietSignals - 4);
    }

    const transcriptStyle = conversationEvidence >= 5
      ? "conversation"
      : prefixLines >= 2
        ? "dialogue"
        : codeBlocks > 0
          ? "code-rich"
          : conversationEvidence >= 3
            ? "structured-chat"
            : "";

    const reason = conversationEvidence >= 3
      ? "Conversation structure found"
      : resultItems || searchNodes >= 2
        ? "Search and results pages are already built for scanning"
        : commerceNodes || countPatternHits(lower, /\b(add to cart|buy now|checkout|shipping|returns?|in stock|out of stock|sku|price|\$\d+|customers also bought|recommended products?)\b/g) >= 2
          ? "Product and shopping pages are better left quiet"
          : appShellNodes || controls > 28
            ? "App screens are better left quiet"
            : "This page is better left quiet";

    return {
      articleEvidence: articleSignals,
      quietEvidence: quietSignals,
      paragraphs,
      controls,
      links,
      cardLikeCount: details.cardLikeCount,
      resultItems,
      commerceNodes,
      appShellNodes,
      searchNodes,
      conversationEvidence,
      conversationNodes,
      assistantHits: conversationAssistantHits,
      userHits: conversationUserHits,
      prefixCount: prefixLines,
      transcriptStyle,
      codeBlocks,
      diagnosticHint: evidenceDiagnosticHint,
      reason
    };
  }

  function buildSectionHierarchy(sections, collapsedSectionIds) {
    const stack = [];
    const validIds = new Set(sections.map((section) => section.id));
    Array.from(collapsedSectionIds).forEach((id) => {
      if (!validIds.has(id)) collapsedSectionIds.delete(id);
    });

    sections.forEach((section) => {
      section.parentId = null;
      section.childIds = [];
      section.isCollapsed = collapsedSectionIds.has(section.id);

      while (stack.length && stack[stack.length - 1].level >= section.level) {
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent) {
        section.parentId = parent.id;
        parent.childIds.push(section.id);
      }
      stack.push(section);
    });

    return sections;
  }

  function pickImportantSections(sections, profile) {
    if (profile.quietMode) return [];
    const important = sections.filter((section) => section.isImportant);
    const best = important.find((section) => section.isBest) || sections.find((section) => section.isBest) || null;
    const ranked = important.slice().sort((a, b) => b.score - a.score);
    const selected = [];
    const limit = profile.type === "chat" ? 12 : 9;

    if (best) selected.push(best);
    ranked.forEach((section) => {
      if (selected.length < limit && !selected.some((item) => item.id === section.id)) {
        selected.push(section);
      }
    });

    return selected.sort((a, b) => a.top - b.top);
  }

  function buildRecommendation(sections, importantSections, pageProfile) {
    const minimumWords = pageProfile.type === "chat" || pageProfile.type === "low_structure" ? 8 : 18;
    const candidates = sections
      .filter((section) => section.wordCount >= minimumWords)
      .filter((section) => section.metrics.fluffScore < 82 || section.isBest || section.score >= 92 || section.metrics.matched.finalCode)
      .sort((a, b) => b.score - a.score);
    const bestSection = sections.find((section) => section.isBest) || candidates[0] || null;
    const second = candidates.find((section) => bestSection && section.id !== bestSection.id) || null;

    if (!bestSection || pageProfile.quietMode) {
      return emptyRecommendation();
    }

    const margin = second ? bestSection.score - second.score : 28;
    const ambiguousPage = Boolean(pageProfile.isAmbiguous) || AMBIGUOUS_PAGE_TYPES.has(pageProfile.type);
    const scoreStrength = Math.max(0, Math.min(1, (bestSection.score - 30) / 112));
    const marginStrength = Math.max(0, Math.min(1, (margin + 8) / 58));
    const signalStrength = Math.max(0, Math.min(1, getSignalCount(bestSection.metrics) / 7));
    const usefulStrength = Math.max(0, Math.min(1, bestSection.usefulScore / 96));
    const confidence = Math.round((scoreStrength * 0.34 + marginStrength * 0.22 + signalStrength * 0.18 + usefulStrength * 0.26) * 100);
    const pageConfidence = pageProfile.readingConfidence || 50;
    const finalConfidence = Math.max(0, Math.min(96, Math.round(confidence * 0.74 + pageConfidence * 0.26)));
    const tier = getConfidenceTier(finalConfidence);
    const minimumConfidence = ambiguousPage
      ? Math.max(68, STRONG_TARGET_CONFIDENCE)
      : pageProfile.type === "chat"
        ? 52
        : pageProfile.type === "article"
          ? 44
          : (pageProfile.type === "docs" || pageProfile.type === "tutorial")
            ? 50
            : STRONG_TARGET_CONFIDENCE;
    const minimumScore = ambiguousPage
      ? 76
      : LOW_CONFIDENCE_PAGE_TYPES.has(pageProfile.type)
        ? 92
        : pageProfile.type === "chat"
          ? 58
          : pageProfile.type === "article"
            ? 66
            : (pageProfile.type === "docs" || pageProfile.type === "tutorial")
              ? 54
              : 42;
    const minimumUseful = ambiguousPage
      ? 36
      : pageProfile.type === "chat"
        ? 34
        : pageProfile.type === "article"
          ? 30
          : (pageProfile.type === "docs" || pageProfile.type === "tutorial")
            ? 26
            : 24;
    const minimumPageConfidence = ambiguousPage
      ? 58
      : pageProfile.type === "chat"
        ? 48
        : pageProfile.type === "article"
          ? 50
          : (pageProfile.type === "docs" || pageProfile.type === "tutorial")
            ? 46
            : 44;
    const marginOk = !ambiguousPage || margin >= 8 || bestSection.score >= 104 || bestSection.metrics.matched.finalCode;
    const hasStrongTarget = Boolean(
      finalConfidence >= minimumConfidence
      && bestSection.score >= minimumScore
      && bestSection.usefulScore >= minimumUseful
      && pageConfidence >= minimumPageConfidence
      && marginOk
    );

    if (!hasStrongTarget && tier === "none") {
      return emptyRecommendation(finalConfidence);
    }

    return {
      bestSectionId: bestSection.id,
      confidence: finalConfidence,
      confidenceTier: tier,
      confidenceLabel: confidenceLabelForTier(tier),
      hasStrongTarget,
      bestLabel: hasStrongTarget ? bestLabelForSection(bestSection, tier, pageProfile) : "No clear standout",
      bestKind: bestKindForSection(bestSection),
      targetConfidenceReason: targetConfidenceReason({ bestSection, second, finalConfidence, pageConfidence, margin, ambiguousPage, hasStrongTarget }),
      savedMinutes: hasStrongTarget ? estimateSavedMinutes(bestSection, sections) : 0
    };
  }

  function emptyRecommendation(confidence) {
    return {
      bestSectionId: null,
      confidence: confidence || 0,
      confidenceTier: "none",
      confidenceLabel: "No clear standout",
      hasStrongTarget: false,
      bestLabel: "No clear standout",
      bestKind: "",
      targetConfidenceReason: "No section has enough signal yet",
      savedMinutes: 0
    };
  }

  function getConfidenceTier(confidence) {
    if (confidence >= HIGH_CONFIDENCE) return "high";
    if (confidence >= STRONG_TARGET_CONFIDENCE) return "medium";
    if (confidence >= LOW_CONFIDENCE) return "low";
    return "none";
  }

  function confidenceLabelForTier(tier) {
    if (tier === "high") return "High confidence";
    if (tier === "medium") return "Looks useful";
    if (tier === "low") return "Low confidence";
    return "No clear standout";
  }

  function bestLabelForSection(section, tier, pageProfile) {
    if (!section || !section.metrics) return "Best place to start";
    if (tier === "medium") return "This looks useful";
    if (section.metrics.matched.finalCode) return "Jump to the final code";
    if (pageProfile.type === "chat" && section.unitMeta && section.unitMeta.hasRevision) return "Jump to the corrected answer";
    if (pageProfile.type === "chat" && section.unitMeta && section.unitMeta.isLatestAssistant) return "Jump to the latest answer";
    if (section.metrics.matched.summary) return "Jump to the summary";
    if (section.metrics.matched.completeCode) return "Complete code";
    if (section.metrics.matched.conciseAnswer || section.metrics.matched.answer) return "Jump straight to the answer";
    if (section.metrics.matched.example || section.metrics.codeBlocks > 0) return "Working example";
    if (section.metrics.matched.procedure || section.metrics.matched.action || section.metrics.matched.directAction) return "Action steps";
    if (section.metrics.matched.recommendation) return "Recommended";
    return "Best place to start";
  }

  function bestKindForSection(section) {
    if (!section || !section.metrics) return "";
    if (section.metrics.matched.finalCode) return "final_code";
    if (section.unitMeta && section.unitMeta.hasRevision) return "corrected_answer";
    if (section.metrics.matched.completeCode) return "complete_code";
    if (section.metrics.matched.conciseAnswer || section.metrics.matched.answer) return "answer";
    if (section.metrics.matched.summary) return "summary";
    if (section.metrics.matched.procedure || section.metrics.matched.directAction) return "steps";
    if (section.metrics.matched.codeExplanation || section.metrics.codeBlocks > 0) return "code_example";
    if (section.metrics.matched.recommendation) return "recommendation";
    return "useful_section";
  }

  function targetConfidenceReason(details) {
    if (!details.hasStrongTarget) {
      if (details.ambiguousPage) return "Ambiguous page, waiting for stronger evidence";
      if (details.pageConfidence < 44) return "Page confidence is low";
      if (details.margin < 8) return "Several sections look similarly useful";
      return "Useful signals are not strong enough yet";
    }
    if (details.bestSection.metrics.matched.finalCode) return "Final code signal with enough confidence";
    if (details.bestSection.unitMeta && details.bestSection.unitMeta.hasRevision) return "Latest corrected answer has the strongest signal";
    if (details.bestSection.metrics.matched.conciseAnswer) return "Concise answer signal with enough confidence";
    if (details.bestSection.metrics.matched.summary) return "Summary signal with enough confidence";
    if (details.bestSection.metrics.matched.completeCode) return "Complete code signal with enough confidence";
    return details.ambiguousPage ? "Strong useful signal on an ambiguous page" : "Strong useful signal";
  }

  function getSignalCount(metrics) {
    if (!metrics || !metrics.matched) return 0;
    return Object.keys(metrics.matched).reduce((sum, key) => sum + (metrics.matched[key] ? 1 : 0), 0)
      + (metrics.listItems >= 3 ? 1 : 0)
      + (metrics.codeBlocks > 0 ? 1 : 0)
      + (metrics.tables > 0 ? 1 : 0)
      + (metrics.hasNumbers ? 1 : 0);
  }

  function estimateSavedMinutes(section, sections) {
    const wordsBefore = sections.reduce((sum, item) => {
      if (item.top >= section.top || item.id === section.id) return sum;
      return sum + item.wordCount;
    }, 0);
    return Math.max(0, Math.floor(wordsBefore / READING_SPEED_WPM));
  }

  function pickNavigationTargets(sections, importantSections, bestSectionId) {
    if (!sections.length) {
      return { nextImportantId: null, skipTargetId: null };
    }
    const currentMarker = window.scrollY + Math.min(window.innerHeight * 0.45, 420);
    const nextImportant = importantSections.find((section) => section.top > currentMarker + 80 && section.id !== bestSectionId)
      || importantSections.find((section) => section.id !== bestSectionId)
      || null;
    return {
      nextImportantId: nextImportant ? nextImportant.id : null,
      skipTargetId: pickSkipTarget(sections, importantSections)
    };
  }

  function pickSkipTarget(sections, importantSections) {
    if (!sections.length) return null;
    const articleTop = sections[0] ? sections[0].top : 0;
    const introFloor = articleTop + Math.max(420, window.innerHeight * 0.72);
    const usefulAfterIntro = importantSections.find((section) => section.top > introFloor);
    const firstNotIntro = importantSections.find((section) => section.index > 0);
    const fallback = sections[Math.min(1, sections.length - 1)];
    return (usefulAfterIntro || firstNotIntro || importantSections[0] || fallback || sections[0]).id;
  }

  function refreshSectionPositions(sections) {
    sections.forEach((section) => {
      if (section.anchor && section.anchor.getBoundingClientRect) {
        section.top = section.anchor.getBoundingClientRect().top + window.scrollY;
      }
    });
  }

  function mergeSections(primary, fallback) {
    const merged = [];
    const seen = new Set();
    primary.concat(fallback).forEach((section) => {
      const key = `${Math.round(section.top / 80)}:${section.title.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(section);
      }
    });
    return merged.sort((a, b) => a.top - b.top);
  }

  function inferTitle(blocks, helpers) {
    const first = blocks[0];
    const nearbyHeading = findNearbyHeading(first);
    if (nearbyHeading) {
      return cleanTitle(nearbyHeading.innerText || nearbyHeading.textContent);
    }
    const text = helpers.cleanText(blocks.map((block) => block.innerText || block.textContent || "").join(" "));
    return cleanTitle(text.split(/[.!?]\s/)[0] || text);
  }

  function inferSectionLevel(blocks) {
    const heading = findNearbyHeading(blocks[0]);
    if (heading && heading.tagName) {
      return Number(heading.tagName.slice(1));
    }
    return 2;
  }

  function findNearbyHeading(element) {
    let current = element;
    let hops = 0;
    while (current && current !== document.body && hops < 4) {
      let sibling = current.previousElementSibling;
      let siblingHops = 0;
      while (sibling && siblingHops < 4) {
        if (sibling.matches && sibling.matches("h1, h2, h3, h4")) {
          return sibling;
        }
        sibling = sibling.previousElementSibling;
        siblingHops += 1;
      }
      current = current.parentElement;
      hops += 1;
    }
    return null;
  }

  function getClassTrail(element, helpers) {
    const parts = [];
    let current = element;
    let depth = 0;
    while (current && current !== document.body && depth < 4) {
      parts.push(`${current.id || ""} ${current.className || ""} ${current.getAttribute && current.getAttribute("role") || ""}`);
      current = current.parentElement;
      depth += 1;
    }
    return helpers.cleanText(parts.join(" "));
  }

  function getScrollOffset(context, helpers) {
    const selectors = [
      "header",
      "nav",
      "[role='banner']",
      "[class*='sticky' i]",
      "[class*='fixed' i]"
    ].join(",");
    const candidates = Array.from(context.document.querySelectorAll(selectors)).slice(0, 80);
    let fixedBottom = 0;
    candidates.forEach((element) => {
      const style = context.window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const pinned = (style.position === "fixed" || style.position === "sticky") && rect.top <= 12 && rect.bottom > 0;
      const usefulSize = rect.height >= 28 && rect.height <= 220 && rect.width >= context.window.innerWidth * 0.42;
      if (pinned && usefulSize && !helpers.isLowValueElement(element)) {
        fixedBottom = Math.max(fixedBottom, rect.bottom);
      }
    });
    return fixedBottom ? Math.min(240, Math.ceil(fixedBottom + 16)) : 72;
  }

  function getStructureSignature(pageProfile, sections) {
    return [
      pageProfile.type,
      pageProfile.quietMode ? "quiet" : "active",
      pageProfile.readingConfidence,
      sections.length,
      sections.slice(0, 28).map((section) => `${section.id}:${section.level}:${Math.round(section.score)}`).join("|")
    ].join(";");
  }

  function cleanTitle(text) {
    const title = cleanText(text).replace(/^#+\s*/, "");
    if (title.length <= 86) return title || "Useful section";
    return `${title.slice(0, 83).trim()}...`;
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
  }

  function countWords(text) {
    const matches = cleanText(text).match(/\b[\w'-]+\b/g);
    return matches ? matches.length : 0;
  }

  function countPatternHits(text, pattern) {
    const matches = String(text || "").match(pattern);
    return matches ? matches.length : 0;
  }

  function safeCall(fn, fallback) {
    try {
      return fn();
    } catch (error) {
      return fallback;
    }
  }

  function analyzeTextFixture(fixture) {
    const profile = {
      type: fixture.type || "article",
      label: fixture.label || "Fixture",
      readingConfidence: fixture.readingConfidence || (LOW_CONFIDENCE_PAGE_TYPES.has(fixture.type) ? 22 : 78),
      quietMode: Boolean(fixture.quietMode || QUIET_PAGE_TYPES.has(fixture.type)),
      reason: fixture.reason || "",
      quietReason: fixture.quietReason || "",
      isAmbiguous: Boolean(fixture.isAmbiguous || LOW_CONFIDENCE_PAGE_TYPES.has(fixture.type)),
      adapterName: "fixture"
    };
    const sections = (fixture.sections || []).map((section, index) => {
      const text = cleanText(`${section.title || ""} ${section.text || ""}`);
      const blockStats = {
        wordCount: countWords(text),
        paragraphs: Math.max(1, Math.ceil(countWords(text) / 100)),
        listItems: section.listItems || (/\n\s*[-*]/.test(section.text || "") ? 3 : 0),
        numberedItems: section.numberedItems || (PROCEDURE_PATTERN.test(section.text || "") ? 3 : 0),
        codeBlocks: section.codeBlocks || (/```|function |const |class |<code/i.test(section.text || "") ? 1 : 0),
        tables: section.tables || 0,
        boldCount: 0,
        links: section.links || 0,
        linkDensity: section.linkDensity || 0,
        hasNumbers: /\b\d+([.,]\d+)?%?\b/.test(text),
        hasReadableParagraphs: true
      };
      const metrics = scoreTextSignals({
        title: section.title || "",
        text,
        index,
        profile,
        unitMeta: section.unitMeta || {},
        blockStats,
        classTrail: section.classTrail || "",
        isElementLowValue: Boolean(section.lowValue)
      });
      return {
        id: `fixture-${index}`,
        title: section.title || `Section ${index + 1}`,
        text,
        index,
        level: section.level || 2,
        wordCount: blockStats.wordCount,
        top: index * 800,
        metrics,
        score: metrics.score + (section.adapterScore || 0),
        usefulScore: metrics.usefulScore + Math.max(0, (section.adapterScore || 0) * 0.5),
        importanceScore: metrics.importanceScore,
        unitMeta: section.unitMeta || {},
        isImportant: false,
        isBest: false,
        label: ""
      };
    });
    let pageProfile = profile;
    let ranked = rankSections(sections, pageProfile);

    if (fixture.finalizeProfile) {
      const words = Number.isFinite(fixture.words)
        ? fixture.words
        : ranked.reduce((sum, section) => sum + section.wordCount, 0);
      const pageEvidence = Object.assign({
        articleEvidence: 0,
        quietEvidence: 0,
        paragraphs: 0,
        reason: "This page is better left quiet"
      }, fixture.pageEvidence || {});

      pageProfile = resolvePageProfile(pageProfile, ranked, {
        words,
        sectionCount: ranked.length,
        strongSignals: ranked.filter((section) => section.score >= 58 && section.metrics.fluffScore < 58 && section.usefulScore >= 24).length,
        linkDensity: fixture.linkDensity || 0,
        formControls: fixture.formControls || 0,
        headings: fixture.headings || 0,
        fallbackOnly: Boolean(fixture.fallbackOnly),
        readableBlocks: fixture.readableBlocks || ranked.length,
        cardLikeCount: fixture.cardLikeCount || 0,
        pageEvidence
      });

      if (pageProfile.type !== "chat" && ((pageEvidence.conversationEvidence || 0) >= 4 || ((pageEvidence.conversationNodes || 0) >= 4 && (pageEvidence.assistantHits || 0) >= 1 && (pageEvidence.userHits || 0) >= 1) || ((pageEvidence.conversationEvidence || 0) >= 3 && (pageEvidence.codeBlocks || 0) > 0) || ((pageEvidence.conversationEvidence || 0) >= 3 && (pageEvidence.prefixCount || 0) >= 2))) {
        pageProfile = Object.assign({}, pageProfile, {
          type: "chat",
          label: "AI chat",
          readingConfidence: Math.max(pageProfile.readingConfidence || 0, 66),
          quietMode: false,
          reason: "Conversation structure found",
          quietReason: "",
          isAmbiguous: false
        });
      } else if (pageProfile.type !== "article" && (pageEvidence.articleEvidence || 0) >= 4 && (pageEvidence.quietEvidence || 0) <= 4) {
        pageProfile = Object.assign({}, pageProfile, {
          type: "article",
          label: "Page",
          readingConfidence: Math.max(pageProfile.readingConfidence || 0, 64),
          quietMode: false,
          reason: "Readable sections found",
          quietReason: "",
          isAmbiguous: false
        });
      }

      ranked = rankSections(ranked, pageProfile);
    }

    const importantSections = pickImportantSections(ranked, pageProfile);
    const recommendation = buildRecommendation(ranked, importantSections, pageProfile);
    return {
      pageProfile,
      sections: ranked,
      importantSections,
      recommendation
    };
  }

  window.PagePilotEngine = {
    createEngine,
    analyzeTextFixture,
    constants: {
      MIN_USEFUL_WORDS,
      READING_SPEED_WPM,
      STRONG_TARGET_CONFIDENCE,
      HIGH_CONFIDENCE,
      LOW_CONFIDENCE
    }
  };
})();
