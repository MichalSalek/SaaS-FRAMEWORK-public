/**
 * Kernel AI-crawler rule (`.shared-kernel/domain/seo/ai-crawler-detection.ts`):
 * UA classification plus `shouldTrackCrawlerRequest`, the one rule shared by the
 * frontend proxy (decides what to send) and the track-crawler endpoint (decides
 * what to store).
 */
import { describe, expect, it } from 'vitest';
import {
  detectAiCrawler,
  shouldTrackCrawlerRequest,
} from '@kernel/domain/seo/ai-crawler-detection';

const UA = {
  chatgptUser:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  oaiSearch:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  gptBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  claudeUser:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  claudeSearch:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
  claudeBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  mistral:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)',
  duckAssist: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)',
  exa: 'Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)',
  amazon:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
  bing: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  human:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  betterStack:
    'Better Stack Better Uptime Bot Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  betterUptimeOld:
    'Better Uptime Bot Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  geoHealthcheck: 'example-monitor geo-healthcheck (+https://nailfolio.app)',
  curl: 'curl/8.5.0',
  nodeFetch: 'node',
} as const;

describe('detectAiCrawler', () => {
  it.each([
    [UA.chatgptUser, 'ChatGPT-User', 'ai-search'],
    [UA.oaiSearch, 'OAI-SearchBot', 'ai-search'],
    [UA.gptBot, 'GPTBot', 'ai-training'],
    [UA.claudeUser, 'Claude-User', 'ai-search'],
    [UA.claudeSearch, 'Claude-SearchBot', 'ai-search'],
    [UA.claudeBot, 'ClaudeBot', 'ai-training'],
    [UA.mistral, 'MistralAI-User', 'ai-search'],
    [UA.duckAssist, 'DuckAssistBot', 'ai-search'],
    [UA.exa, 'ExaSearchBot', 'ai-search'],
    [UA.amazon, 'Amazonbot', 'ai-training'],
    [UA.bing, 'Bingbot', 'search-engine'],
    [UA.betterStack, 'BetterStack', 'monitoring'],
    [UA.betterUptimeOld, 'BetterStack', 'monitoring'],
    [UA.geoHealthcheck, 'example-monitor', 'monitoring'],
    [UA.curl, 'cli-fetch', 'monitoring'],
    [UA.nodeFetch, 'cli-fetch', 'monitoring'],
  ])('%s → %s (%s)', (ua, name, category) => {
    expect(detectAiCrawler(ua)).toEqual({
      bot_name: name,
      bot_category: category,
    });
  });

  it('does not take a browser UA for a CLI tool', () => {
    expect(detectAiCrawler(UA.human)).toBeNull();
    expect(
      detectAiCrawler('Mozilla/5.0 (X11; Linux x86_64) node-ish')
    ).toBeNull();
  });
});

describe('shouldTrackCrawlerRequest', () => {
  it.each([
    UA.chatgptUser,
    UA.oaiSearch,
    UA.claudeUser,
    UA.claudeSearch,
    UA.mistral,
    UA.duckAssist,
    UA.exa,
    UA.gptBot,
    UA.bing,
  ])('tracks a page read by %s', ua => {
    expect(shouldTrackCrawlerRequest('/for-stylists/', ua)).toBe(true);
    expect(shouldTrackCrawlerRequest('/en/blog/some-post/', ua)).toBe(true);
  });

  it.each([
    UA.human,
    UA.googlebot,
    UA.ahrefs,
    UA.claudeBot,
    UA.amazon,
    UA.betterStack,
  ])('does not track a page read by %s', ua => {
    expect(shouldTrackCrawlerRequest('/pricing/', ua)).toBe(false);
  });

  it('tracks machine files and markdown mirrors for any caller but monitoring', () => {
    for (const path of [
      '/llms.txt',
      '/llms-full.txt',
      '/sitemap-profiles.xml',
      '/en/pricing.md',
    ]) {
      expect(shouldTrackCrawlerRequest(path, UA.human)).toBe(true);
      expect(shouldTrackCrawlerRequest(path, UA.googlebot)).toBe(true);
      expect(shouldTrackCrawlerRequest(path, UA.geoHealthcheck)).toBe(false);
      expect(shouldTrackCrawlerRequest(path, UA.betterStack)).toBe(false);
      expect(shouldTrackCrawlerRequest(path, UA.curl)).toBe(false);
    }
  });

  it('never tracks assets, Next internals or an over-long path, even for an AI bot', () => {
    expect(shouldTrackCrawlerRequest('/images/hero.webp', UA.chatgptUser)).toBe(
      false
    );
    expect(
      shouldTrackCrawlerRequest('/_next/data/abc/pricing.json', UA.chatgptUser)
    ).toBe(false);
    expect(
      shouldTrackCrawlerRequest('/_next/data/abc/x.md', UA.chatgptUser)
    ).toBe(false);
    expect(
      shouldTrackCrawlerRequest(`/${'a'.repeat(500)}`, UA.chatgptUser)
    ).toBe(false);
    expect(shouldTrackCrawlerRequest('', UA.chatgptUser)).toBe(false);
  });
});
