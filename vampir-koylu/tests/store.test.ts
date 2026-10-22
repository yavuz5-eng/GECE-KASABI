import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createRoom, newPlayer } from "../server/engine";
import { suggestedSettings } from "../shared/protocol";
import { PostgresStore, TestStore, type Store } from "../server/store";
async function verify(store: Store) {
  const id = randomUUID();
  const p = { id, sessionHash: randomUUID(), nickname: "Kalıcı", avatar: "🦊" };
  await store.saveProfile(p);
  expect((await store.profile(p.sessionHash))?.id).toBe(id);
  const room = createRoom(
    randomUUID(),
    newPlayer(id, p.nickname, p.avatar),
    suggestedSettings(),
    Date.now(),
  );
  room.players[0].role = "villager";
  room.players[0].alive = false;
  room.matchId = randomUUID();
  room.phase = "night";
  await store.saveRoom(room);
  expect(await store.history(id)).toEqual([]);
  room.phase = "ended";
  room.winner = "village";
  await store.saveRoom(room);
  await store.saveRoom(room);
  let history = await store.history(id);
  expect(history).toHaveLength(1);
  expect(history[0].outcome).toBe("win");
  const loaded = (await store.rooms()).find((r) => r.code === room.code)!;
  expect(loaded.players[0].role).toBe("villager");
  expect(loaded.phase).toBe("ended");
  room.matchId = randomUUID();
  room.winner = "unfinished";
  await store.saveRoom(room);
  history = await store.history(id);
  expect(history).toHaveLength(2);
  expect(history.find((h) => h.id === room.matchId)?.outcome).toBe(
    "unfinished",
  );
  await store.close();
}
it("test store persists and writes history exactly once, only after ending", async () => {
  const s = new TestStore(`.test-data/store-${randomUUID()}.json`);
  await s.load();
  await verify(s);
});
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL commits room and history atomically and idempotently",
  async () => {
    const s = new PostgresStore();
    await s.db.$disconnect();
    const { PrismaClient } = await import("@prisma/client");
    s.db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    try {
      await verify(s);
    } finally {
      await s.close();
    }
  },
);
