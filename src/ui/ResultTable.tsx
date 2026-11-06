import {
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@wealthfolio/ui';
import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Analysis } from '../model/analysis';
import { drawdownState, durationText } from '../model/drawdownText';
import type { Fmt } from '../model/format';
import { codeText, messageText } from '../model/messages';
import { rowName, useTexts, type Texts } from './i18n';
import { InfoPopover, SectionTitle, infoFor } from './InfoPopover';
import { gainClass } from './styles';
import { PillSwitch } from './PillSwitch';
import { buildRowViews, type RowView, type ViewMode } from './viewModel';

/** "MWR p.a." per year, plain "MWR" over a window shorter than a year (as the host's Performance page). */
const mwrLabel = (t: Texts['t'], period: boolean, real: boolean): string =>
  period ? (real ? t('table.mwrReal') : t('table.mwr')) : real ? t('table.irrReal') : t('table.irr');

/**
 * The comparison: switch nominal/real in the header, a table from `md`, compact rows below.
 * `unavailable` replaces the rows with a short hint (real view without inflation data).
 */
export function ComparisonCard({
  a,
  fmt,
  view,
  onViewChange,
  unavailable,
  fetching,
  colors,
  selected,
  onSelect,
}: {
  a: Analysis;
  fmt: Fmt;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  unavailable: string | null;
  fetching: boolean;
  /** Line colour per row key (same as badges and chart). */
  colors: Map<string, string>;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { t } = useTexts();
  const views = useMemo(() => ({ nominal: buildRowViews(a.rows, 'nominal'), real: buildRowViews(a.rows, 'real') }), [a.rows]);
  const rows = views[view];
  const ctx: RowCtx = { colors, selected, onSelect, period: a.mwrPeriodDays !== null, today: a.today };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string): void =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-1">
          <SectionTitle title={t('comparison.title')} />
          {/* Phones have no column titles, so the gain difference is explained at the card title there. */}
          <span className="md:hidden">
            <InfoPopover title={t('table.vsActual')} paragraphs={[t('strip.info.vs')]} />
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Left of the switch, so the switch keeps its place when the button appears. */}
          {view === 'real' && !unavailable && <InfoPopover title={t('view.real')} paragraphs={[t('table.realNote')]} />}
          <PillSwitch
            label={t('app.viewLabel')}
            value={view}
            onChange={onViewChange}
            options={(['nominal', 'real'] as const).map((value) => ({ value, label: t(`view.${value}`) }))}
          />
        </div>
      </CardHeader>
      <CardContent className={cn('transition-opacity', fetching && 'opacity-60')}>
        {unavailable ? (
          <p className="text-muted-foreground py-4 text-xs">{unavailable}</p>
        ) : (
          <>
            <div className="md:hidden">
              {rows.map((v) => (
                <MobileRow key={v.row.key} v={v} fmt={fmt} open={open.has(v.row.key)} onToggle={() => toggle(v.row.key)} ctx={ctx} />
              ))}
            </div>
            <div className="hidden md:block">
              <DesktopTable rows={rows} alternateRows={views[view === 'nominal' ? 'real' : 'nominal']} view={view} fmt={fmt} open={open} onToggle={toggle} ctx={ctx} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface RowCtx {
  colors: Map<string, string>;
  selected: string;
  onSelect: (key: string) => void;
  /** Money-weighted returns over the window instead of per year. */
  period: boolean;
  /** Window end (an open drawdown lasts until then). */
  today: string;
}

/** Warning marker of a row; it opens the row's notes. Rows without notes have nothing to expand. */
function NotesToggle({ v, open, onToggle }: { v: RowView; open: boolean; onToggle: () => void }) {
  const { t } = useTexts();
  const count = v.row.warnings.length;
  if (count === 0) return null;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={t('table.notes', { count })}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn('text-warning inline-flex shrink-0 items-center rounded p-0.5', open && 'bg-warning-subtle')}
    >
      <TriangleAlert className="h-3.5 w-3.5" />
    </button>
  );
}

/** Colour bar as in the badges; it marks and selects the row's line and metrics. */
function ColorBar({ v, ctx }: { v: RowView; ctx: RowCtx }) {
  const { t } = useTexts();
  const color = v.headline ? ctx.colors.get(v.row.key) : undefined;
  return (
    <button
      type="button"
      aria-pressed={ctx.selected === v.row.key}
      aria-label={t('table.select', { name: rowName(t, v.row) })}
      disabled={!color}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onSelect(v.row.key);
      }}
      className={cn('flex h-6 w-3 shrink-0 items-center justify-center rounded', ctx.selected === v.row.key && 'bg-warning-subtle')}
    >
      <span className="h-4 w-1 rounded-full" style={{ backgroundColor: color ?? 'var(--muted-foreground)', opacity: color ? 1 : 0.35 }} />
    </button>
  );
}

