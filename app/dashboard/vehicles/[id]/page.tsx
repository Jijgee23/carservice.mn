import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import {
  APPOINTMENT_STATUS_BADGE,
  APPOINTMENT_STATUS_LABEL,
  type AppointmentStatus,
} from "@/lib/appointments";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  formatTugrik,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";
import { getVinHistory } from "@/lib/vehicles/vin-history";
import { getVehicleHistory, isOwnerLocked } from "@/lib/vehicles/vehicle-history";
import { VEHICLE_FORM_ID, VehicleForm } from "../vehicle-form";

export const metadata = {
  title: "Машины дэлгэрэнгүй",
};

function fmtDate(d: Date | null): string {
  return d
    ? d.toLocaleDateString("mn-MN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    : "—";
}

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!canEdit(user, "vehicles")) redirect("/dashboard/vehicles");

  const { id } = await params;

  // id = global vehicleId. Тенантын link-ээр дамжуулж ачаална (харьяалал link дээр).
  const [link, customers, history, vinHistory] = await Promise.all([
    prisma.tenantVehicle.findUnique({
      where: {
        tenantId_vehicleId: { tenantId: user.tenantId, vehicleId: id },
      },
      select: {
        customerId: true,
        isPostpaid: true,
        customer: { select: { isOrganization: true } },
        vehicle: true,
      },
    }),
    prisma.customer.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, phone: true, isOrganization: true, orgRegnum: true },
    }),
    // Захиалга, цаг захиалгын түүх, оношилгооны тайлангийн тоо — DM-05-ийн
    // дагуу нэг л газар (lib/vehicles/vehicle-history.ts), энэ хуудас болон
    // /api/v1/vehicles/[id]/history route хоёулаа ижилхэн дуудна.
    getVehicleHistory(user.tenantId, id),
    getVinHistory(user.tenantId, id),
  ]);

  if (!link) notFound();
  const vehicle = link.vehicle;
  const { orders, appointments } = history;
  // Засварын түүхтэй машины эзнийг солих боломжгүй (updateVehicleAction-тай
  // ижил шалгуур) — form дээр урьдчилан хаана.
  const ownerLocked = isOwnerLocked(history);

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/vehicles" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Машинууд
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{vehicle.make} {vehicle.model}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">
            {vehicle.make} {vehicle.model}
            {vehicleOwnerIsOrganization(link.customer, vehicle.ownerRegnum) ? (
              <span className="ml-3 align-middle rounded-full border border-[var(--oc-line)] px-2 py-0.5 text-xs font-medium text-[var(--oc-muted)]">
                Байгууллага
              </span>
            ) : null}
          </h1>
          <p className="font-plex-mono text-sm text-[var(--oc-muted3)] mt-1">{vehicle.plate}</p>
        </div>
        <div className="flex items-center  gap-2">
          <BtnLink href="/dashboard/vehicles" variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={VEHICLE_FORM_ID}>
            Хадгалах
          </Btn>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Машины бүх мэдээлэл + HUR шинэчлэх (form дотор товчтой) */}
        <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
          <h2 className="font-semibold text-[var(--oc-ink)] text-sm mb-4">Машины мэдээлэл</h2>
          <VehicleForm
            initial={{
              id: vehicle.id,
              plate: vehicle.plate,
              vin: vehicle.vin,
              make: vehicle.make,
              model: vehicle.model,
              year: vehicle.year,
              mileage: vehicle.mileage,
              fuelType: vehicle.fuelType,
              wheelPosition: vehicle.wheelPosition,
              colorName: vehicle.colorName,
              capacity: vehicle.capacity,
              purpose: vehicle.purpose,
              ownerRegnum: vehicle.ownerRegnum,
              customerId: link.customerId,
              isPostpaid: link.isPostpaid,
            }}
            customers={customers}
            ownerLocked={ownerLocked}
          />
        </div>

        {vinHistory &&
        vinHistory.vin &&
        (vinHistory.records.length > 0 || vinHistory.otherTenantRecords > 0) ? (
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--oc-line)]">
              <h2 className="font-semibold text-[var(--oc-ink)] text-sm">
                Ижил арлын дугаартай бүртгэл
              </h2>
              <p className="font-plex-mono text-xs text-[var(--oc-muted3)] mt-1">
                {vinHistory.vin}
              </p>
            </div>
            <ul className="divide-y divide-[var(--oc-line)]">
              {vinHistory.records.map((r) => (
                <li key={r.vehicleId} className="px-5 py-3 text-sm">
                  <Link
                    href={`/dashboard/vehicles/${r.vehicleId}`}
                    className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                  >
                    <span className="font-plex-mono">{r.plate}</span> · {r.make} {r.model}
                    {r.year ? ` · ${r.year}` : ""}
                  </Link>
                  <div className="text-xs text-[var(--oc-muted3)] mt-0.5">
                    {r.ownerName ?? "Эзэнгүй"} · {r.orderCount} засвар
                  </div>
                </li>
              ))}
            </ul>
            {vinHistory.otherTenantRecords > 0 ? (
              <p className="px-5 py-3 text-xs text-[var(--oc-muted3)]">
                Бусад байгууллагад {vinHistory.otherTenantRecords} бүртгэл байна.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* items-start: карт бүр өөрийн контентын өндөртэй — сунаж хоосон
            орон зай үүсгэхгүй */}
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          {/* Захиалгууд */}
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--oc-line)]">
              <h2 className="font-semibold text-[var(--oc-ink)] text-sm">Засварын хуудас</h2>
              <div className="flex items-center gap-3">
                <span className="font-plex-mono text-xs text-[var(--oc-muted3)]">{orders.length}</span>
                {orders.length > 0 ? (
                  <Link
                    href={`/dashboard/orders?q=${encodeURIComponent(vehicle.plate)}`}
                    className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] transition-colors"
                  >
                    Бүгдийг харах →
                  </Link>
                ) : null}
              </div>
            </div>
            {orders.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-[var(--oc-muted3)]">
                Энэ машинд засварын хуудас байхгүй байна.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--oc-line)]">
                {orders.map((o) => {
                  const when = o.completedAt ?? o.scheduledAt ?? o.createdAt;
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/dashboard/orders/${o.id}`}
                        className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-plex-mono text-sm font-semibold text-[var(--oc-ink2)]">
                              №{o.number}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${ORDER_STATUS_BADGE[o.status as OrderStatus]}`}
                            >
                              {ORDER_STATUS_LABEL[o.status as OrderStatus]}
                            </span>
                          </div>
                          <div className="text-xs text-[var(--oc-muted3)] mt-1 tabular-nums">
                            {fmtDate(when)} · {o.branch.name} · {o.itemCount}{" "}
                            мөр
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-plex-mono text-sm font-semibold text-[var(--oc-ink)] tabular-nums">
                            {formatTugrik(o.totalAmount)}
                          </div>
                          <div className="text-xs text-[var(--oc-muted3)]">
                            {
                              PAYMENT_STATUS_LABEL[
                              o.paymentStatus as PaymentStatus
                              ]
                            }
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Цаг захиалгын түүх */}
          <section className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--oc-line)]">
              <h2 className="font-semibold text-[var(--oc-ink)] text-sm">Цаг захиалгын түүх</h2>
              <span className="font-plex-mono text-xs text-[var(--oc-muted3)]">
                {appointments.length}
              </span>
            </div>
            {appointments.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-[var(--oc-muted3)]">
                Цаг захиалга байхгүй байна.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--oc-line)]">
                {appointments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-plex-mono text-sm text-[var(--oc-ink2)] tabular-nums">
                          {a.requestedAt.toLocaleString("mn-MN", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${APPOINTMENT_STATUS_BADGE[a.status as AppointmentStatus]}`}
                        >
                          {APPOINTMENT_STATUS_LABEL[a.status as AppointmentStatus]}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--oc-muted3)] mt-1">
                        {a.branch.name}
                        {a.category ? ` · ${a.category.name}` : ""}
                        {a.note ? ` · ${a.note}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
