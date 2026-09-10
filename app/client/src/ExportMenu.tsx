import { useId, useState } from 'react';
import { Check, Download, Ellipsis, LoaderCircle } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from './ui';

export interface ExportAction {
  label: string;
  run: () => Promise<void> | void;
}

const loadExportActions = () => import('./export-actions');

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
  const [notice, setNotice] = useState('');

  const invoke = async (action: ExportAction) => {
    setRunning(action.label);
    setNotice('');
    try {
      await action.run();
      setNotice(`${action.label} complete`);
      setOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${action.label} failed`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="export-menu">
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
          {actions.map((action) => (
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
              ) : notice === `${action.label} complete` ? (
                <Check aria-hidden="true" />
              ) : null}
              {action.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <span className="sr-only" role={notice.toLowerCase().includes('fail') ? 'alert' : 'status'} aria-live="polite">
        {notice}
      </span>
    </div>
  );
}

export function ConversationExportMenu({ conversationId, title }: { conversationId: string; title: string }) {
  return (
    <ExportMenu
      label="Export whole conversation"
      actions={[
        {
          label: 'Copy Markdown',
          run: async () => (await loadExportActions()).copyConversationExport(conversationId, title),
        },
        {
          label: 'Download Markdown',
          run: async () => (await loadExportActions()).downloadConversationMarkdown(conversationId, title),
        },
        {
          label: 'Download PDF',
          run: async () => (await loadExportActions()).downloadConversationPdf(conversationId, title),
        },
      ]}
    />
  );
}
