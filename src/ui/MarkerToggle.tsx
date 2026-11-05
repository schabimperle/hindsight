import { Button, Icons, Tooltip, TooltipContent, TooltipTrigger, cn } from '@wealthfolio/ui';
import { useTexts } from './i18n';

/** Account detail chart's marker control (account-page.tsx, Wealthfolio 3.12). */
export function MarkerToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  const { t } = useTexts();
  const label = enabled ? t('chart.hideMarkers') : t('chart.showMarkers');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={enabled ? 'default' : 'secondary'}
            size="icon-xs"
            className={cn('rounded-full', !enabled && 'bg-secondary/50')}
            onClick={onToggle}
            aria-label={label}
            aria-pressed={enabled}
          />
        }
      >
        <Icons.History className="size-5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}
