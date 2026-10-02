import { describe, expect, it } from "vitest";

import { dayName, daysIn, monthsIn, parseReadingPlan, todayIn } from "@/lib/readingPlan";

// A made-up plan in the shape a study Bible's takes: dates as `##` headings (a month's first day in
// capitals), each over its readings as `ref:` links — one of them crossing into the next book.
const PLAN = [
  "## JANUARY 1",
  "- [Made-up 1:1–2:3](ref:GEN.1.1-2.3)\n- [Made-up song 1](ref:PSA.1.1-6)",
  "## January 2",
  "- [Made-up 50:1](ref:GEN.50.1-26)—[Made-up 2:10](ref:EXO.1.1-2.10)\n- [Made-up song 2](ref:PSA.2.1-12)",
  "## February 28",
  "- [Made-up 9](ref:LEV.9)",
  "## MARCH 1",
  "- [Made-up 10](ref:LEV.10)",
].join("\n\n");

describe("parseReadingPlan", () => {
  it("reads each dated heading as a day, whatever its case, with the lines under it", () => {
    const plan = parseReadingPlan(PLAN)!;
    expect(plan.preface).toBe("");
    expect(plan.days.map(dayName)).toEqual(["January 1", "January 2", "February 28", "March 1"]);
    expect(plan.days[0]!.markdown).toBe(
      "- [Made-up 1:1–2:3](ref:GEN.1.1-2.3)\n- [Made-up song 1](ref:PSA.1.1-6)",
    );
    // A reading that crosses into the next book stays one line of its day.
    expect(plan.days[1]!.markdown.split("\n")[0]).toBe(
      "- [Made-up 50:1](ref:GEN.50.1-26)—[Made-up 2:10](ref:EXO.1.1-2.10)",
    );
    expect(plan.days[3]!.markdown).toBe("- [Made-up 10](ref:LEV.10)");
  });

  it("keeps words before the first day as its preface, and reads Windows line ends", () => {
    const plan = parseReadingPlan("Made-up words first.\r\n\r\n## January 1\r\n\r\n- A reading")!;
    expect(plan.preface).toBe("Made-up words first.");
    expect(plan.days).toEqual([{ month: 1, day: 1, markdown: "- A reading" }]);
  });

  it("reads a date in emphasis, and keeps a smaller heading inside its day", () => {
    const plan = parseReadingPlan("## **January 3**\n\n### Made-up part\n\n- A reading")!;
    expect(plan.days[0]).toEqual({
      month: 1,
      day: 3,
      markdown: "### Made-up part\n\n- A reading",
    });
  });

  it("is null for a plan not laid out by date, so it shows as an ordinary document", () => {
    expect(parseReadingPlan("## Day 1\n\n- A reading")).toBeNull();
    expect(parseReadingPlan("## January 1\n\n- A\n\n## Made-up week\n\n- B")).toBeNull();
    expect(parseReadingPlan("Made-up words with no headings.")).toBeNull();
    // A day no month has, and days out of order or repeated.
    expect(parseReadingPlan("## February 30\n\n- A")).toBeNull();
    expect(parseReadingPlan("## March 1\n\n- A\n\n## February 1\n\n- B")).toBeNull();
    expect(parseReadingPlan("## March 1\n\n- A\n\n## March 1\n\n- B")).toBeNull();
  });

  it("allows 29 February", () => {
    expect(parseReadingPlan("## February 29\n\n- A")?.days).toHaveLength(1);
  });
});

describe("the plan's months and days", () => {
  const plan = parseReadingPlan(PLAN)!;

  it("lists the months it has, and a month's days", () => {
    expect(monthsIn(plan)).toEqual([1, 2, 3]);
    expect(daysIn(plan, 1).map((d) => d.day)).toEqual([1, 2]);
    expect(daysIn(plan, 4)).toEqual([]);
  });

  it("goes to today, or the nearest day before it in the month when the plan lacks it", () => {
    expect(todayIn(plan, new Date(2026, 0, 2))).toEqual({ month: 1, day: 2 });
    expect(todayIn(plan, new Date(2028, 1, 29))).toEqual({ month: 2, day: 28 });
    // Nothing earlier in the month: its first day. A month the plan lacks: the plan's first day.
    expect(todayIn(plan, new Date(2026, 1, 3))).toEqual({ month: 2, day: 28 });
    expect(todayIn(plan, new Date(2026, 6, 4))).toEqual({ month: 1, day: 1 });
  });
});
