import { parseNoteMarkdown } from "@/lib/noteMarkdown";

/**
 * A study Bible's reading plan (v1.8 slice C2), read for its days: a Concord document whose `##`
 * headings are dates ("JANUARY 1", "January 2" …), each over that day's readings as `ref:` links.
 * Pure, so the About page can show one month at a time instead of a whole year at once. Nothing
 * about what's been read is kept anywhere: this only reads the plan's own text.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// A plan may list 29 February even though most years lack it.
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const DATE = new RegExp(`^(${MONTHS.join("|")})\\s+([1-9]\\d?)$`, "i");

export interface PlanDay {
  /** 1–12. */
  month: number;
  day: number;
  /** The day's readings, as the Markdown under its heading. */
  markdown: string;
}

export interface ReadingPlan {
  /** Any words before the first day. */
  preface: string;
  /** Every day, in calendar order. */
  days: PlanDay[];
}

/**
 * A plan's days, or null when it isn't laid out by date — when any `##` heading isn't a month and
 * a day, or the days aren't in calendar order — so it shows as an ordinary document. Each day's
 * Markdown is the plan's own lines under its heading, so its `ref:` links render exactly as
 * anywhere else; words before the first day are its preface.
 */
export function parseReadingPlan(text: string): ReadingPlan | null {
  const source = text.replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const tokens = parseNoteMarkdown(source);
  const headings: { month: number; day: number; start: number; end: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type !== "heading_open" || t.tag !== "h2") continue;
    const words = (tokens[i + 1]?.children ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.content)
      .join("")
      .trim();
    const m = DATE.exec(words);
    if (!m || !t.map) return null;
    const month = MONTHS.findIndex((name) => name.toLowerCase() === m[1]!.toLowerCase()) + 1;
    const day = Number(m[2]);
    if (day > MONTH_LENGTHS[month - 1]!) return null;
    const last = headings[headings.length - 1];
    if (last && (month < last.month || (month === last.month && day <= last.day))) return null;
    headings.push({ month, day, start: t.map[0], end: t.map[1] });
  }
  if (headings.length === 0) return null;
  return {
    preface: lines.slice(0, headings[0]!.start).join("\n").trim(),
    days: headings.map((h, k) => ({
      month: h.month,
      day: h.day,
      markdown: lines
        .slice(h.end, headings[k + 1]?.start ?? lines.length)
        .join("\n")
        .trim(),
    })),
  };
}

/** The months the plan has days in, in order. */
export function monthsIn(plan: ReadingPlan): number[] {
  return [...new Set(plan.days.map((d) => d.month))];
}

/** A month's days in the plan. */
export function daysIn(plan: ReadingPlan, month: number): PlanDay[] {
  return plan.days.filter((d) => d.month === month);
}

/** A day's place on the page, for scrolling to it. */
export function planDayId(day: { month: number; day: number }): string {
  return `plan-day-${day.month}-${day.day}`;
}

/** "January 1" — whatever case the plan wrote it in. */
export function dayName(day: { month: number; day: number }): string {
  return `${MONTHS[day.month - 1]} ${day.day}`;
}

/**
 * Where "Today" goes on a given date: that day, or when the plan lacks it (29 February) the
 * month's last day before it, or the month's first; a month the plan lacks goes to its first day.
 */
export function todayIn(plan: ReadingPlan, date: Date): { month: number; day: number } {
  const month = date.getMonth() + 1;
  const sameMonth = daysIn(plan, month);
  const before = sameMonth.filter((d) => d.day <= date.getDate());
  const day = before[before.length - 1] ?? sameMonth[0] ?? plan.days[0]!;
  return { month: day.month, day: day.day };
}
