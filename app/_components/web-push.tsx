"use client";

import { getToken, onMessage } from "firebase/messaging";
import { useEffect, useState } from "react";
import {
  registerAccountDevice,
  registerSuperAdminDevice,
  registerUserDevice,
} from "@/app/_actions/devices";
import {
  getClientMessaging,
  isFirebaseConfigured,
  vapidKey,
} from "@/lib/firebase-client";
import { accountNotificationHref } from "@/lib/notification-client-href";

type Status =
  | "idle"
  | "unsupported"
  | "working"
  | "granted"
  | "denied"
  | "error";

const DEVICE_ID_KEY = "carcare:webPushDeviceId";

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function osFromUA(ua: string): string {
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Web";
}

/**
 * `navigator.serviceWorker.register()` нь SW "installing" төлөвт ормогц шууд
 * resolve хийдэг — "activated" болтол хүлээхгүй. Харин `pushManager.subscribe()`
 * (getToken дотор дуудагддаг) ЗААВАЛ идэвхтэй (active) SW шаарддаг тул үүнийг
 * хүлээхгүй бол "AbortError: ...no active Service Worker" гарна. 10с timeout —
 * ямар нэг шалтгаанаар statechange ирэхгүй бол мөнхөд зогсохгүй байх.
 */
function waitForServiceWorkerActivation(
  reg: ServiceWorkerRegistration,
): Promise<void> {
  if (reg.active) return Promise.resolve();
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

type PushTarget = "account" | "user" | "system-admin";

/**
 * Push мэдэгдлийн төлөв + асаах үйлдэл. Mount болмогц: зөвшөөрсөн бол token-оо
 * чимээгүй шинэчилж foreground мессежийг сонсоно (UI нуугдсан ч ажиллана).
 * `checked` — анхны шалгалт дууссан эсэх (түүнээс өмнө UI харуулахгүй, анивчихгүй).
 */
function useWebPush(target: PushTarget) {
  const [status, setStatus] = useState<Status>("idle");
  const [checked, setChecked] = useState(false);

  // Background мессеж (service worker-ийн onBackgroundMessage) нь
  // web-push.tsx-ийн onMessage-ийг ДАМЖИХГҮЙ тул NotificationBell-ийн
  // "carcare:notification-received" dispatch хийгддэггүй байсан — SW-ээс
  // (public/firebase-messaging-sw.js) postMessage-ээр ирсэн дохиог энд
  // хүлээж аваад мөн адил window event болгож дамжуулна. `enable()`-ийн
  // амжилттай дуусахаас үл хамааран, mount болмогц л бүртгэнэ — SW нь
  // өмнөх session-оос идэвхтэй байж болно.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    function onSwMessage(event: MessageEvent) {
      if (event.data?.type === "carcare:notification-received") {
        window.dispatchEvent(new Event("carcare:notification-received"));
      }
    }
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!isFirebaseConfigured() || typeof Notification === "undefined") {
        if (!cancelled) {
          setStatus("unsupported");
          setChecked(true);
        }
        return;
      }
      if (Notification.permission === "granted") {
        // Зөвшөөрсөн → мөр харуулахгүй тул token шинэчлэлтийг хүлээлгүй шалгасанд тооцно.
        if (!cancelled) {
          setStatus("granted");
          setChecked(true);
        }
        await enable(true); // token-оо чимээгүй шинэчилнэ
      } else {
        if (!cancelled) {
          if (Notification.permission === "denied") setStatus("denied");
          setChecked(true);
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable(silent = false) {
    // Чимээгүй (аль хэдийн зөвшөөрсөн) шинэчлэлтэд «Тохируулж байна» төлөв
    // харуулахгүй — эс бөгөөс нуугдсан мөр түр гарч ирнэ.
    if (!silent) setStatus("working");
    // Аль хэдийн зөвшөөрсөн төхөөрөмжийн чимээгүй token шинэчлэлт бүтэлгүйтвэл
    // өмнөх token хүчинтэй хэвээр байх магадлалтай — хуудас бүрт алдааны мөр
    // гаргахгүй, «идэвхтэй» хэвээр үлдээнэ (алдаа консолд бичигдэнэ).
    const fail = () => setStatus(silent ? "granted" : "error");
    try {
      const messaging = await getClientMessaging();
      if (!messaging || !vapidKey) {
        setStatus("unsupported");
        return;
      }

      const perm = silent
        ? Notification.permission
        : await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "idle");
        return;
      }

      // Өмнө буруу үндсэн (/) scope-д бүртгэгдсэн firebase SW байвал устгана —
      // тэр нь апп-ийн chunk ачаалалд саад болж "module factory" алдаа гаргадаг.
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          if (
            r.active?.scriptURL.includes("firebase-messaging-sw") &&
            new URL(r.scope).pathname === "/"
          ) {
            await r.unregister();
          }
        }
      } catch {
        // ignore
      }

      // SW-ийг НАРИЙН scope-д бүртгэнэ — бүх апп-ийн навигацийг "удирдаж",
      // chunk ачаалалд саад болохоос сэргийлнэ (FCM-ийн жишиг scope). Config
      // нь SW файлдаа шууд шигтгэгдсэн (public/firebase-messaging-sw.js).
      const reg = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js",
        { scope: "/firebase-cloud-messaging-push-scope" },
      );
      await waitForServiceWorkerActivation(reg);

      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: reg,
      });
      if (!token) {
        fail();
        return;
      }

      const ua = navigator.userAgent;
      const input = {
        deviceId: getDeviceId(),
        platform: "WEB",
        firebaseToken: token,
        name: ua.slice(0, 120),
        model: navigator.platform || null,
        os: osFromUA(ua),
      };
      const res =
        target === "account"
          ? await registerAccountDevice(input)
          : target === "user"
            ? await registerUserDevice(input)
            : await registerSuperAdminDevice(input);
      if (!res.ok) {
        fail();
        return;
      }

      // Foreground мессеж — энгийн Notification болгож харуулаад, хонхыг
      // (NotificationBell) шууд шинэчлэхийг мэдэгдэнэ (45с polling-ийг хүлээлгүй).
      // Дарахад холбогдох хуудас руу шилжинэ (зөвхөн account realm — staff/
      // system-admin push-ийн товч мэдэгдэл дээрх зан төлөв энэ ажлын хүрээнд биш).
      onMessage(messaging, (payload) => {
        const n = payload.notification;
        if (n && Notification.permission === "granted") {
          const notif = new Notification(n.title ?? "Carservice", { body: n.body ?? "" });
          if (target === "account") {
            const href = accountNotificationHref(payload.data);
            notif.onclick = () => {
              window.focus();
              window.location.assign(href);
              notif.close();
            };
          }
        }
        window.dispatchEvent(new Event("carcare:notification-received"));
      });

      setStatus("granted");
    } catch (e) {
      console.error("[web-push]", e);
      fail();
    }
  }

  return { status, checked, enable };
}

