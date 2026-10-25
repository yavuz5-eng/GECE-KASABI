import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createRoom,
  newPlayer,
  addPlayer,
  applyCommand,
  advance,
  playerView,
  winner,
  type Room,
} from "../server/engine";
import {
  settingsSchema,
  suggestedSettings,
  type Role,
  type Command,
} from "../shared/protocol";
function fixture(
  roles: Role[] = ["vampire", "doctor", "seer", "hunter", "jester", "villager"],
): Room {
  const s = suggestedSettings(roles.length);
  const r = createRoom("ABC234", newPlayer("p0", "Oyuncu0", "🦊"), s, 0);
  roles
    .slice(1)
    .forEach((_, i) =>
      addPlayer(r, newPlayer(`p${i + 1}`, `Oyuncu${i + 1}`, "🦊")),
    );
  r.players.forEach((p, i) => (p.role = roles[i]));
  r.phase = "night";
  r.day = 1;
  r.deadline = 10_000;
  return r;
}
function act(
  r: Room,
  id: string,
  type: Command["type"],
  target?: string | null,
  extra: Partial<Command> = {},
) {
  applyCommand(
    r,
    id,
    {
      type,
      target,
      roomCode: r.code,
      phaseVersion: r.phaseVersion,
      actionId: randomUUID(),
      ...extra,
    },
    1,
  );
}
function resolve(r: Room) {
  advance(r, r.deadline!);
  if (r.phase === "nightResolution" || r.phase === "voteResolution")
    advance(r, r.deadline!);
}
describe("role allocation and validation", () => {
  for (let n = 5; n <= 16; n++)
    it(`${n} player recommendation is valid and assigned exactly`, () => {
      const s = suggestedSettings(n);
      expect(settingsSchema.safeParse(s).success).toBe(true);
      const r = createRoom("ABC234", newPlayer("p0", "Test", "🦊"), s, 0);
      for (let i = 1; i < n; i++)
        addPlayer(r, newPlayer(`p${i}`, `Test${i}`, "🦊"));
      r.players.forEach((p) => (p.ready = true));
      act(r, "p0", "start");
      for (const [role, count] of Object.entries(s.roles))
        expect(r.players.filter((p) => p.role === role)).toHaveLength(count);
      expect(r.phase).toBe("reveal");
    });
  it("rejects parity, bad totals and multiple special roles", () => {
    const s = suggestedSettings(6);
    expect(
      settingsSchema.safeParse({
        ...s,
        roles: { ...s.roles, vampire: 3, villager: 1 },
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...s, roles: { ...s.roles, doctor: 2 } })
        .success,
    ).toBe(false);
  });
  it("requires capacity, host and ready players", () => {
    const r = fixture();
    r.phase = "lobby";
    expect(() => act(r, "p1", "start")).toThrow();
    expect(() => act(r, "p0", "start")).toThrow();
  });
});
describe("night resolution", () => {
  it("vampire tie causes no attack", () => {
    const r = fixture([
      "vampire",
      "vampire",
      "villager",
      "villager",
      "villager",
      "villager",
    ]);
    act(r, "p0", "night", "p2");
    act(r, "p1", "night", "p3");
    resolve(r);
    expect(r.players.every((p) => p.alive)).toBe(true);
  });
  it("no selection means no attack", () => {
    const r = fixture();
    resolve(r);
    expect(r.players.every((p) => p.alive)).toBe(true);
  });
  it("plurality attack works", () => {
    const r = fixture([
      "vampire",
      "vampire",
      "villager",
      "villager",
      "villager",
      "villager",
    ]);
    act(r, "p0", "night", "p2");
    act(r, "p1", "night", "p2");
    resolve(r);
    expect(r.players[2].alive).toBe(false);
  });
  it("doctor protects and cannot protect same target next night", () => {
    const r = fixture();
    act(r, "p0", "night", "p2");
    act(r, "p1", "night", "p2");
    resolve(r);
    expect(r.players[2].alive).toBe(true);
    r.phase = "night";
    r.deadline = 100_000;
    expect(() => act(r, "p1", "night", "p2")).toThrow("Önceki");
    act(r, "p1", "night", "p1");
  });
  it("a skipped doctor night clears consecutive target restriction", () => {
    const r = fixture();
    r.players[1].previousProtection = "p2";
    resolve(r);
    expect(r.players[1].previousProtection).toBeUndefined();
  });
  it("seer receives result even when killed that night", () => {
    const r = fixture();
    act(r, "p2", "night", "p0");
    act(r, "p0", "night", "p2");
    resolve(r);
    expect(r.players[2].alive).toBe(false);
    expect(r.players[2].history[0].vampire).toBe(true);
    expect(playerView(r, "p0", 0).me.history).toEqual([]);
  });
  it("jester appears non-vampire to seer and does not win by night death", () => {
    const r = fixture();
    act(r, "p2", "night", "p4");
    act(r, "p0", "night", "p4");
    resolve(r);
    expect(r.players[2].history[0].vampire).toBe(false);
    expect(r.winner).not.toBe("jester");
  });
  it("all actions do not end night early", () => {
    const r = fixture();
    act(r, "p0", "night", "p4");
    act(r, "p1", "night", "p4");
    act(r, "p2", "night", "p4");
    expect(r.phase).toBe("night");
    expect(advance(r, 9999)).toBe(false);
  });
});
describe("voting and wins", () => {
  it("candidate tie eliminates nobody", () => {
    const r = fixture();
    r.phase = "vote";
    r.votes = { p0: "p2", p1: "p2", p2: "p0", p3: "p0", p4: null, p5: null };
    resolve(r);
    expect(r.players.every((p) => p.alive)).toBe(true);
  });
  it("pass tie prevents elimination, missing votes are pass", () => {
    const r = fixture();
    r.phase = "vote";
    r.votes = { p1: "p0", p2: "p0", p3: "p0" };
    resolve(r);
    expect(r.players[0].alive).toBe(true);
    expect(r.voteResult?.pass).toBe(3);
  });
  it("vote can change and cannot target self", () => {
    const r = fixture();
    r.phase = "vote";
    act(r, "p1", "vote", "p0");
    act(r, "p1", "vote", null);
    expect(r.votes.p1).toBeNull();
    expect(() => act(r, "p0", "vote", "p0")).toThrow();
  });
  it("jester vote victory has priority", () => {
    const r = fixture();
    r.phase = "vote";
    r.votes = { p0: "p4", p1: "p4", p2: "p4", p3: "p4", p4: null, p5: "p4" };
    resolve(r);
    expect(r.winner).toBe("jester");
  });
  it("hunter resolves before parity, protection does not stop hunter", () => {
    const r = fixture(["vampire", "hunter", "doctor", "villager", "villager"]);
    r.players[3].alive = false;
    r.players[4].alive = false;
    act(r, "p0", "night", "p1");
    act(r, "p2", "night", "p0");
    resolve(r);
    expect(r.phase).toBe("hunter");
    expect(r.winner).toBeUndefined();
    act(r, "p1", "hunt", "p0");
    resolve(r);
    expect(r.winner).toBe("village");
  });
  it("hunter killing jester does not grant jester victory", () => {
    const r = fixture();
    act(r, "p0", "night", "p3");
    resolve(r);
    act(r, "p3", "hunt", "p4");
    resolve(r);
    expect(r.players[4].alive).toBe(false);
    expect(r.winner).not.toBe("jester");
  });
  it("hunter timeout continues with normal team victory", () => {
    const r = fixture([
      "vampire",
      "hunter",
      "villager",
      "villager",
      "villager",
    ]);
    r.players[3].alive = false;
    r.players[4].alive = false;
    act(r, "p0", "night", "p1");
    resolve(r);
    resolve(r);
    expect(r.winner).toBe("vampire");
  });
  it("all winning conditions", () => {
    const r = fixture();
    r.players.forEach((p) => (p.alive = false));
    expect(winner(r)).toBe("draw");
    r.players[1].alive = true;
    expect(winner(r)).toBe("village");
    r.players[0].alive = true;
    expect(winner(r)).toBe("vampire");
    r.players[2].alive = true;
    expect(winner(r)).toBeUndefined();
  });
});
describe("privacy and authority", () => {
  it("non-owner and owner cannot see other roles, actions or seer history", () => {
    const r = fixture();
    r.hostId = "p5";
    act(r, "p0", "night", "p4");
    r.players[2].history = [
      { day: 0, targetName: "unique-secret", vampire: true },
    ];
    for (const id of ["p1", "p3", "p4", "p5"]) {
      const v = playerView(r, id, 0);
      expect(v.players.every((p) => !("role" in p))).toBe(true);
      expect(JSON.stringify(v)).not.toContain("unique-secret");
      expect(v.me.teammates).toBeUndefined();
      expect(v).not.toHaveProperty("actions");
      expect(v).not.toHaveProperty("votes");
    }
  });
  it("only living vampires receive current teammate selections", () => {
    const r = fixture([
      "vampire",
      "vampire",
      "doctor",
      "seer",
      "villager",
      "villager",
    ]);
    act(r, "p0", "night", "p4");
    expect(playerView(r, "p1", 0).me.teammates?.[0].target).toBe("p4");
    r.players[1].alive = false;
    expect(playerView(r, "p1", 0).me.teammates).toBeUndefined();
  });
  it("votes are hidden until resolution", () => {
    const r = fixture();
    r.phase = "vote";
    act(r, "p0", "vote", "p4");
    const v = playerView(r, "p1", 0);
    expect(v.voteCount).toBe(1);
    expect(v.voteResult).toBeUndefined();
    expect(v.me.selection).toBeUndefined();
  });
  it("dead, wrong-role, wrong-target and impersonation payloads rejected", () => {
    const r = fixture();
    r.players[5].alive = false;
    expect(() => act(r, "p5", "night", "p0")).toThrow();
    expect(() => act(r, "p4", "night", "p0")).toThrow();
    expect(() => act(r, "p0", "night", "p0")).toThrow();
    expect(() => act(r, "p2", "night", "p2")).toThrow();
    expect(() => act(r, "p1", "night", "unknown")).toThrow();
    expect(() =>
      applyCommand(
        r,
        "p0",
        {
          type: "night",
          target: "p4",
          roomCode: r.code,
          phaseVersion: 0,
          actionId: randomUUID(),
          playerId: "p1",
        } as Command,
        1,
      ),
    ).toThrow();
  });
  it("duplicate, stale and deadline-expired messages rejected", () => {
    const r = fixture();
    const c: Command = {
      type: "night",
      target: "p4",
      roomCode: r.code,
      phaseVersion: 0,
      actionId: randomUUID(),
    };
    applyCommand(r, "p0", c, 1);
    expect(() => applyCommand(r, "p0", c, 2)).toThrow("zaten");
    expect(() =>
      applyCommand(
        r,
        "p0",
        { ...c, actionId: randomUUID(), phaseVersion: 99 },
        2,
      ),
    ).toThrow("faz");
    expect(() =>
      applyCommand(r, "p0", { ...c, actionId: randomUUID() }, 10000),
    ).toThrow("süresi");
  });
  it("recovery resolves once and views cannot mutate state", () => {
    const r = fixture();
    act(r, "p0", "night", "p5");
    advance(r, 10000);
    const restored = JSON.parse(JSON.stringify(r)) as Room;
    advance(restored, 11000);
    expect(advance(restored, 11000)).toBe(false);
    expect(restored.logs.filter((l) => l.text.includes("elendi"))).toHaveLength(
      1,
    );
    const v = playerView(restored, "p0", 0);
    v.settings.capacity = 99;
    expect(restored.settings.capacity).toBe(6);
  });
});
