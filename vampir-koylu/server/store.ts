import { PrismaClient, Prisma } from "@prisma/client";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { Room } from "./engine.js";
export interface Profile {
  id: string;
  sessionHash: string;
  nickname: string;
  avatar: string;
}
export interface History {
  id: string;
  roomCode: string;
  result: string;
  endedAt: string;
  summary: {
    players: { id: string; nickname: string; role?: string }[];
    logs: Room["logs"];
  };
  outcome: string;
}
export interface Store {
  rooms(): Promise<Room[]>;
  profile(hash: string): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;
  saveRoom(room: Room): Promise<void>;
  history(id: string): Promise<History[]>;
  close(): Promise<void>;
}
function outcome(room: Room, p: Room["players"][number]) {
  if (room.winner === "unfinished") return "unfinished";
  if (room.winner === "draw") return "draw";
  return (room.winner === "vampire" && p.role === "vampire") ||
    (room.winner === "jester" && p.role === "jester") ||
    (room.winner === "village" && p.role !== "vampire" && p.role !== "jester")
    ? "win"
    : "loss";
}
function matchData(r: Room) {
  return {
    id: r.matchId!,
    roomCode: r.code,
    result: r.winner!,
    summary: {
      players: r.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        role: p.role,
      })),
      logs: r.logs,
    },
  };
}
export class PostgresStore implements Store {
  db = new PrismaClient();
  async rooms() {
    return (await this.db.room.findMany()).map(
      (r) => r.state as unknown as Room,
    );
  }
  async profile(sessionHash: string) {
    return this.db.profile.findUnique({ where: { sessionHash } });
  }
  async saveProfile(p: Profile) {
    await this.db.profile.upsert({
      where: { id: p.id },
      create: p,
      update: { nickname: p.nickname, avatar: p.avatar },
    });
  }
  async saveRoom(r: Room) {
    await this.db.$transaction(async (db) => {
      await db.room.upsert({
        where: { code: r.code },
        create: {
          code: r.code,
          state: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue,
        },
        update: {
          state: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue,
        },
      });
      if (r.phase === "ended" && r.matchId) {
        const data = matchData(r);
        await db.match.upsert({
          where: { id: data.id },
          update: {},
          create: {
            ...data,
            summary: JSON.parse(
              JSON.stringify(data.summary),
            ) as Prisma.InputJsonValue,
            participants: {
              create: r.players.map((p) => ({
                profileId: p.id,
                outcome: outcome(r, p),
              })),
            },
          },
        });
      }
    });
  }
  async history(profileId: string): Promise<History[]> {
    const rows = await this.db.participation.findMany({
      where: { profileId },
      include: { match: true },
      orderBy: { match: { endedAt: "desc" } },
      take: 100,
    });
    return rows.map((r) => ({
      ...r.match,
      endedAt: r.match.endedAt.toISOString(),
      summary: r.match.summary as unknown as History["summary"],
      outcome: r.outcome,
    }));
  }
  async close() {
    await this.db.$disconnect();
  }
}
// Disk adapter is deliberately unavailable outside NODE_ENV=test.
export class TestStore implements Store {
  private data: {
    rooms: Record<string, Room>;
    profiles: Record<string, Profile>;
    history: Record<string, History[]>;
  } = { rooms: {}, profiles: {}, history: {} };
  constructor(private file: string) {
    if (process.env.NODE_ENV !== "test")
      throw new Error("Test adapter disabled");
  }
  async load() {
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  async flush() {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file + ".tmp", JSON.stringify(this.data));
    await rename(this.file + ".tmp", this.file);
  }
  async rooms() {
    return structuredClone(Object.values(this.data.rooms));
  }
  async profile(hash: string) {
    return structuredClone(
      Object.values(this.data.profiles).find((p) => p.sessionHash === hash) ??
        null,
    );
  }
  async saveProfile(p: Profile) {
    this.data.profiles[p.id] = structuredClone(p);
    await this.flush();
  }
  async saveRoom(r: Room) {
    this.data.rooms[r.code] = structuredClone(r);
    if (r.phase === "ended" && r.matchId)
      for (const p of r.players) {
        const list = (this.data.history[p.id] ??= []);
        if (!list.some((h) => h.id === r.matchId))
          list.unshift({
            ...matchData(r),
            endedAt: new Date().toISOString(),
            outcome: outcome(r, p),
          });
      }
    await this.flush();
  }
  async history(id: string) {
    return structuredClone(this.data.history[id] ?? []);
  }
  async close() {}
}
