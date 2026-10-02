import { NoteMarkdown } from "@/components/NoteMarkdown";
import {
  dayName,
  daysIn,
  MONTHS,
  monthsIn,
  type PlanDay,
  planDayId,
  type ReadingPlan,
} from "@/lib/readingPlan";

interface ReadingPlanBarProps {
  plan: ReadingPlan;
  /** The month on the page. */
  month: number;
  /** The day last gone to in that month, if any. */
  day: number | null;
  onMonth: (month: number) => void;
  onDay: (day: number) => void;
  onToday: () => void;
}

/**
 * The reading plan's way around (v1.8 slice C2): a month, a day in it, and Today, in a row under
 * the title that never scrolls away. Native selects, so a phone shows its own picker.
 */
export function ReadingPlanBar({
  plan,
  month,
  day,
  onMonth,
  onDay,
  onToday,
}: ReadingPlanBarProps): JSX.Element {
  const select = "h-9 rounded border border-gray-300 dark:border-gray-600 px-2 text-sm";
  return (
    // Text sizes on the controls, not the row: the row's 65 characters must match the header's.
    <div className="mx-auto mt-2 flex max-w-prose items-center gap-2 px-4">
      <label className="flex items-center gap-1.5">
        <span className="sr-only sm:not-sr-only text-sm text-gray-600 dark:text-gray-400">
          Month
        </span>
        <select className={select} value={month} onChange={(e) => onMonth(Number(e.target.value))}>
          {monthsIn(plan).map((m) => (
            <option key={m} value={m}>
              {MONTHS[m - 1]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="sr-only sm:not-sr-only text-sm text-gray-600 dark:text-gray-400">Day</span>
        <select
          className={select}
          value={day ?? ""}
          onChange={(e) => onDay(Number(e.target.value))}
        >
          <option value="" disabled>
            –
          </option>
          {daysIn(plan, month).map((d) => (
            <option key={d.day} value={d.day}>
              {d.day}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ml-auto h-9 rounded border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={onToday}
      >
        Today
      </button>
    </div>
  );
}

interface ReadingPlanMonthProps {
  plan: ReadingPlan;
  month: number;
  /** Today's date, marked on its day when the plan has it. */
  today: { month: number; day: number };
  /** A reading's `ref:` link, and the day it's in. */
  onJump: (book: string, chapter: number, verse: number | null, day: PlanDay) => void;
  onMonth: (month: number) => void;
}

/**
 * One month of a reading plan (v1.8 slice C2): each day's date over its readings — beside them from
 * 640 px — and today's day marked. Only the month on the page is drawn, about 31 days, not a whole
 * year. A plan is something to read, not a tracker: nothing about what's been read is kept.
 */
export function ReadingPlanMonth({
  plan,
  month,
  today,
  onJump,
  onMonth,
}: ReadingPlanMonthProps): JSX.Element {
  const months = monthsIn(plan);
  const at = months.indexOf(month);
  const prev = at > 0 ? months[at - 1] : undefined;
  const next = at >= 0 && at < months.length - 1 ? months[at + 1] : undefined;
  const link = "font-medium text-blue-700 dark:text-blue-400 hover:underline";

  return (
    <div>
      {month === months[0] && plan.preface && (
        <div className="mb-4">
          <NoteMarkdown text={plan.preface} onJump={(b, c, v) => onJump(b, c, v, plan.days[0]!)} />
        </div>
      )}
      <div className="border-t border-gray-200 dark:border-gray-700">
        {daysIn(plan, month).map((d) => {
          const isToday = d.month === today.month && d.day === today.day;
          const id = planDayId(d);
          return (
            <section
              key={id}
              id={id}
              aria-labelledby={`${id}-title`}
              aria-current={isToday ? "date" : undefined}
              className={`border-b border-l-4 border-b-gray-200 dark:border-b-gray-700 py-3 pl-3 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-4 ${
                isToday ? "border-l-blue-600 dark:border-l-blue-400" : "border-l-transparent"
              }`}
            >
              <h3 id={`${id}-title`} className="font-semibold">
                {dayName(d)}
                {isToday && (
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                    Today
                  </span>
                )}
              </h3>
              <div className="[&_li+li]:mt-1 [&_ul]:list-none [&_ul]:pl-0">
                <NoteMarkdown text={d.markdown} onJump={(b, c, v) => onJump(b, c, v, d)} />
              </div>
            </section>
          );
        })}
      </div>
      {(prev !== undefined || next !== undefined) && (
        <nav aria-label="Other months" className="mt-6 flex justify-between gap-4">
          {prev !== undefined ? (
            <button type="button" className={link} onClick={() => onMonth(prev)}>
              ← {MONTHS[prev - 1]}
            </button>
          ) : (
            <span />
          )}
          {next !== undefined && (
            <button type="button" className={link} onClick={() => onMonth(next)}>
              {MONTHS[next - 1]} →
            </button>
          )}
        </nav>
      )}
    </div>
  );
}
