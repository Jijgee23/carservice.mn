import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Btn, BtnLink, Chip } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/auth/roles";
import { formatTugrik } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  SERVICE_KIND_BADGE,
  SERVICE_KIND_LABEL,
  SERVICE_KIND_SLUG,
  STOCK_LABEL,
  type ServiceKind,
  type StockLevel,
  formatStock,
  stockLevel,
} from "@/lib/services";
import { ServiceForm, SERVICE_FORM_ID } from "../service-form";
import { StockAdjustForm } from "../stock-adjust-form";

export const metadata = { title: "Үйлчилгээ засах" };

const STOCK_TONE: Record<StockLevel, "danger" | "warn" | "ok"> = {
  out: "danger",
  low: "warn",
  ok: "ok",
};

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!canEdit(user, "services")) redirect("/dashboard/services");

  const { id } = await params;
  const svc = await prisma.service.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      _count: { select: { items: true } },
      unit: { select: { id: true, name: true } },
      durationUnit: { select: { id: true, name: true } },
    },
  });
  if (!svc) notFound();

  const [categories, units] = await Promise.all([
    prisma.category.findMany({
      // Өөрийн + системийн (сэлбэгийн) ангилал; төрлөөр формд шүүнэ.
      where: { OR: [{ tenantId: user.tenantId }, { tenantId: null }] },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, kind: true, tenantId: true },
    }).then((rows) => rows.map(({ tenantId, ...c }) => ({ ...c, isSystem: tenantId === null }))),
    prisma.unit.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, isActive: true },
    }),
  ]);

  const type = svc.type as ServiceKind;
  const isGoods = type === "GOODS";
  const stockNum = svc.stock ? Number.parseFloat(svc.stock.toString()) : 0;
  const backHref = `/dashboard/services/${SERVICE_KIND_SLUG[type]}`;

  return (
    <div className="p-4 sm:p-6">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href={backHref} className="hover:text-[var(--oc-accent-hi)] transition-colors">
          {SERVICE_KIND_LABEL[type]}
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">{svc.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">{svc.name}</h1>
          <span
            className={`font-plex-mono text-[11px] px-2.5 py-1 rounded-full ${SERVICE_KIND_BADGE[type]}`}
          >
            {SERVICE_KIND_LABEL[type]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href={backHref} variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={SERVICE_FORM_ID}>
            Хадгалах
          </Btn>
        </div>
      </div>
      {svc.code ? (
        <p className="font-plex-mono text-xs text-[var(--oc-muted3)] -mt-4 mb-6">
          Код: {svc.code}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
          <h2 className="font-semibold text-[var(--oc-ink)] mb-4">Мэдээлэл</h2>
          <ServiceForm
            categories={categories}
            units={units}
            initial={{
              id: svc.id,
              type,
              name: svc.name,
              code: svc.code,
              unitId: svc.unitId,
              price: svc.price.toString(),
              costPrice: svc.costPrice?.toString() ?? null,
              stock: svc.stock?.toString() ?? null,
              durationValue: svc.durationValue?.toString() ?? null,
              durationUnitId: svc.durationUnitId,
              reminderIntervalMonths: svc.reminderIntervalMonths,
              description: svc.description,
              isActive: svc.isActive,
              categoryId: svc.categoryId,
            }}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
            <div className="font-plex-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--oc-muted3)]">
              {isGoods ? "Одоогийн үлдэгдэл" : "Үнэ"}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="font-plex-mono text-3xl font-bold text-[var(--oc-accent)]">
                {isGoods
                  ? formatStock(stockNum, svc.unit?.name ?? null)
                  : formatTugrik(svc.price.toString())}
              </div>
            </div>
            {isGoods ? (
              <div className="mt-3">
                <Chip tone={STOCK_TONE[stockLevel(stockNum)]}>
                  {STOCK_LABEL[stockLevel(stockNum)]}
                </Chip>
              </div>
            ) : null}

            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
              {isGoods ? (
                <>
                  <div>
                    <dt className="text-xs text-[var(--oc-muted3)]">Өртөг</dt>
                    <dd className="mt-0.5 font-plex-mono text-[var(--oc-ink2)]">
                      {svc.costPrice
                        ? formatTugrik(svc.costPrice.toString())
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--oc-muted3)]">Борлуулах</dt>
                    <dd className="mt-0.5 font-plex-mono text-[var(--oc-ink2)]">
                      {formatTugrik(svc.price.toString())}
                    </dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="text-xs text-[var(--oc-muted3)]">Нэгж</dt>
                  <dd className="mt-0.5 text-[var(--oc-ink2)]">
                    {svc.unit?.name ?? "—"}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-[var(--oc-muted3)]">Засварын хуудсанд орсон</dt>
                <dd className="mt-0.5 font-plex-mono text-[var(--oc-ink2)]">{svc._count.items} удаа</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--oc-muted3)]">Бүртгэсэн</dt>
                <dd className="mt-0.5 font-plex-mono text-[var(--oc-ink2)]">
                  {svc.createdAt.toLocaleDateString("mn-MN")}
                </dd>
              </div>
            </dl>
          </div>

          {isGoods ? (
            <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
              <h2 className="font-semibold text-[var(--oc-ink)] mb-1">Орлого / Зарлага</h2>
              <p className="text-xs text-[var(--oc-muted3)] mb-4">
                Гараар тохируулах. Засварын хуудсанд ашиглавал автоматаар хасагдана.
              </p>
              <StockAdjustForm
                serviceId={svc.id}
                unit={svc.unit?.name ?? ""}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
