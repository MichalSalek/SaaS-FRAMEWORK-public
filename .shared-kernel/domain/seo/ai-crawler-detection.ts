/**
 * Parse User-Agent string to identify AI crawler bot.
 * Returns null if not a recognized bot.
 *
 * Pure function — NO I/O, NO side effects. Safe to use in Edge runtime,
 * middleware, server, or browser.
 */

export interface AiCrawlerBotInfo {
  bot_name: string;
  bot_category: AiCrawlerBotCategory;
}

// SSOT of the categories: the type and the runtime narrower
// (models/type_narrowing.ts) both derive from this list.
export const AI_CRAWLER_BOT_CATEGORIES = [
  'ai-training', // GPTBot, ClaudeBot, anthropic-ai, CCBot, cohere-ai, Amazonbot
  'ai-search', // ChatGPT-User, OAI-SearchBot, Perplexity*, Claude-User/SearchBot/Web, MistralAI-User, DuckAssistBot, ExaSearchBot
  'search-engine', // Googlebot, Bingbot, Google-Extended, Applebot-Extended
  'seo-tool', // AhrefsBot, SemrushBot, MJ12bot, DotBot
  'social', // FacebookBot, Meta-ExternalAgent, Twitterbot
  'monitoring', // our own probes: Better Stack uptime, example-monitor scripts, curl/node
  'unknown', // recognized as bot but uncategorized
] as const;

export type AiCrawlerBotCategory = (typeof AI_CRAWLER_BOT_CATEGORIES)[number];

interface BotPattern {
  pattern: RegExp;
  bot_name: string;
  bot_category: AiCrawlerBotCategory;
  /**
   * Track this bot's fetches of ANY page, not only the fixed machine files.
   * Every `ai-search` bot is page-tracked implicitly; this flag adds the
   * crawlers outside that category whose page reads feed AI answers
   * (GPTBot for OpenAI, Bingbot because ChatGPT and Copilot search on Bing).
   */
  tracksPages?: true;
}

