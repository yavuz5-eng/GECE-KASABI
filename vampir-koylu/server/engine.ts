import { randomInt, randomUUID } from "node:crypto";
import {
  commandSchema,
  settingsSchema,
  type Command,
  type Settings,
  type Role,
  type Phase,
  type Winner,
  type RoomView,
  type LogEntry,
} from "../shared/protocol.js";
export interface Player {
  id: string;
  nickname: string;
  avatar: string;
  connected: boolean;
  disconnectedAt?: number;
  leftAt?: number;
  ready: boolean;
  alive: boolean;
  role?: Role;
  previousProtection?: string;
  history: { day: number; targetName: string; vampire: boolean }[];
}
export interface Room {
  code: string;
  hostId: string;
  settings: Settings;
  phase: Phase;
  phaseVersion: number;
  deadline: number | null;
  day: number;
  players: Player[];
  actions: Record<string, string>;
  votes: Record<string, string | null>;
  seen: string[];
  logs: LogEntry[];
  voteResult?: { votes: Record<string, number>; pass: number };
  hunterId?: string;
  afterHunter?: "day" | "night";
  winner?: Winner;
  matchId?: string;
  emptySince?: number;
  createdAt: number;
}
const fail = (text: string): never => {
  throw new Error(text);
};
// Missing leftAt in older snapshots means the player is still a participant.
export const isParticipant = (p: Player) => p.leftAt === undefined;
const isAlive = (p: Player) => isParticipant(p) && p.alive;
export const activeMatch = (room: Room) =>
  room.phase !== "lobby" && room.phase !== "ended";
