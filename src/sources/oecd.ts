import { addDays } from '../core/dates';
import type { CountryDef } from '../model/countries';
import { DataError, HOUR_MS, cachedFetch, storageKey, type FetchDeps } from './http';

export const CPI_TTL_MS = 24 * HOUR_MS;
const CACHE_PREFIX = 'oecd:v1:';
const BASE = 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,';
/**
 * Two dataflows of the same source: countries that have switched to COICOP 2018 (most European
 * ones from 2026) publish their current months only in the second; the others (e.g. DEU, USA) only
 * in the first. Both are read and the most recent series that covers the flows is used. If one
 * fails (other than 404), the other counts.
 */
export const OECD_FLOWS = ['DSD_PRICES@DF_PRICES_ALL,1.0', 'DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0'];

export function oecdUrl(flow: string, areas: string[], sinceMonth: string): string {
  return `${BASE}${flow}/${areas.join('+')}.M.N.CPI.IX._T.N._Z?startPeriod=${sinceMonth}`;
}

/** Split a CSV line with quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** OECD SDMX-CSV -> {area: {"YYYY-MM": index}}; columns by header row, monthly values only. */
export function parseOecdCsv(body: string): Record<string, Record<string, number>> {
  const text = body.replace(/^﻿/, '');
  if (/^\s*</.test(text)) throw new DataError('inflation_unavailable'); // HTML: error or challenge page
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return {};
  const head = splitCsvLine(lines[0]);
  const col = (name: string): number => head.indexOf(name);
  const [iArea, iFreq, iTime, iValue] = ['REF_AREA', 'FREQ', 'TIME_PERIOD', 'OBS_VALUE'].map(col);
  if (iArea < 0 || iTime < 0 || iValue < 0) throw new DataError('inflation_unavailable');
  const out: Record<string, Record<string, number>> = {};
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    if (iFreq >= 0 && f[iFreq] !== 'M') continue;
    const month = f[iTime];
    const v = Number(f[iValue]);
    if (!/^\d{4}-\d{2}$/.test(month ?? '') || f[iValue] === '' || !Number.isFinite(v) || v <= 0) continue;
    (out[f[iArea]] ??= {})[month] = v;
  }
  for (const area of Object.keys(out)) {
    out[area] = Object.fromEntries(Object.entries(out[area]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  }
  return out;
}

const firstKey = (s: Record<string, number>): string => Object.keys(s).reduce((m, k) => (k < m ? k : m), '9999-99');
const lastKey = (s: Record<string, number>): string => Object.keys(s).reduce((m, k) => (k > m ? k : m), '');

/** Most recent series that covers `sinceMonth`; if none does, the one reaching back furthest. */
export function pickSeries(candidates: Record<string, number>[], sinceMonth: string): Record<string, number> | null {
  const usable = candidates.filter((s) => Object.keys(s).length > 0);
  if (usable.length === 0) return null;
  const covering = usable.filter((s) => firstKey(s) <= sinceMonth);
  if (covering.length > 0) return covering.reduce((best, s) => (lastKey(s) > lastKey(best) ? s : best));
  return usable.reduce((best, s) => (firstKey(s) < firstKey(best) ? s : best));
}

export interface CpiSeries {
  cpi: Record<string, number>;
  lastMonth: string;
  fetchedAt: number;
  stale: boolean;
}

/** CPI of a country from the month before the first cash flow (OECD, both dataflows). */
export async function fetchCpi(deps: FetchDeps, country: CountryDef, firstFlow: string): Promise<CpiSeries> {
  const since = addDays(firstFlow, -31).slice(0, 7);
  let partial = false;
  const r = await cachedFetch<Record<string, number>>(
    deps,
    storageKey(CACHE_PREFIX, country.id),
    `${since}-01`,
    CPI_TTL_MS,
    async () => {
      const results = await Promise.allSettled(
        OECD_FLOWS.map(async (flow) => {
          const resp = await deps.net.request({
            url: oecdUrl(flow, country.areas, since),
            method: 'GET',
            headers: { Accept: 'application/vnd.sdmx.data+csv' },
            timeoutSecs: 30,
          });
          if (resp.status === 404) return {}; // NoRecordsFound: country not in this dataflow
          if (resp.status < 200 || resp.status >= 300) throw new DataError('inflation_unavailable');
          return parseOecdCsv(resp.body);
        }),
      );
      // A failing dataflow does not discard the other. Such a partial result loses against a covering
      // cache entry (the failing flow may be the more recent one) and is never cached; if it does not
      // reach back to `since`, it counts as a load error instead of “data only start in …”.
      partial = results.some((x) => x.status === 'rejected');
      const candidates = results.flatMap((x) => (x.status === 'fulfilled' ? Object.values(x.value) : []));
      const best = pickSeries(candidates, since);
      if (!best || (partial && firstKey(best) > since)) throw new DataError('inflation_unavailable');
      return best;
    },
    { failCode: 'inflation_unavailable', complete: () => !partial },
  );
  return { cpi: r.data, lastMonth: lastKey(r.data), fetchedAt: r.fetchedAt, stale: r.stale };
}
