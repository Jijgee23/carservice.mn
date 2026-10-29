import type { ReactNode } from "react";
import { formatTugrik } from "@/lib/orders";
import type { DocCustomer, DocHeader, OrderDocument, PrintFormat, SettlementDocument } from "@/lib/print/documents";

// Хэвлэх хуудас: A4 (хүснэгт) эсвэл 80мм дулааны принтер (нэг багана).
// Дэлгэц дээр цагаан цаас шиг харагдана; хэвлэхэд globals.css-ийн #print-root дүрэм ажиллана.
// Энэ нь татварын баримт биш (PRINTABLE_ORDER_SPEC.md).

const fmtDate = (d: Date) =>
  d.toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" });

const fmtDateTime = (d: Date) =>
  d.toLocaleString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const fmtQty = (q: string) => Number.parseFloat(q).toLocaleString("mn-MN", { maximumFractionDigits: 3 });

// A4: page size + margin. 80mm: margin only — the thermal printer's own roll size
// decides the paper (80mm roll with cutter, 72mm printable); no page margin, the 72mm box carries its own padding.
const PAGE_CSS: Record<PrintFormat, string> = {
  a4: "@media print { @page { size: A4; margin: 12mm; } }",
  "80mm": "@media print { @page { margin: 0; } #print-root { width: 72mm !important; } }",
};

function Paper({ format, children }: { format: PrintFormat; children: ReactNode }) {
  const narrow = format === "80mm";
  return (
    <>
      <style>{PAGE_CSS[format]}</style>
      <div
        id="print-root"
        className={`mx-auto bg-[#fff] text-[#111] shadow-sm rounded-[4px] ${
          narrow ? "w-[72mm] max-w-full p-3 text-[11px] leading-snug" : "w-full max-w-[210mm] p-6 sm:p-10 text-[13px] leading-relaxed"
        }`}
      >
        {children}
      </div>
    </>
  );
}

function Header({ header, format }: { header: DocHeader; format: PrintFormat }) {
  const narrow = format === "80mm";
  return (
    <div className={narrow ? "text-center flex flex-col items-center gap-0.5" : "flex items-start gap-4"}>
      {header.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={header.logoUrl} alt="" className={narrow ? "h-10 w-10 object-contain" : "h-14 w-14 object-contain shrink-0"} />
      ) : null}
      <div className="min-w-0">
        <div className={`font-semibold ${narrow ? "text-[13px]" : "text-[17px]"}`}>{header.shopName}</div>
        <div>РД: {header.shopRegnum}</div>
        <div>
          {header.branchName}
          {header.address ? ` · ${header.address}` : ""}
        </div>
        {header.phone ? <div>Утас: {header.phone}</div> : null}
      </div>
    </div>
  );
}

