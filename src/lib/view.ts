// What every results page gets: the brand, the runs in the chosen period, and the filters.
import type { Run } from "./chats";
import type { Brand, Topic } from "./db";
import type { Filter } from "./metrics";

export type View = {
  brand: Brand;
  current: Run[]; // runs in the chosen period
  previous: Run[]; // runs in the period just before, for change arrows
  filter: Filter; // chosen model and topic
  topics: Topic[]; // topics in view (all, or the chosen one)
  engines: string[]; // engines in view
  days: number;
};
