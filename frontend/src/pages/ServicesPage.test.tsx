import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../state/store";
import { makeBinding, makeFlag, makeService } from "../test/factories";
import type { Role } from "../types";
import { ServicesPage } from "./ServicesPage";

vi.mock("../state/store", () => ({ useStore: vi.fn() }));

const rotateCredential = vi.fn();
const registerService = vi.fn();

function renderAs(role: Role) {
  vi.mocked(useStore).mockReturnValue({
    role,
    services: [makeService("svc-api", "orders-api"), { ...makeService("svc-new", "billing-api"), hasCredential: false, lastCheckInAt: undefined }],
    flags: [makeFlag({ key: "backend", services: [makeBinding("svc-api")] })],
    registerService,
    rotateCredential,
  } as unknown as ReturnType<typeof useStore>);
  render(<ServicesPage />);
}

/** Clicks and lets the async handler settle. */
const click = (el: HTMLElement) => act(async () => void fireEvent.click(el));

afterEach(cleanup);

beforeEach(() => {
  rotateCredential.mockResolvedValue({ ok: true, token: "ssf_shown_once" });
  registerService.mockResolvedValue({ ok: false, reason: 'A service with the key "orders-api" already exists.' });
});

describe("ServicesPage", () => {
  it("shows each service's credential state and check-in, read-only for an Editor", () => {
    renderAs("editor");

    screen.getByText("active");
    screen.getByText("no credential");
    screen.getByText("never");
    expect(screen.queryByRole("button", { name: /rotate|issue|register/i })).toBeNull();
    screen.getByText(/Only Admins can register services/);
  });

  it("shows a new credential once, until the Admin confirms it is stored", async () => {
    renderAs("admin");

    await click(screen.getByRole("button", { name: "Issue credential" }));

    expect(rotateCredential).toHaveBeenCalledWith("svc-new", false);
    screen.getByText("ssf_shown_once");
    await click(screen.getByRole("button", { name: /Done/ }));
    expect(screen.queryByText("ssf_shown_once")).toBeNull();
  });

  it("asks before revoking a credential at once, and shows the server's refusal", async () => {
    renderAs("admin");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await click(screen.getByRole("button", { name: /Revoke/ }));
    expect(confirm).toHaveBeenCalled();
    expect(rotateCredential).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("evapl-service-frontend"), { target: { value: "orders-api" } });
    await click(screen.getByRole("button", { name: "Register service" }));
    expect(registerService).toHaveBeenCalledWith("orders-api", "");
    expect(screen.getByRole("alert").textContent).toBe('A service with the key "orders-api" already exists.');
  });
});
