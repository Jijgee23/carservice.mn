// Захиалгын хуудас / тооцооны нэхэмжлэхийн PDF (мобайл endpoint-д). Вэбийн HTML хэвлэх загвартай
// (app/_components/print/print-document.tsx) ИЖИЛ агуулга — аль аль нь lib/print/documents.ts-ийн
// цэвэр view model-оос зурагдана. Энэ нь татварын баримт (e-barimt) БИШ.
// Лого зураг оруулахгүй (гадаад URL-аас татаж, хугацаа/аюулын эрсдэл үүсгэхгүйн тулд).
// Кирилл дэмждэг DejaVuSans-ийг файлын системээс ачаална (lib/diagnostics-pdf.tsx-тэй ижил).

import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { formatTugrik } from "@/lib/orders";
import { CHECKLIST_STATUS_LABEL } from "@/lib/orders/order-settings";
import type { DocCustomer, DocHeader, OrderDocument, PrintFormat, SettlementDocument } from "@/lib/print/documents";

let fontRegistered = false;
function ensureFontRegistered(): void {
  if (fontRegistered) return;
  Font.register({
    family: "DejaVuSans",
    fonts: [
      { src: path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"), fontWeight: "normal" },
      { src: path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // Үгийг дундуур таслахгүй (кирилл урт нэр): зөвхөн зайгаар мөр шилжүүлнэ.
  Font.registerHyphenationCallback((word) => [word]);
  fontRegistered = true;
}

const TZ = "Asia/Ulaanbaatar";
const fmtDate = (d: Date) =>
  d.toLocaleDateString("mn-MN", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtDateTime = (d: Date) =>
  d.toLocaleString("mn-MN", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtQty = (q: string) => Number.parseFloat(q).toLocaleString("mn-MN", { maximumFractionDigits: 3 });

/** 80мм = 226.77pt. A4 бол хуудаслалттай. */
export const RECEIPT_WIDTH_PT = 226.77;

const s = StyleSheet.create({
  a4: { padding: 34, fontFamily: "DejaVuSans", fontSize: 10, color: "#111", lineHeight: 1.35 },
  narrow: { padding: 10, fontFamily: "DejaVuSans", fontSize: 8, color: "#111", lineHeight: 1.3 },
  shop: { fontWeight: "bold" },
  muted: { color: "#555" },
  titleBar: { marginTop: 12, marginBottom: 10, flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#999", paddingBottom: 5 },
  titleBarNarrow: { marginTop: 6, marginBottom: 6, alignItems: "center", borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#999", paddingVertical: 4 },
  title: { fontWeight: "bold" },
  row: { flexDirection: "row", gap: 4 },
  rowLabel: { color: "#555" },
  section: { marginTop: 12, marginBottom: 4, fontWeight: "bold" },
  sectionNarrow: { marginTop: 6, paddingTop: 4, borderTopWidth: 0.5, borderTopColor: "#999", fontWeight: "bold" },
  th: { fontWeight: "bold", borderBottomWidth: 1, borderBottomColor: "#999", paddingVertical: 3 },
  td: { borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 3 },
  right: { textAlign: "right" },
  between: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  totals: { marginTop: 8, alignSelf: "flex-end", width: 220 },
  totalsNarrow: { marginTop: 6, paddingTop: 4, borderTopWidth: 0.5, borderTopColor: "#999" },
  strong: { fontWeight: "bold" },
  box: { marginTop: 12, borderWidth: 1, borderColor: "#999", padding: 8 },
  sign: { marginTop: 28, flexDirection: "row", gap: 32 },
  signCol: { flex: 1 },
  signLine: { height: 22, borderBottomWidth: 1, borderBottomColor: "#555" },
  footer: { marginTop: 18, color: "#777", flexDirection: "row", justifyContent: "space-between" },
  footerNarrow: { marginTop: 10, color: "#777", textAlign: "center" },
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}:</Text>
      <Text style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}

function HeaderBlock({ header, narrow }: { header: DocHeader; narrow: boolean }) {
  const place = header.address ? `${header.branchName ? `${header.branchName} · ` : ""}${header.address}` : header.branchName;
  return (
    <View style={narrow ? { alignItems: "center" } : undefined}>
      <Text style={[s.shop, { fontSize: narrow ? 10 : 14 }]}>{header.shopName}</Text>
      <Text>РД: {header.shopRegnum}</Text>
      {place ? <Text>{place}</Text> : null}
      {header.phone ? <Text>Утас: {header.phone}</Text> : null}
    </View>
  );
}

function TitleBlock({ title, sub, narrow }: { title: string; sub: string; narrow: boolean }) {
  return (
    <View style={narrow ? s.titleBarNarrow : s.titleBar}>
      <Text style={[s.title, { fontSize: narrow ? 10 : 16 }]}>{title}</Text>
      <Text>{sub}</Text>
    </View>
  );
}

function CustomerBlock({ customer }: { customer: DocCustomer }) {
  return (
    <View>
      {customer.orgName ? <Row label="Байгууллага" value={`${customer.orgName}${customer.orgRegnum ? ` · РД ${customer.orgRegnum}` : ""}`} /> : null}
      <Row label="Харилцагч" value={customer.name} />
      {customer.phone ? <Row label="Утас" value={customer.phone} /> : null}
    </View>
  );
}

function Totals({ rows, narrow }: { rows: Array<{ label: string; value: string; strong?: boolean }>; narrow: boolean }) {
  return (
    <View style={narrow ? s.totalsNarrow : s.totals} wrap={false}>
      {rows.map((r) => (
        <View key={r.label} style={s.between}>
          <Text style={r.strong ? s.strong : undefined}>{r.label}</Text>
          <Text style={r.strong ? s.strong : undefined}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ children, narrow }: { children: ReactNode; narrow: boolean }) {
  return <Text style={narrow ? s.sectionNarrow : s.section}>{children}</Text>;
}

function FooterBlock({ narrow, printedAt }: { narrow: boolean; printedAt: Date }) {
  return narrow ? (
    <View style={s.footerNarrow}>
      <Text>Хэвлэсэн: {fmtDateTime(printedAt)}</Text>
      <Text>carservice.mn</Text>
    </View>
  ) : (
    <View style={s.footer}>
      <Text>Хэвлэсэн: {fmtDateTime(printedAt)}</Text>
      <Text>carservice.mn</Text>
    </View>
  );
}

// A4: тоо/нэгж үнэ/дүн багануудтай хүснэгт. 80мм: мөр бүр хоёр мөрөнд.
const COL = { no: 22, qty: 44, unit: 80, total: 80 } as const;

function OrderBody({ doc, narrow, printedAt }: { doc: OrderDocument; narrow: boolean; printedAt: Date }) {
  const totals: Array<{ label: string; value: string; strong?: boolean }> = [{ label: "Нийт дүн", value: formatTugrik(doc.total), strong: true }];
  if (doc.payments) {
    totals.push({ label: "Төлсөн", value: formatTugrik(doc.paid) });
    totals.push({ label: "Үлдэгдэл", value: formatTugrik(doc.remaining), strong: true });
  }
  return (
    <>
      <HeaderBlock header={doc.header} narrow={narrow} />
      <TitleBlock title={doc.title} sub={`№ ${doc.number} · ${fmtDate(doc.date)}`} narrow={narrow} />
      {doc.headerNote ? <Text style={{ marginBottom: 6 }}>{doc.headerNote}</Text> : null}

      <View style={narrow ? undefined : { flexDirection: "row", gap: 24 }}>
        <View style={narrow ? undefined : { flex: 1 }}>
          <CustomerBlock customer={doc.customer} />
        </View>
        <View style={narrow ? undefined : { flex: 1 }}>
          <Row label="Улсын дугаар" value={doc.vehicle.plate} />
          {doc.vehicle.makeModel ? <Row label="Машин" value={doc.vehicle.makeModel} /> : null}
          {doc.vehicle.vin ? <Row label="VIN" value={doc.vehicle.vin} /> : null}
          {doc.vehicle.mileageKm != null ? <Row label="Гүйлт" value={`${doc.vehicle.mileageKm.toLocaleString("mn-MN")} км`} /> : null}
          {doc.master ? <Row label="Мастер" value={doc.master} /> : null}
        </View>
      </View>

      {doc.checklist.length > 0 ? (
        <>
          <Section narrow={narrow}>Хүлээн авалтын шалгалт</Section>
          {doc.checklist.map((c, i) => (
            <View key={i} style={s.between} wrap={false}>
              <Text style={{ flex: 1 }}>{c.label}</Text>
              <Text style={c.status === "ISSUE" ? s.strong : s.muted}>
                {CHECKLIST_STATUS_LABEL[c.status]}
                {c.note ? ` — ${c.note}` : ""}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      <Section narrow={narrow}>Ажил, сэлбэг</Section>
      {doc.lines.length === 0 ? (
        <Text style={s.muted}>—</Text>
      ) : narrow ? (
        doc.lines.map((l, i) => (
          <View key={i} style={{ marginBottom: 3 }} wrap={false}>
            <Text>
              {i + 1}. {l.description}
            </Text>
            <View style={s.between}>
              <Text style={s.muted}>
                {fmtQty(l.quantity)} × {formatTugrik(l.unitPrice)}
              </Text>
              <Text>{formatTugrik(l.total)}</Text>
            </View>
          </View>
        ))
      ) : (
        <View>
          <View style={{ flexDirection: "row" }} fixed>
            <Text style={[s.th, { width: COL.no }]}>№</Text>
            <Text style={[s.th, { flex: 1 }]}>Нэр</Text>
            <Text style={[s.th, s.right, { width: COL.qty }]}>Тоо</Text>
            <Text style={[s.th, s.right, { width: COL.unit }]}>Нэгж үнэ</Text>
            <Text style={[s.th, s.right, { width: COL.total }]}>Дүн</Text>
          </View>
          {doc.lines.map((l, i) => (
            <View key={i} style={{ flexDirection: "row" }} wrap={false}>
              <Text style={[s.td, { width: COL.no }]}>{i + 1}</Text>
              <Text style={[s.td, { flex: 1 }]}>{l.description}</Text>
              <Text style={[s.td, s.right, { width: COL.qty }]}>{fmtQty(l.quantity)}</Text>
              <Text style={[s.td, s.right, { width: COL.unit }]}>{formatTugrik(l.unitPrice)}</Text>
              <Text style={[s.td, s.right, { width: COL.total }]}>{formatTugrik(l.total)}</Text>
            </View>
          ))}
        </View>
      )}
      <Totals rows={totals} narrow={narrow} />

      {doc.payments && doc.payments.length > 0 ? (
        <>
          <Section narrow={narrow}>Төлбөр</Section>
          {doc.payments.map((p, i) => (
            <View key={i} style={s.between} wrap={false}>
              <Text style={{ flex: 1 }}>
                {fmtDate(p.date)} · {p.method}
                {p.account ? ` · ${p.account}` : ""}
              </Text>
              <Text>{formatTugrik(p.amount)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {doc.payTo.length > 0 ? (
        <View style={narrow ? s.totalsNarrow : s.box} wrap={false}>
          <Text style={s.strong}>Төлөх данс</Text>
          {doc.payTo.map((a, i) => (
            <View key={i} style={s.between}>
              <Text style={{ flex: 1 }}>{a.name}</Text>
              <Text style={s.strong}>{a.accountNumber}</Text>
            </View>
          ))}
          <Text style={s.muted}>Гүйлгээний утга: {doc.number}</Text>
        </View>
      ) : null}

      {doc.footerNote ? <Text style={{ marginTop: narrow ? 6 : 12 }}>{doc.footerNote}</Text> : null}

      {doc.signatureLines ? (
        <View style={narrow ? { marginTop: 16, gap: 14 } : s.sign} wrap={false}>
          {["Хүлээлгэн өгсөн", "Хүлээн авсан"].map((label) => (
            <View key={label} style={narrow ? undefined : s.signCol}>
              <View style={s.signLine} />
              <Text style={s.muted}>{label}: ............................</Text>
            </View>
          ))}
        </View>
      ) : null}

      <FooterBlock narrow={narrow} printedAt={printedAt} />
    </>
  );
}

function SettlementBody({ doc, narrow, printedAt }: { doc: SettlementDocument; narrow: boolean; printedAt: Date }) {
  return (
    <>
      <HeaderBlock header={doc.header} narrow={narrow} />
      <TitleBlock title={doc.title} sub={fmtDate(doc.date)} narrow={narrow} />
      {doc.voided ? (
        <View style={{ marginBottom: 6, borderWidth: 1, borderColor: "#999", padding: 6 }} wrap={false}>
          <Text style={s.strong}>Энэ тооцоо цуцлагдсан, хүчингүй.</Text>
          {doc.voidReason ? <Text>Шалтгаан: {doc.voidReason}</Text> : null}
        </View>
      ) : null}
      <CustomerBlock customer={doc.customer} />

      <Section narrow={narrow}>Захиалгууд</Section>
      {narrow ? (
        doc.orders.map((o) => (
          <View key={o.number} style={{ marginBottom: 3 }} wrap={false}>
            <Text>
              #{o.number}
              {o.plate ? ` · ${o.plate}` : ""}
              {o.date ? ` · ${fmtDate(o.date)}` : ""}
            </Text>
            <View style={s.between}>
              <Text style={s.muted}>Нийт {formatTugrik(o.orderTotal)}</Text>
              <Text>{formatTugrik(o.amount)}</Text>
            </View>
          </View>
        ))
      ) : (
        <View>
          <View style={{ flexDirection: "row" }} fixed>
            <Text style={[s.th, { flex: 1 }]}>Захиалга</Text>
            <Text style={[s.th, { width: 70 }]}>Огноо</Text>
            <Text style={[s.th, { width: 80 }]}>Улсын дугаар</Text>
            <Text style={[s.th, s.right, { width: 90 }]}>Захиалгын дүн</Text>
            <Text style={[s.th, s.right, { width: 90 }]}>Энэ тооцоонд</Text>
          </View>
          {doc.orders.map((o) => (
            <View key={o.number} style={{ flexDirection: "row" }} wrap={false}>
              <Text style={[s.td, { flex: 1 }]}>#{o.number}</Text>
              <Text style={[s.td, { width: 70 }]}>{o.date ? fmtDate(o.date) : "—"}</Text>
              <Text style={[s.td, { width: 80 }]}>{o.plate ?? "—"}</Text>
              <Text style={[s.td, s.right, { width: 90 }]}>{formatTugrik(o.orderTotal)}</Text>
              <Text style={[s.td, s.right, { width: 90 }]}>{formatTugrik(o.amount)}</Text>
            </View>
          ))}
        </View>
      )}
      <Totals
        rows={[
          { label: "Нийт", value: formatTugrik(doc.total), strong: true },
          { label: "Төлбөрийн хэлбэр", value: `${doc.method}${doc.account ? ` · ${doc.account}` : ""}` },
        ]}
        narrow={narrow}
      />
      <FooterBlock narrow={narrow} printedAt={printedAt} />
    </>
  );
}

/**
 * 80мм-ийн хуудасны өндөр (pt). react-pdf нь «автомат өндөр»-гүй тул агуулгаас ХАМГААС ИХЭЭР тооцож
 * хэт бага (агуулга таслагдах) байхаас сэргийлнэ; илүүдэл нь цагаан зай. Агуулга нэмэгдэх тусам өснө.
 */
export function receiptHeightPt(doc: OrderDocument | SettlementDocument): number {
  const wrapLines = (text: string | null | undefined, perLine = 34) =>
    text ? text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0) : 0;
  let lines = 14; // толгой, гарчиг, харилцагч, footer
  if (doc.kind === "order") {
    lines += 8; // машин, мастер, нийт дүн
    lines += doc.lines.reduce((n, l) => n + 1 + Math.max(1, Math.ceil(l.description.length / 34)), 0);
    lines += doc.checklist.reduce((n, c) => n + 1 + wrapLines(c.note), 0) + (doc.checklist.length ? 2 : 0);
    lines += (doc.payments?.length ?? 0) * 2 + (doc.payments?.length ? 2 : 0);
    lines += doc.payTo.length * 2 + (doc.payTo.length ? 3 : 0);
    lines += wrapLines(doc.headerNote) + wrapLines(doc.footerNote);
    lines += doc.signatureLines ? 8 : 0;
  } else {
    lines += 6 + doc.orders.length * 3 + wrapLines(doc.voidReason) + (doc.voided ? 3 : 0);
  }
  return Math.max(260, Math.ceil(lines * 11.5 + 30));
}

export type PdfDocument = OrderDocument | SettlementDocument;

function PrintPdf({ doc, format, printedAt }: { doc: PdfDocument; format: PrintFormat; printedAt: Date }) {
  const narrow = format === "80mm";
  const body = doc.kind === "order" ? <OrderBody doc={doc} narrow={narrow} printedAt={printedAt} /> : <SettlementBody doc={doc} narrow={narrow} printedAt={printedAt} />;
  return (
    <Document title={`${doc.title} ${doc.kind === "order" ? `№ ${doc.number}` : ""}`.trim()} author="carservice.mn">
      {narrow ? (
        <Page size={{ width: RECEIPT_WIDTH_PT, height: receiptHeightPt(doc) }} style={s.narrow}>
          {body}
        </Page>
      ) : (
        <Page size="A4" style={s.a4} wrap>
          {body}
        </Page>
      )}
    </Document>
  );
}

export async function renderPrintPdf(doc: PdfDocument, format: PrintFormat, printedAt: Date = new Date()): Promise<Buffer> {
  ensureFontRegistered();
  return renderToBuffer(<PrintPdf doc={doc} format={format} printedAt={printedAt} />);
}
