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

  return (
    <div className="w-full flex flex-col gap-3.5">
      <h1 className="font-semibold text-[var(--oc-ink2)] text-sm">
        Миний машинууд
        {vehicles.length > 0 ? (
          <span className="text-[var(--oc-muted3)] font-normal"> · {vehicles.length}</span>
        ) : null}
      </h1>

      <div className="flex flex-col gap-2">
        {vehicles.length === 0 ? (
          <p className="text-sm text-[var(--oc-muted3)]">
            Машин бүртгээгүй байна. Цаг захиалахад хэрэг болно.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {vehicles.map((v) => (
              <div
                key={v.id}
                className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-2.5 flex items-start gap-2.5"
              >
                <div className="w-9 h-9 rounded-lg bg-[var(--oc-panel2)] border border-[var(--oc-line2)] flex items-center justify-center text-[var(--oc-accent)] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 16V11l2-5h10l2 5v5" />
                    <path d="M3 16h18v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3z" />
                    <circle cx="7" cy="17" r="1.2" />
                    <circle cx="17" cy="17" r="1.2" />
                  </svg>
                </div>
                <Link
                  href={`/account/vehicles/${v.vehicleId}`}
                  className="min-w-0 flex-1 group"
                  title="Машины дэлгэрэнгүй ба үйлчилгээний түүх"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--oc-ink)] group-hover:text-[var(--oc-accent)] transition-colors tabular-nums">
                        {v.plate}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs font-normal text-[var(--oc-muted3)]">
                        <span className="truncate">
                          {v.make} {v.model}
                          {v.year ? ` · ${v.year}` : ""}
                        </span>
                        {!v.removable ? (
                          <span className="shrink-0">
                            <TagChip>Сервисээс</TagChip>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 whitespace-nowrap text-[11px] font-normal text-[var(--oc-muted3)] justify-self-end">
                      <span>{v._count.serviceOrders} үйлчилгээ</span>
                      <span aria-hidden="true">·</span>
                      <span>{v._count.diagnosticReports} оношилгоо</span>
                    </div>
                    <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-normal text-[var(--oc-muted3)]">
                      {v.colorName ? <span className="truncate">Өнгө: {v.colorName}</span> : null}
                      {v.fuelType ? <span className="truncate">{v.fuelType}</span> : null}
                      {v.capacity ? <span className="truncate">{v.capacity.toLocaleString("mn-MN")} см³</span> : null}
                      {v.wheelPosition ? <span className="truncate">Хүрд: {v.wheelPosition}</span> : null}
                      {v.purpose ? <span className="truncate">{v.purpose}</span> : null}
                    </div>
                    <div className="self-end whitespace-nowrap text-right text-[11px] font-normal text-[var(--oc-accent)]">
                      Дэлгэрэнгүй харах →
                    </div>
                  </div>
                </Link>
                {v.removable ? (
                  <ConfirmForm
                    action={deleteAccountVehicle}
                    message={`"${v.plate}" машиныг устгах уу?`}
                    className="shrink-0"
                  >
                    <input type="hidden" name="id" value={v.id} />
                    <button
                      type="submit"
                      aria-label="Устгах"
                      className="text-red-400 light:text-red-600 hover:text-red-300 hover:bg-red-500/10 p-2 rounded-lg transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </ConfirmForm>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <AddAccountVehicle />
      </div>
    </div>
  );
}
