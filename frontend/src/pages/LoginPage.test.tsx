import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

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

  it("offers the demo data, without sign-in, when the API is not reachable", () => {
    const onOpenDemo = vi.fn();
    render(<LoginPage demo onOpenDemo={onOpenDemo} />);

    expect(screen.getByRole("note").textContent).toMatch(/API is not reachable/);
    expect(screen.queryByRole("link", { name: "Sign in with SSO" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the demo" }));
    expect(onOpenDemo).toHaveBeenCalledTimes(1);
  });
});
