import { spawn } from "node:child_process";
export default async function setup() {
  try {
    const r = await fetch("http://127.0.0.1:3100/api/health");
    if (r.ok) throw new Error("E2E port 3100 is already in use.");
  } catch (e) {
    if (e instanceof Error && e.message.includes("already in use")) throw e;
  }
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: "3100",
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        PUBLIC_ORIGIN: "http://127.0.0.1:3100",
        ...(process.env.E2E_DATABASE_URL
          ? { DATABASE_URL: process.env.E2E_DATABASE_URL, TEST_STORE_PATH: "" }
          : { TEST_STORE_PATH: `.test-data/e2e-${Date.now()}.json` }),
      },
    },
  );
  let diagnostics = "";
  child.stderr.on("data", (b) => (diagnostics += b.toString()));
  child.stdout.on("data", () => {});
  const stop = async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
    });
  };
  try {
    const end = Date.now() + 30000;
    while (true) {
      if (child.exitCode !== null)
        throw new Error(diagnostics || "E2E server stopped.");
      try {
        if ((await fetch("http://127.0.0.1:3100/api/health")).ok) break;
      } catch {}
      if (Date.now() > end)
        throw new Error("E2E server startup timed out. " + diagnostics);
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
