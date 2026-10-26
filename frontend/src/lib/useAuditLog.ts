import { useEffect, useState } from "react";
import { api, failureReason } from "../api/client";
import { useStore } from "../state/useStore";
import type { AuditLogEntry, AuditLogQuery } from "../types";
import { matchesAuditQuery } from "./auditFilter";

interface AuditLogView {
  entries: AuditLogEntry[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
}

/** What the server returned for one query (`key`); a different key means it is still loading. */
interface Loaded {
  key: string;
  entries: AuditLogEntry[];
  cursor?: string;
  error: string | null;
}

/**
 * The audit log filtered by `query`, newest first. With the API it is fetched from the server page by page and
 * reloaded whenever the store's latest entries change (after every change); in demo mode it filters the local entries.
 */
export function useAuditLog(query: Omit<AuditLogQuery, "before">): AuditLogView {
  const { demo, auditLog } = useStore();
  const key = JSON.stringify(query);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    api
      .listAuditLog(JSON.parse(key) as AuditLogQuery)
      .then((page) => !cancelled && setLoaded({ key, entries: page.entries, cursor: page.nextCursor, error: null }))
      .catch((err: unknown) => !cancelled && setLoaded({ key, entries: [], error: failureReason(err) }));
    return () => {
      cancelled = true;
    };
  }, [demo, key, auditLog]);

  if (demo) {
    const matching = auditLog.filter((e) => matchesAuditQuery(e, query));
    return { entries: query.limit ? matching.slice(0, query.limit) : matching, hasMore: false, loading: false, error: null, loadMore: () => {} };
  }

  const current = loaded?.key === key ? loaded : null;
  const loadMore = () => {
    if (!current?.cursor || loadingMore) return;
    setLoadingMore(true);
    api
      .listAuditLog({ ...query, before: current.cursor })
      .then((page) => setLoaded({ ...current, entries: [...current.entries, ...page.entries], cursor: page.nextCursor }))
      .catch((err: unknown) => setLoaded({ ...current, error: failureReason(err) }))
      .finally(() => setLoadingMore(false));
  };

  return {
    entries: current?.entries ?? [],
    hasMore: current?.cursor !== undefined,
    loading: !current || loadingMore,
    error: current?.error ?? null,
    loadMore,
  };
}