// Order matters — most specific patterns FIRST, generic fallback LAST.
const BOT_PATTERNS: ReadonlyArray<BotPattern> = [
  // DECISION: monitoring patterns come FIRST. Our own probes (Better Stack uptime, example-monitor
  // geo-healthcheck, IndexNow, a bare curl or node fetch) used to land in the AI stats (the Better
  // Stack UA ends in "Bot" and matched the generic fallback). `monitoring` is never stored
  // (shouldTrackCrawlerRequest refuses it). Anchored `curl`/`node`/`Wget` match only a bare tool UA,
  // never a browser string.
  {
    pattern: /Better ?(?:Stack|Uptime)/i,
    bot_name: 'BetterStack',
    bot_category: 'monitoring',
  },
  {
    pattern: /example-monitor/i,
    bot_name: 'example-monitor',
    bot_category: 'monitoring',
  },
  {
    pattern: /UptimeRobot/i,
    bot_name: 'UptimeRobot',
    bot_category: 'monitoring',
  },
  {
    pattern: /^(?:curl|Wget|node)(?:\/|$)/i,
    bot_name: 'cli-fetch',
    bot_category: 'monitoring',
  },

  // AI training
  {
    pattern: /GPTBot/i,
    bot_name: 'GPTBot',
    bot_category: 'ai-training',
    tracksPages: true,
  },
  { pattern: /ClaudeBot/i, bot_name: 'ClaudeBot', bot_category: 'ai-training' },
  {
    pattern: /anthropic-ai/i,
    bot_name: 'anthropic-ai',
    bot_category: 'ai-training',
  },
  { pattern: /CCBot/i, bot_name: 'CCBot', bot_category: 'ai-training' },
  { pattern: /cohere-ai/i, bot_name: 'cohere-ai', bot_category: 'ai-training' },
  {
    pattern: /Bytespider/i,
    bot_name: 'Bytespider',
    bot_category: 'ai-training',
  },
  // Amazon documents Amazonbot as improving its services, AI models included.
  { pattern: /Amazonbot/i, bot_name: 'Amazonbot', bot_category: 'ai-training' },

  // AI search (assistive search bots)
  {
    pattern: /ChatGPT-User/i,
    bot_name: 'ChatGPT-User',
    bot_category: 'ai-search',
  },
  {
    pattern: /OAI-SearchBot/i,
    bot_name: 'OAI-SearchBot',
    bot_category: 'ai-search',
  },
  {
    pattern: /PerplexityBot/i,
    bot_name: 'PerplexityBot',
    bot_category: 'ai-search',
  },
  {
    pattern: /Perplexity-User/i,
    bot_name: 'Perplexity-User',
    bot_category: 'ai-search',
  },
  { pattern: /Claude-Web/i, bot_name: 'Claude-Web', bot_category: 'ai-search' },
  // Tokens as published by the vendors: Anthropic (Claude-User fetches for a
  // person's question, Claude-SearchBot indexes for search), Mistral
  // (MistralAI-User), DuckDuckGo (DuckAssistBot), Exa (ExaSearchBot).
  {
    pattern: /Claude-User/i,
    bot_name: 'Claude-User',
    bot_category: 'ai-search',
  },
  {
    pattern: /Claude-SearchBot/i,
    bot_name: 'Claude-SearchBot',
    bot_category: 'ai-search',
  },
  {
    pattern: /MistralAI-User/i,
    bot_name: 'MistralAI-User',
    bot_category: 'ai-search',
  },
  {
    pattern: /DuckAssistBot/i,
    bot_name: 'DuckAssistBot',
    bot_category: 'ai-search',
  },
  {
    pattern: /ExaSearchBot/i,
    bot_name: 'ExaSearchBot',
    bot_category: 'ai-search',
  },

  // Search engines (Google-Extended must come before Googlebot to avoid mis-match)
  {
    pattern: /Google-Extended/i,
    bot_name: 'Google-Extended',
    bot_category: 'search-engine',
  },
  {
    pattern: /Googlebot-Image/i,
    bot_name: 'Googlebot-Image',
    bot_category: 'search-engine',
  },
  {
    pattern: /Googlebot-News/i,
    bot_name: 'Googlebot-News',
    bot_category: 'search-engine',
  },
  {
    pattern: /Googlebot/i,
    bot_name: 'Googlebot',
    bot_category: 'search-engine',
  },
  {
    pattern: /Bingbot/i,
    bot_name: 'Bingbot',
    bot_category: 'search-engine',
    tracksPages: true,
  },
  {
    pattern: /Applebot-Extended/i,
    bot_name: 'Applebot-Extended',
    bot_category: 'search-engine',
  },
  { pattern: /Applebot/i, bot_name: 'Applebot', bot_category: 'search-engine' },
  {
    pattern: /DuckDuckBot/i,
    bot_name: 'DuckDuckBot',
    bot_category: 'search-engine',
  },
  {
    pattern: /YandexBot/i,
    bot_name: 'YandexBot',
    bot_category: 'search-engine',
  },

  // SEO tools
  { pattern: /AhrefsBot/i, bot_name: 'AhrefsBot', bot_category: 'seo-tool' },
  { pattern: /SemrushBot/i, bot_name: 'SemrushBot', bot_category: 'seo-tool' },
  { pattern: /MJ12bot/i, bot_name: 'MJ12bot', bot_category: 'seo-tool' },
  { pattern: /DotBot/i, bot_name: 'DotBot', bot_category: 'seo-tool' },

  // Social
  {
    pattern: /facebookexternalhit|FacebookBot/i,
    bot_name: 'FacebookBot',
    bot_category: 'social',
  },
  {
    pattern: /Meta-ExternalAgent/i,
    bot_name: 'Meta-ExternalAgent',
    bot_category: 'social',
  },
  { pattern: /Twitterbot/i, bot_name: 'Twitterbot', bot_category: 'social' },
  { pattern: /LinkedInBot/i, bot_name: 'LinkedInBot', bot_category: 'social' },
  { pattern: /Slackbot/i, bot_name: 'Slackbot', bot_category: 'social' },

  // Generic bot fallback (order matters — MUST be last)
  {
    pattern: /bot|crawler|spider/i,
    bot_name: 'unknown-bot',
    bot_category: 'unknown',
  },
];

