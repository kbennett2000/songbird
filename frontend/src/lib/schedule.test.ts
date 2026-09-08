import { describe, expect, it } from "vitest";

import { describeSchedule, everyPhrase, formatRunTime } from "@/lib/schedule";
import type { SermonSourcesStatus } from "@/schemas";

function status(overrides: Partial<SermonSourcesStatus> = {}): SermonSourcesStatus {
  return {
    configured: true,
    min_minutes_default: 10,
    scan_running: false,
    scan_started_at: null,
    interval_hours: 168,
    timer_enabled: true,
    last_scheduled_run_at: null,
    next_scheduled_run_at: null,
    ...overrides,
  };
}

describe("everyPhrase", () => {
  it("reads in days when the interval divides into days", () => {
    // 168 is the shipped default, and "every 7 days" is what a reader recognises as weekly.
    expect(everyPhrase(168)).toBe("7 days");
    expect(everyPhrase(48)).toBe("2 days");
    expect(everyPhrase(24)).toBe("day");
  });

  it("reads in hours when it doesn't", () => {
    expect(everyPhrase(12)).toBe("12 hours");
    expect(everyPhrase(1)).toBe("hour");
  });
});

describe("formatRunTime", () => {
  it("gives a weekday and a clock time", () => {
    // Asserted by shape, not by an exact string: this formats in the reader's own timezone, so
    // pinning "Sun 3:02 AM" would pin the machine the suite happens to run on.
    expect(formatRunTime("2026-09-06T15:02:00Z")).toMatch(/^\w{3,} \d{1,2}:\d{2}(\s?[AP]M)?$/);
  });

  it("hands back anything it can't read rather than showing Invalid Date", () => {
    expect(formatRunTime("not a time")).toBe("not a time");
  });
});

describe("describeSchedule", () => {
  it("says how often, when it last ran, and when it will run next", () => {
    const line = describeSchedule(
      status({
        last_scheduled_run_at: "2026-09-06T15:02:00Z",
        next_scheduled_run_at: "2026-09-13T15:02:00Z",
      }),
    );

    expect(line).toMatch(/^Checks every 7 days · last .+ · next .+$/);
  });

  it("leaves out the last run until there has been one", () => {
    // The timer holds it in memory, so a box that has just restarted has no last run to report.
    // Saying nothing is honest; inventing one from the sources' own checks would not be.
    const line = describeSchedule(status({ next_scheduled_run_at: "2026-09-13T15:02:00Z" }));

    expect(line).toMatch(/^Checks every 7 days · next .+$/);
    expect(line).not.toContain("last");
  });

  it("says so plainly when the schedule is switched off", () => {
    // Spec §3: an interval of 0 turns the scheduled check off, and "Check now" still works — so
    // the line points at the thing that does work rather than just reporting an absence.
    expect(describeSchedule(status({ timer_enabled: false, interval_hours: 0 }))).toBe(
      "Scheduled checks are off; use Check now",
    );
  });

  it("says nothing at all when there is no key", () => {
    // Without a key the page is one setup message. A line about a schedule that cannot run would
    // be answering a question the reader has not reached yet.
    expect(describeSchedule(status({ configured: false, timer_enabled: false }))).toBeNull();
  });
});
