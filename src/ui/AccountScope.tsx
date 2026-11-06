import type { Account } from '@wealthfolio/addon-sdk';
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
import { Check, ChevronsUpDown, CreditCard, ListFilter, TriangleAlert, Wallet } from 'lucide-react';
import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react';
import { accountSupported, unavailableSelection } from '../sources/portfolio';
import { useTexts } from './i18n';

/** null = all investment accounts (the default selection: eligible, active, not of type cash). */
export type Scope = string[] | null;

/** Toggles one account; an empty selection falls back to all accounts (as in the host). */
export function toggleScope(value: Scope, id: string): Scope {
  if (value === null) return [id];
  const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
  return next.length === 0 ? null : next;
}

type TriggerProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'value'> & {
  label: string;
  filtered: boolean;
  compact: boolean;
  open: boolean;
};

/** Trigger as the host's account scope selector: labelled pill on wide screens, filter icon with dot on phones. */
const Trigger = forwardRef<HTMLButtonElement, TriggerProps>(function Trigger({ label, filtered, compact, open, className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant={compact ? 'secondary' : 'outline'}
      role="combobox"
      aria-expanded={open}
      size={compact ? 'sm' : 'default'}
      className={cn(
        'flex items-center gap-2 font-medium',
        compact
          ? 'h-9 w-9 justify-center rounded-full p-0'
          : 'bg-secondary/30 hover:bg-muted/80 h-10 min-w-55 justify-between rounded-full border-none px-4 text-sm',
        className,
      )}
      {...props}
    >
      {compact ? (
        <span className="relative" aria-hidden="true">
          <ListFilter className="h-4 w-4" />
          {filtered && <span className="bg-primary absolute -start-[1.5px] -top-1 h-2 w-2 rounded-full" />}
        </span>
      ) : (
        <>
          {filtered ? <CreditCard className="h-4 w-4 shrink-0 opacity-70" /> : <Wallet className="h-4 w-4 shrink-0 opacity-70" />}
          <span className="min-w-0 flex-1 truncate text-start">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </>
      )}
    </Button>
  );
});

function ScopeCommand({
  accounts,
  unavailable,
  value,
  onAll,
  onToggle,
  mobile,
}: {
  accounts: Account[];
  /** Selected but not analysable (archived, unsupported type, deleted): listed so they can be removed. */
  unavailable: { id: string; name: string | null }[];
  value: Scope;
  onAll: () => void;
  onToggle: (id: string) => void;
  mobile: boolean;
}) {
  const { t } = useTexts();
  const item = mobile ? 'min-h-12 rounded-xl px-3 py-3 text-base' : 'py-2';
  const group = mobile
    ? '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider'
    : undefined;
  return (
    <Command className={mobile ? 'h-[calc(80vh-4.5rem)] rounded-none' : undefined}>
      <CommandInput placeholder={t('scope.search')} />
      <CommandList className={mobile ? 'max-h-none min-h-0 flex-1 px-2 py-2' : undefined}>
        <CommandEmpty>{t('scope.noResults')}</CommandEmpty>
        <CommandGroup className={group}>
          <CommandItem className={item} onSelect={onAll}>
            <Wallet className="me-1 h-4 w-4" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{t('scope.all')}</span>
              <span className="text-muted-foreground truncate text-xs">{t('scope.allHint')}</span>
            </span>
            <Check className={cn('ms-auto h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
          </CommandItem>
        </CommandGroup>
        {unavailable.length > 0 && (
          <CommandGroup heading={t('scope.unavailable')} className={group}>
            {unavailable.map((u) => (
              <CommandItem key={u.id} value={u.id} keywords={[u.name ?? '']} className={item} onSelect={() => onToggle(u.id)}>
                <TriangleAlert className="text-warning me-1 h-4 w-4" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{u.name ?? t('scope.deleted')}</span>
                  <span className="text-muted-foreground truncate text-xs">{t('scope.unavailableHint')}</span>
                </span>
                <Check className="ms-auto h-4 w-4" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {accounts.length > 0 && (
          <CommandGroup heading={t('scope.accounts')} className={group}>
            {accounts.map((a) => (
              <CommandItem key={a.id} value={a.id} keywords={[a.name, a.currency]} className={item} onSelect={() => onToggle(a.id)}>
                <CreditCard className="me-1 h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs">({a.currency})</span>
                <Check className={cn('ms-auto h-4 w-4', value?.includes(a.id) ? 'opacity-100' : 'opacity-0')} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/** Account scope like the host's Insights > Performance page: popover on wide screens, bottom sheet on phones;
 * accounts toggle without closing, "All accounts" closes. */
export function AccountScope({
  accounts,
  value,
  onChange,
  disabled = false,
}: {
  accounts: Account[];
  value: Scope;
  onChange: (v: Scope) => void;
  disabled?: boolean;
}) {
  const { t } = useTexts();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Only accounts the host's Performance page would accept are offered; stale selections stay visible as such.
  const listed = accounts.filter(accountSupported);
  const unavailable = unavailableSelection(accounts, value);
  const label =
    value === null
      ? t('scope.all')
      : value.length === 1
        ? (accounts.find((a) => a.id === value[0])?.name ?? t('scope.count', { count: 1 }))
        : t('scope.count', { count: value.length });
  const trigger = (
    <Trigger
      label={label}
      filtered={value !== null}
      compact={isMobile}
      open={open}
      disabled={disabled}
      aria-label={`${t('scope.title')}: ${label}`}
    />
  );
  const command = (
    <ScopeCommand
      accounts={listed}
      unavailable={unavailable}
      value={value}
      mobile={isMobile}
      onAll={() => {
        onChange(null);
        setOpen(false);
      }}
      onToggle={(id) => onChange(toggleScope(value, id))}
    />
  );
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={trigger} />
        <SheetContent side="bottom" className="mx-1 h-[80vh] rounded-t-4xl p-0">
          <SheetHeader className="border-border border-b px-6 py-4">
            <SheetTitle>{t('scope.title')}</SheetTitle>
          </SheetHeader>
          {command}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
        {command}
      </PopoverContent>
    </Popover>
  );
}
