import { useId, useState } from 'react';
import {
  Braces,
  Check,
  Code2,
  Copy,
  Download,
  Ellipsis,
  FileDown,
  FileImage,
  FileText,
  LoaderCircle,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from './ui';
import { exportCompleteMessage } from './export-labels';

export interface ExportAction {
  label: string;
  run: () => Promise<void> | void;
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  'Copy Markdown': Copy,
  'Copy TSV': Copy,
  'Download Markdown': FileDown,
  'Download HTML': Code2,
  'Download HTML for slides': Presentation,
  'Download JSON': Braces,
  'Download PDF': FileText,
  'Download PNG': FileImage,
};

export function ExportMenu({
  label,
  actions,
  compact = false,
}: {
  label: string;
  actions: readonly ExportAction[];
  compact?: boolean;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const invoke = async (action: ExportAction) => {
    setRunning(action.label);
    setNotice(null);
    try {
      await action.run();
      setNotice({ tone: 'success', message: exportCompleteMessage(action.label) });
      setOpen(false);
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : `${action.label} failed` });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="export-menu">
      {notice ? (
        <span
          className={`export-menu-notice export-menu-notice--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {notice.tone === 'success' ? <Check aria-hidden="true" /> : null}
          {notice.message}
        </span>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={compact ? 'export-menu-trigger is-compact' : 'export-menu-trigger'}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            title={label}
          >
            {compact ? <Ellipsis aria-hidden="true" /> : <Download aria-hidden="true" />}
            <span>{compact ? <span className="sr-only">{label}</span> : label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent id={menuId} className="export-menu-content ast-surface-menu" align="end" role="menu">
          {actions.map((action) => {
            const ActionIcon = ACTION_ICONS[action.label] ?? Download;
            return (
              <button
                type="button"
                role="menuitem"
                className="export-menu-item"
                key={action.label}
                disabled={running !== null}
                onClick={() => void invoke(action)}
              >
                {running === action.label ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <ActionIcon aria-hidden="true" />
                )}
                {action.label}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
}
