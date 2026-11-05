import { useEffect, useState } from 'react';
import { searchHits, type SearchHit } from '../model/search';
import { useAddon } from './context';

export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchState {
  status: 'idle' | 'loading' | 'done' | 'error';
  hits: SearchHit[];
}

/** Searches via Wealthfolio while typing (debounced); responses to outdated input are discarded. */
export function useTickerSearch(query: string): SearchState {
  const ctx = useAddon();
  const [state, setState] = useState<SearchState>({ status: 'idle', hits: [] });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setState({ status: 'idle', hits: [] });
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      setState((s) => ({ status: 'loading', hits: s.hits }));
      const onHits = (r: Parameters<typeof searchHits>[0]): void => {
        if (current) setState({ status: 'done', hits: searchHits(r) });
      };
      const onError = (): void => {
        if (current) setState({ status: 'error', hits: [] });
      };
      // A synchronous host error (e.g. missing permission) also ends up in onError.
      Promise.resolve()
        .then(() => ctx.api.market.searchTicker(q))
        .then(onHits, onError);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, ctx]);
  return state;
}
