import "dotenv/config";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { randomBytes, randomUUID, randomInt, createHash } from "node:crypto";
import { parse, serialize } from "cookie";
import { Server, type Socket } from "socket.io";
import path from "node:path";
import { z } from "zod";
import {
  profileSchema,
  codeSchema,
  settingsSchema,
  commandSchema,
  type Reply,
} from "../shared/protocol.js";
import {
  createRoom,
  newPlayer,
  addPlayer,
  applyCommand,
  advance,
  playerView,
  abandon,
  isParticipant,
  type Room,
} from "./engine.js";
import { PostgresStore, TestStore, type Store, type Profile } from "./store.js";
const app = express();
const http = createServer(app);
const port = Number(process.env.PORT ?? 3000);
const testMode = process.env.NODE_ENV === "test";
if (process.env.TEST_STORE_PATH && !testMode)
  throw new Error("Test storage requires NODE_ENV=test");
const store: Store =
  testMode && process.env.TEST_STORE_PATH
    ? new TestStore(process.env.TEST_STORE_PATH)
    : new PostgresStore();
if (store instanceof TestStore) await store.load();
const rooms = new Map((await store.rooms()).map((r) => [r.code, r]));
for (const room of rooms.values()) {
  for (const p of room.players) {
    p.connected = false;
    p.disconnectedAt = Date.now();
  }
  room.emptySince ??= Date.now();
}
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  next();
});
const allowedOrigin = (origin: string | undefined, host: string | undefined) =>
  !origin ||
  (process.env.PUBLIC_ORIGIN
    ? origin === process.env.PUBLIC_ORIGIN
    : (() => {
        try {
          return new URL(origin).host === host;
        } catch {
          return false;
        }
      })());
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    !allowedOrigin(req.headers.origin, req.headers.host) ||
    req.headers["sec-fetch-site"] === "cross-site"
  ) {
    res.status(403).json({ error: "İstek kaynağı geçersiz." });
    return;
  }
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: testMode ? 10000 : 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Çok fazla istek. Biraz bekleyin." },
  }),
);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function getProfile(cookie: string | undefined) {
  const token = parse(cookie ?? "").vk_session;
  return token && /^[a-f0-9]{64}$/.test(token)
    ? store.profile(hash(token))
    : null;
}
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const job = queue.then(fn);
  queue = job.catch(() => {});
  return job;
}
const membership = (id: string) =>
  [...rooms.values()].find((r) =>
    r.players.some((p) => p.id === id && isParticipant(p)),
  );
