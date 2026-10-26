import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useStore } from "../state/useStore";
import type { AuditLogEntry } from "../types";
import { AuditLogPage } from "./AuditLogPage";

vi.mock("../state/useStore", () => ({ useStore: vi.fn() }));
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { listAuditLog: vi.fn() } };
});

const entry = (id: string, flagKey: string, action: AuditLogEntry["action"] = "env-enabled"): AuditLogEntry => ({
  id,
  timestamp: "2026-10-26T10:00:00.000Z",
  actor: "m.chen",
  action,
  flagKey,
});

function renderWith(demo: boolean, auditLog: AuditLogEntry[] = []) {
  vi.mocked(useStore).mockReturnValue({ demo, auditLog } as unknown as ReturnType<typeof useStore>);
  render(<AuditLogPage />);
}

afterEach(cleanup);

describe("AuditLogPage with the API", () => {
  beforeEach(() => {
    vi.mocked(api.listAuditLog).mockImplementation(async (query = {}) =>
      query.before
        ? { entries: [entry("2", "older-flag")] }
        : { entries: [entry("1", query.action === "promotion-blocked" ? "blocked-flag" : "newest-flag")], nextCursor: "c1" },
    );
  });

  it("shows the first page and loads older entries on request", async () => {
    renderWith(false);

    await screen.findByText("newest-flag");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Load older entries" })));

    expect(api.listAuditLog).toHaveBeenLastCalledWith({ before: "c1" });
    await screen.findByText("older-flag");
    screen.getByText("newest-flag");
    expect(screen.queryByRole("button", { name: "Load older entries" })).toBeNull();
  });

  it("asks the server again when an action filter is chosen", async () => {
    renderWith(false);
    await screen.findByText("newest-flag");

    fireEvent.click(screen.getByRole("button", { name: "promotion blocked" }));

    await screen.findByText("blocked-flag");
    expect(api.listAuditLog).toHaveBeenLastCalledWith({ action: "promotion-blocked" });
  });
});

describe("AuditLogPage in demo mode", () => {
  it("filters the local entries without calling the API", async () => {
    renderWith(true, [entry("1", "kept", "promotion-blocked"), entry("2", "hidden")]);

    fireEvent.click(screen.getByRole("button", { name: "promotion blocked" }));

    await waitFor(() => expect(screen.queryByText("hidden")).toBeNull());
    screen.getByText("kept");
    expect(api.listAuditLog).not.toHaveBeenCalled();
  });
});
