/**
 * Account-realm push notification-ий дарахад шилжих зам — зөвхөн клиент
 * bundle-д ашиглагдана (web-push.tsx, service worker). `lib/notifications.ts`-ийн
 * `NOTIFICATION_REGISTRY`-тэй ижил логик боловч тэр модуль Prisma/server кодтой
 * тул клиент рүү импортлож болохгүй — энд давхардуулав. Шинэ account-realm
 * event нэмэхдээ энд болон `public/firebase-messaging-sw.js`-д ижил тохируулна уу.
 */
export function accountNotificationHref(data: Record<string, string> | undefined | null): string {
  const d = data ?? {};
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
