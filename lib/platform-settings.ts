import { prisma } from "@/lib/prisma";
import { getTenantContext, setBypassContext } from "@/lib/tenant-context";
import type { AppStoreLinks } from "@/lib/app-store-links";
import { CONTACT } from "@/lib/contact";

export type PlatformSettings = {
  facebookUrl: string | null;
  youtubeUrl: string | null;
  // Super admin-ийн хадгалсан утаснууд (хоосон бол []) — харуулахдаа
  // contactPhonesOrDefault()-ээр CONTACT.phones руу буцна.
  contactPhones: string[];
  // Цаг захиалгын хураамж — false бол үнэгүй (invoice үүсэхгүй).
  appointmentFeeEnabled: boolean;
  appointmentFeeAmount: number;
  // Мобайл аппуудын store холбоос (хоосон бол харагдахгүй).
  appLinks: AppStoreLinks;
};

const SETTING_ID = "default";
const DEFAULT_APPOINTMENT_FEE_AMOUNT = 1000;

/**
 * Global тохиргоог уншина (нэг мөр). Мөр байхгүй бол текст талбарууд null,
 * хураамж анхны утгуудаараа (идэвхтэй, 1000₮).
 * Дуудагдах хоёр контекст (public Footer, эсвэл system superadmin) аль аль нь
 * bypass-той тохирдог тул энд bypass тавихад аюулгүй (superadmin талд аль
 * хэдийн bypass идэвхтэй тул давхар дуудалт зүгээр).
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  setBypassContext();
  return readPlatformSettings();
}

/** Context-ыг өөрчлөхгүйгээр уншина (PlatformSetting RLS-гүй глобал мөр). */
async function readPlatformSettings(): Promise<PlatformSettings> {
  const row = await prisma.platformSetting.findUnique({
    where: { id: SETTING_ID },
    select: {
      facebookUrl: true,
      youtubeUrl: true,
      contactPhones: true,
      appointmentFeeEnabled: true,
      appointmentFeeAmount: true,
      customerAppStoreUrl: true,
      customerPlayStoreUrl: true,
      businessAppStoreUrl: true,
      businessPlayStoreUrl: true,
    },
  });
  return {
    facebookUrl: row?.facebookUrl ?? null,
    youtubeUrl: row?.youtubeUrl ?? null,
    contactPhones: row?.contactPhones ?? [],
    appointmentFeeEnabled: row?.appointmentFeeEnabled ?? true,
    appointmentFeeAmount: row
      ? Number.parseFloat(row.appointmentFeeAmount.toString())
      : DEFAULT_APPOINTMENT_FEE_AMOUNT,
    appLinks: {
      customer: { appStore: row?.customerAppStoreUrl ?? null, playStore: row?.customerPlayStoreUrl ?? null },
      business: { appStore: row?.businessAppStoreUrl ?? null, playStore: row?.businessPlayStoreUrl ?? null },
    },
  };
}

/**
 * Зөвхөн store холбоосууд (layout/sidebar-д). Tenant context (RLS) тавигдсан
 * ажилтны layout-оос дуудахад bypass руу ШИЛЖҮҮЛЭХГҮЙ — context байхгүй үед л
 * (нийтийн хуудас) bypass тавина.
 */
export async function getAppStoreLinks(): Promise<AppStoreLinks> {
  if (!getTenantContext()) setBypassContext();
  return (await readPlatformSettings()).appLinks;
}

/** Харуулах утаснууд: super admin тохируулсан бол тэр, үгүй бол CONTACT.phones. */
export function contactPhonesOrDefault(phones: readonly string[] | null | undefined): string[] {
  return phones && phones.length > 0 ? [...phones] : [...CONTACT.phones];
}

/** Нийтийн хуудсуудад (context-ыг өөрчлөхгүй — getAppStoreLinks-тэй адил). */
export async function getContactPhones(): Promise<string[]> {
  if (!getTenantContext()) setBypassContext();
  return contactPhonesOrDefault((await readPlatformSettings()).contactPhones);
}
