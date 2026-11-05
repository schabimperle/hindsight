import { Alert, AlertDescription } from '@wealthfolio/ui';
import { CircleAlert } from 'lucide-react';
import type { WarningItem } from '../core/types';
import type { Fmt } from '../model/format';
import { messageText } from '../model/messages';
import { useTexts } from './i18n';

/** Bookings a message refers to (date · symbol · account). */
export function BookingList({ w, fmt }: { w: WarningItem; fmt: Fmt }) {
  if (!w.items || w.items.length === 0) return null;
  return (
    <ul className="mt-1 list-disc space-y-0.5 ps-4">
      {w.items.map((b, i) => (
        <li key={`${b.date}-${b.symbol}-${i}`} className="tabular-nums">
          {fmt.date(b.date)} · {b.symbol} · {b.account}
        </li>
      ))}
    </ul>
  );
}

/** Blocking error with its booking list. */
export function Notice({ w, fmt }: { w: WarningItem; fmt: Fmt }) {
  const { t } = useTexts();
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>
        <span>{messageText(t, fmt, w)}</span>
        <BookingList w={w} fmt={fmt} />
      </AlertDescription>
    </Alert>
  );
}
