import Link from "next/link";
import { deleteAccountVehicle } from "@/app/_actions/account-vehicles";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { TagChip } from "@/app/_components/landing-ops-ui";
import { requireAccount } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { AddAccountVehicle } from "../add-account-vehicle";

export const metadata = {
  title: "Миний машинууд",
};

export const dynamic = "force-dynamic";

export default async function AccountVehiclesPage() {
  const account = await requireAccount();

  const VEH_SELECT = {
    plate: true,
    make: true,
    model: true,
    year: true,
    vin: true,
    fuelType: true,
    wheelPosition: true,
    colorName: true,
    capacity: true,
    purpose: true,
    _count: {
      select: {
        serviceOrders: { where: { status: "COMPLETED", isInternal: false } },
        diagnosticReports: true,
      },
    },
  } as const;

  const [avLinks, ownedTV] = await Promise.all([
    // 1) Хэрэглэгчийн өөрөө нэмсэн машинууд (устгах боломжтой).
    prisma.accountVehicle.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, vehicleId: true, vehicle: { select: VEH_SELECT } },
    }),
    // 2) Сервисүүдэд бүртгэлтэй, энэ хэрэглэгчид холбогдсон машин — account-той
    //    холбоотой ЭСВЭЛ утас нь таарсан Customer-ээр (баталгаажсан эзэмшил).
    prisma.tenantVehicle.findMany({
      where: {
        OR: [
          { customer: { accountId: account.id } },
          { customer: { phone: { endsWith: account.phone } } },
        ],
      },
      select: { vehicleId: true, vehicle: { select: VEH_SELECT } },
      distinct: ["vehicleId"],
    }),
  ]);

  // Global Vehicle-ээр нэгтгэж давхардлыг арилгана. Өөрийн нэмсэн нь устгагдах
  // боломжтой (removable); сервисээс ирсэн нь зөвхөн харагдана.
  const vehMap = new Map<
    string,
    {
      id: string;
      vehicleId: string;
      plate: string;
      make: string;
      model: string;
      year: number | null;
      vin: string | null;
      fuelType: string | null;
      wheelPosition: string | null;
      colorName: string | null;
      capacity: number | null;
      purpose: string | null;
      _count: {
        serviceOrders: number;
        diagnosticReports: number;
      };
      removable: boolean;
    }
  >();
  for (const av of avLinks) {
    vehMap.set(av.vehicleId, {
      id: av.id,
      vehicleId: av.vehicleId,
      removable: true,
      ...av.vehicle,
    });
  }
  for (const tv of ownedTV) {
    if (!vehMap.has(tv.vehicleId)) {
      vehMap.set(tv.vehicleId, {
        id: tv.vehicleId,
        vehicleId: tv.vehicleId,
        removable: false,
        ...tv.vehicle,
      });
    }
  }
  const vehicles = [...vehMap.values()];
  const totalServices = vehicles.reduce((n, v) => n + v._count.serviceOrders, 0);
  const totalDiagnostics = vehicles.reduce((n, v) => n + v._count.diagnosticReports, 0);

  return (
    <div className="w-full flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--oc-accent)]/10 blur-2xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--oc-accent)]">
              Миний гараж
            </div>
            <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Миний машинууд</h1>
            <p className="mt-1 text-sm text-[var(--oc-muted)]">
              Машинаа бүртгэвэл цаг захиалахад сонгох, үйлчилгээний түүхээ нэг дор харах боломжтой.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Машин", value: vehicles.length },
              { label: "Үйлчилгээ", value: totalServices },
              { label: "Оношилгоо", value: totalDiagnostics },
            ].map((s) => (
              <div
                key={s.label}
                className="min-w-[5.5rem] rounded-xl border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-3 py-2.5"
              >
                <dt className="text-[11px] text-[var(--oc-muted3)]">{s.label}</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums text-[var(--oc-ink)]">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--oc-line)] bg-[var(--oc-panel)] px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--oc-accent)]/10 text-[var(--oc-accent)]">
            <CarIcon className="h-7 w-7" />
          </div>
          <div className="text-sm font-semibold text-[var(--oc-ink)]">Машин бүртгээгүй байна</div>
          <div className="mt-1 text-xs text-[var(--oc-muted3)]">
            Улсын дугаараа оруулаад машинаа нэмээрэй — цаг захиалахад хэрэг болно.
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => {
            const specs = [
              v.fuelType,
              v.capacity ? `${v.capacity.toLocaleString("mn-MN")} см³` : null,
              v.colorName,
              v.wheelPosition ? `Хүрд: ${v.wheelPosition}` : null,
              v.purpose,
            ].filter((x): x is string => Boolean(x));
            return (
              <div
                key={v.id}
                className="group relative flex flex-col rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] shadow-sm transition-all hover:border-[var(--oc-accent)]/50 hover:shadow-lg"
              >
                <Link
                  href={`/account/vehicles/${v.vehicleId}`}
                  className="flex flex-1 flex-col gap-4 p-4 sm:p-5"
                  title="Машины дэлгэрэнгүй ба үйлчилгээний түүх"
                >
                  <div className="flex items-start gap-3 pr-8">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--oc-accent)]/10 text-[var(--oc-accent)]">
                      <CarIcon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold text-[var(--oc-ink)] group-hover:text-[var(--oc-accent)] transition-colors">
                        {[v.make, v.model].filter(Boolean).join(" ") || "Машин"}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--oc-muted3)]">
                        {v.year ? <span className="tabular-nums">{v.year} он</span> : null}
                        {!v.removable ? <TagChip>Сервисээс</TagChip> : null}
                      </div>
                    </div>
                  </div>

                  {/* Улсын дугаар — дугаарын хавтан шиг */}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-stretch overflow-hidden rounded-lg border-2 border-[var(--oc-ink)]/80 bg-[#fff] font-plex-mono text-lg font-bold tracking-[0.12em] text-[#1e2b38] shadow-sm">
                      <span className="flex items-center bg-[#1f4e9c] px-1.5 text-[9px] font-bold tracking-normal text-[#fff]">MN</span>
                      <span className="px-3 py-1 tabular-nums">{v.plate}</span>
                    </span>
                  </div>

                  {specs.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {specs.map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-panel2)] px-2 py-0.5 text-[11px] text-[var(--oc-muted)]"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {v.vin ? (
                    <div className="truncate font-plex-mono text-[11px] text-[var(--oc-muted3)]">VIN {v.vin}</div>
                  ) : null}

                  <div className="mt-auto flex items-center gap-4 border-t border-[var(--oc-line2)] pt-3 text-xs">
                    <span className="text-[var(--oc-muted)]">
                      <b className="font-semibold tabular-nums text-[var(--oc-ink)]">{v._count.serviceOrders}</b> үйлчилгээ
                    </span>
                    <span className="text-[var(--oc-muted)]">
                      <b className="font-semibold tabular-nums text-[var(--oc-ink)]">{v._count.diagnosticReports}</b> оношилгоо
                    </span>
                    <span className="ml-auto font-semibold text-[var(--oc-accent)]">
                      Түүх харах <span aria-hidden>→</span>
                    </span>
                  </div>
                </Link>
                {v.removable ? (
                  <ConfirmForm
                    action={deleteAccountVehicle}
                    message={`"${v.plate}" машиныг устгах уу?`}
                    className="absolute right-3 top-3"
                  >
                    <input type="hidden" name="id" value={v.id} />
                    <button
                      type="submit"
                      aria-label={`${v.plate} устгах`}
                      title="Устгах"
                      className="rounded-lg p-2 text-[var(--oc-muted3)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </ConfirmForm>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <AddAccountVehicle />
    </div>
  );
}

function CarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 16V11l2-5h10l2 5v5" />
      <path d="M3 16h18v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3z" />
      <circle cx="7" cy="17" r="1.2" />
      <circle cx="17" cy="17" r="1.2" />
    </svg>
  );
}
