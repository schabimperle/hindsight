import type { AddonContext } from '@wealthfolio/addon-sdk';
import { createContext, useContext } from 'react';

export const AddonCtx = createContext<AddonContext | null>(null);

export function useAddon(): AddonContext {
  const ctx = useContext(AddonCtx);
  if (!ctx) throw new Error('AddonContext missing');
  return ctx;
}
