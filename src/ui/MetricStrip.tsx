import { Button, Carousel, CarouselContent, CarouselItem, Popover, PopoverContent, PopoverTrigger, cn } from '@wealthfolio/ui';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTexts } from './i18n';
import { InfoPopover } from './InfoPopover';

export interface Metric {
  key: string;
  label: string;
  /** Label of the phone tile, where the section title is not shown (default: `label`). */
  mobileLabel?: string;
  /** Explanation behind the info buttons; only for figures that are not self-explanatory. */
  info?: string;
  value: ReactNode;
  detail?: string;
}

export interface MetricSection {
  key: string;
  title: string;
  metrics: Metric[];
}

// Classes of the host's Performance strip (performance-page.tsx).
const SECTION = 'border-border/70 flex min-h-[4.75rem] min-w-0 flex-col justify-center border-s ps-5';
const TITLE = 'text-muted-foreground/70 mb-2.5 font-mono text-2xs font-semibold uppercase tracking-[0.28em]';
const LABEL = 'text-muted-foreground truncate font-mono text-2xs font-medium tracking-[0.02em]';
export const STRIP_VALUE = 'font-mono text-lg font-semibold leading-none';

/** All explanations in one popover at the strip's corner, as the host's metric help. */
function HelpPopover({ sections }: { sections: MetricSection[] }) {
  const { t } = useTexts();
  const items = sections.flatMap((s) =>
    s.metrics.flatMap((m) => (m.info ? [{ key: `${s.key}.${m.key}`, label: m.label, info: m.info }] : [])),
  );
  if (items.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground absolute end-0 top-0 h-6 w-6 rounded-full"
            aria-label={t('strip.helpTitle')}
          />
        }
      >
        <Info className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] space-y-2 text-xs" side="bottom" align="end">
        {items.map((i) => (
          <p key={i.key}>
            <span className="font-semibold">{i.label}</span> <span className="text-muted-foreground">{i.info}</span>
          </p>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Desktop: sections side by side with the host's mono labels; phones: a carousel of small tiles with an info
 * button per label (as the host's mobile metrics). Tiles stretch to the row (`h-full`); reserving label space or
 * using the 44 px info button inflates the strip. */
export function MetricStrip({ sections, mobile }: { sections: MetricSection[]; mobile: boolean }) {
  if (mobile) {
    return (
      <Carousel opts={{ align: 'start', loop: false }} className="w-full touch-pan-x overscroll-x-contain" data-no-swipe-drag>
        <CarouselContent className="-ms-2">
          {sections.flatMap((s) =>
            s.metrics.map((m) => (
              <CarouselItem key={`${s.key}.${m.key}`} className="basis-[42%] ps-2">
                <div className="bg-muted/30 flex h-full flex-col gap-1 rounded-lg px-3 py-2">
                  <div className="text-muted-foreground flex items-center text-xs font-light">
                    <span>{m.mobileLabel ?? m.label}</span>
                    {m.info && <InfoPopover title={m.mobileLabel ?? m.label} paragraphs={[m.info]} compact />}
                  </div>
                  <div className="text-base font-semibold">{m.value}</div>
                  {m.detail && <div className="text-muted-foreground text-xs">{m.detail}</div>}
                </div>
              </CarouselItem>
            )),
          )}
        </CarouselContent>
      </Carousel>
    );
  }
  return (
    <div className="relative w-full overflow-x-auto pe-8 pb-1 2xl:w-auto 2xl:overflow-visible">
      <HelpPopover sections={sections} />
      <div className="flex min-w-max items-stretch justify-start 2xl:justify-end">
        {sections.map((s) => (
          <section key={s.key} className={SECTION}>
            <div className={TITLE}>{s.title}</div>
            <div className={cn('grid gap-5')} style={{ gridTemplateColumns: `repeat(${s.metrics.length}, minmax(7.5rem, auto))` }}>
              {s.metrics.map((m) => (
                <div key={m.key} className="flex min-w-0 flex-col items-start gap-2 pe-2">
                  <span className={LABEL}>{m.label}</span>
                  <span className={STRIP_VALUE}>{m.value}</span>
                  <span className="text-muted-foreground text-xs" style={{ minHeight: 16 }}>{m.detail}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
