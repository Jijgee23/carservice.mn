"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canCreate } from "@/lib/auth/roles";
import { assertActiveSubscription } from "@/lib/subscription-server";
import { CustomerCommandError, createCustomerCommand } from "@/lib/customers/customer-commands";
import { createCustomerFromPlate } from "@/lib/customers/customer-from-plate";
import { VehicleCommandError, createVehicleCommand } from "@/lib/vehicles/vehicle-commands";

// Захиалга үүсгэх явцад үйлчлүүлэгч / машин шинээр бүртгэх — хуудас сольж redirect
// хийхгүй, шинээр үүсгэсэн бичлэгийг буцаана.

async function authorize(resource: "customers" | "vehicles") {
  const user = await requireUser();
  if (!canCreate(user, resource)) {
    throw new Error(
      resource === "customers"
        ? "Танд үйлчлүүлэгч үүсгэх эрх байхгүй."
        : "Танд машин үүсгэх эрх байхгүй.",
    );
  }
  await assertActiveSubscription(user.tenantId);
  return user;
}

// ---------- Customer ------------------------------------------------------

export type QuickCustomerResult = {
  ok: boolean;
  customer?: { id: string; fullName: string; phone: string; isOrganization?: boolean; orgName?: string | null; orgRegnum?: string | null };
  fieldErrors?: Record<string, string>;
  message?: string;
};

export async function quickCreateCustomerAction(input: {
  fullName: string;
  phone: string;
  email?: string | null;
  note?: string | null;
  isOrganization?: boolean;
  orgRegnum?: string | null;
  orgName?: string | null;
  orgEmail?: string | null;
}): Promise<QuickCustomerResult> {
  let user;
  try {
    user = await authorize("customers");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  // P3-B1: validate/normalise болон Account-claim нь
  // `lib/customers/customer-commands.ts`-д нэгдсэн. Энэ функц зөвхөн эрх
  // шалгаад, командыг дуудаж, слим үр дүн буцаадаг нимгэн адаптер.
  // MAX_CUSTOMERS-ийг команд өөрөө үргэлж шалгана (D-154).
  let result;
  try {
    result = await createCustomerCommand({
      actor: user,
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        note: input.note,
        isOrganization: input.isOrganization === true,
        orgRegnum: input.orgRegnum ?? null,
        orgName: input.orgName ?? null,
        orgEmail: input.orgEmail ?? null,
      },
      // Түүх: энэ зам урьд нь MAX_CUSTOMERS шалгадаггүй байсан. D-154
      // (2026-09-22) шийдвэрээр хязгаар одоо бүх зам дээр үйлчилнэ — команд
      // өөрөө шалгадаг тул хязгаарт хүрсэн tenant энэ modal-аас блоклогдоно.
      // Энэ бол зориудын зан төлөв; bypass сэргээж болохгүй.
      auditSummarySuffix: "(засварын хуудаснаас түргэн)",
    });
  } catch (e) {
    if (e instanceof CustomerCommandError) {
      if (e.fieldErrors) return { ok: false, fieldErrors: e.fieldErrors };
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа.",
    };
  }

  revalidatePath("/dashboard/customers");
  return {
    ok: true,
    customer: {
      id: result.customer.id,
      fullName: result.customer.fullName,
      phone: result.customer.phone,
      isOrganization: result.customer.isOrganization,
      orgName: result.customer.orgName,
      orgRegnum: result.customer.orgRegnum,
    },
  };
}

/**
 * Дугаараар эзэмшигчийг СЕРВЕР талд дахин шийдээд (tenant холбоос → HUR)
 * бодит утсаар нь үйлчлүүлэгч үүсгэнэ. Бүтэн утас browser-д огт очдоггүй (QA #17).
 */
export async function quickCreateCustomerFromPlateAction(input: {
  plate: string;
}): Promise<QuickCustomerResult> {
  let user;
  try {
    user = await authorize("customers");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }
  try {
    const result = await createCustomerFromPlate({
      actor: user,
      plate: input.plate,
      auditSummarySuffix: "(засварын хуудаснаас түргэн)",
    });
    revalidatePath("/dashboard/customers");
    return {
      ok: true,
      customer: {
        id: result.customer.id,
        fullName: result.customer.fullName,
        phone: result.customer.phone,
      },
    };
  } catch (e) {
    if (e instanceof CustomerCommandError) {
      if (e.fieldErrors) return { ok: false, fieldErrors: e.fieldErrors };
      return { ok: false, message: e.message };
    }
    return { ok: false, message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа." };
  }
}

// ---------- Vehicle -------------------------------------------------------

export type QuickVehicleResult = {
  ok: boolean;
  vehicle?: {
    id: string;
    plate: string;
    make: string;
    model: string;
    customerId: string | null;
    isPostpaid: boolean;
  };
  fieldErrors?: Record<string, string>;
  message?: string;
};

export async function quickCreateVehicleAction(input: {
  plate: string;
  vin: string | null;
  make: string;
  model: string;
  year: number | null;
  fuelType: string | null;
  wheelPosition: string | null;
  customerId: string;
  /** HUR/global lookup-аас бөглөсөн — регистрийг сервер талд шийднэ. */
  fromLookup?: boolean;
}): Promise<QuickVehicleResult> {
  let user;
  try {
    user = await authorize("vehicles");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Алдаа" };
  }

  // P3-B2: validate/claim логик нь `lib/vehicles/vehicle-commands.ts`-д
  // нэгдсэн. Энэ функц зөвхөн эрх шалгаад, командыг дуудаж, слим үр дүн
  // буцаадаг нимгэн адаптер.
  //  - `customerId` заавал: quick-create-ийн ганцхан онцлог дүрэм
  //    (Divergence 1) — `requireCustomerId: true` тугаар дамжина.
  //  - MAX_VEHICLES одоо энд ч шалгагдана: D-154 (2026-09-22) D-151-ийг
  //    орлуулж, хязгаарыг бүх зам дээр үйлчлүүлсэн. Давхардал татгалзах
  //    (`rejectDuplicate`) нь харин хэвээр унтраалттай — энэ нь тусдаа
  //    divergence, хязгаартай хамаагүй.
  //  - `mileage` талбар энд байхгүй: хуучин quick-create-д ч байгаагүй.
  let record;
  try {
    record = await createVehicleCommand({
      actor: user,
      data: {
        plate: input.plate ?? "",
        vin: input.vin,
        make: input.make ?? "",
        model: input.model ?? "",
        year: input.year,
        fuelType: input.fuelType,
        wheelPosition: input.wheelPosition,
        customerId: input.customerId,
      },
      rejectDuplicate: false,
      requireCustomerId: true,
      resolveOwnerRegnum: input.fromLookup === true,
      auditSummarySuffix: "(засварын хуудаснаас түргэн)",
    });
  } catch (e) {
    if (e instanceof VehicleCommandError) {
      if (e.fieldErrors) return { ok: false, fieldErrors: e.fieldErrors };
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Үүсгэх явцад алдаа гарлаа.",
    };
  }

  revalidatePath("/dashboard/vehicles");
  if (record.customerId) {
    revalidatePath(`/dashboard/customers/${record.customerId}`);
  }
  return {
    ok: true,
    vehicle: {
      id: record.id,
      plate: record.plate,
      make: record.make,
      model: record.model,
      customerId: record.customerId,
      isPostpaid: record.isPostpaid,
    },
  };
}
