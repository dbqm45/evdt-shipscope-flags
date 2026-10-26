import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../../state/useStore";
import { makeBinding, makeFlag, makeService } from "../../test/factories";
import { BindingCard } from "./BindingCard";

vi.mock("../../state/useStore", () => ({ useStore: vi.fn() }));

afterEach(cleanup);

function renderBinding(serviceId: string) {
  vi.mocked(useStore).mockReturnValue({ services: [{ ...makeService("svc-billing", "billing-api"), name: "Billing API" }] } as unknown as ReturnType<
    typeof useStore
  >);
  const binding = makeBinding(serviceId);
  render(<BindingCard flag={makeFlag({ key: "f", services: [binding] })} binding={binding} editable={false} onChange={() => {}} />);
}

describe("BindingCard", () => {
  it("names the service from the services the API returned, not from the demo data", () => {
    renderBinding("svc-billing");
    screen.getByText("Billing API");
    screen.getByText("billing-api");
  });

  it("shows the service id when the service is not in the list", () => {
    renderBinding("svc-unknown");
    expect(screen.getAllByText("svc-unknown")).toHaveLength(2);
  });
});
