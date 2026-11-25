import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import { loginErrorCode } from "../lib/loginErrors";
import { LoginPage } from "./LoginPage";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, breakGlass: vi.fn() } };
});

afterEach(cleanup);

describe("LoginPage", () => {
  it("signs in through the API's SSO route and asks for no password itself", () => {
    render(<LoginPage demo={false} onOpenDemo={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Sign in with SSO" }).getAttribute("href")).toBe("/api/auth/login");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a failed sign-in in words", () => {
    render(<LoginPage demo={false} error="no-role" onOpenDemo={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/no role in ShipScope Flags/);
  });

  it("tells a person outside the organization to ask their organization's administrator, not an Admin here", () => {
    render(<LoginPage demo={false} error="not-member" onOpenDemo={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/not a member of the organization/);
    expect(loginErrorCode("not-member")).toBe("not-member");
  });

  it("takes only known error codes from the address, so a crafted link cannot put its own text on the page", () => {
    expect(loginErrorCode("no-role")).toBe("no-role");
    expect(loginErrorCode("Your account is locked, call +1 555 0100")).toBe("failed");
    expect(loginErrorCode("constructor")).toBe("failed");
    expect(loginErrorCode(null)).toBeUndefined();
  });

  it("offers the demo data, without sign-in, when the API is not reachable", () => {
    const onOpenDemo = vi.fn();
    render(<LoginPage demo onOpenDemo={onOpenDemo} />);

    expect(screen.getByRole("note").textContent).toMatch(/API is not reachable/);
    expect(screen.queryByRole("link", { name: "Sign in with SSO" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the demo" }));
    expect(onOpenDemo).toHaveBeenCalledTimes(1);
  });

  it("offers break-glass access only when the server has it, and needs a password and a reason", async () => {
    const { rerender } = render(<LoginPage demo={false} onOpenDemo={vi.fn()} onSignedIn={vi.fn()} />);
    expect(screen.queryByText(/Emergency access/)).toBeNull();

    const onSignedIn = vi.fn();
    rerender(<LoginPage demo={false} breakGlass onOpenDemo={vi.fn()} onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Emergency access/));
    const submit = screen.getByRole("button", { name: "Sign in with break-glass" });
    fireEvent.change(screen.getByLabelText(/Break-glass password/), { target: { value: "from-the-vault" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "SSO outage, prod flag must go off" } });

    vi.mocked(api.breakGlass).mockRejectedValueOnce(new ApiError("Wrong break-glass password. The attempt was logged.", 401));
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toMatch(/attempt was logged/);

    const user = { username: "break-glass", name: "Break-glass admin", role: "admin" as const, breakGlass: true };
    vi.mocked(api.breakGlass).mockResolvedValueOnce(user);
    fireEvent.click(submit);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user));
    expect(api.breakGlass).toHaveBeenLastCalledWith("from-the-vault", "SSO outage, prod flag must go off");
  });
});