app.get("/api/me", async (req, res) => {
  try {
    const p = await exclusive(async () => {
      let p = await getProfile(req.headers.cookie);
      if (!p) {
        const token = randomBytes(32).toString("hex");
        p = {
          id: randomUUID(),
          sessionHash: hash(token),
          nickname: "Misafir",
          avatar: "🦊",
        };
        await store.saveProfile(p);
        res.setHeader(
          "Set-Cookie",
          serialize("vk_session", token, {
            httpOnly: true,
            sameSite: "strict",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
          }),
        );
      }
      return p;
    });
    res.json({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      roomCode: membership(p.id)?.code ?? null,
    });
  } catch {
    res.status(503).json({ error: "Veritabanına erişilemiyor." });
  }
});
app.post("/api/profile", async (req, res) => {
  try {
    await exclusive(async () => {
      const p = await getProfile(req.headers.cookie);
      if (!p) {
        res.status(401).json({ error: "Oturum yok." });
        return;
      }
      const data = profileSchema.parse(req.body);
      const r = membership(p.id);
      if (r && r.phase !== "lobby" && r.phase !== "ended")
        throw new Error("Maç sırasında profil değiştirilemez.");
      await store.saveProfile({ ...p, ...data });
      if (r) {
        const copy = structuredClone(r);
        Object.assign(
          copy.players.find((x) => x.id === p.id)!,
          data,
        );
        await commit(copy);
      }
      res.json({ ok: true });
    });
  } catch (e) {
    res.status(400).json({ error: message(e) });
  }
});
app.get("/api/history", async (req, res) => {
  const p = await getProfile(req.headers.cookie);
  if (!p) {
    res.status(401).json({ error: "Oturum yok." });
    return;
  }
  try {
    res.json(await store.history(p.id));
  } catch {
    res.status(503).json({ error: "Geçmiş alınamadı." });
  }
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
const io = new Server(http, {
  maxHttpBufferSize: 8192,
  allowRequest: (req, callback) =>
    callback(
      null,
      allowedOrigin(req.headers.origin, req.headers.host) &&
        req.headers["sec-fetch-site"] !== "cross-site",
    ),
});
const active = new Map<string, Socket>();
const buckets = new Map<string, { count: number; until: number }>();
function limit(key: string, max: number) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.until <= now) {
    b = { count: 0, until: now + 60_000 };
    buckets.set(key, b);
  }
  if (++b.count > max)
    throw new Error("Çok hızlı işlem yapıyorsunuz. Biraz bekleyin.");
}
io.use(async (socket, next) => {
  try {
    limit(`connect:${socket.handshake.address}`, testMode ? 10000 : 180);
    const p = await getProfile(socket.request.headers.cookie);
    if (!p) return next(new Error("Önce sayfayı yenileyip oturum açın."));
    socket.data.profile = p;
    next();
  } catch {
    next(new Error("Bağlantı kurulamadı. Biraz bekleyin."));
  }
});
function message(e: unknown) {
  return e instanceof z.ZodError
    ? e.issues.map((x) => x.message).join(" ")
    : e instanceof Error && !/prisma|database|connection|query/i.test(e.message)
      ? e.message
      : "İşlem kaydedilemedi. Yeniden deneyin.";
}
function broadcast(room: Room) {
  for (const p of room.players) {
    if (!isParticipant(p) || membership(p.id)?.code !== room.code) continue;
    const socket = active.get(p.id);
    if (socket) socket.emit("view", playerView(room, p.id, Date.now()));
  }
}
async function commit(room: Room) {
  await store.saveRoom(room);
  rooms.set(room.code, room);
  broadcast(room);
}
async function catchUp(room: Room) {
  let changed = false;
  let count = 0;
  while (advance(room, Date.now())) {
    changed = true;
    if (++count > 5000) {
      abandon(room, Date.now());
      break;
    }
  }
  return changed;
}
io.on("connection", (socket) => {
  const profile = socket.data.profile as Profile;
  const old = active.get(profile.id);
  active.set(profile.id, socket);
  if (old && old.id !== socket.id) {
    old.emit("replaced");
    old.disconnect(true);
  }
  const handle = (event: string, fn: (data: any) => Promise<Reply>) =>
    socket.on(event, (data: unknown, ack: unknown) => {
      void exclusive(async () => {
        try {
          if (active.get(profile.id) !== socket)
            throw new Error("Bu oturum başka sekmede açık.");
          limit(`action:${profile.id}`, testMode ? 10000 : 150);
          const result = await fn(data);
          if (typeof ack === "function") ack(result);
        } catch (e) {
          if (typeof ack === "function") ack({ ok: false, error: message(e) });
        }
      });
    });
  handle("create", async (input) => {
    limit(`join:${socket.handshake.address}`, testMode ? 10000 : 60);
    const settings = settingsSchema.parse(input);
    if (membership(profile.id))
      throw new Error("Önce mevcut odanızdan ayrılın.");
    const fresh = (await store.profile(profile.sessionHash))!;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
      code = Array.from(
        { length: 6 },
        () => alphabet[randomInt(alphabet.length)],
      ).join("");
    } while (rooms.has(code));
    const r = createRoom(
      code,
      newPlayer(profile.id, fresh.nickname, fresh.avatar),
      settings,
      Date.now(),
    );
    await commit(r);
    return { ok: true };
  });
  handle("join", async (input) => {
    limit(`join:${socket.handshake.address}`, testMode ? 10000 : 60);
    const code = codeSchema.parse(input);
    const current = membership(profile.id);
    if (current && current.code !== code)
      throw new Error("Önce mevcut odanızdan ayrılın.");
    const existing = rooms.get(code);
    if (!existing) throw new Error("Oda bulunamadı.");
    if (current) {
      socket.emit("view", playerView(current, profile.id, Date.now()));
      return { ok: true };
    }
    const fresh = (await store.profile(profile.sessionHash))!;
    const r = structuredClone(existing);
    addPlayer(r, newPlayer(profile.id, fresh.nickname, fresh.avatar));
    await commit(r);
    return { ok: true };
  });
  handle("command", async (input) => {
    const command = commandSchema.parse(input);
    const existing = membership(profile.id);
    if (!existing) throw new Error("Odada değilsiniz.");
    if (command.roomCode !== existing.code)
      throw new Error("Bu komut başka bir odaya ait. Güncel odayı kullanın.");
    const r = structuredClone(existing);
    if (await catchUp(r)) await commit(r);
    applyCommand(r, profile.id, command, Date.now());
    await commit(r);
    if (command.type === "kick" && command.target)
      active
        .get(command.target)
        ?.emit("removed", "Oda sahibi sizi lobiden çıkardı.");
    if (command.type === "leave") socket.emit("removed", "Odadan ayrıldınız.");
    return { ok: true };
  });
  void exclusive(async () => {
    const r = membership(profile.id);
    if (r) {
      const copy = structuredClone(r);
      await catchUp(copy);
      const p = copy.players.find((p) => p.id === profile.id)!;
      p.connected = true;
      p.disconnectedAt = undefined;
      copy.emptySince = undefined;
      await commit(copy);
    } else socket.emit("removed", "");
  }).catch(() => socket.emit("notice", "Durum alınamadı. Sayfayı yenileyin."));
  socket.on("disconnect", () => {
    void exclusive(async () => {
      if (active.get(profile.id) !== socket) return;
      active.delete(profile.id);
      const r = membership(profile.id);
      if (r) {
        const copy = structuredClone(r);
        const p = copy.players.find((p) => p.id === profile.id)!;
        p.connected = false;
        p.disconnectedAt = Date.now();
        if (!copy.players.some((p) => isParticipant(p) && p.connected))
          copy.emptySince ??= Date.now();
        await commit(copy);
      }
    }).catch(() => {});
  });
});
let ticking = false;
const timer = setInterval(() => {
  if (ticking) return;
  ticking = true;
  void exclusive(async () => {
    for (const original of rooms.values()) {
      const r = structuredClone(original);
      let changed = false;
      const now = Date.now();
      changed = await catchUp(r);
      const host = r.players.find((p) => p.id === r.hostId);
      if (
        host &&
        !host.connected &&
        host.disconnectedAt &&
        now - host.disconnectedAt >= 20_000
      ) {
        const next = r.players.find((p) => isParticipant(p) && p.connected);
        if (next) {
          r.hostId = next.id;
          changed = true;
        }
      }
      if (changed) await commit(r);
    }
    for (const [key, b] of buckets)
      if (b.until < Date.now()) buckets.delete(key);
  })
    .catch(() =>
      console.error(
        "Durum kaydı başarısız; bir sonraki döngüde yeniden denenecek.",
      ),
    )
    .finally(() => (ticking = false));
}, 250);
app.use(express.static(path.resolve("dist"), { index: false }));
app.get("/{*splat}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
http.listen(port, process.env.HOST ?? "0.0.0.0", () =>
  console.log(`Gece Kasabası http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    http.close();
    io.close();
    void queue.finally(() => store.close()).finally(() => process.exit(0));
  });
