import { run as fetch } from "./stages/fetch.js";
import { run as join } from "./stages/join.js";
import { run as grade } from "./stages/grade.js";
import { run as score } from "./stages/score.js";

for (const stage of [fetch, join, grade, score]) {
  await stage();
}
