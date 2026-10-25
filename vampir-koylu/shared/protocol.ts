import { z } from "zod";
export const roles = [
  "villager",
  "vampire",
  "doctor",
  "seer",
  "hunter",
  "jester",
] as const;
export type Role = (typeof roles)[number];
export const roleNames: Record<Role, string> = {
  villager: "Köylü",
  vampire: "Vampir",
  doctor: "Doktor",
  seer: "Kâhin",
  hunter: "Avcı",
  jester: "Soytarı",
};
export const roleIcons: Record<Role, string> = {
  villager: "☀",
  vampire: "☾",
  doctor: "✚",
  seer: "◉",
  hunter: "➶",
  jester: "♢",
};
export const roleDescriptions: Record<Role, string> = {
  villager: "Gündüz tartış, vampirleri bul ve oy ver. Gece eylemin yok.",
  vampire:
    "Takımınla yaşayan bir vampir olmayan oyuncuyu seç. En çok seçilen tek hedefe saldırılır; eşitlikte saldırı olmaz.",
  doctor:
    "Bir yaşayan oyuncuyu koru. Kendini seçebilirsin; önceki gece koruduğun kişiyi tekrar seçemezsin.",
  seer: "Kendin dışında yaşayan bir oyuncuyu incele. Sonucu gece sonunda yalnızca sen görürsün.",
  hunter:
    "Elendiğinde 15 saniye içinde yaşayan başka birini beraberinde götürebilirsin. Seçmezsen yeteneğin geçer.",
  jester:
    "Yalnız gündüz oylamasıyla elenirsen tek başına kazanırsın. Gece veya avcıyla elenmek zafer getirmez.",
};
export const avatars = ["🦊", "🐺", "🦉", "🐈‍⬛", "🦇", "🐻", "🐰", "🦌"];
export const nicknameSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const message = !value
      ? "İsim girilmedi. Lütfen bir oyuncu adı yaz."
      : value.length < 2
        ? "Oyuncu adı en az 2 karakter olmalı."
        : value.length > 20
          ? "Oyuncu adı en fazla 20 karakter olmalı."
          : !/^[\p{L}\p{N} _.-]+$/u.test(value)
            ? "Yalnız harf, sayı, boşluk ve ._- kullanın."
            : undefined;
    if (message) ctx.addIssue({ code: "custom", message });
  });
export const profileSchema = z
  .object({
    nickname: nicknameSchema,
    avatar: z.enum(["🦊", "🐺", "🦉", "🐈‍⬛", "🦇", "🐻", "🐰", "🦌"]),
  })
  .strict();
export const settingsSchema = z
  .object({
    capacity: z.number().int().min(5).max(16),
    roles: z
      .object({
        villager: z.number().int().min(0).max(15),
        vampire: z.number().int().min(1).max(7),
        doctor: z.number().int().min(0).max(1),
        seer: z.number().int().min(0).max(1),
        hunter: z.number().int().min(0).max(1),
        jester: z.number().int().min(0).max(1),
      })
      .strict(),
    daySeconds: z.number().int().min(15).max(600),
    voteSeconds: z.number().int().min(10).max(180),
    nightSeconds: z.number().int().min(10).max(180),
    revealEliminated: z.boolean(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const total = Object.values(s.roles).reduce((a, b) => a + b, 0);
    if (total !== s.capacity)
      ctx.addIssue({
        code: "custom",
        message: "Rol toplamı kapasiteye eşit olmalı.",
      });
    if (s.roles.vampire * 2 >= total)
      ctx.addIssue({
        code: "custom",
        message: "Vampir sayısı diğer oyunculardan az olmalı.",
      });
  });
export type Settings = z.infer<typeof settingsSchema>;
export function suggestedSettings(capacity = 6): Settings {
  const vampire = capacity >= 12 ? 3 : capacity >= 8 ? 2 : 1;
  return {
    capacity,
    roles: {
      vampire,
      doctor: 1,
      seer: 1,
      hunter: capacity >= 7 ? 1 : 0,
      jester: capacity >= 9 ? 1 : 0,
      villager:
        capacity -
        vampire -
        2 -
        (capacity >= 7 ? 1 : 0) -
        (capacity >= 9 ? 1 : 0),
    },
    daySeconds: 90,
    voteSeconds: 30,
    nightSeconds: 30,
    revealEliminated: false,
  };
}
export const codeSchema = z
  .string()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
export const commandSchema = z
  .object({
    roomCode: codeSchema,
    actionId: z.string().uuid(),
    phaseVersion: z.number().int().nonnegative(),
    type: z.enum([
      "ready",
      "settings",
      "kick",
      "start",
      "night",
      "vote",
      "hunt",
      "rematch",
      "leave",
    ]),
    target: z.string().max(64).nullable().optional(),
    ready: z.boolean().optional(),
    settings: settingsSchema.optional(),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export type Phase =
  | "lobby"
  | "reveal"
  | "night"
  | "nightResolution"
  | "hunter"
  | "day"
  | "vote"
  | "voteResolution"
  | "ended";
export const phaseNames: Record<Phase, string> = {
  lobby: "Lobi",
  reveal: "Roller dağıtılıyor",
  night: "Gece",
  nightResolution: "Gece sonuçlanıyor",
  hunter: "Avcının son seçimi",
  day: "Gündüz · Tartışma",
  vote: "Oylama",
  voteResolution: "Oylar sayılıyor",
  ended: "Oyun sonu",
};
export type Winner = "village" | "vampire" | "jester" | "draw" | "unfinished";
export const winnerNames: Record<Winner, string> = {
  village: "Köylü takımı kazandı",
  vampire: "Vampirler kazandı",
  jester: "Soytarı kazandı",
  draw: "Beraberlik",
  unfinished: "Maç tamamlanmadı",
};
export interface PublicPlayer {
  id: string;
  nickname: string;
  avatar: string;
  connected: boolean;
  ready: boolean;
  alive: boolean;
  departed?: boolean;
  role?: Role;
}
export interface LogEntry {
  day: number;
  text: string;
}
export interface RoomView {
  code: string;
  hostId: string;
  settings: Settings;
  phase: Phase;
  phaseVersion: number;
  deadline: number | null;
  serverNow: number;
  day: number;
  players: PublicPlayer[];
  me: {
    id: string;
    role?: Role;
    history: { day: number; targetName: string; vampire: boolean }[];
    selection?: string | null;
    previousProtection?: string;
    teammates?: { id: string; target: string | null }[];
  };
  logs: LogEntry[];
  voteCount: number;
  voteResult?: { votes: Record<string, number>; pass: number };
  hunterId?: string;
  winner?: Winner;
  matchId?: string;
}
export type Reply =
  { ok: true; view?: RoomView } | { ok: false; error: string };
