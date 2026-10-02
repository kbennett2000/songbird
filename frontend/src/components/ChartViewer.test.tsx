import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChartViewer } from "@/components/ChartViewer";

// Made-up names only. happy-dom doesn't fetch the <img> or lay anything out, so a test sets the
// picture's own size and fires its load; with no box size, "fit" is the picture's own size (100%).
const SRC = "/api/v1/translations/EMB/assets/chart-99.png";

function renderViewer(onClose = vi.fn()) {
  const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
  render(
    <ChartViewer
      src={SRC}
      title="A made-up chart"
      subtitle="Covers Genesis 12:10-20"
      alt="Chart: A made-up chart"
      onClose={onClose}
    />,
  );
  return { onClose, showModal };
}

function loadPicture(width = 800, height = 600) {
  const img = screen.getByAltText("Chart: A made-up chart") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
  fireEvent.load(img);
  return img;
}

// What a screen reader hears from the zoom readout (a live region): "Zoom 150%".
const readout = () => screen.getByText(/^\d+%$/).closest("[aria-live]")!.textContent;

describe("ChartViewer", () => {
  it("opens as a modal dialog named by the chart's title, focus on the picture", () => {
    const { showModal } = renderViewer();
    expect(showModal).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog", { name: "A made-up chart" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByText("Covers Genesis 12:10-20")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("group", { name: "Chart picture: use the arrow keys to move around" }),
    );
    expect(
      screen.getByText("The chart’s words are part of the picture and aren’t available as text."),
    ).toBeInTheDocument();
  });

  it("says it's loading until the picture arrives, then shows it at its fitted size", () => {
    renderViewer();
    expect(screen.getByText("Loading the chart…")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument(); // no zoom claimed yet
    const img = loadPicture(800, 600);
    expect(screen.queryByText("Loading the chart…")).not.toBeInTheDocument();
    expect(img.style.width).toBe("800px");
    expect(readout()).toBe("Zoom 100%");
  });

  it("fits the picture to its area from the first frame, measured once the dialog is open", () => {
    // A closed dialog has no size; an open one does. The viewer must measure after opening, or a
    // picture already in the cache shows at full size until a resize notice corrects it.
    const sized = (el: HTMLElement) => el.closest("dialog")?.hasAttribute("open") ?? false;
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return sized(this) ? 400 : 0;
      });
    const height = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return sized(this) ? 300 : 0;
      });
    try {
      renderViewer();
      loadPicture(800, 600);
      expect(readout()).toBe("Zoom 50%");
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it("zooms in and out with its buttons, up to three times, and back to fit", async () => {
    const user = userEvent.setup();
    renderViewer();
    const img = loadPicture(800, 600);
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const fit = screen.getByRole("button", { name: "Fit" });
    expect(zoomOut).toBeDisabled(); // already fitted
    expect(fit).toBeDisabled();

    await user.click(zoomIn);
    expect(readout()).toBe("Zoom 150%");
    expect(img.style.width).toBe("1200px");
    await user.click(zoomIn);
    await user.click(zoomIn);
    expect(readout()).toBe("Zoom 300%");
    expect(zoomIn).toBeDisabled(); // the limit

    await user.click(zoomOut);
    expect(readout()).toBe("Zoom 200%");
    await user.click(fit);
    expect(readout()).toBe("Zoom 100%");
    expect(fit).toBeDisabled();
  });

  it("zooms with the + − and 0 keys", async () => {
    const user = userEvent.setup();
    renderViewer();
    loadPicture();
    await user.keyboard("+");
    expect(readout()).toBe("Zoom 150%");
    await user.keyboard("=");
    expect(readout()).toBe("Zoom 225%");
    await user.keyboard("-");
    expect(readout()).toBe("Zoom 150%");
    await user.keyboard("0");
    expect(readout()).toBe("Zoom 100%");
  });

  it("double-click goes to twice the size when the whole chart already fits, and back", () => {
    renderViewer();
    loadPicture();
    const box = screen.getByRole("group", { name: /Chart picture/ });
    fireEvent.doubleClick(box, { clientX: 10, clientY: 10 });
    expect(readout()).toBe("Zoom 200%");
    fireEvent.doubleClick(box, { clientX: 10, clientY: 10 });
    expect(readout()).toBe("Zoom 100%");
  });

  it("closes with its Close button", async () => {
    const { onClose } = renderViewer();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
  });

  it("closes on Escape (the dialog's own cancel, then close)", () => {
    const { onClose } = renderViewer();
    const dialog = screen.getByRole("dialog");
    // happy-dom doesn't turn Escape into cancel + close as a browser does; play that part.
    fireEvent(dialog, new Event("cancel"));
    (dialog as HTMLDialogElement).close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says when the picture couldn't load, and tries again", async () => {
    renderViewer();
    fireEvent.error(screen.getByAltText("Chart: A made-up chart"));
    expect(
      screen.getByText("Couldn’t load the chart’s picture (is Concord reachable?)."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByAltText("Chart: A made-up chart")).toHaveAttribute(
      "src",
      `${SRC}?attempt=1`,
    );
  });
});
