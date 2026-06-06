import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} title="Map" onClose={() => {}}>
        <p>contents</p>
      </Modal>,
    );
    expect(screen.queryByText("contents")).not.toBeInTheDocument();
  });

  it("renders its children and title when open", () => {
    render(
      <Modal open title="Map — John 3" onClose={() => {}}>
        <p>contents</p>
      </Modal>,
    );
    expect(screen.getByText("contents")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Map — John 3" })).toBeInTheDocument();
  });

  it("closes on the ✕ button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open title="Map" onClose={onClose}>
        <p>contents</p>
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open title="Map" onClose={onClose}>
        <p>contents</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but not on an inner click", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open title="Map" onClose={onClose}>
        <p>contents</p>
      </Modal>,
    );
    await user.click(screen.getByText("contents"));
    expect(onClose).not.toHaveBeenCalled();

    // The dialog's parent is the backdrop.
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open", () => {
    render(
      <Modal open title="Map" onClose={() => {}}>
        <p>contents</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });
});
