import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

afterEach(cleanup);

describe("LoginPage", () => {
  it("says that sign-in is not set up instead of pretending to check anything", () => {
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);

    expect(screen.getByRole("note").textContent).toMatch(/Sign-in is not set up yet/);
    expect(screen.queryByText(/This attempt is logged/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the dashboard" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});
