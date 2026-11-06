import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useIsMobile,
} from '@wealthfolio/ui';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Rebalance } from '../core/types';
import { MIX_MAX, MIX_MIN, MIX_SUM_TOL, mixIdentity, validMix, type BenchmarkDef, type MixComponent } from '../model/settings';
import { PickerCommand } from './BenchmarkPicker';
import { useTexts } from './i18n';
import { PillSwitch } from './PillSwitch';

interface Row {
  name: string;
  ticker: string;
  /** As typed (percent). */
  weight: string;
}

const EMPTY: Row = { name: '', ticker: '', weight: '' };
const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

/** Suggested name: "70% URTH / 30% AGG". */
export function mixName(components: MixComponent[]): string {
  return components.map((c) => `${Math.round(c.weight * 100) / 100}% ${c.ticker.toUpperCase()}`).join(' / ');
}

/** Asset of one component: a button that opens the benchmark search (assets only). */
function AssetField({ row, others, onPick }: { row: Row; others: Row[]; onPick: (b: BenchmarkDef) => void }) {
  const { t } = useTexts();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const existing: BenchmarkDef[] = others.filter((o) => o.ticker !== '').map((o) => ({ name: o.name, ticker: o.ticker, kind: 'asset' }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="h-input-height min-w-0 flex-1 justify-between gap-2 px-3 font-normal" />}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          {row.ticker ? (
            <>
              <span className="truncate">{row.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{row.ticker}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('mix.chooseAsset')}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="w-87.5 max-w-[calc(100vw-2rem)] p-0" align="start">
        {open && (
          <PickerCommand
            existing={existing}
            mobile={isMobile}
            assetsOnly
            onPick={(b) => {
              onPick(b);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Form for a fixed mix: 2 to 5 assets with weights summing to 100 %, yearly or no rebalancing, a name. */
export function MixDialog({
  open,
  onOpenChange,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: BenchmarkDef[];
  onAdd: (b: BenchmarkDef) => void;
}) {
  const { t, language } = useTexts();
  const [rows, setRows] = useState<Row[]>([EMPTY, EMPTY]);
  const [rebalance, setRebalance] = useState<Rebalance>('yearly');
  const [name, setName] = useState('');
  const reset = (): void => {
    setRows([EMPTY, EMPTY]);
    setRebalance('yearly');
    setName('');
  };
  const setRow = (i: number, patch: Partial<Row>): void => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const components: MixComponent[] = rows.map((r) => ({ name: r.name, ticker: r.ticker, weight: num(r.weight) }));
  const valid = validMix(components);
  const sum = components.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0);
  const identity = valid ? mixIdentity(valid, rebalance) : null;
  const duplicate = identity !== null && existing.some((b) => b.kind === 'mix' && b.ticker === identity);
  const suggested = valid ? mixName(valid) : '';
  const sumText = new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(sum);
  const hint = !valid
    ? rows.some((r) => r.ticker === '')
      ? t('mix.hintAssets')
      : Math.abs(sum - 100) > MIX_SUM_TOL
        ? t('mix.hintSum', { sum: sumText })
        : t('mix.hintInvalid')
    : duplicate
      ? t('mix.hintDuplicate')
      : null;
  const add = (): void => {
    if (!valid || !identity || duplicate) return;
    onAdd({ name: name.trim() || suggested, ticker: identity, kind: 'mix', components: valid, rebalance });
    onOpenChange(false);
    reset();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o: boolean) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      useIsMobile={useIsMobile}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" mobileClassName="max-h-[85vh] overflow-y-auto p-6">
        <DialogHeader className="text-start">
          <DialogTitle>{t('mix.title')}</DialogTitle>
          <DialogDescription className="text-start">{t('mix.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <AssetField row={r} others={rows.filter((_, k) => k !== i)} onPick={(b) => setRow(i, { name: b.name, ticker: b.ticker })} />
              <div className="relative w-24 shrink-0">
                <Input
                  inputMode="decimal"
                  aria-label={t('mix.weight')}
                  placeholder="0"
                  value={r.weight}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRow(i, { weight: e.target.value })}
                  className="pe-8 text-end tabular-nums"
                />
                <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm">%</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={rows.length <= MIX_MIN}
                aria-label={t('mix.remove')}
                onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2"
              disabled={rows.length >= MIX_MAX}
              onClick={() => setRows((rs) => [...rs, EMPTY])}
            >
              <Plus className="h-4 w-4" />
              {t('mix.addComponent')}
            </Button>
            <span className={`text-xs tabular-nums ${Math.abs(sum - 100) <= MIX_SUM_TOL ? 'text-muted-foreground' : 'text-destructive'}`}>
              {t('mix.sum', { sum: sumText })}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{t('mix.rebalance')}</span>
          <PillSwitch
            label={t('mix.rebalance')}
            value={rebalance}
            onChange={setRebalance}
            options={(['yearly', 'none'] as const).map((value) => ({ value, label: t(`mix.rebalance_${value}`) }))}
          />
        </div>
        <Input
          aria-label={t('mix.name')}
          placeholder={suggested || t('mix.name')}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
        <DialogFooter className="flex-row items-center justify-end gap-3">
          {hint && <span className="text-muted-foreground me-auto text-xs">{hint}</span>}
          <Button size="sm" disabled={!valid || duplicate} onClick={add}>
            {t('mix.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
