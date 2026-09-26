export type TaskId = "code" | "plan" | "computer";

export type TaskStep = { readonly text: string; readonly cost: number };

/**
 * One demo job on mosfet.bot.
 *
 * `steps` is the first, paid run. `result` is what it hands back, which is
 * fine but not how you'd have done it; `correction` is the one thing you tell
 * it; `skill` is what it keeps; `learnedResult` is every run after that.
 * Costs are illustrative dollars per step of an agent run, not a price list.
 */
export type Task = {
  readonly id: TaskId;
  readonly label: string;
  readonly ask: string;
  readonly steps: readonly TaskStep[];
  readonly result: string;
  readonly correction: string;
  readonly skill: string;
  readonly learnedSteps: readonly string[];
  readonly learnedResult: string;
};

export const TASKS: Record<TaskId, Task> = {
  code: {
    id: "code",
    label: "Fix a failing test",
    ask: "checkout tests are red again, fix it",
    steps: [
      { text: "reading the test output", cost: 0.36 },
      { text: "searching the codebase for the total calculation", cost: 0.66 },
      { text: "found it: tax rounds before the discount", cost: 0.54 },
      { text: "patching cart/total.ts", cost: 0.48 },
      { text: "running the suite", cost: 0.3 },
    ],
    result: "Fixed. 212 tests passing.",
    correction: "always write a test that fails first, then fix it",
    skill: "Fixing a bug: reproduce it in a failing test before touching code",
    learnedSteps: ["wrote a failing test for the rounding case", "applied the fix", "suite green"],
    learnedResult: "Fixed, with a regression test. 213 tests passing.",
  },
  plan: {
    id: "plan",
    label: "Plan the offsite",
    ask: "plan our team offsite next month",
    steps: [
      { text: "checking 8 calendars", cost: 0.42 },
      { text: "comparing venues downtown", cost: 0.72 },
      { text: "picking the date with no conflicts", cost: 0.36 },
      { text: "drafting an agenda", cost: 0.6 },
    ],
    result: "Thursday the 14th, downtown loft, agenda in a Google Doc.",
    correction: "we always go out of town, and agendas live in Notion",
    skill: "Offsites: somewhere out of town, agenda goes in Notion",
    learnedSteps: ["pulled the out-of-town shortlist", "found the open date", "agenda posted to Notion"],
    learnedResult: "Thursday the 14th, the lake house, agenda in Notion.",
  },
  computer: {
    id: "computer",
    label: "File my expenses",
    ask: "file my expenses from last week",
    steps: [
      { text: "opening your inbox, finding 6 receipts", cost: 0.48 },
      { text: "logging into the expense tool", cost: 0.3 },
      { text: "filling in 6 line items", cost: 0.84 },
      { text: "submitting the report", cost: 0.24 },
    ],
    result: "Filed 6 receipts, $412.80 total.",
    correction: "client dinners go under that client's project code",
    skill: "Expenses: meals with a client get the client's project code",
    learnedSteps: ["pulled 6 receipts", "tagged 2 client dinners to ACME-204", "submitted"],
    learnedResult: "Filed 6 receipts, $412.80, client dinners coded to ACME-204.",
  },
};

export function isTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && value in TASKS;
}

/** Workdays in a year: the projection the demo quotes. */
export const RUNS_PER_YEAR = 250;

export function firstRunCost(task: Task): number {
  return task.steps.reduce((sum, step) => sum + step.cost, 0);
}