export function detectAiCrawler(
  userAgent: string | null | undefined
): AiCrawlerBotInfo | null {
  if (!userAgent) {
    return null;
  }
  for (const { pattern, bot_name, bot_category } of BOT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return { bot_name, bot_category };
    }
  }
  return null;
}

/**
 * Machine-readable files logged for EVERY caller except our own monitoring:
 * the llms files, robots and the sitemaps. The per-page markdown mirrors
 * (`/pricing.md`, `/en/blog/<slug>.md`) count as well, see isTrackedFilePath.
 */
const TRACKED_PATHS = [
  '/llms.txt',
  '/llms-pl.txt',
  '/llms-de.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap-static.xml',
  '/sitemap-blog.xml',
  '/sitemap-profiles.xml',
] as const;

/** Column cap of `AiCrawlerEvent.path` (VarChar(500)). */
const MAX_TRACKED_PATH_LENGTH = 500;

const NEXT_INTERNAL_PREFIX = '/_next/';

function isTrackedFilePath(path: string): boolean {
  if ((TRACKED_PATHS as ReadonlyArray<string>).includes(path)) {
    return true;
  }
  return (
    path.startsWith('/') &&
    path.endsWith('.md') &&
    !path.startsWith(NEXT_INTERNAL_PREFIX)
  );
}

/** A page route: no file extension in the last segment, no Next internals. */
function isPagePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith(NEXT_INTERNAL_PREFIX)) {
    return false;
  }
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

const isPageTrackedPattern = (bot: BotPattern): boolean =>
  bot.bot_category === 'ai-search' || bot.tracksPages === true;

const PAGE_TRACKED_BOT_NAMES: ReadonlySet<string> = new Set(
  BOT_PATTERNS.filter(isPageTrackedPattern).map(bot => bot.bot_name)
);

// One combined regex derived from the table above: the only UA work done for
// an ordinary page request (proxy runs this on every request).
const PAGE_TRACKED_BOT_PREFILTER = new RegExp(
  BOT_PATTERNS.filter(isPageTrackedPattern)
    .map(bot => bot.pattern.source)
    .join('|'),
  'i'
);

/**
 * Should this request be logged as a crawler event?
 *
 * - Machine files (TRACKED_PATHS, `*.md` mirrors): every caller except our own
 *   monitoring, as before (humans reading llms.txt included).
 * - Any page: only AI assistants and AI search bots (`ai-search`) plus GPTBot
 *   and Bingbot. Humans and other bots are never logged on pages.
 *
 * Cheap path first: path checks, then ONE prefilter regex; the full ordered
 * detection runs only for a request that already looks like a tracked bot.
 * The same function validates the payload in the backend endpoint, so the
 * proxy and the endpoint cannot disagree on what is stored.
 */
export function shouldTrackCrawlerRequest(
  path: string,
  userAgent: string
): boolean {
  if (path.length === 0 || path.length > MAX_TRACKED_PATH_LENGTH) {
    return false;
  }
  if (isTrackedFilePath(path)) {
    return detectAiCrawler(userAgent)?.bot_category !== 'monitoring';
  }
  if (!isPagePath(path) || !PAGE_TRACKED_BOT_PREFILTER.test(userAgent)) {
    return false;
  }
  const bot = detectAiCrawler(userAgent);
  return bot !== null && PAGE_TRACKED_BOT_NAMES.has(bot.bot_name);
}
