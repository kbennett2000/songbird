import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChartPicture } from "@/components/ChartPicture";

// Made-up names only — never a real study Bible's picture. happy-dom doesn't fetch an <img>, so
// each test plays the browser's part with load / error events.
const SRC = "/api/v1/translations/EMB/assets/chart-99.png";

function renderPicture(onOpen = vi.fn(), size: "note" | "thumb" = "note") {
  render(
    <ChartPicture
      src={SRC}
      alt="Chart: A made-up chart"
      label="Open the chart larger: A made-up chart"
      size={size}
      onOpen={onOpen}
    />,
  );
  return onOpen;
}

const frame = () => document.querySelector("[data-chart-picture]")!;

describe("ChartPicture", () => {
  it("says it's loading, in a frame that already has its final size", () => {
    renderPicture();
    expect(screen.getByText("Loading the chart…")).toBeInTheDocument();
    expect(frame()).toHaveAttribute("data-chart-picture", "loading");
    expect(frame().className).toContain("h-48");
    expect(screen.getByAltText("Chart: A made-up chart")).toHaveAttribute("src", SRC);
  });

  it("shows the picture once it loads, as a button that opens it larger", async () => {
    const onOpen = renderPicture();
    fireEvent.load(screen.getByAltText("Chart: A made-up chart"));
    expect(frame()).toHaveAttribute("data-chart-picture", "loaded");
    expect(screen.queryByText("Loading the chart…")).not.toBeInTheDocument();
    expect(screen.getByText("⤢ Open larger")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Open the chart larger: A made-up chart" });
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(button);
  });

  it("says when the picture couldn't load, and asks again on Try again", async () => {
    renderPicture();
    fireEvent.error(screen.getByAltText("Chart: A made-up chart"));
    expect(
      screen.getByText("Couldn’t load the chart’s picture (is Concord reachable?)."),
    ).toBeInTheDocument();
    expect(frame().className).toContain("h-48"); // the same space: the note box doesn't move
    expect(screen.queryByRole("button", { name: /Open the chart larger/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Loading the chart…")).toBeInTheDocument();
    // A fresh request, not the failed one again.
    expect(screen.getByAltText("Chart: A made-up chart")).toHaveAttribute(
      "src",
      `${SRC}?attempt=1`,
    );
  });

  it("comes as a small lazy thumbnail too", () => {
    renderPicture(vi.fn(), "thumb");
    expect(frame().className).toContain("w-28");
    expect(screen.getByAltText("Chart: A made-up chart")).toHaveAttribute("loading", "lazy");
  });

  it("comes as a figure in a page of text, shaped like its picture and called a picture", () => {
    render(
      <ChartPicture
        src={SRC}
        alt="A made-up caption"
        label="Open the picture larger: A made-up caption"
        size="figure"
        aspect={{ width: 1024, height: 180 }}
        noun="picture"
        onOpen={vi.fn()}
      />,
    );
    // The frame has the picture's shape before it loads, so the text never shifts under it.
    expect(frame()).toHaveStyle({ aspectRatio: "1024 / 180", maxWidth: "1024px" });
    expect(frame().className).toContain("w-full");
    expect(screen.getByText("Loading the picture…")).toBeInTheDocument();
    fireEvent.error(screen.getByAltText("A made-up caption"));
    expect(
      screen.getByText("Couldn’t load the picture (is Concord reachable?)."),
    ).toBeInTheDocument();
  });
});
