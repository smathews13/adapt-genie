import { Box, TableProperties } from 'lucide-react';

import { BrandIcon } from './BrandIcon';
import { healthResourceIconSpec } from './health-resource-icon';

/** Decorative row icon; the adjacent resource label remains the accessible name. */
export function HealthResourceIcon({ kind, className = '' }: { kind: string; className?: string }) {
  const icon = healthResourceIconSpec(kind);
  const classes = ['ops-dependency-mark', className].filter(Boolean).join(' ');
  if (icon.type === 'brand') {
    return <BrandIcon product={icon.product} size={16} className={classes} />;
  }
  const Icon = icon.type === 'table' ? TableProperties : Box;
  return <Icon size={16} className={`${classes} ops-dependency-mark-generic`} aria-hidden="true" />;
}
