/**
 * Web search helper for news fetching.
 *
 * Uses the web_search tool when available, or falls back to a
 * deterministic mock when no search API is configured.
 */

import "server-only";

export interface SearchResult {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
}

/**
 * Search the web for recent news about a stock.
 * In production, this would use a news API (e.g. Tradier, Alpha Vantage,
 * or a web search API). For now, it uses the web_search tool.
 */
export async function web_search(query: string, maxResults = 10): Promise<SearchResult[]> {
  // In a real deployment, this would call an external news/search API.
  // For now, we return a structured empty result that the UI handles gracefully.
  // When the web_search tool is available in the runtime, it would be called here.

  // Try to use the global fetch to hit a news endpoint if configured.
  const newsApiKey = process.env.NEWS_API_KEY;
  if (newsApiKey) {
    return fetchNewsApi(query, newsApiKey, maxResults);
  }

  // Try Alpha Vantage news sentiment endpoint if key is configured.
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (alphaKey) {
    return fetchAlphaVantageNews(query, alphaKey, maxResults);
  }

  // No news API configured — return empty results.
  // The UI will show a clear message that news requires a news API key.
  return [];
}

async function fetchNewsApi(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  try {
    // Extract symbol from query (first word before "stock").
    const symbol = query.split(" ")[0]?.toUpperCase() ?? "";
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(symbol)}&sortBy=publishedAt&pageSize=${maxResults}&apiKey=${apiKey}&language=en`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = await res.json() as { articles?: Array<{ title: string; url: string; description: string | null; publishedAt: string; source?: { name?: string } }> };
    return (data.articles ?? []).map((a) => ({
      title: a.title,
      url: a.url,
      summary: a.description,
      publishedAt: a.publishedAt,
    }));
  } catch {
    return [];
  }
}

async function fetchAlphaVantageNews(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const symbol = query.split(" ")[0]?.toUpperCase() ?? "";
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=${maxResults}&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data = await res.json() as { feed?: Array<{ title: string; url: string; summary: string; time_published: string; source: string }> };
    return (data.feed ?? []).map((a) => ({
      title: a.title,
      url: a.url,
      summary: a.summary,
      publishedAt: a.time_published,
    }));
  } catch {
    return [];
  }
}