/** Тохиргооны хуудсанд (account) — төлөвийг товч/текстээр харуулна. */
export function WebPushToggle({ target }: { target: PushTarget }) {
  const { status, enable } = useWebPush(target);

  if (status === "unsupported") return null;

  if (status === "granted") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 light:text-emerald-700">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        Мэдэгдэл идэвхтэй
      </span>
    );
  }

  if (status === "denied") {
    return (
      <span className="text-xs text-white/40">
        Мэдэгдэл блоклогдсон — хөтчийн тохиргооноос зөвшөөрнө үү.
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={status === "working"}
      onClick={() => enable(false)}
      className="text-sm border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-60 px-4 py-2 rounded-lg transition-colors"
    >
      {status === "working"
        ? "Тохируулж байна..."
        : status === "error"
          ? "Дахин оролдох"
          : "🔔 Мэдэгдэл асаах"}
    </button>
  );
}

const BAR_DISMISS_KEY = "carcare:pushBarDismissedAt:";
/** Хаасан мөрийг дахин санал болгох хүртэлх хугацаа. */
const BAR_DISMISS_MS = 14 * 86_400_000;

function readDismissed(target: PushTarget): boolean {
  try {
    const at = Number(localStorage.getItem(BAR_DISMISS_KEY + target) ?? 0);
    return Number.isFinite(at) && at > 0 && Date.now() - at < BAR_DISMISS_MS;
  } catch {
    return false;
  }
}

