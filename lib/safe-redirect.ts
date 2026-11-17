/**
 * "next" query параметрийг (харах: auth-ийн login→choose-branch урсгал)
 * бусад "буцах" урсгалд (захиалга/цаг захиалга үүсгэх) дахин ашиглах нэгдсэн
 * helper. Зөвхөн харьяа (site-ийн доторх, "/"-ээр эхэлсэн) зам зөвшөөрнө —
 * гадаад URL руу чиглүүлэх open-redirect эрсдэлээс сэргийлнэ.
 *
 * `//host` (protocol-relative) болон `/\host` — browser-ууд `\`-г `/` гэж
 * ойлгодог тул хоёуланг нь, мөн control тэмдэгт агуулсан утгыг татгалзана.
 */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/**
 * `safeNext` + зам нь `prefix` (ж: "/dashboard")-ийн дотор байх ёстой. Нэвтэрсэн
 * хэсэгтээ (realm) харьяалахгүй зам руу (ж: ажилтныг /system руу) явуулахгүй.
 */
export function safeNextWithin(
  raw: string | null | undefined,
  fallback: string,
  prefix: string,
): string {
  const next = safeNext(raw, fallback);
  const path = next.split(/[?#]/)[0];
  return path === prefix || path.startsWith(`${prefix}/`) ? next : fallback;
}
