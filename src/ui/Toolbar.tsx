import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useIsMobile,
} from '@wealthfolio/ui';
import { Info, TriangleAlert } from 'lucide-react';
import type { WarningItem } from '../core/types';
import type { Fmt } from '../model/format';
import { messageText } from '../model/messages';
import { BookingList } from './Notice';
import { GUIDE_COUNTS, useTexts } from './i18n';
import { DIALOG } from './styles';

/** Small round icon button next to the card title, as the host's metric help button. */
const ICON_BUTTON = 'text-muted-foreground hover:text-foreground h-7 w-7 shrink-0 rounded-full';
const EYEBROW = 'text-muted-foreground text-2xs font-semibold tracking-wider uppercase';

/** Non-blocking hints about the whole analysis; the button only exists when there are any. */
export function WarningsButton({ warnings, fmt }: { warnings: WarningItem[]; fmt: Fmt }) {
  const { t } = useTexts();
  if (warnings.length === 0) return null;
  const label = t('app.warnings', { count: warnings.length });
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-warning hover:text-warning h-7 shrink-0 gap-1 rounded-full px-2 tabular-nums"
            aria-label={label}
          />
        }
      >
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
        {warnings.length}
      </PopoverTrigger>
      <PopoverContent className="max-h-[60vh] w-80 space-y-3 overflow-y-auto text-xs" align="start">
        <div className={EYEBROW}>{label}</div>
        <ul className="space-y-2.5">
          {warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="flex items-start gap-2">
              <TriangleAlert className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                {messageText(t, fmt, w)}
                <BookingList w={w} fmt={fmt} />
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** What Hindsight answers, what each figure shows and every assumption behind it. */
export function HowItWorks() {
  const { t } = useTexts();
  const list = (part: keyof typeof GUIDE_COUNTS): string[] =>
    Array.from({ length: GUIDE_COUNTS[part] }, (_, i) => t(`guide.${part}${i + 1}`));
  return (
    <Dialog useIsMobile={useIsMobile}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className={ICON_BUTTON} aria-label={t('app.howItWorks')} />}>
        <Info className="h-3.5 w-3.5" aria-hidden />
      </DialogTrigger>
      <DialogContent {...DIALOG}>
        <DialogHeader className="text-start">
          <DialogTitle>{t('app.howItWorks')}</DialogTitle>
          <DialogDescription className="text-start">{t('app.subtitle')}</DialogDescription>
        </DialogHeader>
        {(['shows', 'assumes'] as const).map((part) => (
          <section key={part} className="space-y-2 text-sm">
            <h3 className="font-medium">{t(`guide.${part}Title`)}</h3>
            <ul className="text-muted-foreground list-disc space-y-1.5 ps-4">
              {list(part).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
