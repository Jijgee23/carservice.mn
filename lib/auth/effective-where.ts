// Prisma-д «энэ ажилтан тухайн эрхийг ҮР ДҮНТЭЙ эзэмшиж байна» гэсэн нөхцөл. SQL түвшний шүүлт
// (хариуцагчийн жагсаалт, мэдэгдлийн хүлээн авагч) нь `role.permissions has code`-оор шууд
// шүүдэг байсан — байгууллагын override болон ажилтны хязгаарлалтыг тооцохгүй. Энд ижил томьёог
// (lib/auth/effective-permissions.ts) relation filter-ээр илэрхийлнэ:
//
//   идэвхтэй роль ∧ ¬(ажилтны хязгаарлалт has code) ∧ (
//     (роль has code ∧ ¬(code өөрчилж болох ∧ тенантын override remove has code))
//     ∨ (код өөрчилж болох ∧ тенантын override add has code) )
//
// ЗӨВХӨН эзэн биш (role-оор эрхтэй) ажилтанд — эзэнг дуудагч `{ isOwner: true }`-аар тусад нь авна.
// `tenantId` ЗААВАЛ: TenantRoleOverride нь RLS-тэй ч bypass context-д (cron/мэдэгдэл) бүх
// байгууллагын мөр харагддаг тул override-ийг тухайн байгууллагаар тодорхой хязгаарлана.

import type { Prisma } from "@/app/generated/prisma/client";

export function holdsEffectivePermissionWhere(code: string, tenantId: string): Prisma.UserWhereInput {
  return {
    NOT: { deniedPermissions: { has: code } },
    role: {
      isActive: true,
      OR: [
        {
          permissions: { has: code },
          NOT: {
            AND: [
              { tenantEditablePermissions: { has: code } },
              { tenantOverrides: { some: { tenantId, removePermissions: { has: code } } } },
            ],
          },
        },
        {
          tenantEditablePermissions: { has: code },
          tenantOverrides: { some: { tenantId, addPermissions: { has: code } } },
        },
      ],
    },
  };
}