function transferHost(room: Room) {
  const remaining = room.players.filter(isParticipant);
  room.hostId =
    remaining.find((p) => p.connected)?.id ?? remaining[0]?.id ?? "";
}
function leaveRoom(room: Room, p: Player, now: number) {
  if (room.phase === "lobby")
    room.players = room.players.filter((x) => x.id !== p.id);
  else {
    p.leftAt = now;
    p.connected = false;
    p.ready = false;
    if (activeMatch(room)) p.alive = false;
  }
  delete room.actions[p.id];
  delete room.votes[p.id];
  for (const [id, target] of Object.entries(room.actions))
    if (target === p.id) delete room.actions[id];
  for (const [id, target] of Object.entries(room.votes))
    if (target === p.id) delete room.votes[id];
  if (room.hostId === p.id) transferHost(room);
  if (room.players.some((x) => isParticipant(x) && x.connected))
    room.emptySince = undefined;
  else room.emptySince ??= now;
  if (!activeMatch(room)) return;
  log(room, `${p.nickname} oyundan ayrıldı.`);
  if (!room.players.some(isParticipant)) {
    abandon(room, now);
    return;
  }
  if (room.hunterId === p.id) {
    const next = room.afterHunter!;
    room.hunterId = undefined;
    room.afterHunter = undefined;
    resume(room, next, now);
  } else if (!room.hunterId) {
    const result = winner(room);
    if (result) finish(room, result, now);
  }
}
export function createRoom(
  code: string,
  player: Player,
  settings: Settings,
  now: number,
): Room {
  settingsSchema.parse(settings);
  return {
    code,
    hostId: player.id,
    settings,
    phase: "lobby",
    phaseVersion: 0,
    deadline: null,
    day: 0,
    players: [player],
    actions: {},
    votes: {},
    seen: [],
    logs: [],
    createdAt: now,
  };
}
export function newPlayer(
  id: string,
  nickname: string,
  avatar: string,
): Player {
  return {
    id,
    nickname,
    avatar,
    connected: true,
    ready: false,
    alive: true,
    history: [],
  };
}
export function addPlayer(room: Room, p: Player) {
  if (room.phase !== "lobby") fail("Maç başladı; yeni katılım kapalı.");
  if (room.players.length >= room.settings.capacity) fail("Oda dolu.");
  if (room.players.some((x) => x.id === p.id)) fail("Zaten bu odadasınız.");
  room.players.push(p);
}
function enter(room: Room, phase: Phase, now: number, seconds?: number) {
  room.phase = phase;
  room.phaseVersion++;
  room.deadline = seconds === undefined ? null : now + seconds * 1000;
  room.seen = [];
}
function log(room: Room, text: string) {
  room.logs.push({ day: room.day, text });
}
function nextNight(room: Room, now: number) {
  room.day++;
  room.actions = {};
  room.votes = {};
  enter(room, "night", now, room.settings.nightSeconds);
  log(room, `${room.day}. gece başladı.`);
}
export function winner(room: Room): Winner | undefined {
  const alive = room.players.filter(isAlive);
  const vampires = alive.filter((p) => p.role === "vampire").length;
  if (!alive.length) return "draw";
  if (!vampires) return "village";
  if (vampires >= alive.length - vampires) return "vampire";
}
function finish(room: Room, result: Winner, now: number) {
  room.winner = result;
  enter(room, "ended", now);
  log(
    room,
    result === "unfinished"
      ? "Tüm oyuncular ayrıldığı için maç tamamlanmadı."
      : "Maç sona erdi.",
  );
}
export function abandon(room: Room, now: number) {
  finish(room, "unfinished", now);
}
function resume(room: Room, next: "day" | "night", now: number) {
  const result = winner(room);
  if (result) return finish(room, result, now);
  if (next === "night") nextNight(room, now);
  else enter(room, "day", now, room.settings.daySeconds);
}
function eliminate(
  room: Room,
  id: string,
  reason: "night" | "vote" | "hunter",
  now: number,
  next: "day" | "night",
) {
  const p = room.players.find((p) => p.id === id)!;
  p.alive = false;
  log(
    room,
    `${p.nickname} ${reason === "night" ? "gece" : reason === "vote" ? "oylamayla" : "avcının seçimiyle"} elendi.`,
  );
  if (p.role === "jester" && reason === "vote") {
    finish(room, "jester", now);
    return;
  }
  if (p.role === "hunter" && reason !== "hunter") {
    room.hunterId = p.id;
    room.afterHunter = next;
    enter(room, "hunter", now, 15);
    return;
  }
  resume(room, next, now);
}
export function assignRoles(room: Room) {
  const pool = Object.entries(room.settings.roles).flatMap(
    ([role, count]) => Array(count).fill(role) as Role[],
  );
  if (pool.length !== room.players.length)
    fail("Rol sayısı oyuncu sayısıyla eşleşmiyor.");
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  room.players.forEach((p, i) => {
    p.role = pool[i];
    p.alive = true;
    p.history = [];
    p.previousProtection = undefined;
  });
}
export function applyCommand(
  room: Room,
  playerId: string,
  input: Command,
  now: number,
) {
  const c = commandSchema.parse(input);
  const p =
    room.players.find((p) => p.id === playerId && isParticipant(p)) ??
    fail("Bu odada değilsiniz.");
  if (c.roomCode !== room.code) fail("Bu komut başka bir odaya ait.");
  if (c.type !== "leave" && c.phaseVersion !== room.phaseVersion)
    fail("Bu faz sona erdi; güncel ekranı kullanın.");
  if (c.type !== "leave" && room.deadline !== null && now >= room.deadline)
    fail("Eylem süresi doldu.");
  if (room.seen.includes(c.actionId)) fail("Bu eylem zaten işlendi.");
  if (c.type !== "leave" && room.seen.length >= 4096)
    fail("Bu faz için eylem sınırına ulaşıldı.");
  const host = () => {
    if (room.hostId !== p.id) fail("Yalnız oda sahibi yapabilir.");
  };
  const phase = (s: Phase) => {
    if (room.phase !== s) fail("Bu eylem bu fazda yapılamaz.");
  };
  const target = () =>
    room.players.find((x) => x.id === c.target && isAlive(x)) ??
    fail("Yaşayan bir hedef seçin.");
  switch (c.type) {
    case "ready":
      phase("lobby");
      if (c.ready === undefined) fail("Hazır bilgisi eksik.");
      p.ready = c.ready!;
      break;
    case "settings":
      phase("lobby");
      host();
      if (!c.settings) fail("Ayarlar eksik.");
      if (c.settings!.capacity < room.players.length)
        fail("Kapasite mevcut oyuncu sayısından az olamaz.");
      room.settings = settingsSchema.parse(c.settings);
      room.players.forEach((x) => (x.ready = false));
      break;
    case "kick":
      phase("lobby");
      host();
      if (c.target === p.id) fail("Kendinizi çıkaramazsınız.");
      if (!room.players.some((x) => x.id === c.target))
        fail("Oyuncu bulunamadı.");
      room.players = room.players.filter((x) => x.id !== c.target);
      break;
    case "leave":
      leaveRoom(room, p, now);
      break;
    case "start":
      phase("lobby");
      host();
      settingsSchema.parse(room.settings);
      if (
        room.players.length !== room.settings.capacity ||
        !room.players.every((x) => x.ready && x.connected)
      )
        fail("Kapasite dolmalı ve herkes bağlı, hazır olmalı.");
      assignRoles(room);
      room.matchId = randomUUID();
      room.logs = [];
      room.day = 0;
      room.winner = undefined;
      enter(room, "reveal", now, 8);
      log(room, "Roller gizlice dağıtıldı.");
      break;
    case "rematch":
      phase("ended");
      host();
      room.players = room.players.filter(isParticipant);
      room.players.forEach((x) => {
        x.role = undefined;
        x.alive = true;
        x.ready = false;
        x.history = [];
        x.previousProtection = undefined;
      });
      room.actions = {};
      room.votes = {};
      room.logs = [];
      room.day = 0;
      room.winner = undefined;
      room.matchId = undefined;
      room.voteResult = undefined;
      room.hunterId = undefined;
      enter(room, "lobby", now);
      break;
    case "night": {
      phase("night");
      if (!p.alive) fail("Elenen oyuncu eylem yapamaz.");
      const t = target();
      if (p.role === "vampire") {
        if (t.role === "vampire") fail("Vampirler hedef seçilemez.");
      } else if (p.role === "doctor") {
        if (t.id === p.previousProtection)
          fail("Önceki geceki hedefi koruyamazsınız.");
      } else if (p.role === "seer") {
        if (t.id === p.id) fail("Kendinizi inceleyemezsiniz.");
      } else fail("Bu rolün gece eylemi yok.");
      room.actions[p.id] = t.id;
      break;
    }
    case "vote":
      phase("vote");
      if (!p.alive) fail("Elenen oyuncu oy veremez.");
      if (c.target !== null) {
        const t = target();
        if (t.id === p.id) fail("Kendinize oy veremezsiniz.");
      }
      room.votes[p.id] = c.target ?? null;
      break;
    case "hunt":
      phase("hunter");
      if (room.hunterId !== p.id || p.role !== "hunter")
        fail("Bu yetki avcıya ait.");
      if (target().id === p.id) fail("Başka birini seçin.");
      room.actions[p.id] = c.target!;
      break;
  }
  room.seen.push(c.actionId);
}
export function advance(room: Room, now: number): boolean {
  if (
    activeMatch(room) &&
    (!room.players.some(isParticipant) ||
      (!room.players.some((p) => isParticipant(p) && p.connected) &&
        room.emptySince !== undefined &&
        now - room.emptySince >= 30 * 60_000))
  ) {
    abandon(room, now);
    return true;
  }
  if (room.deadline === null || now < room.deadline) return false;
  const at = room.deadline;
  switch (room.phase) {
    case "reveal":
      nextNight(room, at);
      break;
    case "night":
      enter(room, "nightResolution", at, 1);
      break;
    case "nightResolution": {
      const alive = room.players.filter(isAlive);
      const counts: Record<string, number> = {};
      let protection: string | undefined;
      for (const p of alive) {
        const requested = room.actions[p.id];
        const t = alive.some((x) => x.id === requested) ? requested : undefined;
        if (p.role === "doctor") {
          protection = t;
          p.previousProtection = t;
        }
        if (p.role === "vampire" && t) counts[t] = (counts[t] ?? 0) + 1;
        if (p.role === "seer" && t) {
          const subject = alive.find((x) => x.id === t);
          if (subject)
            p.history.push({
              day: room.day,
              targetName: subject.nickname,
              vampire: subject.role === "vampire",
            });
        }
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const hit =
        sorted.length && sorted[0][1] > (sorted[1]?.[1] ?? 0)
          ? sorted[0][0]
          : undefined;
      if (hit && hit !== protection) eliminate(room, hit, "night", at, "day");
      else {
        log(room, "Bu gece kimse elenmedi.");
        resume(room, "day", at);
      }
      break;
    }
    case "day":
      room.votes = {};
      enter(room, "vote", at, room.settings.voteSeconds);
      break;
    case "vote":
      enter(room, "voteResolution", at, 1);
      break;
    case "voteResolution": {
      const votes: Record<string, number> = {};
      let pass = 0;
      for (const p of room.players.filter(isAlive)) {
        const t = room.votes[p.id];
        if (t && room.players.some((x) => x.id === t && isAlive(x)))
          votes[t] = (votes[t] ?? 0) + 1;
        else pass++;
      }
      room.voteResult = { votes, pass };
      const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      const hit =
        sorted.length &&
        sorted[0][1] > pass &&
        sorted[0][1] > (sorted[1]?.[1] ?? 0)
          ? sorted[0][0]
          : undefined;
      log(
        room,
        `Oylama: ${
          Object.entries(votes)
            .map(
              ([id, n]) =>
                `${room.players.find((p) => p.id === id)?.nickname}: ${n}`,
            )
            .join(", ") || "Aday oyu yok"
        }. Pas: ${pass}.`,
      );
      if (hit) eliminate(room, hit, "vote", at, "night");
      else {
        log(room, "Oylamada kimse elenmedi.");
        resume(room, "night", at);
      }
      break;
    }
    case "hunter": {
      const id = room.hunterId!;
      const next = room.afterHunter!;
      const t = room.actions[id];
      room.hunterId = undefined;
      room.afterHunter = undefined;
      if (t && room.players.some((p) => p.id === t && isAlive(p)))
        eliminate(room, t, "hunter", at, next);
      else {
        log(room, "Avcının seçim süresi sona erdi.");
        resume(room, next, at);
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
export function playerView(
  room: Room,
  playerId: string,
  now: number,
): RoomView {
  const p =
    room.players.find((p) => p.id === playerId && isParticipant(p)) ??
    fail("Bu odada değilsiniz.");
  const me: RoomView["me"] = { id: p.id, history: structuredClone(p.history) };
  if (p.role) me.role = p.role;
  if (p.alive && room.phase === "night") {
    if (["vampire", "doctor", "seer"].includes(p.role ?? ""))
      me.selection = room.actions[p.id] ?? null;
    if (p.role === "doctor") me.previousProtection = p.previousProtection;
    if (p.role === "vampire")
      me.teammates = room.players
        .filter((x) => x.alive && x.role === "vampire")
        .map((x) => ({ id: x.id, target: room.actions[x.id] ?? null }));
  }
  if (p.role === "vampire" && p.alive && !me.teammates)
    me.teammates = room.players
      .filter((x) => isParticipant(x) && x.role === "vampire")
      .map((x) => ({ id: x.id, target: null }));
  if (room.phase === "vote" && p.alive) me.selection = room.votes[p.id];
  if (room.phase === "hunter" && room.hunterId === p.id)
    me.selection = room.actions[p.id] ?? null;
  return {
    code: room.code,
    hostId: room.hostId,
    settings: structuredClone(room.settings),
    phase: room.phase,
    phaseVersion: room.phaseVersion,
    deadline: room.deadline,
    serverNow: now,
    day: room.day,
    players: room.players.map((x) => ({
      id: x.id,
      nickname: x.nickname,
      avatar: x.avatar,
      connected: x.connected,
      ready: x.ready,
      alive: x.alive,
      departed: !isParticipant(x),
      ...((room.phase === "ended" ||
        (!x.alive && room.settings.revealEliminated)) &&
      x.role
        ? { role: x.role }
        : {}),
    })),
    me,
    logs: structuredClone(room.logs),
    voteCount:
      room.phase === "vote" || room.phase === "voteResolution"
        ? Object.keys(room.votes).length
        : 0,
    voteResult: room.voteResult ? structuredClone(room.voteResult) : undefined,
    hunterId: room.hunterId,
    winner: room.winner,
    matchId: room.matchId,
  };
}
