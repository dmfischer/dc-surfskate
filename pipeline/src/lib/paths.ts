import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CONFIG_DIR = path.join(REPO_ROOT, "config");
/** Generated artifacts. Gitignored; never commit anything written here. */
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const INTERMEDIATE_DIR = path.join(DATA_DIR, "intermediate");
export const OUTPUT_DIR = path.join(DATA_DIR, "output");
