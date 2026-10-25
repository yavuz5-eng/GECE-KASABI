import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createRoom,
  newPlayer,
  addPlayer,
  applyCommand,
  advance,
  playerView,
  isParticipant,
  type Room,
} from "../server/engine";
import {
  suggestedSettings,
  nicknameSchema,
  profileSchema,
  type Command,
  type Role,
} from "../shared/protocol";
function room(): Room {
  const r = createRoom(
    "ABC234",
    newPlayer("p0", "Host", "🦊"),
    suggestedSettings(6),
    0,
  );
  for (let i = 1; i < 6; i++)
    addPlayer(r, newPlayer(`p${i}`, `Player${i}`, "🦊"));
  const roles: Role[] = [
    "villager",
    "vampire",
    "doctor",
    "seer",
    "hunter",
    "jester",
  ];
  r.players.forEach((p, i) => (p.role = roles[i]));
  r.phase = "night";
  r.day = 1;
  r.deadline = 10000;
  r.matchId = randomUUID();
  return r;
}
function command(
  r: Room,
  id: string,
  type: Command["type"],
  target?: string | null,
) {
  applyCommand(
    r,
    id,
    {
      roomCode: r.code,
      phaseVersion: r.phaseVersion,
      actionId: randomUUID(),
      type,
      target,
    },
    100,
  );
}
describe("explicit departure", () => {
  it("keeps historical role but revokes all commands and views; transfers ownership", () => {
    const r = room();
    command(r, "p0", "leave");
    const p = r.players[0];
    expect(p.role).toBe("villager");
    expect(p.alive).toBe(false);
    expect(p.connected).toBe(false);
    expect(isParticipant(p)).toBe(false);
    expect(r.hostId).toBe("p1");
    expect(() => playerView(r, "p0", 101)).toThrow("odada");
    expect(() => command(r, "p0", "night", "p2")).toThrow("odada");
    expect(playerView(r, "p2", 101).players[0].departed).toBe(true);
  });
  it("cleans both outgoing actions and actions targeting the departing player", () => {
    const r = room();
    r.actions = { p1: "p0", p2: "p0", p3: "p0", p0: "p2" };
    r.votes = { p0: "p1", p1: "p0", p2: "p3" };
    command(r, "p0", "leave");
    expect(r.actions).toEqual({});
    expect(r.votes).toEqual({ p2: "p3" });
    advance(r, 10000);
    advance(r, 11000);
    expect(r.players[2].alive).toBe(true);
    expect(r.players[3].history).toEqual([]);
  });
  it("invalidated votes count as pass, departed players no longer vote", () => {
    const r = room();
    r.phase = "vote";
    r.votes = { p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: "p1", p5: null };
    command(r, "p0", "leave");
    advance(r, 10000);
    advance(r, 11000);
    expect(r.voteResult).toEqual({ votes: { p1: 2 }, pass: 3 });
    expect(r.players[1].alive).toBe(true);
  });
  it.each(["p4", "p5"])(
    "leaving as special role %s does not trigger its ability or personal victory",
    (id) => {
      const r = room();
      r.phase = "vote";
      command(r, id, "leave");
      expect(r.hunterId).toBeUndefined();
      expect(r.winner).toBeUndefined();
      expect(r.phase).toBe("vote");
    },
  );
  it("leaving vampire causes village win but preserves the record", () => {
    const r = room();
    command(r, "p1", "leave");
    expect(r.winner).toBe("village");
    expect(r.players).toHaveLength(6);
  });
  it("last explicit participant closes unfinished before team victory", () => {
    const r = room();
    r.players.slice(1).forEach((p) => {
      p.leftAt = 1;
      p.alive = false;
      p.connected = false;
    });
    command(r, "p0", "leave");
    expect(r.winner).toBe("unfinished");
    expect(r.deadline).toBeNull();
    expect(advance(r, 10000000)).toBe(false);
  });
  it("pending hunter resolves before team victory and departing hunter cancels it", () => {
    const r = room();
    r.phase = "hunter";
    r.hunterId = "p4";
    r.afterHunter = "day";
    r.players[4].alive = false;
    r.actions.p4 = "p2";
    command(r, "p1", "leave");
    expect(r.winner).toBeUndefined();
    command(r, "p4", "leave");
    expect(r.winner).toBe("village");
    expect(r.players[2].alive).toBe(true);
    expect(r.hunterId).toBeUndefined();
  });
  it("legacy snapshots remain active and disconnected players return with same role", () => {
    const r = JSON.parse(JSON.stringify(room())) as Room;
    r.players[0].connected = false;
    r.emptySince = 0;
    expect(isParticipant(r.players[0])).toBe(true);
    expect(playerView(r, "p0", 1).me.role).toBe("villager");
    expect(advance(r, 500)).toBe(false);
  });
  it("all offline timeout closes once before resolving overdue phases", () => {
    const r = room();
    r.players.forEach((p) => (p.connected = false));
    r.emptySince = 0;
    expect(advance(r, 30 * 60_000)).toBe(true);
    expect(r.winner).toBe("unfinished");
    expect(r.day).toBe(1);
    expect(advance(r, 60 * 60_000)).toBe(false);
  });
  it("a connected participant prevents stale emptySince from abandoning", () => {
    const r = room();
    r.emptySince = 0;
    advance(r, 30 * 60_000);
    expect(r.winner).toBeUndefined();
  });
  it("stale confirmation may leave its room, but never a different room", () => {
    const r = room();
    r.phaseVersion = 12;
    applyCommand(
      r,
      "p0",
      {
        roomCode: r.code,
        phaseVersion: 0,
        type: "leave",
        actionId: randomUUID(),
      },
      20000,
    );
    expect(isParticipant(r.players[0])).toBe(false);
    const next = room();
    expect(() =>
      applyCommand(
        next,
        "p0",
        {
          roomCode: "ZZZ234",
          phaseVersion: 0,
          type: "leave",
          actionId: randomUUID(),
        },
        1,
      ),
    ).toThrow("başka");
  });
  it("rematch excludes historical leavers and retains active participants", () => {
    const r = room();
    command(r, "p0", "leave");
    r.phase = "ended";
    command(r, "p1", "rematch");
    expect(r.players).toHaveLength(5);
    expect(r.players.some((p) => p.id === "p0")).toBe(false);
    expect(r.players.every((p) => p.alive && !p.ready)).toBe(true);
  });
});
describe("shared nickname validation", () => {
  it.each(["", " ", "   \t "])(
    "rejects blank name with the exact visible error",
    (nickname) => {
      const r = profileSchema.safeParse({ nickname, avatar: "🦊" });
      expect(r.success).toBe(false);
      if (!r.success)
        expect(r.error.issues[0].message).toBe(
          "İsim girilmedi. Lütfen bir oyuncu adı yaz.",
        );
    },
  );
  it("keeps existing length, character and trim constraints", () => {
    expect(nicknameSchema.parse("  Ayşe  ")).toBe("Ayşe");
    for (const s of ["a", "x".repeat(21), "<script>"])
      expect(nicknameSchema.safeParse(s).success).toBe(false);
  });
});
