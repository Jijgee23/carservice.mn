// Эзэнд зориулсан «Эхлэх алхмууд» — шинэ байгууллагын эхний өдрүүдэд юу хийхийг нүүр дэлгэцэн дээр
// чиглүүлнэ. Бүх алхам дууссан бол харагдахгүй. Бүтээх логик PURE (unit тест), тоолол нь
// loadOnboardingChecklist-д (4 жижиг count, зөвхөн эзэнд нүүр дэлгэцээс дуудна).

import { prisma } from "@/lib/prisma";

export type ChecklistStepKey = "employee" | "service" | "order";

export type ChecklistStep = {
  key: ChecklistStepKey;
  label: string;
  hint: string;
  href: string;
  done: boolean;
};

export type OnboardingCounts = {
  /** Эзнээс бусад идэвхтэй (устгагдаагүй) ажилтан. */
  otherEmployees: number;
  /** Идэвхтэй үйлчилгээ/сэлбэг/бараа. */
  services: number;
  /** Нээсэн засварын хуудас (цуцлагдсан ч оролцоно — «анхны хуудас нээсэн»). */
  orders: number;
};

export type OnboardingChecklist = {
  steps: ChecklistStep[];
  doneCount: number;
  total: number;
  complete: boolean;
};

export function buildOnboardingChecklist(counts: OnboardingCounts): OnboardingChecklist {
  const steps: ChecklistStep[] = [
    {
      key: "service",
      label: "Үйлчилгээ, сэлбэгээ нэмэх",
      hint: "Ажил, сэлбэгийн үнийг бүртгэснээр хуудас хурдан үүснэ.",
      href: "/dashboard/services/new",
      done: counts.services > 0,
    },
    {
      key: "employee",
      label: "Ажилтнаа нэмэх",
      hint: "Засварчин, кассчин зэрэг ажилтнуудад өөр өөр эрх өгнө.",
      href: "/dashboard/employees/new",
      done: counts.otherEmployees > 0,
    },
    {
      key: "order",
      label: "Анхны засварын хуудсаа нээх",
      hint: "Улсын дугаараар машин, үйлчлүүлэгч автоматаар бөглөгдөнө.",
      href: "/dashboard/orders/new",
      done: counts.orders > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length };
}

/** Tenant context тавигдсаны дараа дуудна (requireUser). */
export async function loadOnboardingChecklist(tenantId: string): Promise<OnboardingChecklist> {
  const [otherEmployees, services, firstOrder] = await Promise.all([
    prisma.user.count({ where: { tenantId, isOwner: false, deletedAt: null } }),
    prisma.service.count({ where: { tenantId, isActive: true } }),
    prisma.serviceOrder.findFirst({ where: { tenantId }, select: { id: true } }),
  ]);
  return buildOnboardingChecklist({ otherEmployees, services, orders: firstOrder ? 1 : 0 });
}
