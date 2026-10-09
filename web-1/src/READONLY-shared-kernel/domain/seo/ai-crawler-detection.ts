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

export type AiCrawlerBotCategory =
  | 'ai-training' // GPTBot, ClaudeBot, anthropic-ai, CCBot, cohere-ai
  | 'ai-search' // ChatGPT-User, OAI-SearchBot, PerplexityBot, Perplexity-User, Claude-Web
  | 'search-engine' // Googlebot, Bingbot, Google-Extended, Applebot-Extended
  | 'seo-tool' // AhrefsBot, SemrushBot, MJ12bot, DotBot
  | 'social' // FacebookBot, Meta-ExternalAgent, Twitterbot
  | 'unknown'; // recognized as bot but uncategorized

interface BotPattern {
  pattern: RegExp;
  bot_name: string;
  bot_category: AiCrawlerBotCategory;
}

// Order matters — most specific patterns FIRST, generic fallback LAST.
const BOT_PATTERNS: ReadonlyArray<BotPattern> = [
  // AI training
  { pattern: /GPTBot/i, bot_name: 'GPTBot', bot_category: 'ai-training' },
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
  { pattern: /Bingbot/i, bot_name: 'Bingbot', bot_category: 'search-engine' },
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

export const TRACKED_PATHS = [
  '/llms.txt',
  '/llms-pl.txt',
  '/llms-de.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/sitemap-static.xml',
  '/sitemap-blog.xml',
  '/sitemap-profiles.xml',
] as const;

export type TrackedPath = (typeof TRACKED_PATHS)[number];

export function isTrackedPath(path: string): path is TrackedPath {
  return (TRACKED_PATHS as ReadonlyArray<string>).includes(path);
}
