import type { SymbolSearchResult } from '@wealthfolio/addon-sdk';

export interface SearchHit {
  name: string;
  /** Yahoo-Ticker. */
  ticker: string;
  symbol: string;
  exchange: string;
  currency: string;
  type: string;
}

/**
 * Hits of `market.searchTicker` that can be loaded via Yahoo: provider Yahoo or no provider given
 * (assets already present in Wealthfolio come without provider fields, `symbol` is then the Yahoo
 * symbol), no manually created assets. The ticker is the Yahoo symbol (`providerSymbol`, else
 * `symbol`); duplicate tickers appear once.
 */
export function searchHits(results: SymbolSearchResult[] | null | undefined): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const r of results ?? []) {
    const provider = (r.providerId ?? '').toUpperCase();
    if (provider !== '' && provider !== 'YAHOO') continue;
    // Runtime field `quoteMode` (not in the SDK type): manually maintained assets have no Yahoo prices.
    const quoteMode = (r as { quoteMode?: string }).quoteMode ?? '';
    if ((r.dataSource ?? '').toUpperCase() === 'MANUAL' || quoteMode.toUpperCase() === 'MANUAL') continue;
    const ticker = (r.providerSymbol || r.symbol || '').trim();
    if (ticker === '' || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({
      name: (r.longName || r.shortName || ticker).trim(),
      ticker,
      symbol: r.symbol || ticker,
      exchange: r.exchangeName || r.exchange || '',
      currency: r.currency ?? '',
      type: r.typeDisplay || r.quoteType || '',
    });
  }
  return out;
}
