/**
 * The reader's saved questions, backed by `/api/saved-queries`.
 *
 * A saved query is the QUESTION and nothing it produced (see the migration in
 * `server/lib/migrations.ts`): clicking one re-asks it through the same ask path
 * a typed question takes. The list is scoped server-side to the signed-in
 * address, so this hook holds only the reader's own.
 *
 * Reads degrade to an empty list rather than an error, matching the rest of the
 * Ask page: a rail that cannot reach the store shows nothing saved rather than a
 * failure panel over a convenience feature. Writes report success so the caller
 * can tell a saved question from one that did not land.
 */
import { useCallback, useEffect, useState } from 'react';

export interface SavedQuery {
  id: string;
  question: string;
  /** ISO instant the row was written; absent only on a drifted payload. */
  created_at?: string;
}

export interface SavedQueriesState {
  queries: SavedQuery[];
  loading: boolean;
  saving: boolean;
  /** Keeps the question if it is new; a no-op that resolves true when it is already saved. */
  save: (question: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
}

export function useSavedQueries(): SavedQueriesState {
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch('/api/saved-queries')
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : []))
      .then((rows) => {
        if (live) setQueries(Array.isArray(rows) ? (rows as SavedQuery[]) : []);
      })
      .catch(() => {
        if (live) setQueries([]);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return false;
      // A question already kept is not saved twice: the rail would otherwise
      // grow a duplicate row every time the reader pressed Save on the same
      // prompt. Compared case-insensitively, because two spellings of one
      // question are one question to a reader scanning the list.
      if (queries.some((entry) => entry.question.trim().toLowerCase() === trimmed.toLowerCase())) {
        return true;
      }
      setSaving(true);
      try {
        const response = await fetch('/api/saved-queries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        });
        if (!response.ok) return false;
        const row = (await response.json()) as SavedQuery;
        if (!row?.id) return false;
        setQueries((current) => [row, ...current.filter((entry) => entry.id !== row.id)]);
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [queries]
  );

  const remove = useCallback(async (id: string) => {
    // Optimistic: the row goes on the click, and a 404 (already gone) is left
    // removed. Only a store outage puts it back, because then it truly is still
    // there and the reader should see it to try again.
    let removed: SavedQuery | undefined;
    setQueries((current) => {
      removed = current.find((entry) => entry.id === id);
      return current.filter((entry) => entry.id !== id);
    });
    try {
      const response = await fetch(`/api/saved-queries/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404 && removed) {
        const restored = removed;
        setQueries((current) => (current.some((entry) => entry.id === id) ? current : [restored, ...current]));
      }
    } catch {
      if (removed) {
        const restored = removed;
        setQueries((current) => (current.some((entry) => entry.id === id) ? current : [restored, ...current]));
      }
    }
  }, []);

  return { queries, loading, saving, save, remove };
}
