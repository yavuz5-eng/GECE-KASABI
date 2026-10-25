import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import {
  suggestedSettings,
  type RoomView,
  type Reply,
  type Command,
} from "../shared/protocol";
const base = "http://127.0.0.1:3101";
const file = `.test-data/server-${randomUUID()}.json`;
const db = process.env.TEST_DATABASE_URL
  ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })
  : null;
let child: ChildProcess;
const clients: {
  cookie: string;
  socket: Socket;
  view?: RoomView;
  id: string;
}[] = [];
async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 12000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function boot() {
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: "3101",
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      ...(db
        ? { DATABASE_URL: process.env.TEST_DATABASE_URL, TEST_STORE_PATH: "" }
        : { TEST_STORE_PATH: file }),
      PUBLIC_ORIGIN: base,
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr?.on("data", (b) => (error += b));
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(error);
    try {
      return (await fetch(base + "/api/health")).ok;
    } catch {
      return false;
    }
  });
}
async function stop() {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}
async function client() {
  const r = await fetch(base + "/api/me");
  const p = await r.json();
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  await fetch(base + "/api/profile", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nickname: `Test${clients.length}`, avatar: "🦊" }),
  });
  const c = {
    cookie,
    id: p.id,
    socket: io(base, {
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie, Origin: base },
      reconnectionDelay: 100,
    }),
    view: undefined as RoomView | undefined,
  };
  c.socket.on("view", (v) => (c.view = v));
  clients.push(c);
  await waitFor(() => c.socket.connected);
  return c;
}
function send(
  c: (typeof clients)[number],
  event: string,
  data: unknown,
): Promise<Reply> {
  return new Promise((resolve, reject) =>
    c.socket
      .timeout(4000)
      .emit(event, data, (e: Error | null, r: Reply) =>
        e ? reject(e) : resolve(r),
      ),
  );
}
function command(
  c: (typeof clients)[number],
  type: Command["type"],
  extra: Partial<Command> = {},
) {
  return send(c, "command", {
    type,
    roomCode: c.view!.code,
    phaseVersion: c.view!.phaseVersion,
    actionId: randomUUID(),
    ...extra,
  });
}
beforeAll(async () => {
  await mkdir(".test-data", { recursive: true });
  await boot();
}, 20000);
afterAll(async () => {
  clients.forEach((c) => c.socket.disconnect());
  await stop();
  await db?.$disconnect();
});
describe.sequential("real Socket.IO server security and recovery", () => {
  it("sets HttpOnly SameSite cookie and denies cross-origin mutations", async () => {
    const r = await fetch(base + "/api/me");
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")).toContain("SameSite=Strict");
    const bad = await fetch(base + "/api/profile", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(bad.status).toBe(403);
  });
  it("requires an authenticated socket session", async () => {
    const s = io(base, { transports: ["websocket"], reconnection: false });
    const error = await new Promise<Error>((resolve) =>
      s.once("connect_error", resolve),
    );
    expect(error.message).toContain("oturum");
    s.disconnect();
  });
  it("creates six distinct guest sessions and starts only when ready", async () => {
    for (let i = 0; i < 6; i++) await client();
    expect(new Set(clients.map((c) => c.id)).size).toBe(6);
    expect((await send(clients[0], "create", suggestedSettings())).ok).toBe(
      true,
    );
    await waitFor(() => !!clients[0].view);
    for (const c of clients.slice(1))
      expect((await send(c, "join", clients[0].view!.code)).ok).toBe(true);
    expect((await command(clients[0], "start")).ok).toBe(false);
    for (const c of clients) await command(c, "ready", { ready: true });
    expect((await command(clients[0], "start")).ok).toBe(true);
    await waitFor(() => clients.every((c) => c.view?.phase === "reveal"));
    expect(
      clients.every((c) => c.view!.players.every((p) => p.role === undefined)),
    ).toBe(true);
  });
  it("isolates rooms and rejects mid-match join and cross-room target", async () => {
    const outsider = await client();
    expect((await send(outsider, "join", clients[0].view!.code)).ok).toBe(
      false,
    );
    await send(outsider, "create", suggestedSettings(5));
    await waitFor(() => !!outsider.view);
    expect(outsider.view!.players).toHaveLength(1);
    expect(outsider.view!.code).not.toBe(clients[0].view!.code);
    expect(clients[0].view!.players).toHaveLength(6);
  });
  it("rejects forged identity, duplicates, old phase and invalid role actions", async () => {
    await waitFor(() => clients[0].view?.phase === "night");
    const v = clients.find((c) => c.view?.me.role === "vampire")!;
    const target = clients.find((c) => c.view?.me.role === "villager")!;
    const c = {
      type: "night",
      roomCode: v.view!.code,
      phaseVersion: v.view!.phaseVersion,
      actionId: randomUUID(),
      target: target.id,
    };
    expect((await send(v, "command", { ...c, playerId: target.id })).ok).toBe(
      false,
    );
    expect((await send(v, "command", { ...c, target: clients[6].id })).ok).toBe(
      false,
    );
    expect((await send(v, "command", c)).ok).toBe(true);
    expect((await send(v, "command", c)).ok).toBe(false);
    expect(
      (
        await send(v, "command", {
          ...c,
          actionId: randomUUID(),
          phaseVersion: 0,
        })
      ).ok,
    ).toBe(false);
    expect((await command(target, "night", { target: v.id })).ok).toBe(false);
  }, 15000);
  it("restores sessions and resolves an expired night exactly once after process restart", async () => {
    const old = clients[0].view!;
    const v = clients.find((c) => c.view?.me.role === "vampire")!;
    const target = clients.find((c) => c.view?.me.role === "villager")!;
    await stop();
    if (db) {
      const row = await db.room.findUniqueOrThrow({
        where: { code: old.code },
      });
      const state = row.state as any;
      state.deadline = Date.now() - 2000;
      await db.room.update({ where: { code: old.code }, data: { state } });
    } else {
      const data = JSON.parse(await readFile(file, "utf8"));
      data.rooms[old.code].deadline = Date.now() - 2000;
      await writeFile(file, JSON.stringify(data));
    }
    await boot();
    await waitFor(() => clients[0].view?.phase === "day");
    expect(clients[0].view!.me.role).toBe(old.me.role);
    expect(clients[0].view!.me.id).toBe(old.me.id);
    expect(
      clients[0].view!.players.find((p) => p.id === target.id)!.alive,
    ).toBe(false);
    expect(
      clients[0].view!.logs.filter((l) => l.text.includes("elendi")),
    ).toHaveLength(1);
    expect((await command(target, "vote", { target: v.id })).ok).toBe(false);
    await stop();
    await boot();
    await waitFor(() => clients[0].socket.connected);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      clients[0].view!.logs.filter((l) => l.text.includes("elendi")),
    ).toHaveLength(1);
  }, 25000);
  it("latest tab replaces previous connection deterministically", async () => {
    const original = clients[0];
    const replaced = new Promise<void>((resolve) =>
      original.socket.once("replaced", resolve),
    );
    const s = io(base, {
      transports: ["websocket"],
      extraHeaders: { Cookie: original.cookie, Origin: base },
    });
    await replaced;
    await waitFor(() => !original.socket.connected);
    expect(s.connected).toBe(true);
    s.disconnect();
  });
  it("explicit lobby host leave transfers ownership in join order", async () => {
    const a = clients[6];
    const b = await client();
    await send(b, "join", a.view!.code);
    await command(a, "leave");
    await waitFor(() => b.view?.hostId === b.id);
    expect(b.view!.players).toHaveLength(1);
  });
  it("active departure frees membership, isolates broadcasts and persists across restart", async () => {
    const group: (typeof clients)[number][] = [];
    for (let i = 0; i < 6; i++) group.push(await client());
    const host = group[0];
    await send(host, "create", suggestedSettings());
    await waitFor(() => !!host.view);
    const oldCode = host.view!.code;
    for (const c of group.slice(1)) await send(c, "join", oldCode);
    for (const c of group) await command(c, "ready", { ready: true });
    await command(host, "start");
    await waitFor(() => group.every((c) => c.view?.phase === "reveal"));
    const villager = group.find(
      (c) => c.id !== host.id && c.view?.me.role === "villager",
    )!;
    const before = await (
      await fetch(base + "/api/me", { headers: { Cookie: host.cookie } })
    ).json();
    expect((await command(villager, "leave")).ok).toBe(true);
    expect((await send(villager, "join", clients[7].view!.code)).ok).toBe(true);
    expect((await command(host, "leave")).ok).toBe(true);
    const remaining = group.filter((c) => c !== host && c !== villager);
    await waitFor(() => remaining[0].view?.hostId === remaining[0].id);
    const me = await (
      await fetch(base + "/api/me", { headers: { Cookie: host.cookie } })
    ).json();
    expect(me.roomCode).toBeNull();
    expect(me.id).toBe(before.id);
    expect(me.nickname).toBe(before.nickname);
    const seen: string[] = [];
    host.socket.on("view", (v) => seen.push(v.code));
    expect((await send(host, "create", suggestedSettings())).ok).toBe(true);
    await waitFor(() => host.view?.code !== oldCode);
    const nextCode = host.view!.code;
    expect(
      (
        await command(host, "leave", {
          roomCode: oldCode,
          phaseVersion: host.view!.phaseVersion,
        })
      ).ok,
    ).toBe(false);
    expect(
      (await command(host, "ready", { roomCode: oldCode, ready: true })).ok,
    ).toBe(false);
    expect(
      (
        await send(host, "command", {
          type: "ready",
          actionId: randomUUID(),
          phaseVersion: 0,
          ready: true,
        })
      ).ok,
    ).toBe(false);
    await command(remaining[0], "leave");
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((code) => code === nextCode)).toBe(true);
    await stop();
    host.view = undefined;
    await boot();
    await waitFor(() => host.view?.code === nextCode);
    expect(
      (
        await (
          await fetch(base + "/api/me", { headers: { Cookie: host.cookie } })
        ).json()
      ).roomCode,
    ).toBe(nextCode);
    const persisted = db
      ? (await db.room.findUniqueOrThrow({ where: { code: oldCode } })).state
      : JSON.parse(await readFile(file, "utf8")).rooms[oldCode];
    expect(
      (persisted as any).players.find((p: any) => p.id === host.id).leftAt,
    ).toBeTypeOf("number");
    expect((await send(host, "join", oldCode)).ok).toBe(false);
  }, 25000);
  it("all disconnected timeout is persisted, ends once, and yields no winning statistic", async () => {
    const group: (typeof clients)[number][] = [];
    for (let i = 0; i < 6; i++) group.push(await client());
    const host = group[0];
    await send(host, "create", suggestedSettings());
    await waitFor(() => !!host.view);
    const code = host.view!.code;
    for (const c of group.slice(1)) await send(c, "join", code);
    for (const c of group) await command(c, "ready", { ready: true });
    await command(host, "start");
    for (const c of group) c.socket.disconnect();
    await new Promise((r) => setTimeout(r, 300));
    await stop();
    if (db) {
      const row = await db.room.findUniqueOrThrow({ where: { code } });
      const state = row.state as any;
      state.emptySince = Date.now() - 31 * 60_000;
      await db.room.update({ where: { code }, data: { state } });
    } else {
      const data = JSON.parse(await readFile(file, "utf8"));
      data.rooms[code].emptySince = Date.now() - 31 * 60_000;
      await writeFile(file, JSON.stringify(data));
    }
    await boot();
    await waitFor(async () => {
      const h = await (
        await fetch(base + "/api/history", { headers: { Cookie: host.cookie } })
      ).json();
      return h.length === 1 && h[0].outcome === "unfinished";
    });
    if (!db) await waitFor(async () => {
      const persisted = JSON.parse(await readFile(file, 'utf8'));
      return persisted.history[host.id]?.length === 1;
    });
    await stop();
    await boot();
    const h = await (
      await fetch(base + "/api/history", { headers: { Cookie: host.cookie } })
    ).json();
    expect(h).toHaveLength(1);
    expect(h[0].result).toBe("unfinished");
  }, 25000);
});

