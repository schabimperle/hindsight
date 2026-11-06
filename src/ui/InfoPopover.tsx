import { Button, CardTitle, Popover, PopoverContent, PopoverTrigger, cn } from '@wealthfolio/ui';
import { Info } from 'lucide-react';
import type { Translate } from '../model/messages';
import { useTexts } from './i18n';

/**
 * Explanation behind a small info button, built exactly like the host's `HighlightTitle` popover
 * (Insights page): round ghost button, popover `w-64 text-xs` above the button.
 */
export function InfoPopover({ title, paragraphs, compact = false }: { title: string; paragraphs: string[]; compact?: boolean }) {
  const { t } = useTexts();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'shrink-0 rounded-full p-0',
              compact ? 'ms-1 h-4 w-4' : 'text-muted-foreground/60 hover:text-foreground pointer-coarse:size-11 h-6 w-6',
            )}
            aria-label={t('info.moreAbout', { label: title })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        }
      >
        <Info className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 text-xs" side="top" align="start">
        {paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Card title as on the host's Insights page: small muted capitals, explanation behind the info button. */
export function SectionTitle({ title, info }: { title: string; info?: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <CardTitle className="text-muted-foreground text-sm font-medium tracking-wider uppercase">{title}</CardTitle>
      {info && <InfoPopover title={title} paragraphs={info} />}
    </div>
  );
}

/** Explanation for a warning code (title and paragraphs); null if there is none. */
export function infoFor(t: Translate, code: string): { title: string; paragraphs: string[] } | null {
  if (code === 'withdrawal_uncovered') {
    return { title: t('info.shortfall.title'), paragraphs: [t('info.shortfall.p1')] };
  }
  if (code === 'late_start') return { title: t('info.lateStart.title'), paragraphs: [t('info.lateStart.p1')] };
  if (code === 'late_start_partial') return { title: t('info.lateStart.title'), paragraphs: [t('info.lateStart.partial')] };
  return null;
}