const select = (v: RowView, ctx: RowCtx): (() => void) | undefined => (v.headline ? () => ctx.onSelect(v.row.key) : undefined);

/** Row in the style of the host's holding rows: name left, value and gain · p.a. right. */
function MobileRow({ v, fmt, open, onToggle, ctx }: { v: RowView; fmt: Fmt; open: boolean; onToggle: () => void; ctx: RowCtx }) {
  const { t } = useTexts();
  const h = v.headline;
  return (
    <div className="border-b last:border-0">
      <div className="flex items-center gap-2">
        <ColorBar v={v} ctx={ctx} />
        <div
          role={h ? 'button' : undefined}
          onClick={select(v, ctx)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 text-start"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('truncate text-sm', v.isActual ? 'font-bold' : 'font-semibold')}>{rowName(t, v.row)}</span>
              <NotesToggle v={v} open={open} onToggle={onToggle} />
            </span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">
              {h
                ? v.diff !== null
                  ? t('table.vsShort', { diff: fmt.moneySigned(v.diff) })
                  : ''
                : t('table.notComputable', { reason: codeText(t, fmt, v.error ?? '') })}
            </span>
          </span>
          {h && (
            <span className="flex shrink-0 flex-col items-end">
              <span className="text-sm font-semibold tabular-nums">{fmt.money(h.value)}</span>
              <span className="text-xs tabular-nums">
                <span className={gainClass(h.gain)}>{h.gain === null ? '–' : fmt.moneySigned(h.gain)}</span>
                <span className="text-muted-foreground"> · </span>
                <span className={gainClass(h.irr)}>
                  {fmt.pctSigned(h.irr)}
                  {ctx.period ? '' : ` ${t('table.perYear')}`}
                </span>
              </span>
            </span>
          )}
        </div>
      </div>
      {open && <Notes v={v} fmt={fmt} />}
    </div>
  );
}

const th = 'text-muted-foreground text-2xs h-9 font-medium tracking-wider whitespace-nowrap uppercase';
const td = 'text-end tabular-nums whitespace-nowrap';
const COLS = 6;

/** Reserve both views' intrinsic text widths, including after fonts or locale change. */
function ReservedText({ value, reserve }: { value: string; reserve: string }) {
  return (
    <span className="grid">
      <span style={{ gridArea: '1 / 1' }}>{value}</span>
      <span aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{reserve}</span>
    </span>
  );
}

function DesktopTable({
  rows,
  alternateRows,
  view,
  fmt,
  open,
  onToggle,
  ctx,
}: {
  rows: RowView[];
  alternateRows: RowView[];
  view: ViewMode;
  fmt: Fmt;
  open: Set<string>;
  onToggle: (key: string) => void;
  ctx: RowCtx;
}) {
  const { t } = useTexts();
  const real = view === 'real';
  const alternateByKey = useMemo(() => new Map(alternateRows.map((v) => [v.row.key, v])), [alternateRows]);
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(th, 'ps-5')}>{t('table.variant')}</TableHead>
          <TableHead className={cn(th, 'text-end')}>{t('table.value')}</TableHead>
          <TableHead className={cn(th, 'text-end')}>
            <ReservedText value={real ? t('table.gainReal') : t('table.gain')} reserve={real ? t('table.gain') : t('table.gainReal')} />
          </TableHead>
          <TableHead className={cn(th, 'text-end')}>
            <ReservedText value={mwrLabel(t, ctx.period, real)} reserve={mwrLabel(t, ctx.period, !real)} />
          </TableHead>
          <TableHead className={cn(th, 'text-end')}>
            {/* After the right-aligned title, so it keeps its place when the "(real)" suffix appears. */}
            <span className="inline-flex items-center">
              <ReservedText value={real ? t('table.vsActualReal') : t('table.vsActual')} reserve={real ? t('table.vsActual') : t('table.vsActualReal')} />
              <InfoPopover title={t('table.vsActual')} paragraphs={[t('strip.info.vs')]} compact />
            </span>
          </TableHead>
          <TableHead className={cn(th, 'text-end')}>
            {/* Nominal in both views, so no "(real)" suffix and nothing to reserve. */}
            <span className="inline-flex items-center">
              {t('table.maxDrawdown')}
              <InfoPopover title={t('table.maxDrawdown')} paragraphs={[t('strip.info.maxDrawdown'), t('strip.info.recovery')]} compact />
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <DesktopRow key={v.row.key} v={v} alternate={alternateByKey.get(v.row.key)!} fmt={fmt} isOpen={open.has(v.row.key)} onToggle={() => onToggle(v.row.key)} ctx={ctx} />
        ))}
      </TableBody>
    </Table>
  );
}

