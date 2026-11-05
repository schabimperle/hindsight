import { cn } from '@wealthfolio/ui';

/** Pill switch as in the host's Top Movers card. Shared by view and chart scale. */
export function PillSwitch<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; describedBy?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="bg-muted/50 flex shrink-0 rounded-full p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          aria-describedby={option.describedBy}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
