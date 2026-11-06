import type { AddonContext, QueryClient } from '@wealthfolio/addon-sdk';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DateRangeSelector,
  Page,
  PageContent,
  Skeleton,
  TooltipProvider,
  cn,
  useIsMobile,
} from '@wealthfolio/ui';
import { CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isError } from '../core/types';
import { analyze, benchKeys } from '../model/analysis';
import { codeText } from '../model/messages';
import { isoOfLocal, localOfIso, presetFrom, rangeFromDays, windowOf, type RangeSetting } from '../model/range';
import { DEFAULT_SETTINGS, type AddonSettings, type BenchmarkDef } from '../model/settings';
import { loadAll } from '../sources/load';
import { unavailableSelection } from '../sources/portfolio';
import { loadSettings, saveSettings } from '../sources/settingsStore';
import { AccountScope, type Scope } from './AccountScope';
import { BadgeRow, type BadgeItem } from './Badges';
import { BenchmarkPicker } from './BenchmarkPicker';
import { ComparisonChart, NET_KEY, type ChartMode } from './ComparisonChart';
import { ChartScaleSwitch } from './ChartScaleSwitch';
import { logAxis, type ChartScale } from './logAxis';
import { MarkerToggle } from './MarkerToggle';
import { PillSwitch } from './PillSwitch';
import { AddonCtx, useAddon } from './context';
import { Notice } from './Notice';
import { rowName, useFmt, useTexts } from './i18n';
import { MetricStrip } from './MetricStrip';
import { ComparisonCard } from './ResultTable';
import { stripSections } from './strip';
import { seriesColor } from './styles';
import { HowItWorks, WarningsButton } from './Toolbar';
import type { ViewMode } from './viewModel';

export function App({ ctx }: { ctx: AddonContext }) {
  const client = ctx.api.query.getClient() as QueryClient;
  return (
    <AddonCtx.Provider value={ctx}>
      <QueryClientProvider client={client}>
        <Comparison />
      </QueryClientProvider>
    </AddonCtx.Provider>
  );
}

const SETTINGS_KEY = ['hindsight', 'settings'];

/** Calendar day in the Wealthfolio time zone (the host anchors its presets the same way). */
function todayIn(timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
  } catch {
    return isoOfLocal(new Date());
  }
}

