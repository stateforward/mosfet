import { firstRunCost, TASKS } from "./tasks.ts";

export type Frequency = {
  readonly label: string;
  /** Runs of the routine in a year. */
  readonly runsPerYear: number;
  /** One line that makes the yearly number land. */
  readonly quip: string;
};

/** The dial's stops, slowest first. Illustrative, like every demo figure. */
export const FREQUENCIES: readonly Frequency[] = [
  { label: "Monthly", runsPerYear: 12, quip: "Small. Now multiply it by every routine you have." },
  { label: "Weekly", runsPerYear: 52, quip: "A streaming subscription, spent on one chore." },
  { label: "Daily", runsPerYear: 250, quip: "A weekend away, spent re-explaining one thing." },
  { label: "3× a day", runsPerYear: 750, quip: "A flight to Tokyo. For one routine." },
  { label: "Hourly", runsPerYear: 2000, quip: "A used car. For one routine." },
];

/** What one run of the demo's routine costs on the model, in dollars. */
export const ROUTINE_COST = firstRunCost(TASKS.code);

/** Clamp any slider value to a valid stop index. */
export function stopIndex(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(FREQUENCIES.length - 1, Math.round(n)));
}

/** Dollars a year when every run hits the model. */
export function rebilledPerYear(index: number): number {
  const stop = FREQUENCIES[stopIndex(index)];
  return stop === undefined ? 0 : stop.runsPerYear * ROUTINE_COST;
}

/** Dollars a year with mosfet: the one run where it learns, then nothing. */
export function learnedPerYear(): number {
  return ROUTINE_COST;
}

/** Whole dollars with thousands separators, e.g. `$4,680`. */
export function wholeDollars(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}
