// P3-B1 — нэг канон Customer create/update/delete команд. Гурван хуулбар
// (`app/_actions/customers.ts`, `app/_actions/quick-create.ts`,
// `app/api/v1/customers/route.ts` POST) урьд нь тус бүрдээ validate/normalise
// болон Account-claim логикийг давхар бичдэг байсан бөгөөд аль хэдийн
// зөрсөн байсан. `lib/orders/order-commands.ts`-ийн загварыг дуурайна: typed
// input/output — FormData, NextResponse, redirect, revalidatePath байхгүй.
// Эрх (permission) шалгалт болон subscription gate дуудагч талд үлдэнэ
// (order-commands-ийн адил зарчим).

import { isForeignKeyViolation } from "@/lib/prisma-errors";
import { Prisma } from "@/app/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { orgRegnumError } from "@/lib/customers/org-regnum";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { PLAN_LIMIT_CODES } from "@/lib/plan-limits";
import { enforceCountLimit } from "@/lib/plan-limits-server";
import { prisma } from "@/lib/prisma";

export type CustomerCommandActor = {
  id: string;
  tenantId: string;
};

export class CustomerCommandError extends Error {
  constructor(
    message: string,
    public readonly status = 422,
    public readonly code = "CUSTOMER_COMMAND_REJECTED",
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "CustomerCommandError";
  }
}

export type CustomerCommandInput = {
  fullName?: string | null;
  phone: string;
  email?: string | null;
  note?: string | null;
  /** Phase 4a: Байгууллага. Унтраалттай бол org* талбарууд null хадгалагдана. */
  isOrganization?: boolean;
  orgRegnum?: string | null;
  orgName?: string | null;
  orgEmail?: string | null;
};

export type NormalizedCustomerData = {
  fullName: string;
  phone: string;
  email: string | null;
  note: string | null;
  isOrganization: boolean;
  orgRegnum: string | null;
  orgName: string | null;
  orgEmail: string | null;
};

export type CustomerRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  note: string | null;
  isOrganization: boolean;
  orgRegnum: string | null;
  orgName: string | null;
  orgEmail: string | null;
  createdAt: Date;
};

/** Аль хэдийн Account-той (`tenantId_accountId`) Customer байсныг олж ашигласан. */
export type CreateCustomerOutcome = "created" | "claimed" | "existing";

export type CreateCustomerCommandResult = {
  customer: CustomerRecord;
  outcome: CreateCustomerOutcome;
};

export const CUSTOMER_NAME_MAX = 100;
export const ORG_NAME_MAX = 200;

const PHONE_CONFLICT_MESSAGE =
  "Энэ утасны дугаартай үйлчлүүлэгч аль хэдийн бүртгэлтэй байна.";

