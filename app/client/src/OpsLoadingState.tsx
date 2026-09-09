import { AdaptLoader } from './AdaptLoadingAnimation';

export function OpsLoadingState({ label }: { label: string }) {
  return (
    <div className="ops-loading-state">
      <AdaptLoader variant="panel" label={label} />
    </div>
  );
}
