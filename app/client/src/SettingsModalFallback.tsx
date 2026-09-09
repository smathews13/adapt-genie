import { AdaptLoader } from './AdaptLoadingAnimation';

/** Settings-shaped fallback that leaves app readiness ownership in Layout. */
export function SettingsModalFallback() {
  return (
    <div
      className="settings-overlay fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"
      data-testid="settings-loading"
    >
      <section
        className="settings-modal settings-page settings-loading-seat h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] rounded-lg border bg-background"
        aria-busy="true"
        aria-label="Loading settings"
      >
        <AdaptLoader variant="panel" label="Loading settings" announce={false} />
      </section>
    </div>
  );
}