const BellIcon = ({ off = false }: { off?: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {off ? (
      <>
        <path d="M8.7 3A6 6 0 0 1 18 8c0 2.7.6 4.6 1.3 6" />
        <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        <path d="m2 2 20 20" />
      </>
    ) : (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    )}
  </svg>
);

/**
 * Layout-ын дээд талын нимгэн мөр: push асаагаагүй бол «Асаах», блоклогдсон
 * бол товч тайлбар. Идэвхтэй / дэмжигдээгүй / хаасан (14 хоног) бол юу ч
 * харуулахгүй — hook нь ажилласаар (token шинэчлэл, foreground мессеж).
 */
export function WebPushBar({
  target,
  description,
  className = "",
}: {
  target: PushTarget;
  /** Юуны мэдэгдэл ирэх тухай богино тайлбар (том дэлгэц дээр харагдана). */
  description: string;
  className?: string;
}) {
  const { status, checked, enable } = useWebPush(target);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage зөвхөн client дээр — mount-ийн дараа уншина.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissed(target));
  }, [target]);

  if (!checked || dismissed !== false) return null;
  if (status === "unsupported" || status === "granted") return null;

  function dismiss() {
    try {
      localStorage.setItem(BAR_DISMISS_KEY + target, String(Date.now()));
    } catch {
      // хадгалж чадахгүй бол зөвхөн энэ удаад нууна
    }
    setDismissed(true);
  }

  const denied = status === "denied";
  return (
    <div className={className}>
      <div
        role="status"
        className={`flex items-center gap-2.5 rounded-full border py-1 pl-1 pr-1.5 text-xs ${
          denied
            ? "border-[var(--oc-line)] bg-[var(--oc-panel)]"
            : "border-[var(--oc-accent)]/25 bg-[var(--oc-accent)]/[0.06]"
        }`}
      >
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
            denied
              ? "bg-white/[0.06] text-[var(--oc-muted3)] light:bg-black/[0.05]"
              : "bg-[var(--oc-accent)]/15 text-[var(--oc-accent)]"
          }`}
        >
          <BellIcon off={denied} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {denied ? (
            <>
              <span className="font-medium text-[var(--oc-ink2)]">Мэдэгдэл хаалттай</span>
              <span className="text-[var(--oc-muted3)]"> · хөтчийн тохиргооноос зөвшөөрнө үү</span>
            </>
          ) : (
            <>
              <span className="font-medium text-[var(--oc-ink)]">
                {status === "error" ? "Мэдэгдэл асааж чадсангүй" : "Энэ төхөөрөмж дээр мэдэгдэл авах"}
              </span>
              <span className="hidden text-[var(--oc-muted3)] md:inline"> · {description}</span>
            </>
          )}
        </span>
        {denied ? null : (
          <button
            type="button"
            disabled={status === "working"}
            onClick={() => enable(false)}
            className="shrink-0 rounded-full bg-[var(--oc-accent)] px-3 py-1 text-xs font-semibold text-[var(--oc-on-accent)] transition-colors hover:bg-[var(--oc-accent-hi)] disabled:opacity-60"
          >
            {status === "working" ? "Асааж байна…" : status === "error" ? "Дахин оролдох" : "Асаах"}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Хаах"
          title="14 хоног харуулахгүй"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--oc-muted3)] transition-colors hover:bg-white/[0.08] hover:text-[var(--oc-ink2)] light:hover:bg-black/[0.06]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