function isEmailFormat(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Гурван оролтын нийтлэг validate/normalise дүрэм: зөвхөн утас заавал (овог
 * нэр заавал биш), утас Account ↔ Customer гүүрний канон 8 оронтой хэлбэрт
 * хадгалагдана, имэйл заавал биш ч бөглөвөл формат шалгагдана.
 */
export function validateCustomerInput(
  input: CustomerCommandInput,
  options: {
    /** Засахад: хадгалагдсан нэр. Өөрчлөгдөөгүй бол урт хязгаарыг шалгахгүй. */
    existingFullName?: string | null;
  } = {},
): {
  data: NormalizedCustomerData;
  fieldErrors: Record<string, string>;
} {
  const fullName = (input.fullName ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const email = (input.email ?? "").trim();
  const note = (input.note ?? "").trim();
  const fieldErrors: Record<string, string> = {};

  if (!phone) fieldErrors.phone = "Утасны дугаар оруулна уу.";
  else if (!isValidPhone(phone)) fieldErrors.phone = "Утасны дугаар 8 оронтой тоо байх ёстой.";
  if (email && !isEmailFormat(email)) fieldErrors.email = "Имэйл хаяг буруу.";
  const nameUnchanged =
    options.existingFullName !== undefined &&
    (options.existingFullName ?? "").trim() === fullName;
  if (fullName.length > CUSTOMER_NAME_MAX && !nameUnchanged) {
    fieldErrors.fullName = `Нэр ${CUSTOMER_NAME_MAX} тэмдэгтээс хэтрэхгүй.`;
  }

  const isOrganization = input.isOrganization === true;
  let orgRegnum: string | null = null;
  let orgName: string | null = null;
  let orgEmail: string | null = null;
  if (isOrganization) {
    orgRegnum = (input.orgRegnum ?? "").trim();
    orgName = (input.orgName ?? "").trim();
    orgEmail = (input.orgEmail ?? "").trim();
    const regErr = orgRegnumError(orgRegnum);
    if (regErr) fieldErrors.orgRegnum = regErr;
    if (!orgName) fieldErrors.orgName = "Байгууллагын нэр оруулна уу.";
    else if (orgName.length > ORG_NAME_MAX) {
      fieldErrors.orgName = `Байгууллагын нэр ${ORG_NAME_MAX} тэмдэгтээс хэтрэхгүй.`;
    }
    if (orgEmail && !isEmailFormat(orgEmail)) fieldErrors.orgEmail = "Имэйл хаяг буруу.";
    orgRegnum = orgRegnum || null;
    orgName = orgName || null;
    orgEmail = orgEmail || null;
  }

  return {
    data: {
      fullName,
      phone: normalizePhone(phone) ?? phone,
      email: email || null,
      note: note || null,
      isOrganization,
      orgRegnum,
      orgName,
      orgEmail,
    },
    fieldErrors,
  };
}

/** JSON body-оос байгууллагын талбаруудыг (төрөл шалгаад) гаргана — API route-уудад. */
export function orgInputFromBody(
  body: Record<string, unknown>,
): Pick<CustomerCommandInput, "isOrganization" | "orgRegnum" | "orgName" | "orgEmail"> {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    isOrganization: body.isOrganization === true,
    orgRegnum: str(body.orgRegnum),
    orgName: str(body.orgName),
    orgEmail: str(body.orgEmail),
  };
}

const CUSTOMER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  note: true,
  isOrganization: true,
  orgRegnum: true,
  orgName: true,
  orgEmail: true,
  createdAt: true,
} as const;

/**
 * Канон create команд — validate → MAX_CUSTOMERS quota → Account-claim
 * (Account утсаар олдвол: аль хэдийн энэ tenant-д тухайн Account-тай Customer
 * байвал түүнийг ашиглана ("existing"); эс бөгөөс "эзэнгүй" (accountId=null)
 * ижил утастай Customer байвал "нэхэмжилнэ" ("claimed"); байхгүй бол шинээр
 * үүсгэнэ ("created") Account-той нь холбож). `tenant+phone` хэсэгчилсэн
 * unique index зөвхөн `accountId IS NULL` мөрүүдийн дунд хэрэгждэг тул
 * "claimed"/"created" замууд P2002 өгч болзошгүй бөгөөд энд барьж fieldErrors
 * болгоно.
 */
