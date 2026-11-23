/* Firebase Cloud Messaging — фон (background) мессежийн service worker.
 * Config-ыг ЭНД шууд бичнэ (query string-ээр дамжуулахаас татгалзсан — тэр
 * арга нь register()-ийн URL уртасгаж, encode/parse алдаа гарах эрсдэлтэй,
 * мөн ажилладаг лавлагаа төслүүд (жишээ: online_shop) бүгд шууд шигтгэдэг
 * загварыг ашигладаг). Эдгээр утга бүгд PUBLIC (NEXT_PUBLIC_FIREBASE_*-тай
 * ижил, аль хэдийн клиент bundle-д ил байгаа) — нууц биш. */
importScripts(
  "https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js",
);

firebase.initializeApp({
  apiKey: "AIzaSyCbw7gsHS6Th_ph8c8e6CpC-ZYTkpqZthc",
  authDomain: "carcare-bf796.firebaseapp.com",
  projectId: "carcare-bf796",
  messagingSenderId: "17267525827",
  appId: "1:17267525827:web:f1241072cd24cb96fffa76",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = (payload && payload.notification) || {};
  self.registration.showNotification(n.title || "Carservice", {
    body: n.body || "",
    data: (payload && payload.data) || {},
  });

  // Нээлттэй байгаа таб(ууд)-д мэдэгдэнэ — тэдгээрийн NotificationBell шууд
  // (45с polling-ийг хүлээлгүй) шинэчлэгдэхийн тулд. Background message нь
  // web-push.tsx-ийн онгойлт (onMessage) дундуур ЯВДАГГҮЙ тул тэр талын
  // "carcare:notification-received" dispatch энд хүрдэггүй — иймд SW-ээс
  // өөрөө clients руу postMessage хийж дамжуулна.
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      client.postMessage({ type: "carcare:notification-received" });
    }
  });
});

// Мэдэгдэл дээр дарахад шилжих зам — lib/notifications.ts-ийн
// NOTIFICATION_REGISTRY-ийн href()-тэй ижил логик, гэхдээ service worker нь
// тухайн server-side модулийг import хийж чадахгүй тул энд давхардуулав.
// Шинэ account-realm event нэмэхдээ энд ч тохирох замыг нэмнэ үү.
function hrefForNotificationData(data) {
  const d = data || {};
  switch (d.type) {
    case "appointment_confirmed":
    case "appointment_rejected":
    case "appointment_reminder":
    case "appointment_expired":
      return d.appointmentId ? `/account/appointments/${d.appointmentId}` : "/account";
    case "diagnostic_report_created":
      return d.reportId ? `/account/diagnostics/${d.reportId}` : "/account/diagnostics";
    case "feedback_replied_account":
    case "broadcast_account":
      return "/account/notifications";
    default:
      return "/account";
  }
}

// Мэдэгдэл дээр дарахад: аль хэдийн нээлттэй таб байвал түүн рүү шилжиж
// шинэ хаяг руу шилжинэ (шинэ таб нээхгүй); байхгүй бол шинээр нээнэ.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = hrefForNotificationData(event.notification.data);
  const targetUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) return client.navigate(targetUrl);
            return;
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