function Title({ title, sub, format }: { title: string; sub: ReactNode; format: PrintFormat }) {
  const narrow = format === "80mm";
  return (
    <div className={`${narrow ? "my-2 text-center border-y border-dashed border-[#999] py-1.5" : "my-5 flex items-baseline justify-between gap-4 border-b border-[#ccc] pb-2"}`}>
      <div className={`font-bold ${narrow ? "text-[13px]" : "text-[20px]"}`}>{title}</div>
      <div className={narrow ? "" : "text-right"}>{sub}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-[#555] shrink-0">{label}:</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function CustomerBlock({ customer }: { customer: DocCustomer }) {
  return (
    <div>
      {customer.orgName ? <Row label="Байгууллага" value={`${customer.orgName}${customer.orgRegnum ? ` · РД ${customer.orgRegnum}` : ""}`} /> : null}
      <Row label="Харилцагч" value={customer.name} />
      {customer.phone ? <Row label="Утас" value={customer.phone} /> : null}
    </div>
  );
}

function Totals({ rows, format }: { rows: Array<{ label: string; value: string; strong?: boolean }>; format: PrintFormat }) {
  const narrow = format === "80mm";
  return (
    <div className={narrow ? "mt-2 border-t border-dashed border-[#999] pt-1.5" : "mt-3 ml-auto w-full max-w-[280px]"}>
      {rows.map((r) => (
        <div key={r.label} className={`flex justify-between gap-3 ${r.strong ? "font-bold" : ""}`}>
          <span>{r.label}</span>
          <span className="tabular-nums whitespace-nowrap">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children, format }: { children: ReactNode; format: PrintFormat }) {
  return <div className={`font-semibold ${format === "80mm" ? "mt-2 border-t border-dashed border-[#999] pt-1.5" : "mt-5 mb-1.5"}`}>{children}</div>;
}

function Footer({ format }: { format: PrintFormat }) {
  return (
    <div className={`text-[#777] ${format === "80mm" ? "mt-3 text-center text-[10px]" : "mt-8 text-[11px] flex justify-between"}`}>
      <span>Хэвлэсэн: {fmtDateTime(new Date())}</span>
      {format === "80mm" ? <br /> : null}
      <span>carservice.mn</span>
    </div>
  );
}

const TH = "text-left font-semibold border-b border-[#bbb] py-1.5 px-1.5";
const TD = "border-b border-[#e3e3e3] py-1.5 px-1.5 align-top";

export function OrderPrint({ doc, format }: { doc: OrderDocument; format: PrintFormat }) {
  const narrow = format === "80mm";
  const totals: Array<{ label: string; value: string; strong?: boolean }> = [{ label: "Нийт дүн", value: formatTugrik(doc.total), strong: true }];
  if (doc.payments) {
    totals.push({ label: "Төлсөн", value: formatTugrik(doc.paid) });
    totals.push({ label: "Үлдэгдэл", value: formatTugrik(doc.remaining), strong: true });
  }
  return (
    <Paper format={format}>
      <Header header={doc.header} format={format} />
      <Title title={doc.title} sub={<div>№ {doc.number} · {fmtDate(doc.date)}</div>} format={format} />

      <div className={narrow ? "flex flex-col gap-0.5" : "grid grid-cols-2 gap-x-8 gap-y-0.5"}>
        <CustomerBlock customer={doc.customer} />
        <div>
          <Row label="Улсын дугаар" value={doc.vehicle.plate} />
          {doc.vehicle.makeModel ? <Row label="Машин" value={doc.vehicle.makeModel} /> : null}
          {doc.vehicle.vin ? <Row label="VIN" value={doc.vehicle.vin} /> : null}
          {doc.vehicle.mileageKm != null ? <Row label="Гүйлт" value={`${doc.vehicle.mileageKm.toLocaleString("mn-MN")} км`} /> : null}
          {doc.master ? <Row label="Мастер" value={doc.master} /> : null}
        </div>
      </div>

      <SectionTitle format={format}>Ажил, сэлбэг</SectionTitle>
      {doc.lines.length === 0 ? (
        <div className="text-[#777]">—</div>
      ) : narrow ? (
        <div className="flex flex-col gap-1">
          {doc.lines.map((l, i) => (
            <div key={i}>
              <div>
                {i + 1}. {l.description}
              </div>
              <div className="flex justify-between gap-2 tabular-nums">
                <span className="text-[#555]">
                  {fmtQty(l.quantity)} × {formatTugrik(l.unitPrice)}
                </span>
                <span>{formatTugrik(l.total)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-8`}>№</th>
              <th className={TH}>Нэр</th>
              <th className={`${TH} text-right w-16`}>Тоо</th>
              <th className={`${TH} text-right w-28`}>Нэгж үнэ</th>
              <th className={`${TH} text-right w-28`}>Дүн</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i}>
                <td className={TD}>{i + 1}</td>
                <td className={TD}>{l.description}</td>
                <td className={`${TD} text-right tabular-nums`}>{fmtQty(l.quantity)}</td>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatTugrik(l.unitPrice)}</td>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatTugrik(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Totals rows={totals} format={format} />

      {doc.payments && doc.payments.length > 0 ? (
        <>
          <SectionTitle format={format}>Төлбөр</SectionTitle>
          <div className="flex flex-col gap-0.5">
            {doc.payments.map((p, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {fmtDate(p.date)} · {p.method}
                  {p.account ? ` · ${p.account}` : ""}
                </span>
                <span className="tabular-nums whitespace-nowrap">{formatTugrik(p.amount)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {doc.payTo.length > 0 ? (
        <div className={`${narrow ? "mt-2 border-t border-dashed border-[#999] pt-1.5" : "mt-5 rounded-[6px] border border-[#bbb] p-3"}`}>
          <div className="font-semibold">Төлөх данс</div>
          {doc.payTo.map((a, i) => (
            <div key={i} className={narrow ? "" : "flex justify-between gap-4"}>
              <span>{a.name}</span>
              {narrow ? <br /> : null}
              <span className="font-semibold tabular-nums">{a.accountNumber}</span>
            </div>
          ))}
          <div className="text-[#555] mt-1">Гүйлгээний утга: {doc.number}</div>
        </div>
      ) : null}

      <Footer format={format} />
    </Paper>
  );
}

export function SettlementPrint({ doc, format }: { doc: SettlementDocument; format: PrintFormat }) {
  const narrow = format === "80mm";
  return (
    <Paper format={format}>
      <Header header={doc.header} format={format} />
      <Title title={doc.title} sub={<div>{fmtDate(doc.date)}</div>} format={format} />
      {doc.voided ? (
        <div className="mb-2 rounded-[4px] border border-[#999] p-2 font-semibold">
          Энэ тооцоо цуцлагдсан, хүчингүй.
          {doc.voidReason ? <div className="font-normal">Шалтгаан: {doc.voidReason}</div> : null}
        </div>
      ) : null}
      <CustomerBlock customer={doc.customer} />

      <SectionTitle format={format}>Захиалгууд</SectionTitle>
      {narrow ? (
        <div className="flex flex-col gap-1">
          {doc.orders.map((o) => (
            <div key={o.number}>
              <div>
                #{o.number}
                {o.plate ? ` · ${o.plate}` : ""}
                {o.date ? ` · ${fmtDate(o.date)}` : ""}
              </div>
              <div className="flex justify-between gap-2 tabular-nums">
                <span className="text-[#555]">Нийт {formatTugrik(o.orderTotal)}</span>
                <span>{formatTugrik(o.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>Захиалга</th>
              <th className={TH}>Огноо</th>
              <th className={TH}>Улсын дугаар</th>
              <th className={`${TH} text-right`}>Захиалгын дүн</th>
              <th className={`${TH} text-right`}>Энэ тооцоонд</th>
            </tr>
          </thead>
          <tbody>
            {doc.orders.map((o) => (
              <tr key={o.number}>
                <td className={TD}>#{o.number}</td>
                <td className={TD}>{o.date ? fmtDate(o.date) : "—"}</td>
                <td className={TD}>{o.plate ?? "—"}</td>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatTugrik(o.orderTotal)}</td>
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatTugrik(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Totals
        rows={[
          { label: "Нийт", value: formatTugrik(doc.total), strong: true },
          { label: "Төлбөрийн хэлбэр", value: `${doc.method}${doc.account ? ` · ${doc.account}` : ""}` },
        ]}
        format={format}
      />
      <Footer format={format} />
    </Paper>
  );
}
