import { Badge, Button, Carousel, CarouselContent, CarouselItem, Separator, cn } from '@wealthfolio/ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTexts } from './i18n';
import { COMPACT_ICON_BUTTON } from './styles';

export interface BadgeItem {
  key: string;
  label: string;
  /** Line colour; null = not plotted (uncomputable). */
  color: string | null;
  /** Title of the badge: why it is not plotted, or a mix's composition. */
  reason?: string;
  removable: boolean;
}

/** Selected item badge exactly as on the host's Performance page: colour bar, name, remove button; the selected
 * one is tinted, an item without a line is dashed and marked "not plotted". */
function ItemBadge({
  item,
  selected,
  onSelect,
  onRemove,
}: {
  item: BadgeItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { t } = useTexts();
  const plotted = item.color !== null;
  return (
    <Badge
      variant="secondary"
      style={{ minHeight: 34 }}
      title={item.reason}
      className={cn(
        // The host does not compile addon-only Tailwind utilities.
        'text-foreground group relative cursor-pointer rounded-md border px-2.5 py-1.5 shadow-sm transition-all sm:px-3',
        'hover:bg-accent/80 hover:shadow-md',
        'has-[[data-badge-select]:focus-visible]:ring-ring has-[[data-badge-select]:focus-visible]:ring-2 has-[[data-badge-select]:focus-visible]:ring-offset-2',
        !plotted && 'text-muted-foreground bg-muted/30 hover:bg-muted/50 border-dashed shadow-none hover:shadow-sm',
        selected && 'bg-warning-subtle hover:bg-warning-subtle/70',
      )}
    >
      <button
        type="button"
        data-badge-select=""
        onClick={onSelect}
        aria-pressed={selected}
        className="flex cursor-pointer items-center space-x-2 outline-none after:absolute after:inset-0 after:content-[''] sm:space-x-3"
      >
        <div
          className={cn('h-3 w-1 rounded-full sm:h-4', plotted ? 'transition-opacity group-hover:opacity-80' : 'bg-muted-foreground/35')}
          style={plotted ? { backgroundColor: item.color ?? undefined } : undefined}
        />
        <span className="group-hover:text-foreground max-w-40 truncate text-xs font-medium transition-colors sm:text-sm">{item.label}</span>
        {!plotted && (
          <span className="bg-background/70 text-muted-foreground text-2xs rounded px-1.5 py-0.5 font-medium">
            {t('badges.notPlotted')}
          </span>
        )}
      </button>
      {item.removable && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            'relative ms-2 transition-all duration-150',
            COMPACT_ICON_BUTTON,
            'hover:bg-destructive-subtle hover:text-destructive-subtle-foreground hover:scale-110',
            'focus-visible:ring-destructive/50 focus-visible:ring-2',
          )}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t('badges.remove', { name: item.label })}
        >
          <X className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        </Button>
      )}
    </Badge>
  );
}

/** Row of badges plus the add control: carousel with separator on wide screens, carousel and plus button on phones. */
export function BadgeRow({
  items,
  selected,
  onSelect,
  onRemove,
  add,
}: {
  items: BadgeItem[];
  selected: string;
  onSelect: (key: string) => void;
  onRemove: (key: string) => void;
  add: ReactNode;
}) {
  const badges = (
    <CarouselContent className="-ms-2">
      {items.map((item) => (
        <CarouselItem key={item.key} className="basis-auto ps-2">
          <ItemBadge item={item} selected={selected === item.key} onSelect={() => onSelect(item.key)} onRemove={() => onRemove(item.key)} />
        </CarouselItem>
      ))}
    </CarouselContent>
  );
  return (
    <>
      <div className="flex items-center gap-2 md:hidden">
        <Carousel opts={{ align: 'start', loop: false }} className="min-w-0 flex-1 touch-pan-x overscroll-x-contain" data-no-swipe-drag>
          {badges}
        </Carousel>
        {add}
      </div>
      <div className="hidden md:flex md:flex-row md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Carousel opts={{ align: 'start', loop: false }} className="w-full max-w-[calc(100vw-24rem)] md:max-w-[calc(100vw-28rem)]">
            {badges}
          </Carousel>
          <Separator orientation="vertical" className="h-6 flex-shrink-0" />
        </div>
        <div className="ms-3 flex flex-shrink-0 items-center gap-2">{add}</div>
      </div>
    </>
  );
}
