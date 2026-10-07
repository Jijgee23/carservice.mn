import Link from "next/link";
import { redirect } from "next/navigation";
import { vehicleOwnerIsOrganization } from "@/lib/vehicles/owner-kind";
import { Btn, BtnLink } from "@/app/_components/landing-ops-ui";
import { requireUser } from "@/lib/auth";
import { canAssignOrders } from "@/lib/auth/order-access";
import {
  orderAssignableWhere,
  canCreate,
  workingBranchScopeId,
} from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { safeNext } from "@/lib/safe-redirect";
import { ORDER_FORM_ID, OrderForm } from "../order-form";

export const metadata = {
  title: "Шинэ засварын хуудас",
};

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    branchId?: string;
    customerId?: string;
    vehicleId?: string;
    scheduledAt?: string;
    note?: string;
    appointmentId?: string;
    next?: string;
  }>;
}) {
  const user = await requireUser();
  if (!canCreate(user, "orders")) redirect("/dashboard/orders");
  const scopeBranchId = workingBranchScopeId(user);

  const sp = await searchParams;
  // Ирээгүй бол одоогийн адил "Захиалга" жагсаалт руу буцна — жишээ нь
  // хуваарийн (calendar) хуудаснаас ирсэн бол тэр хуудас руу яг тэр
  // байдлаараа (interval/anchor/branchId зэрэг query хэвээр) буцна.
  const backTarget = safeNext(sp.next, "/dashboard/orders");
  // Appointment-аас ирсэн бол tenant scope доторх account/customer-г дахин
  // уншина. Ингэснээр баталгаажсаны дараа customer өөрийн машин нэмсэн
  // тохиолдолд тэр AccountVehicle-уудыг order form-д зөвхөн энэ appointment-д
  // зориулж харуулна.
  const appointment = sp.appointmentId
    ? await prisma.appointment.findFirst({
        where: { id: sp.appointmentId, tenantId: user.tenantId },
        select: {
          accountId: true,
          customerId: true,
          vehicleId: true,
          serviceOrderId: true,
          // QA #28: цагийн хариуцах мастерыг засварын хуудсанд урьдчилан бөглөнө.
          assignedToId: true,
          estimatedDurationMinutes: true,
          categoryId: true,
          category: { select: { name: true } },
          categories: {
            orderBy: { createdAt: "asc" },
            select: {
              categoryId: true,
              category: { select: { name: true } },
            },
          },
        },
      })
    : null;
  const bookingCategories = appointment?.categories.length
    ? appointment.categories.map((entry) => ({
        id: entry.categoryId,
        name: entry.category.name,
      }))
    : appointment?.categoryId && appointment.category
      ? [{ id: appointment.categoryId, name: appointment.category.name }]
      : [];
  const prefillCustomerId = sp.customerId || appointment?.customerId || "";
  const prefillVehicleId = sp.vehicleId || appointment?.vehicleId || "";
  // Цаг захиалгаас ирсэн prefill (customer/branch/цаг), эсвэл ажиллах
  // салбар тодорхой бол (scopeBranchId) — түүнийг Салбар талбарт автоматаар
  // бөглөнө ("Бүх салбар" сонгосон owner-д prefill хийхгүй, гараар сонгоно).
  const prefillScheduled = sp.scheduledAt ? new Date(sp.scheduledAt) : null;
  const initial =
    prefillCustomerId || sp.branchId || sp.scheduledAt || sp.note || scopeBranchId
      ? {
          branchId: sp.branchId ?? scopeBranchId ?? "",
          customerId: prefillCustomerId,
          vehicleId: prefillVehicleId,
          assignedToId: appointment?.assignedToId ?? null,
          scheduledAt:
            prefillScheduled && Number.isFinite(prefillScheduled.getTime())
              ? prefillScheduled
              : null,
          notes: sp.note ?? null,
        }
      : undefined;

  const [branches, customers, tenantVehicles, technicians, accountVehicles] = await Promise.all([
    prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        ...(scopeBranchId ? { id: scopeBranchId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slotMinutes: true },
    }),
    prisma.customer.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, phone: true, isOrganization: true, orgName: true, orgRegnum: true },
    }),
    prisma.tenantVehicle
      .findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: { createdAt: "desc" },
        select: {
          customerId: true,
          isPostpaid: true,
          customer: { select: { isOrganization: true } },
          vehicle: {
            select: { id: true, plate: true, vin: true, make: true, model: true, ownerRegnum: true },
          },
        },
      })
      .then((rows) =>
        rows.map(({ vehicle: { ownerRegnum, ...vehicle }, customer, ...r }) => ({
          ...vehicle,
          customerId: r.customerId,
          isPostpaid: r.isPostpaid,
          ownerIsOrganization: vehicleOwnerIsOrganization(customer, ownerRegnum),
        })),
      ),
    prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        ...orderAssignableWhere(),
      },
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        branchId: true,
        assignableBranchIds: true,
        isOwner: true,
        role: { select: { name: true } },
      },
    }),
    appointment?.accountId && appointment.customerId === prefillCustomerId && !appointment.serviceOrderId
      ? prisma.accountVehicle.findMany({
          where: { accountId: appointment.accountId },
          orderBy: { createdAt: "desc" },
          select: {
            vehicleId: true,
            vehicle: {
              select: { id: true, plate: true, vin: true, make: true, model: true, ownerRegnum: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // A global AccountVehicle becomes available to the tenant only when a staff
  // member selects it for this appointment/order. Keep already-linked tenant
  // vehicles authoritative and append only the missing account vehicles.
  const linkedVehicleIds = new Set(tenantVehicles.map((v) => v.id));
  const vehicles = [
    ...tenantVehicles,
    ...accountVehicles
      .filter((v) => !linkedVehicleIds.has(v.vehicleId))
      .map(({ vehicle: { ownerRegnum, ...vehicle } }) => ({
        ...vehicle,
        ownerIsOrganization: vehicleOwnerIsOrganization(null, ownerRegnum),
        customerId: prefillCustomerId,
        isPostpaid: false,
        isAccountVehicle: true,
      })),
  ];

  if (branches.length === 0) {
    return (
      <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
        <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
          <Link href="/dashboard/orders" className="hover:text-[var(--oc-accent-hi)] transition-colors">
            Засварын хуудас
          </Link>
          <span>/</span>
          <span className="text-[var(--oc-muted)]">Шинэ засварын хуудас</span>
        </nav>
        <h1 className="text-2xl font-semibold text-[var(--oc-ink)] mb-6">Шинэ засварын хуудас</h1>
        <div className="rounded-[10px] border border-[var(--oc-accent)]/30 bg-[var(--oc-panel)] p-5 text-sm text-[var(--oc-ink2)]">
          Засварын хуудас үүсгэхийн тулд эхлээд{" "}
          <Link
            href="/dashboard/branches/new"
            className="text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] underline"
          >
            салбараа бүртгэнэ үү
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-full flex-1 flex flex-col min-h-0 w-full">
      <nav className="flex items-center gap-1.5 text-[13px] text-[var(--oc-muted3)] mb-3">
        <Link href="/dashboard/orders" className="hover:text-[var(--oc-accent-hi)] transition-colors">
          Засварын хуудас
        </Link>
        <span>/</span>
        <span className="text-[var(--oc-muted)]">Шинэ засварын хуудас</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--oc-ink)]">Шинэ засварын хуудас</h1>
          <p className="text-sm text-[var(--oc-muted3)] mt-1">
            Засварын хуудасны үндсэн мэдээллийг оруулна уу. Ажил, сэлбэгийн мөрийг дараа нь нэмнэ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BtnLink href={backTarget} variant="ghost">
            ← Буцах
          </BtnLink>
          <Btn type="submit" form={ORDER_FORM_ID}>
            Засварын хуудас үүсгэх
          </Btn>
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--oc-line)] bg-[var(--oc-panel)] p-4 sm:p-5">
        <OrderForm
          initial={
            initial && {
              ...initial,
              // QA #28: цагийн мастерыг зөвхөн сонгогдох боломжтой (идэвхтэй,
              // тохирох) бөгөөд энэ хэрэглэгч оноож чадах үед л урьдчилан бөглөнө.
              assignedToId:
                initial.assignedToId &&
                technicians.some((t) => t.id === initial.assignedToId) &&
                (canAssignOrders(user) || initial.assignedToId === user.id)
                  ? initial.assignedToId
                  : null,
            }
          }
          appointmentId={sp.appointmentId}
          branches={branches}
          customers={customers}
          vehicles={vehicles}
          technicians={technicians}
          bookingCategories={bookingCategories}
          bookingDurationMinutes={appointment?.estimatedDurationMinutes ?? null}
          backHref={backTarget}
          next={sp.next ? backTarget : undefined}
          // Оноох эрхгүй ажилтан зөвхөн өөрийгөө оноож болно (createOrderAction).
          assigneeHint={
            appointment?.assignedToId &&
            !technicians.some((t) => t.id === appointment.assignedToId)
              ? "Цаг захиалгын мастер идэвхгүй болсон тул өөр мастер сонгоно уу."
              : undefined
          }
          defaultAssignedToId={canAssignOrders(user) ? undefined : user.id}
        />
      </div>
    </div>
  );
}
