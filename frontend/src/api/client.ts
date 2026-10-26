/**
 * Typed client for the flag-status service (FR-006/007/008, FR-011, FR-014).
 *
 * Every call attempts the real NestJS endpoint first (served under /api) and falls back
 * to local fixture data on any network/HTTP failure, so the UI still works as a demo
 * when the backend is not running.
 */
import { auditLog as mockAuditLog, flags as mockFlags, services as mockServices } from "../data/mock";
import type { AuditLogEntry, Environment, Flag, NotificationSettings, Service } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const REQUEST_TIMEOUT_MS = 2000;

let warnedOffline = false;

async function request<T>(path: string, init: RequestInit, fallback: () => T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (err) {
    if (!warnedOffline) {
      warnedOffline = true;
      console.info(
        `[shipscope] "${path}" isn't served by the backend yet (${(err as Error).message}); using fixture data. This message logs once per session.`,
      );
    }
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  listFlags: () => request<Flag[]>("/flags", { method: "GET" }, () => mockFlags),

  listServices: () => request<Service[]>("/services", { method: "GET" }, () => mockServices),

  listAuditLog: () => request<AuditLogEntry[]>("/audit-log", { method: "GET" }, () => mockAuditLog),

  getNotifications: () => request<NotificationSettings>("/settings/notifications", { method: "GET" }, () => ({ enabled: false, webhookUrl: "" })),

  saveNotifications: (settings: NotificationSettings) =>
    request<NotificationSettings>(
      "/settings/notifications",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) },
      () => settings,
    ),

  testNotification: () =>
    request<{ ok: boolean; error?: string }>("/settings/notifications/test", { method: "POST" }, () => ({
      ok: false,
      error: "The API is not running (demo data).",
    })),

  setEnvironmentState: (flagKey: string, environment: Environment, enabled: boolean, actor: string) =>
    request<{ ok: true }>(
      `/flags/${flagKey}/environments/${environment}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, actor }) },
      () => ({ ok: true as const }),
    ),
};
