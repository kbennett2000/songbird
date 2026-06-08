import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TagInput } from "@/components/TagInput";

describe("TagInput", () => {
  it("adds a tag on Enter (normalized)", async () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} suggestions={[]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add a tag"), "Grace");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(["grace"]);
  });

  it("commits the draft on blur (regression: #89 — typing then clicking Save)", async () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} suggestions={[]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add a tag"), "Grace");
    // Tab away (as clicking the sibling Save button would) — no Enter pressed.
    await user.tab();
    expect(onChange).toHaveBeenCalledWith(["grace"]);
  });

  it("removes a tag via its × button", async () => {
    const onChange = vi.fn();
    render(<TagInput value={["grace", "faith"]} suggestions={[]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove tag grace" }));
    expect(onChange).toHaveBeenCalledWith(["faith"]);
  });

  it("offers autocomplete from existing tags", async () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} suggestions={["grace", "gratitude", "faith"]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add a tag"), "gra");
    // "grace" and "gratitude" match "gra".
    expect(screen.getByRole("button", { name: "grace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gratitude" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "gratitude" }));
    expect(onChange).toHaveBeenCalledWith(["gratitude"]);
  });

  it("clicking a suggestion does not also commit the partial draft", async () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} suggestions={["grace", "gratitude"]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Add a tag"), "gra");
    await user.click(screen.getByRole("button", { name: "gratitude" }));
    // Only the chosen suggestion is added — not the in-progress "gra" draft.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["gratitude"]);
  });
});
