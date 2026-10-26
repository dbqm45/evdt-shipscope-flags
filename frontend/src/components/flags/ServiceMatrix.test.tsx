import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../state/useStore";
import { daysBefore, makeBinding, makeFlag, makeService, NOW } from "../../test/factories";
import { ServiceMatrix } from "./ServiceMatrix";

vi.mock("../../state/useStore", () => ({ useStore: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ServiceMatrix", () => {
  it("groups flags by service, marks where a service may disagree, and opens a flag on click", () => {
    // orders-api last read prod 3 days ago; "checkout" changed there yesterday.
    const services = [{ ...makeService("svc-api", "orders-api"), checkIns: { prod: daysBefore(3) } }, makeService("svc-web", "shop-web")];
    vi.mocked(useStore).mockReturnValue({ services } as unknown as ReturnType<typeof useStore>);
    const onSelect = vi.fn();
    const flags = [
      makeFlag({ key: "checkout", on: ["test"], changedDaysAgo: 1, services: [makeBinding("svc-api"), makeBinding("svc-web", { readMode: "both" })] }),
      makeFlag({ key: "orphan" }),
    ];

    render(<ServiceMatrix flags={flags} onSelect={onSelect} />);

    const api = within(screen.getByRole("region", { name: "orders-api" }));
    expect(api.getAllByText("drift")).toHaveLength(1);
    within(screen.getByRole("region", { name: "shop-web" })).getByText("build-time + runtime");
    within(screen.getByRole("region", { name: "Not read by any service" })).getByText("orphan");

    fireEvent.click(api.getByText("checkout"));
    expect(onSelect).toHaveBeenCalledWith("checkout");
  });
});