function DesktopRow({ v, alternate, fmt, isOpen, onToggle, ctx }: { v: RowView; alternate: RowView; fmt: Fmt; isOpen: boolean; onToggle: () => void; ctx: RowCtx }) {
  const { t } = useTexts();
  const h = v.headline;
  return (
    <>
      <TableRow className={cn(h && 'cursor-pointer', isOpen && 'border-transparent')} onClick={select(v, ctx)}>
        <TableCell className="max-w-72">
          <span className="flex min-w-0 items-center gap-2">
            <ColorBar v={v} ctx={ctx} />
            <span className={cn('truncate', v.isActual ? 'font-bold' : 'font-medium')}>{rowName(t, v.row)}</span>
            <NotesToggle v={v} open={isOpen} onToggle={onToggle} />
          </span>
        </TableCell>
        {h ? (
          <>
            <TableCell className={cn(td, 'font-semibold')}>{fmt.money(h.value)}</TableCell>
            <TableCell className={cn(td, gainClass(h.gain))}>
              <ReservedText value={h.gain === null ? '–' : fmt.moneySigned(h.gain)} reserve={alternate.headline?.gain == null ? '–' : fmt.moneySigned(alternate.headline.gain)} />
            </TableCell>
            <TableCell className={cn(td, gainClass(h.irr))}>
              <ReservedText value={fmt.pctSigned(h.irr)} reserve={fmt.pctSigned(alternate.headline?.irr ?? null)} />
            </TableCell>
            <TableCell className={cn(td, 'text-muted-foreground')}>
              <ReservedText value={v.diff === null ? '–' : fmt.moneySigned(v.diff)} reserve={alternate.diff === null ? '–' : fmt.moneySigned(alternate.diff)} />
            </TableCell>
            <TableCell className={td}>
              <DrawdownCell v={v} fmt={fmt} today={ctx.today} />
            </TableCell>
          </>
        ) : (
          <TableCell colSpan={COLS - 1} className="text-muted-foreground">
            {t('table.notComputable', { reason: codeText(t, fmt, v.error ?? '') })}
          </TableCell>
        )}
      </TableRow>
      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLS} className="ps-5 pt-0 pb-4">
            <Notes v={v} fmt={fmt} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Max drawdown with its recovery time (or "not recovered") behind it. */
function DrawdownCell({ v, fmt, today }: { v: RowView; fmt: Fmt; today: string }) {
  const { t } = useTexts();
  const dd = drawdownState(v.report?.drawdown ?? null, today);
  if (dd.kind === 'unavailable') return <span className="text-muted-foreground">–</span>;
  if (dd.kind === 'none') return <span className="text-muted-foreground">{fmt.pct(0)}</span>;
  return (
    <>
      <span className={gainClass(dd.max)}>{fmt.pctSigned(dd.max)}</span>
      <span className="text-muted-foreground">
        {' · '}
        {dd.kind === 'recovered' ? durationText(t, fmt, dd.days) : t('drawdown.notRecovered')}
      </span>
    </>
  );
}

/** What the row's warnings mean (with the explanation behind an info button where there is one). */
function Notes({ v, fmt }: { v: RowView; fmt: Fmt }) {
  const { t } = useTexts();
  const notes = v.row.warnings.map((w) => ({ text: messageText(t, fmt, w), info: infoFor(t, w.code) }));
  return (
    <ul className="bg-muted/30 text-muted-foreground space-y-1 rounded-lg p-3 text-xs whitespace-normal">
      {notes.map((n) => (
        <li key={n.text} className="flex items-start gap-1.5">
          <TriangleAlert className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{n.text}</span>
          {n.info && <InfoPopover title={n.info.title} paragraphs={n.info.paragraphs} />}
        </li>
      ))}
    </ul>
  );
}
