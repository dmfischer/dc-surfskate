import { pathToFileURL } from "node:url";

export async function run(): Promise<void> {
  console.log("[grade] not implemented yet");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await run();
}
