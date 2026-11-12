import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  cn,
  useIsMobile,
} from '@wealthfolio/ui';
import { Layers, Plus, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_BENCHMARKS, type BenchmarkDef } from '../model/settings';
import { useTexts } from './i18n';
import { MixDialog } from './MixDialog';
import { COMPACT_ICON_BUTTON } from './styles';
import { useTickerSearch } from './useTickerSearch';

const STICKY_HEADING =
  '[&_[cmdk-group-heading]]:bg-popover [&_[cmdk-group-heading]]:border-border/10 [&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:border-b';

/** Plain ticker as typed (letters, digits and . - ^ =), offered when the search has no exact hit. */
const TICKER_RE = /^[A-Za-z0-9^][A-Za-z0-9.\-=^]{0,19}$/;

const sameAsset = (a: BenchmarkDef, b: BenchmarkDef): boolean =>
  a.kind === b.kind && (a.kind === 'cash' || a.ticker.toUpperCase() === b.ticker.toUpperCase());

/** Search list of the picker. `onMix` adds the "Create a mix…" entry; `assetsOnly` (mix components) hides cash. */
export function PickerCommand({
  existing,
  onPick,
  mobile,
  onMix,
  assetsOnly = false,
}: {
  existing: BenchmarkDef[];
  onPick: (b: BenchmarkDef) => void;
  mobile: boolean;
  onMix?: () => void;
  assetsOnly?: boolean;
}) {
  const { t } = useTexts();
  const [query, setQuery] = useState('');
  const search = useTickerSearch(query);
  const q = query.trim();
  const has = (b: BenchmarkDef): boolean => existing.some((e) => sameAsset(e, b));
  const matches = (text: string): boolean => q === '' || text.toLowerCase().includes(q.toLowerCase());
  const cash: BenchmarkDef = { name: '', ticker: '', kind: 'cash' };
  const suggestions = [
    ...(assetsOnly || has(cash) || !matches(t('table.notInvested')) ? [] : [cash]),
    ...DEFAULT_BENCHMARKS.filter((b) => b.kind === 'asset' && !has(b) && matches(`${b.name} ${b.ticker}`)),
  ];
  const suggested = new Set(suggestions.map((b) => b.ticker.toUpperCase()));
  const hits =
    q.length >= 2
      ? search.hits
          .filter((h) => !has({ name: h.name, ticker: h.ticker, kind: 'asset' }) && !suggested.has(h.ticker.toUpperCase()))
          .slice(0, 12)
      : [];
  const exact =
    search.hits.some((h) => h.ticker.toUpperCase() === q.toUpperCase()) || existing.some((e) => e.ticker.toUpperCase() === q.toUpperCase());
  const manual = TICKER_RE.test(q) && !exact && search.status !== 'loading';
  const item = mobile ? 'min-h-12 rounded-xl px-3 py-3' : undefined;
  return (
    <Command shouldFilter={false} className={mobile ? 'h-[calc(80vh-4.5rem)] rounded-none' : undefined}>
      <CommandInput placeholder={t('picker.placeholder')} value={query} onValueChange={setQuery} />
      <CommandList className={mobile ? 'max-h-none min-h-0 flex-1 px-2 py-2' : 'max-h-75 overflow-y-auto'}>
        <CommandEmpty>{search.status === 'loading' ? t('picker.searching') : t('picker.noResults')}</CommandEmpty>
        {suggestions.length > 0 && (
          <CommandGroup heading={t('picker.suggestions')} className={STICKY_HEADING}>
            {suggestions.map((b) => (
              <CommandItem key={`${b.kind}:${b.ticker}`} value={`s:${b.kind}:${b.ticker}`} className={item} onSelect={() => onPick(b)}>
                <div className="flex min-w-0 flex-col">
                  <div className="flex items-center">
                    <span className="truncate font-medium">{b.kind === 'cash' ? t('table.notInvested') : b.name}</span>
                    {b.ticker && <span className="text-muted-foreground ms-2 text-xs">{b.ticker}</span>}
                  </div>
                  {b.kind === 'cash' && <span className="text-muted-foreground text-xs">{t('picker.cashInfo')}</span>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {hits.length > 0 && (
          <CommandGroup heading={t('picker.results')} className={STICKY_HEADING}>
            {hits.map((h) => (
              <CommandItem
                key={h.ticker}
                value={`h:${h.ticker}`}
                className={item}
                onSelect={() => onPick({ name: h.name, ticker: h.ticker, kind: 'asset' })}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center">
                    <span className="truncate font-medium">{h.name}</span>
                    <span className="text-muted-foreground ms-2 shrink-0 text-xs">{h.ticker}</span>
                  </div>
                  <span className="text-muted-foreground truncate text-xs">
                    {[h.exchange, h.type, h.currency].filter((x) => x !== '').join(' · ')}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {onMix && q === '' && (
          <CommandGroup heading={t('mix.group')} className={STICKY_HEADING}>
            <CommandItem value="mix:new" className={item} onSelect={onMix}>
              <Layers className="me-1 h-4 w-4" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{t('mix.create')}</span>
                <span className="text-muted-foreground text-xs">{t('mix.createInfo')}</span>
              </div>
            </CommandItem>
          </CommandGroup>
        )}
        {search.status === 'error' && <p className="text-destructive px-3 py-2 text-xs">{t('picker.searchFailed')}</p>}
        {manual && (
          <CommandGroup heading={t('picker.manual')} className={STICKY_HEADING}>
            <CommandItem
              value={`m:${q}`}
              className={item}
              onSelect={() => onPick({ name: q.toUpperCase(), ticker: q.toUpperCase(), kind: 'asset' })}
            >
              <Plus className="me-1 h-4 w-4" />
              <span className="truncate">{t('picker.useTicker', { ticker: q.toUpperCase() })}</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/** "Add benchmark" like the host's Insights > Performance page: dashed button with a search popover on wide
 * screens, a plus button with a bottom sheet on phones. */
export function BenchmarkPicker({ existing, onAdd }: { existing: BenchmarkDef[]; onAdd: (b: BenchmarkDef) => void }) {
  const { t } = useTexts();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [mixOpen, setMixOpen] = useState(false);
  const pick = (b: BenchmarkDef): void => {
    onAdd(b);
    setOpen(false);
  };
  const startMix = (): void => {
    setOpen(false);
    setMixOpen(true);
  };
  const mixDialog = <MixDialog open={mixOpen} onOpenChange={setMixOpen} existing={existing} onAdd={onAdd} />;
  if (isMobile) {
    return (
      <>
      {mixDialog}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className={`hindsight-row-icon hindsight-add-benchmark bg-secondary/30 hover:bg-muted/80 flex-shrink-0 rounded-md border-none ${COMPACT_ICON_BUTTON}`}
              aria-label={t('picker.add')}
            />
          }
        >
          <Plus className="h-4 w-4" />
        </SheetTrigger>
        <SheetContent side="bottom" className="mx-1 h-[80vh] rounded-t-4xl p-0">
          <SheetHeader className="border-border border-b px-6 py-4">
            <SheetTitle>{t('picker.add')}</SheetTitle>
          </SheetHeader>
          {open && <PickerCommand existing={existing} onPick={pick} mobile onMix={startMix} />}
        </SheetContent>
      </Sheet>
      </>
    );
  }
  return (
    <>
    {mixDialog}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            size="sm"
            className={cn(
              'hindsight-row-button hindsight-add-benchmark bg-secondary/30 hover:bg-muted/80 flex items-center gap-1.5 rounded-md border-dashed px-3 py-1 text-sm font-medium',
            )}
          />
        }
      >
        <TrendingUp className="h-4 w-4" />
        {t('picker.add')}
      </PopoverTrigger>
      <PopoverContent className="w-87.5 p-0" align="start">
        {open && <PickerCommand existing={existing} onPick={pick} mobile={false} onMix={startMix} />}
      </PopoverContent>
    </Popover>
    </>
  );
}
