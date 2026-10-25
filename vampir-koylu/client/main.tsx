import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import {
  avatars,
  roles,
  roleNames,
  roleIcons,
  roleDescriptions,
  phaseNames,
  winnerNames,
  suggestedSettings,
  settingsSchema,
  nicknameSchema,
  type RoomView,
  type Settings,
  type Command,
  type Reply,
} from "../shared/protocol";
import "./style.css";
type Profile = {
  id: string;
  nickname: string;
  avatar: string;
  roomCode: string | null;
};
type History = {
  id: string;
  result: keyof typeof winnerNames;
  outcome: string;
  endedAt: string;
  summary: {
    players: { id: string; nickname: string; role: keyof typeof roleNames }[];
    logs: { day: number; text: string }[];
  };
};
const outcomeNames: Record<string, string> = {
  win: "Galibiyet",
  loss: "Mağlubiyet",
  draw: "Beraberlik",
  unfinished: "Tamamlanmadı",
};
const uid = () =>
  crypto.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
    ).toString(16),
  );
function App() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [nickname, setNickname] = useState(""),
    [avatar, setAvatar] = useState(avatars[0]);
  const [view, setView] = useState<RoomView | null>(null),
    [page, setPage] = useState<"home" | "create" | "rules" | "profile">("home");
  const [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") ?? "",
    ),
    [settings, setSettings] = useState(suggestedSettings());
  const [status, setStatus] = useState("Bağlanıyor"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [hidden, setHidden] = useState(true),
    [showSettings, setShowSettings] = useState(false),
    [qr, setQr] = useState(false),
    [history, setHistory] = useState<History[]>([]),
    [now, setNow] = useState(Date.now()),
    [sound, setSound] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameAttempted, setNameAttempted] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = leaveDialog.current;
    if (leaveOpen) dialog?.showModal();
    else dialog?.close();
  }, [leaveOpen]);
  const socket = useRef<Socket | null>(null),
    offset = useRef(0),
    lastPhase = useRef(-1),
    soundRef = useRef(false);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);
  useEffect(() => {
    let disposed = false;
    fetch("/api/me")
      .then(async (r) => {
        if (!r.ok)
          throw new Error("Sunucuya erişilemiyor. Yenileyerek tekrar deneyin.");
        return r.json();
      })
      .then((p: Profile) => {
        if (disposed) return;
        setProfile(p);
        setNickname(p.nickname === "Misafir" ? "" : p.nickname);
        setAvatar(p.avatar);
        const s = io({ reconnection: true });
        socket.current = s;
        s.on("connect", () => setStatus("Bağlı"));
        s.on("disconnect", () => {
          setStatus((old) =>
            old === "Başka sekmede açık"
              ? old
              : "Bağlantı koptu · Yeniden bağlanıyor",
          );
          setHidden(true);
        });
        s.on("connect_error", () =>
          setStatus("Bağlanılamadı · Tekrar deneniyor"),
        );
        s.on("view", (v: RoomView) => {
          offset.current = v.serverNow - Date.now();
          setNow(v.serverNow);
          if (lastPhase.current !== v.phaseVersion) {
            setHidden(true);
            if (soundRef.current && lastPhase.current >= 0) {
              try {
                const audio = new AudioContext();
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.connect(gain);
                gain.connect(audio.destination);
                gain.gain.value = 0.035;
                osc.frequency.value = 440;
                osc.start();
                osc.stop(audio.currentTime + 0.12);
                osc.onended = () => void audio.close();
              } catch {}
            }
            lastPhase.current = v.phaseVersion;
          }
          setView(v);
        });
        s.on("removed", (text: string) => {
          setView(null);
          setPage("home");
          setNotice(text);
          setHidden(true);
          setLeaveOpen(false);
          setShowSettings(false);
          setQr(false);
          lastPhase.current = -1;
          if (text) {
            setCode("");
            window.history.replaceState(null, "", location.pathname);
          }
        });
        s.on("replaced", () => {
          s.io.reconnection(false);
          setStatus("Başka sekmede açık");
          setHidden(true);
        });
        s.on("notice", setError);
      })
      .catch((e) => setError(e.message));
    const hide = () => {
      if (document.hidden) setHidden(true);
    };
    document.addEventListener("visibilitychange", hide);
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => {
      disposed = true;
      socket.current?.disconnect();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  async function send(event: string, data: unknown) {
    if (!socket.current?.connected) throw new Error("Bağlantı bekleniyor.");
    return new Promise<void>((resolve, reject) =>
      socket
        .current!.timeout(8000)
        .emit(event, data, (err: Error | null, r: Reply) =>
          err
            ? reject(new Error("Yanıt alınamadı; güncel durumu kontrol edin."))
            : r.ok
              ? resolve()
              : reject(new Error(r.error)),
        ),
    );
  }
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem yapılamadı.");
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile() {
    const parsed = nicknameSchema.safeParse(nickname);
    setNameAttempted(true);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0].message);
      nameInput.current?.focus();
      return false;
    }
    setNameError("");
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: parsed.data, avatar }),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    setProfile((p) => (p ? { ...p, nickname, avatar } : p));
    return true;
  }
  async function leaveGame() {
    if (!view || busy) return;
    setBusy(true);
    setLeaveError("");
    setError("");
    try {
      await send("command", {
        type: "leave",
        roomCode: view.code,
        phaseVersion: view.phaseVersion,
        actionId: uid(),
      });
      setView(null);
      setPage("home");
      setLeaveOpen(false);
      setHidden(true);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Çıkış kaydedilemedi. Yeniden deneyin.";
      if (leaveOpen) setLeaveError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  const command = (type: Command["type"], extra: Partial<Command> = {}) =>
    run(() =>
      send("command", {
        type,
        roomCode: view!.code,
        phaseVersion: view!.phaseVersion,
        actionId: uid(),
        ...extra,
      }),
    );
  const invite = view ? `${location.origin}/?room=${view.code}` : "";
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setNotice("Davet bağlantısı kopyalandı.");
    } catch {
      setNotice(`Davet bağlantısı: ${invite}`);
    }
  }
  const me = view?.players.find((p) => p.id === view.me.id),
    isHost = view?.hostId === view?.me.id;
  const seconds = view?.deadline
    ? Math.max(0, Math.ceil((view.deadline - now) / 1000))
    : 0;
  const action =
    view?.phase === "vote" && me?.alive
      ? "vote"
      : view?.phase === "hunter" && view.hunterId === me?.id
        ? "hunt"
        : view?.phase === "night" &&
            me?.alive &&
            ["vampire", "doctor", "seer"].includes(view.me.role ?? "")
          ? "night"
          : null;
  const targets =
    view?.players.filter(
      (p) =>
        p.alive &&
        (action === "night" && view.me.role === "doctor"
          ? p.id !== view.me.previousProtection
          : p.id !== me?.id) &&
        (action === "night" && view.me.role === "vampire"
          ? !view.me.teammates?.some((t) => t.id === p.id)
          : true),
    ) ?? [];
  const profileForm = (
    <>
      <label>
        Takma adın
        <input
          ref={nameInput}
          aria-label="Takma adın"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "nickname-error" : undefined}
          autoComplete="nickname"
          maxLength={20}
          placeholder="Kasaba seni nasıl tanısın?"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            if (nameAttempted) {
              const result = nicknameSchema.safeParse(e.target.value);
              setNameError(
                result.success ? "" : result.error.issues[0].message,
              );
            }
          }}
        />
        {nameError && (
          <span id="nickname-error" className="field-error" role="alert">
            {nameError}
          </span>
        )}
      </label>
      <div className="avatar-picker" aria-label="Avatar seçimi">
        {avatars.map((a) => (
          <button
            type="button"
            key={a}
            aria-label={`Avatar ${a}`}
            aria-pressed={avatar === a}
            className={avatar === a ? "selected" : ""}
            onClick={() => setAvatar(a)}
          >
            {a}
          </button>
        ))}
      </div>
    </>
  );
  return (
    <div className="shell">
      <header>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
          }}
        >
          <span className="brand-icon">☾</span>
          <span>
            GECE KASABASI<small>VAMPİR KÖYLÜ</small>
          </span>
        </a>
        <span
          className={`connection ${status === "Bağlı" ? "online" : ""}`}
          role="status"
        >
          {status === "Bağlı" ? "● Çevrimiçi" : `◌ ${status}`}
        </span>
      </header>
      {view && (
        <div className="exit-bar">
          <button
            disabled={busy}
            onClick={() => {
              if (view.phase !== "lobby" && view.phase !== "ended") {
                setLeaveError("");
                setLeaveOpen(true);
              } else void leaveGame();
            }}
          >
            Oyundan çık
          </button>
        </div>
      )}
      <dialog
        ref={leaveDialog}
        className="leave-dialog"
        aria-labelledby="leave-title"
        aria-describedby="leave-description"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) setLeaveOpen(false);
        }}
      >
        <h2 id="leave-title">Oyundan ayrılmak istiyor musun?</h2>
        <p id="leave-description">Bu maçtaki katılımın sona erecek.</p>
        {leaveError && (
          <p className="field-error" role="alert">
            {leaveError}
          </p>
        )}
        <div className="button-row">
          <button autoFocus disabled={busy} onClick={() => setLeaveOpen(false)}>
            Vazgeç
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void leaveGame()}
          >
            Oyundan çık
          </button>
        </div>
      </dialog>
      {status === "Başka sekmede açık" && (
        <div className="banner">
          Bu oturumun son açılan sekmesi etkin. Buradan devam etmek için sayfayı
          yenileyin.
          <button onClick={() => location.reload()}>Bu sekmede devam et</button>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button aria-label="Uyarıyı kapat" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice}
        </div>
      )}
      {page === "rules" ? (
        <section className="panel rules">
          <button className="back" onClick={() => setPage("home")}>
            ← Geri dön
          </button>
          <p className="eyebrow">KASABANIN KURALLARI</p>
          <h1>Nasıl oynanır?</h1>
          <p>
            5–16 kişi, kendi cihazlarından aynı odaya girer. Konuşmak için yan
            yana olun veya harici bir sesli uygulama kullanın. Uygulamada sohbet
            yoktur. İnternet bağlantısı gerekir.
          </p>
          <h2>Bir geceden diğerine</h2>
          <p>
            Herkes hazır olunca oda sahibi başlatır. 8 saniyelik rol
            gösteriminden sonra gece başlar. Gece eylemleri aynı anda ve süre
            sonuna kadar değiştirilebilir; herkes seçim yapsa bile gece erken
            bitmez. Ardından gündüz tartışması, gizli oylama ve yeni gece gelir.
            Çözümleme aşamaları 1 saniyedir.
          </p>
          <div className="role-rules">
            {roles.map((r) => (
              <article key={r}>
                <span className="role-icon">{roleIcons[r]}</span>
                <h3>{roleNames[r]}</h3>
                <p>{roleDescriptions[r]}</p>
              </article>
            ))}
          </div>
          <h2>Gece ve gizli bilgiler</h2>
          <p>
            Doktor koruması yalnız o geceki vampir saldırısını durdurur.
            Vampirler en çok seçtikleri tek hedefe saldırır; hedef eşitliğinde
            veya seçim yoksa saldırı olmaz. Doktor eylem yapmazsa koruma yoktur.
            Kâhin “Vampir” ya da “Vampir değil” sonucunu alır; soytarı vampir
            değildir. Kâhin o gece elense bile sonucu alır. Gece özeti
            saldırının neden başarısız olduğunu açıklamaz.
          </p>
          <h2>Gündüz oylaması</h2>
          <p>
            Yaşayan herkes bir oy verir; kendine oy veremez. Oyunu süre dolana
            kadar değiştirebilir veya pas geçebilir. Oy kullanmayanlar pas
            sayılır. Yalnız kullanılan oy sayısı görünür. En yüksek oyu tek
            başına alan aday, pas sayısını da aşarsa elenir. Aday eşitliğinde
            veya pas en yüksek oya eşitse/üstündeyse kimse elenmez. Sonuçta aday
            toplamları açıklanır.
          </p>
          <h2>Kim kazanır?</h2>
          <p>
            Gündüz oylamasıyla elenen soytarı tek başına kazanır. Bekleyen avcı
            seçimi takım zaferinden önce çözülür ve doktor tarafından
            engellenmez. Hiç yaşayan kalmazsa beraberlik; vampir kalmazsa köylü
            takımı kazanır. Yaşayan vampirler diğer yaşayanların sayısına
            ulaşırsa vampirler kazanır. Köylü, doktor, kâhin ve avcı köylü
            takımındadır. Soytarı bağımsızdır.
          </p>
          <h2>Oda ve bağlantı</h2>
          <p>
            Her özel rol en fazla bir kişi olabilir; özel roller arasında başka
            uyumsuzluk yoktur. Rol toplamı kapasiteyle aynı olmalı; vampirler
            başlangıçta diğerlerinin sayısına ulaşamaz. Başlangıç önerileri
            kesin denge garantisi değildir. Oda sahibinin bağlantısı 20 saniye
            kesilirse sahiplik katılım sırasındaki ilk bağlı oyuncuya geçer.
          </p>
          <p>
            Bağlantı kesilmesi seni öldürmez; süreler devam eder. Aynı
            tarayıcıdan yenileyerek dönebilirsin. Son açılan sekme etkin olur.
            Herkes 30 dakika boyunca bağlantısızsa maç tamamlanmadı olarak
            kapanır. Elendiğinde konuşma; yalnız herkese açık akışı ve kendi
            geçmiş bilgilerini takip et.
          </p>
        </section>
      ) : page === "profile" ? (
        <section className="panel">
          <button className="back" onClick={() => setPage("home")}>
            ← Geri dön
          </button>
          <p className="eyebrow">BU TARAYICIDAKİ SEN</p>
          <h1>Profil ve geçmiş</h1>
          <p className="muted">
            Misafir profilin bu tarayıcının çerezine bağlıdır. Çerezleri
            silersen erişimini kaybedersin. Cihazlar arasında eşitlenmez.
          </p>
          {profileForm}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!(await saveProfile())) return;
                setNotice("Profil kaydedildi.");
              })
            }
          >
            Profili kaydet
          </button>
          <div className="stats">
            {["win", "loss", "draw", "unfinished"].map((o) => (
              <div key={o}>
                <strong>{history.filter((h) => h.outcome === o).length}</strong>
                <span>{outcomeNames[o]}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            Son 100 maç. Takım zaferi elenmiş takım üyelerine de galibiyet
            sayılır; soytarı yalnız kişisel zaferinde kazanır. Tamamlanmayan
            maçlar oranlara katılmaz.
          </p>
          {history.length === 0 ? (
            <p>Henüz tamamlanmış maçın yok. Kasaba seni bekliyor.</p>
          ) : (
            history.map((h) => (
              <details key={h.id}>
                <summary>
                  {winnerNames[h.result]} · {outcomeNames[h.outcome]}
                  <small>{new Date(h.endedAt).toLocaleString("tr-TR")}</small>
                </summary>
                {h.summary.players.map((p) => (
                  <p key={p.id}>
                    {p.nickname} — {roleNames[p.role]}
                  </p>
                ))}
                {h.summary.logs.map((l, i) => (
                  <p key={i} className="muted">
                    {l.day}. tur · {l.text}
                  </p>
                ))}
              </details>
            ))
          )}
        </section>
      ) : view ? (
        <>
          <div className="room-heading">
            <div>
              <p className="eyebrow">
                ODA <b data-testid="room-code">{view.code}</b> ·{" "}
                {view.players.length}/{view.settings.capacity} KİŞİ
              </p>
              <h1>
                {view.phase === "lobby"
                  ? "Ateşin etrafında toplanın."
                  : phaseNames[view.phase]}
              </h1>
            </div>
            {view.deadline && (
              <div
                className={`timer ${seconds <= 5 ? "urgent" : ""}`}
                aria-label="Kalan süre"
              >
                <strong>
                  {Math.floor(seconds / 60)}:
                  {String(seconds % 60).padStart(2, "0")}
                </strong>
                <small>{view.day > 0 ? `${view.day}. tur` : "Hazırlık"}</small>
              </div>
            )}
          </div>
          <div className="room-grid">
            <section className="panel players">
              <div className="section-title">
                <h2>Kasabadakiler</h2>
                <span>
                  {view.players.filter((p) => p.alive).length} hayatta
                </span>
              </div>
              <div className="player-list">
                {view.players.map((p) => (
                  <div
                    key={p.id}
                    className={`player ${!p.alive ? "eliminated" : ""}`}
                  >
                    <span className="avatar">{p.avatar}</span>
                    <div>
                      <strong>
                        {p.nickname}
                        {p.id === view.me.id ? " (sen)" : ""}
                      </strong>
                      <small>
                        {p.id === view.hostId ? "♛ Oda sahibi · " : ""}
                        {p.departed
                          ? "↪ Oyundan ayrıldı"
                          : !p.connected
                            ? "◌ Bağlantısı kesildi"
                            : view.phase === "lobby"
                              ? p.ready
                                ? "✓ Hazır"
                                : "Hazırlanıyor"
                              : p.alive
                                ? "● Hayatta"
                                : "✕ Elendi"}
                        {p.role ? ` · ${roleNames[p.role]}` : ""}
                      </small>
                    </div>
                    {view.phase === "lobby" && isHost && p.id !== me?.id && (
                      <button
                        className="icon-button"
                        aria-label={`${p.nickname} çıkar`}
                        onClick={() => command("kick", { target: p.id })}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {view.phase === "lobby" && (
                <div className="invite">
                  <p className="eyebrow">BİR ARKADAŞINI ÇAĞIR</p>
                  <div className="room-code">{view.code}</div>
                  <div className="button-row">
                    <button onClick={() => void copyInvite()}>
                      Bağlantıyı kopyala
                    </button>
                    {typeof navigator.share === "function" && (
                      <button
                        onClick={() =>
                          run(() =>
                            navigator.share({
                              title: "Gece Kasabası",
                              url: invite,
                            }),
                          )
                        }
                      >
                        Paylaş
                      </button>
                    )}
                    <button aria-expanded={qr} onClick={() => setQr(!qr)}>
                      QR kodu
                    </button>
                  </div>
                  {qr && (
                    <div className="qr">
                      <QRCodeSVG value={invite} size={180} marginSize={2} />
                      <p>Telefon kameranla odaya katıl.</p>
                    </div>
                  )}
                </div>
              )}
            </section>
            <div className="main-column">
              {view.phase === "lobby" ? (
                <section className="panel">
                  <p className="eyebrow">GECEYE HAZIR MISIN?</p>
                  <h2>Her yüzün bir sırrı var.</h2>
                  <p className="muted">
                    Herkes katılıp hazır olduğunda gece başlar. Rolünü yalnızca
                    sen göreceksin.
                  </p>
                  <div className="role-summary">
                    {roles
                      .filter((r) => view.settings.roles[r] > 0)
                      .map((r) => (
                        <span key={r}>
                          {roleIcons[r]} {view.settings.roles[r]} {roleNames[r]}
                        </span>
                      ))}
                  </div>
                  <p className="muted">
                    Gece {view.settings.nightSeconds} sn · Gündüz{" "}
                    {view.settings.daySeconds} sn · Oylama{" "}
                    {view.settings.voteSeconds} sn
                  </p>
                  <p className="muted">
                    Elenen roller{" "}
                    {view.settings.revealEliminated
                      ? "açıklanır"
                      : "gizli kalır"}
                    .
                  </p>
                  {isHost && (
                    <button
                      onClick={() => {
                        setSettings(view.settings);
                        setShowSettings(!showSettings);
                      }}
                    >
                      Oda ayarları
                    </button>
                  )}
                  {showSettings && isHost && (
                    <SettingsEditor
                      value={settings}
                      onChange={setSettings}
                      onSave={() =>
                        command("settings", { settings }).then(() =>
                          setShowSettings(false),
                        )
                      }
                      busy={busy}
                    />
                  )}
                  <div className="sticky-actions">
                    <button
                      className={me?.ready ? "" : "primary"}
                      disabled={busy || status !== "Bağlı"}
                      onClick={() => command("ready", { ready: !me?.ready })}
                    >
                      {me?.ready ? "Hazır değilim" : "Hazırım"}
                    </button>
                    {isHost && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          view.players.length !== view.settings.capacity ||
                          !view.players.every((p) => p.ready && p.connected)
                        }
                        onClick={() => command("start")}
                      >
                        Geceyi başlat
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    Başlatmak için {view.settings.capacity} bağlı ve hazır
                    oyuncu gerekir.
                  </p>
                </section>
              ) : view.phase === "ended" ? (
                <section className="panel ending">
                  <span className="ending-icon">
                    {view.winner === "vampire" ? "☾" : "✦"}
                  </span>
                  <p className="eyebrow">KASABANIN HİKÂYESİ TAMAMLANDI</p>
                  <h2>{winnerNames[view.winner!]}</h2>
                  <p>
                    {view.day} tur boyunca herkesin bir sırrı vardı. Artık
                    roller açık.
                  </p>
                  {isHost ? (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => command("rematch")}
                    >
                      Yeniden oyna
                    </button>
                  ) : (
                    <p>Yeni maç için oda sahibini bekleyin.</p>
                  )}
                </section>
              ) : (
                <>
                  <section
                    className={`panel secret ${!hidden && view.me.role === "vampire" ? "vampire" : ""}`}
                  >
                    <p className="eyebrow">YALNIZCA SANA ÖZEL</p>
                    <button
                      className="secret-toggle"
                      aria-expanded={!hidden}
                      onClick={() => setHidden(!hidden)}
                    >
                      {hidden
                        ? "◈ Rolümü ve özel bilgilerimi göster"
                        : "◈ Özel bilgilerimi gizle"}
                    </button>
                    {hidden ? (
                      <div className="sealed">
                        <span>☾</span>
                        <h2>Sırrın burada güvende.</h2>
                        <p>Ekranını yalnız sen görüyorsan kartını aç.</p>
                      </div>
                    ) : (
                      <>
                        <span className="role-emblem">
                          {view.me.role && roleIcons[view.me.role]}
                        </span>
                        <h2 data-testid="my-role">
                          {view.me.role && roleNames[view.me.role]}
                        </h2>
                        <p className="eyebrow">
                          {view.me.role === "vampire"
                            ? "Vampir takımı"
                            : view.me.role === "jester"
                              ? "Bağımsız"
                              : "Köylü takımı"}
                        </p>
                        <p>{view.me.role && roleDescriptions[view.me.role]}</p>
                        {view.me.teammates && (
                          <div className="private-info">
                            <h3>Vampir takımı</h3>
                            {view.me.teammates.map((t) => (
                              <p key={t.id}>
                                {
                                  view.players.find((p) => p.id === t.id)
                                    ?.nickname
                                }{" "}
                                →{" "}
                                {t.target
                                  ? view.players.find((p) => p.id === t.target)
                                      ?.nickname
                                  : "Seçim yok"}
                              </p>
                            ))}
                          </div>
                        )}
                        {view.me.history.length > 0 && (
                          <div className="private-info">
                            <h3>İncelemelerin</h3>
                            {view.me.history.map((h, i) => (
                              <p key={i}>
                                {h.day}. gece · {h.targetName}:{" "}
                                <strong>
                                  {h.vampire ? "Vampir" : "Vampir değil"}
                                </strong>
                              </p>
                            ))}
                          </div>
                        )}
                        {action === "night" && (
                          <ActionPanel
                            view={view}
                            targets={targets}
                            type={action}
                            busy={busy || status !== "Bağlı"}
                            onSelect={(target) => command(action, { target })}
                          />
                        )}
                      </>
                    )}
                  </section>
                  {!me?.alive && (
                    <div className="panel muted">
                      ✕ Elendin. Lütfen konuşma; oyun akışını ve kendi geçmiş
                      bilgilerini takip edebilirsin.
                      {view.hunterId === me?.id
                        ? " Avcı seçimin için süren devam ediyor."
                        : ""}
                    </div>
                  )}
                  {(action === "vote" || action === "hunt") && (
                    <section className="panel">
                      <ActionPanel
                        view={view}
                        targets={targets}
                        type={action}
                        busy={busy || status !== "Bağlı"}
                        onSelect={(target) => command(action, { target })}
                      />
                    </section>
                  )}
                  {view.phase === "day" && (
                    <section className="panel">
                      <p className="eyebrow">SÖZ SİZDE</p>
                      <h2>Bu gece kime güveneceksin?</h2>
                      <p>
                        Yaşayan oyuncular tartışsın. Süre dolduğunda gizli
                        oylama başlayacak.
                      </p>
                    </section>
                  )}
                  {view.phase === "night" && !action && (
                    <p className="panel muted">
                      Geceyi sessizce bekle. Süre dolduğunda kasaba uyanacak.
                    </p>
                  )}
                </>
              )}
              {view.logs.length > 0 && (
                <section className="panel">
                  <h2>Kasabanın günlüğü</h2>
                  <ol className="event-log">
                    {[...view.logs].reverse().map((l, i) => (
                      <li key={i}>
                        <span>
                          {l.day === 0 ? "BAŞLANGIÇ" : `${l.day}. TUR`}
                        </span>
                        {l.text}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </div>
          <div className="room-footer">
            <button onClick={() => setPage("rules")}>Nasıl oynanır?</button>
            <label className="sound">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => setSound(e.target.checked)}
              />{" "}
              Kısa faz sesi
            </label>
          </div>
        </>
      ) : page === "create" ? (
        <section className="panel create-panel">
          <button className="back" onClick={() => setPage("home")}>
            ← Geri dön
          </button>
          <p className="eyebrow">KENDİ KASABANI KUR</p>
          <h1>Gece seninle başlasın.</h1>
          {profileForm}
          <SettingsEditor
            value={settings}
            onChange={setSettings}
            onSave={() =>
              run(async () => {
                if (!(await saveProfile())) return;
                await send("create", settings);
                setPage("home");
              })
            }
            busy={busy}
            create
          />
        </section>
      ) : (
        <>
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="tiny-star">✦</span> BİR KASABA. BİRÇOK SIR.
              </p>
              <h1>
                Gece çöker.
                <br />
                <em>Şüphe uyanır.</em>
              </h1>
              <p>
                Aranızdan kim vampir?
                <br />
                Arkadaşlarını topla, rolünü sakla.
                <br />
                Kasabanın kaderini birlikte yazın.
              </p>
              <div className="tags">
                <span>5–16 oyuncu</span>
                <span>Telefonundan oyna</span>
                <span>Ücretsiz · Hesapsız</span>
              </div>
            </div>
            <div className="town-art" aria-hidden="true">
              <div className="moon"></div>
              <div className="stars">
                ✧<i>✦</i>
                <b>·</b>
              </div>
              <div className="hill back-hill"></div>
              <div className="houses">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="hill front-hill"></div>
              <span className="town-caption">KASABA UYUYOR. PEKİ YA SEN?</span>
            </div>
          </section>
          <div className="home-grid">
            <section className="panel join-panel">
              <div className="section-title">
                <h2>Kasabaya katıl</h2>
                <span>01 / DAVETİN VAR MI?</span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (!(await saveProfile())) return;
                    await send("join", code.trim().toUpperCase());
                  });
                }}
              >
                {profileForm}
                <label>
                  Oda kodu
                  <input
                    className="code-input"
                    aria-label="Oda kodu"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={6}
                    placeholder="ABC234"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                </label>
                <button
                  className="primary full"
                  disabled={busy || !profile || status !== "Bağlı"}
                  type="submit"
                >
                  Odaya katıl <span>→</span>
                </button>
              </form>
            </section>
            <section className="panel host-panel">
              <p className="eyebrow">02 / HİKÂYEYİ SEN BAŞLAT</p>
              <span className="lantern">♜</span>
              <h2>Bu gece ev sahibi sensin.</h2>
              <p>
                Bir oda kur. Arkadaşların bağlantı veya QR koduyla gelsin.
                Gerisini kasaba halleder.
              </p>
              <button
                className="full"
                disabled={!profile}
                onClick={() => setPage("create")}
              >
                Oda oluştur <span>＋</span>
              </button>
              <div className="host-note">
                ◈ Roller gizli dağıtılır.
                <br />
                Kararlarınızı siz verirsiniz.
              </div>
            </section>
          </div>
          <div className="home-links">
            <button onClick={() => setPage("rules")}>Nasıl oynanır? ↗</button>
            <button
              onClick={() =>
                run(async () => {
                  const r = await fetch("/api/history");
                  if (!r.ok) throw new Error("Geçmiş alınamadı.");
                  setHistory(await r.json());
                  setPage("profile");
                })
              }
            >
              Profil ve geçmiş ↗
            </button>
          </div>
        </>
      )}
      <footer>
        <span>☾ GECE KASABASI</span>
        <p>
          Konuşma sizde, oyun yönetimi bizde. İnternet bağlantısı gerektirir.
        </p>
      </footer>
    </div>
  );
}
function SettingsEditor({
  value,
  onChange,
  onSave,
  busy,
  create = false,
}: {
  value: Settings;
  onChange: (s: Settings) => void;
  onSave: () => unknown;
  busy: boolean;
  create?: boolean;
}) {
  const parsed = settingsSchema.safeParse(value);
  return (
    <div className="settings">
      <h3>Oda düzeni</h3>
      <label>
        Oyuncu kapasitesi
        <select
          aria-label="Oyuncu kapasitesi"
          value={value.capacity}
          onChange={(e) =>
            onChange({ ...value, capacity: Number(e.target.value) })
          }
        >
          {Array.from({ length: 12 }, (_, i) => i + 5).map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <button
        onClick={() =>
          onChange({
            ...suggestedSettings(value.capacity),
            daySeconds: value.daySeconds,
            voteSeconds: value.voteSeconds,
            nightSeconds: value.nightSeconds,
            revealEliminated: value.revealEliminated,
          })
        }
      >
        Başlangıç önerisini uygula
      </button>
      <p className="hint">
        Bir denge garantisi değildir. Her özel rol en fazla 1; vampirler diğer
        oyunculardan az olmalı. Başka özel rol uyumsuzluğu yok.
      </p>
      <div className="role-settings">
        {roles.map((r) => (
          <label key={r}>
            {roleIcons[r]} {roleNames[r]}
            <input
              aria-label={`${roleNames[r]} sayısı`}
              type="number"
              min={r === "vampire" ? 1 : 0}
              max={r === "villager" ? 15 : r === "vampire" ? 7 : 1}
              value={value.roles[r]}
              onChange={(e) =>
                onChange({
                  ...value,
                  roles: { ...value.roles, [r]: Number(e.target.value) },
                })
              }
            />
          </label>
        ))}
      </div>
      {(["nightSeconds", "daySeconds", "voteSeconds"] as const).map(
        (key, i) => (
          <label key={key}>
            {
              ["Gece süresi (sn)", "Gündüz süresi (sn)", "Oylama süresi (sn)"][
                i
              ]
            }
            <input
              aria-label={["Gece süresi", "Gündüz süresi", "Oylama süresi"][i]}
              type="number"
              min={key === "daySeconds" ? 15 : 10}
              max={key === "daySeconds" ? 600 : 180}
              value={value[key]}
              onChange={(e) =>
                onChange({ ...value, [key]: Number(e.target.value) })
              }
            />
          </label>
        ),
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={value.revealEliminated}
          onChange={(e) =>
            onChange({ ...value, revealEliminated: e.target.checked })
          }
        />{" "}
        Elenen oyuncunun rolünü açıkla
      </label>
      {!parsed.success && (
        <p className="validation" role="alert">
          {parsed.error.issues.map((i) => i.message).join(" ")}
        </p>
      )}
      <button
        className="primary full"
        disabled={busy || !parsed.success}
        onClick={() => onSave()}
      >
        {create ? "Odayı oluştur" : "Ayarları kaydet"}
      </button>
    </div>
  );
}
function ActionPanel({
  view,
  targets,
  type,
  busy,
  onSelect,
}: {
  view: RoomView;
  targets: RoomView["players"];
  type: "vote" | "night" | "hunt";
  busy: boolean;
  onSelect: (id: string | null) => unknown;
}) {
  return (
    <div className="action-panel">
      <h3>
        {type === "vote"
          ? "Kime oy veriyorsun?"
          : type === "hunt"
            ? "Son seçimini yap"
            : "Bu gecenin hedefi"}
      </h3>
      <p className="muted">
        {type === "vote"
          ? `${view.voteCount} / ${view.players.filter((p) => p.alive).length} kişi oy kullandı. Oylar süre sonunda açıklanır.`
          : "Seçimin süre sonunda uygulanır. O zamana kadar değiştirebilirsin."}
      </p>
      <div className="target-grid">
        {targets.map((p) => (
          <button
            disabled={busy}
            aria-pressed={view.me.selection === p.id}
            key={p.id}
            className={view.me.selection === p.id ? "selected" : ""}
            onClick={() => onSelect(p.id)}
          >
            {p.avatar} {p.nickname} {view.me.selection === p.id ? "✓" : ""}
          </button>
        ))}
        {type === "vote" && (
          <button
            disabled={busy}
            aria-pressed={view.me.selection === null}
            className={view.me.selection === null ? "selected" : ""}
            onClick={() => onSelect(null)}
          >
            Pas {view.me.selection === null ? "✓" : ""}
          </button>
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
