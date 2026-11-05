import { useId } from 'react';
import type { ChartScale } from './logAxis';
import { useTexts } from './i18n';
import { PillSwitch } from './PillSwitch';

export function ChartScaleSwitch({ scale, onChange, available = true }: {
  scale: ChartScale;
  onChange: (scale: ChartScale) => void;
  available?: boolean;
}) {
  const { t } = useTexts();
  const reasonId = useId();
  return (
    <div className="flex flex-col items-end gap-1">
      <PillSwitch
        label={t('chart.scale')}
        value={scale}
        onChange={onChange}
        options={[
          { value: 'linear', label: t('chart.linear') },
          { value: 'log', label: t('chart.log'), disabled: !available, describedBy: !available ? reasonId : undefined },
        ]}
      />
      {!available && <p id={reasonId} className="text-muted-foreground max-w-sm text-end text-xs">{t('chart.logUnavailable')}</p>}
    </div>
  );
}
