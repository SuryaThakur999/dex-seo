import * as cheerio from 'cheerio';

export interface RssItem {
  title: string;
  link: string;
  publishedAt: Date | null;
  description: string;
}

export function parseRssItems(xml: string): RssItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('item').map((_, el) => {
    const $el = $(el);
    const pubDateRaw = $el.find('pubDate').first().text().trim();
    const parsed = pubDateRaw ? new Date(pubDateRaw) : null;
    return {
      title: $el.find('title').first().text().trim(),
      link: $el.find('link').first().text().trim(),
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      description: $el.find('description').first().text().trim(),
    };
  }).get();
}
