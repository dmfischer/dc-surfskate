import { run as fetch } from "./stages/fetch.js";
import { run as fetchDtm } from "./stages/fetchDtm.js";
import { run as join } from "./stages/join.js";
import { run as grade } from "./stages/grade.js";
import { run as exportSegments } from "./stages/export.js";

// Fetch stages reuse cached downloads; pass --refresh to re-download.
const refresh = process.argv.includes("--refresh");

await fetch({ refresh });
await join();
await fetchDtm({ refresh });
await grade();
await exportSegments();
// Scoring (stages/score.ts) is not implemented yet.