function Comparison() {
  const ctx = useAddon();
  const qc = useQueryClient();
  const { t } = useTexts();
  const isMobile = useIsMobile();
  const settingsQ = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => loadSettings(ctx.api.storage) });
  const accountsQ = useQuery({ queryKey: ['hindsight', 'accounts'], queryFn: () => ctx.api.accounts.getAll() });
  const settings = settingsQ.data;
  const [view, setView] = useState<ViewMode>('nominal');
  const [selected, setSelected] = useState('actual');
  const [markers, setMarkers] = useState(false);
  const [chartScale, setChartScale] = useState<ChartScale>('linear');
  const [chartMode, setChartMode] = useState<ChartMode>('gain');

  // Every selector saves right away (as the host persists its selections); the page shows the new state at once.
  // Only once the stored settings are loaded (the selectors are disabled before), so a late load cannot overwrite
  // a change; a failed save reloads the stored state instead of restoring a snapshot that may drop later changes.
  const update = (patch: Partial<AddonSettings>): void => {
    const cur = qc.getQueryData<AddonSettings>(SETTINGS_KEY);
    if (!cur) return;
    qc.setQueryData(SETTINGS_KEY, { ...cur, ...patch });
    saveSettings(ctx.api.storage, patch).catch(() => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      ctx.api.toast.error(t('app.settingsSaveFailed'));
    });
  };

  // Selected accounts that cannot be analysed (archived, unsupported type, deleted) block the analysis until
  // they are deselected; the scope only counts as known once the account list has loaded.
  const blocked = useMemo(
    () => (accountsQ.data && settings ? unavailableSelection(accountsQ.data, settings.accounts) : []),
    [accountsQ.data, settings],
  );
  // Loading does not depend on the range: switching periods only recomputes. A change of the account scope
  // drops the previous result at once (it describes other accounts); benchmark changes keep it while loading.
  const scopeKey = settings ? JSON.stringify(settings.accounts) : null;
  const benchKey = settings ? JSON.stringify(settings.benchmarks) : null;
  const dataQ = useQuery({
    queryKey: ['hindsight', 'data', scopeKey, benchKey],
    enabled: !!settings && !!accountsQ.data && blocked.length === 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === scopeKey ? prev : undefined),
    queryFn: () => loadAll(ctx.api, { net: ctx.api.network, storage: ctx.api.storage, nowMs: () => Date.now() }, settings as AddonSettings),
  });

  // The cached account list can be older than the loader's: if the loader refuses the scope, reload the list so
  // `blocked` names the accounts instead of showing a raw error.
  const staleScope = dataQ.isError && dataQ.error instanceof Error && dataQ.error.message === 'scope_unavailable';
  useEffect(() => {
    if (staleScope) void qc.invalidateQueries({ queryKey: ['hindsight', 'accounts'] });
  }, [staleScope, qc]);
  const loaded = blocked.length === 0 ? dataQ.data : undefined;
  const asOf = loaded?.real.asOf ?? todayIn(loaded?.real.timeZone);
  const range = settings?.range ?? DEFAULT_SETTINGS.range;
  const analysis = useMemo(() => {
    if (!loaded) return null;
    return analyze(
      {
        flows: loaded.flows.flows,
        flowWarnings: loaded.flows.warnings,
        unvalued: loaded.flows.unvalued,
        unconverted: loaded.flows.unconverted,
        country: loaded.country,
        cpi: loaded.cpi,
        cpiError: loaded.cpiError,
        fxStaleHours: loaded.fxStaleHours,
        benchmarks: loaded.benchmarks,
        real: loaded.real,
      },
      windowOf(range, asOf),
    );
  }, [loaded, range, asOf]);
  const fmt = useFmt(loaded?.real.baseCurrency ?? 'USD');

  // Badges and colours come from the saved list (the source of truth), results from the analysis by key: while
  // new data load, the badges already show the new list, and removing works by identity, never by position.
  const benchmarks = useMemo(() => settings?.benchmarks ?? [], [settings]);
  const keys = useMemo(() => benchKeys(benchmarks), [benchmarks]);
  const colors = useMemo(() => {
    const m = new Map<string, string>([['actual', 'var(--foreground)']]);
    keys.forEach((k, i) => m.set(k, seriesColor(i)));
    return m;
  }, [keys]);
  const rows = analysis && !analysis.fatal ? analysis.rows : [];
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const selectedRow = rows.find((r) => r.key === selected && !isError(r.result)) ?? rows.find((r) => r.kind === 'actual');
  const selectedKey = selectedRow?.key ?? 'actual';
  const badgeItems: BadgeItem[] = [
    { key: 'actual', label: t('table.yourPortfolio'), color: colors.get('actual') ?? null, removable: false },
    ...benchmarks.map((b, i): BadgeItem => {
      const r = rowByKey.get(keys[i]);
      const err = r && isError(r.result) ? r.result.error : null;
      return {
        key: keys[i],
        label: r ? rowName(t, r) : b.kind === 'cash' && b.name.trim() === '' ? t('table.notInvested') : b.name,
        color: r && !err ? (colors.get(keys[i]) ?? null) : null,
        reason: err ? t('table.notComputable', { reason: codeText(t, fmt, err) }) : undefined,
        removable: true,
      };
    }),
  ];
  const removeBench = (key: string): void => {
    update({ benchmarks: benchmarks.filter((_, k) => keys[k] !== key) });
    if (selected === key) setSelected('actual');
  };
  const addBench = (b: BenchmarkDef): void => update({ benchmarks: [...benchmarks, b] });

  const busy = settingsQ.isLoading || accountsQ.isLoading || (blocked.length === 0 && !loaded && dataQ.isFetching);
  const failure = blocked.length === 0 && dataQ.isError && !staleScope ? dataQ.error : accountsQ.isError ? accountsQ.error : null;
  const loadError = failure ? (failure instanceof Error ? failure.message : String(failure)) : null;
  const realMissing = view === 'real' && analysis !== null && analysis.investedReal === null;
  const unavailable = realMissing ? t('app.realUnavailable') : null;

  // Range selector: presets anchored at the latest valuation day, ALL starting with the first deposit.
  const asOfDate = useMemo(() => localOfIso(asOf), [asOf]);
  const rangeValue = useMemo(() => {
    if ('preset' in range) {
      const from = presetFrom(range.preset, asOf);
      return { from: from === null ? new Date(1970, 0, 1) : localOfIso(from), to: asOfDate };
    }
    return { from: localOfIso(range.from), to: localOfIso(range.to) };
  }, [range, asOf, asOfDate]);
  const onRange = (r: { from: Date | undefined; to: Date | undefined } | undefined): void => {
    const next: RangeSetting | null = rangeFromDays(r?.from ? isoOfLocal(r.from) : null, r?.to ? isoOfLocal(r.to) : null, asOf);
    if (next) update({ range: next });
  };
  const filters = (
    <>
      <AccountScope
        accounts={accountsQ.data ?? []}
        unavailable={blocked}
        value={settings?.accounts ?? null}
        disabled={!settings}
        onChange={(v: Scope) => update({ accounts: v })}
      />
      <DateRangeSelector
        asOf={asOfDate}
        value={rangeValue}
        onChange={onRange}
        hiddenRanges={['1D']}
        allTimeFrom={analysis?.firstEver ? localOfIso(analysis.firstEver) : undefined}
      />
    </>
  );

  const report = selectedRow && !isError(selectedRow.result) ? selectedRow.result : null;
  const actualRow = rows.find((r) => r.kind === 'actual');
  const actualReport = actualRow && !isError(actualRow.result) ? actualRow.result : null;
  const sections =
    analysis && report
      ? stripSections({ t, fmt, a: analysis, report, actual: selectedRow?.kind === 'actual' ? null : actualReport })
      : [];
  const warnings = analysis && !analysis.fatal ? analysis.headerWarnings : [];
  const period = analysis?.start && analysis.today ? `${fmt.date(analysis.start)} – ${fmt.date(analysis.today)}` : '';

  const plottedKeys = [NET_KEY, ...rows.filter((r) => !isError(r.result) && colors.has(r.key)).map((r) => r.key)];
  const logAvailable = !!analysis && logAxis(analysis.chart, plottedKeys, fmt.money) !== null;
  const scale = chartScale === 'log' && logAvailable ? 'log' : 'linear';

  return (
    <TooltipProvider>
      <Page>
        <PageContent className="pb-20">
          <div className="mx-auto w-full space-y-4">
            {/* As the filter row of the host's Performance page: right-aligned at the content's padding, no title
                beside it (PageHeader's own padding and empty title slot pushed it inwards on phones). */}
            <div className="pt-safe flex items-center justify-end gap-2 md:pt-2">{filters}</div>
            {loadError && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{t('app.loadFailed', { error: loadError })}</AlertDescription>
              </Alert>
            )}
            {blocked.length > 0 && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>
                  {t('app.scopeBlocked', { names: blocked.map((u) => u.name ?? t('scope.deleted')).join(', ') })}
                </AlertDescription>
              </Alert>
            )}
            {settings && (
              <BadgeRow
                items={badgeItems}
                selected={selectedKey}
                onSelect={setSelected}
                onRemove={removeBench}
                add={<BenchmarkPicker existing={benchmarks} onAdd={addBench} />}
              />
            )}
            {analysis?.fatal && [analysis.fatal, ...analysis.moreFatal].map((w) => <Notice key={w.code} w={w} fmt={fmt} />)}
            {busy && !analysis && <LoadingState label={t('app.loading')} />}
            {analysis && !analysis.fatal && (
              <>
                <Card className={cn('transition-opacity', dataQ.isFetching && 'opacity-60')}>
                  <CardHeader className={cn('pb-2', isMobile ? 'px-3 py-3' : 'px-6 pt-5 pb-2')}>
                    <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <CardTitle className={cn('min-w-0 text-lg sm:text-xl', isMobile && 'text-sm')}>{t('app.title')}</CardTitle>
                            <HowItWorks />
                            <WarningsButton warnings={warnings} fmt={fmt} />
                          </div>
                          <CardDescription className={cn('text-xs sm:text-sm', isMobile && 'text-2xs')}>
                            <span className="block">{t('app.tagline')}</span>
                            {period && <span className="block tabular-nums opacity-70">{period}</span>}
                          </CardDescription>
                        </div>
                      </div>
                      {sections.length > 0 && <MetricStrip sections={sections} mobile={isMobile} />}
                    </div>
                  </CardHeader>
                  <CardContent className={cn('min-h-0', isMobile ? 'p-2' : 'p-3 sm:p-6')}>
                    <div className="mb-1 flex flex-wrap items-start justify-end gap-2">
                      <MarkerToggle enabled={markers} onToggle={() => setMarkers((m) => !m)} />
                      {/* Gain starts at zero and can be negative, so only the value chart has a logarithmic scale.
                          It sits left of the mode switch, which keeps its place when it appears. */}
                      {chartMode === 'value' && <ChartScaleSwitch scale={scale} onChange={setChartScale} available={logAvailable} />}
                      <PillSwitch
                        label={t('chart.mode')}
                        value={chartMode}
                        onChange={setChartMode}
                        options={(['gain', 'value'] as const).map((value) => ({ value, label: t(`chart.${value}`) }))}
                      />
                    </div>
                    <ComparisonChart
                      a={analysis}
                      fmt={fmt}
                      colors={colors}
                      selected={selectedKey}
                      markers={markers}
                      mode={chartMode}
                      scale={scale}
                    />
                  </CardContent>
                </Card>
                <ComparisonCard
                  a={analysis}
                  fmt={fmt}
                  view={view}
                  onViewChange={setView}
                  unavailable={unavailable}
                  fetching={dataQ.isFetching}
                  colors={colors}
                  selected={selectedKey}
                  onSelect={setSelected}
                />
              </>
            )}
          </div>
        </PageContent>
      </Page>
    </TooltipProvider>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={label}>
      <Skeleton className="h-72 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