export async function createCustomerCommand(input: {
  actor: CustomerCommandActor;
  data: CustomerCommandInput;
  /**
  /** Audit summary-д нэмэх тэмдэглэгээ (quick-create-ыг ялгахад). */
  auditSummarySuffix?: string;
}): Promise<CreateCustomerCommandResult> {
  const { actor } = input;
  const { data, fieldErrors } = validateCustomerInput(input.data);
  if (Object.keys(fieldErrors).length > 0) {
    throw new CustomerCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }

  // `MAX_CUSTOMERS` — БҮХ entry point дээр шалгана (D-154, 2026-09-22
  // хэрэглэгчийн шийдвэр; D-151-ийг орлоно). Урьд нь зөвхөн dashboard-ын
  // бүрэн create action шалгадаг байсан бөгөөд quick-create болон API route
  // хязгаарыг тойрч гардаг байв. Тухайн алгасалтыг зориудаар хаасан тул
  // энд түг байхгүй: команд дуудагдсан бол хязгаар үргэлж шалгагдана.
  const limit = await enforceCountLimit(
    actor.tenantId,
    PLAN_LIMIT_CODES.MAX_CUSTOMERS,
    () => prisma.customer.count({ where: { tenantId: actor.tenantId } }),
  );
  if (!limit.allowed) {
    throw new CustomerCommandError(
      limit.message ?? "Үйлчлүүлэгчийн хязгаарт хүрсэн байна.",
      422,
      "PLAN_LIMIT_REACHED",
    );
  }

  const account = await prisma.account.findUnique({
    where: { phone: data.phone },
    select: { id: true },
  });

  if (account) {
    const existingForAccount = await prisma.customer.findUnique({
      where: { tenantId_accountId: { tenantId: actor.tenantId, accountId: account.id } },
      select: CUSTOMER_SELECT,
    });
    if (existingForAccount) {
      return { customer: existingForAccount, outcome: "existing" };
    }
  }

  let created: CustomerRecord;
  let outcome: CreateCustomerOutcome = "created";
  try {
    const unclaimed = account
      ? await prisma.customer.findFirst({
          where: { tenantId: actor.tenantId, phone: data.phone, accountId: null },
          select: { id: true },
        })
      : null;

    if (unclaimed) {
      outcome = "claimed";
      created = await prisma.customer.update({
        where: { id: unclaimed.id },
        data: {
          fullName: data.fullName || undefined,
          email: data.email,
          note: data.note,
          isOrganization: data.isOrganization,
          orgRegnum: data.orgRegnum,
          orgName: data.orgName,
          orgEmail: data.orgEmail,
          accountId: account!.id,
        },
        select: CUSTOMER_SELECT,
      });
    } else {
      created = await prisma.customer.create({
        data: {
          fullName: data.fullName,
          phone: data.phone,
          email: data.email,
          note: data.note,
          isOrganization: data.isOrganization,
          orgRegnum: data.orgRegnum,
          orgName: data.orgName,
          orgEmail: data.orgEmail,
          tenantId: actor.tenantId,
          accountId: account?.id ?? null,
        },
        select: CUSTOMER_SELECT,
      });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new CustomerCommandError(PHONE_CONFLICT_MESSAGE, 409, "PHONE_CONFLICT", {
        phone: PHONE_CONFLICT_MESSAGE,
      });
    }
    throw e;
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Customer",
    entityId: created.id,
    action: "CREATE",
    summary: input.auditSummarySuffix
      ? `${created.fullName || created.phone} ${input.auditSummarySuffix}`
      : created.fullName || created.phone,
    after: {
      fullName: created.fullName,
      phone: created.phone,
      email: created.email,
      note: created.note,
      isOrganization: created.isOrganization,
      orgRegnum: created.orgRegnum,
      orgName: created.orgName,
      orgEmail: created.orgEmail,
    },
  });

  return { customer: created, outcome };
}

export async function updateCustomerCommand(input: {
  actor: CustomerCommandActor;
  customerId: string;
  data: CustomerCommandInput;
}): Promise<NormalizedCustomerData & { id: string }> {
  const { actor, customerId } = input;
  // Нэрний урт хязгаарыг зөвхөн нэр өөрчлөгдсөн үед шалгана.
  const stored = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: actor.tenantId },
    select: { fullName: true },
  });
  const { data, fieldErrors } = validateCustomerInput(input.data, {
    existingFullName: stored?.fullName,
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new CustomerCommandError("Хүсэлт буруу.", 422, "VALIDATION_FAILED", fieldErrors);
  }

  try {
    const updated = await prisma.customer.updateMany({
      where: { id: customerId, tenantId: actor.tenantId },
      data,
    });
    if (updated.count === 0) {
      throw new CustomerCommandError("Үйлчлүүлэгч олдсонгүй.", 404, "CUSTOMER_NOT_FOUND");
    }
  } catch (e) {
    if (e instanceof CustomerCommandError) throw e;
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new CustomerCommandError(PHONE_CONFLICT_MESSAGE, 409, "PHONE_CONFLICT", {
        phone: PHONE_CONFLICT_MESSAGE,
      });
    }
    throw e;
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Customer",
    entityId: customerId,
    action: "UPDATE",
    summary: data.fullName || data.phone,
    after: data,
  });

  return { id: customerId, ...data };
}

export async function deleteCustomerCommand(input: {
  actor: CustomerCommandActor;
  customerId: string;
}): Promise<{ id: string; fullName: string | null }> {
  const { actor, customerId } = input;

  const target = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: actor.tenantId },
    select: { fullName: true },
  });
  if (!target) {
    throw new CustomerCommandError("Үйлчлүүлэгч олдсонгүй.", 404, "CUSTOMER_NOT_FOUND");
  }

  try {
    await prisma.customer.delete({
      where: { id: customerId, tenantId: actor.tenantId },
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      throw new CustomerCommandError(
        "Энэ үйлчлүүлэгчтэй холбоотой засварын хуудас байгаа тул устгах боломжгүй.",
        409,
        "CUSTOMER_IN_USE",
      );
    }
    throw e;
  }

  await logAudit({
    tenantId: actor.tenantId,
    userId: actor.id,
    entity: "Customer",
    entityId: customerId,
    action: "DELETE",
    summary: target.fullName,
  });

  return { id: customerId, fullName: target.fullName };
}
