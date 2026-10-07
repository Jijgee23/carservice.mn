// Phase 4a — машины эзэмшигч "байгууллага" эсэх (багана байхгүй, derived).
//   ownerIsOrganization = customer?.isOrganization ?? ownerKindFromRegnum(ownerRegnum) === "Байгууллага"
// `ownerKindFromRegnum` (lib/hur_service.ts): 7 оронтой цэвэр тоо → "Байгууллага".

import { ownerKindFromRegnum } from "@/lib/hur_service";

export function vehicleOwnerIsOrganization(
  customer: { isOrganization?: boolean | null } | null | undefined,
  ownerRegnum: string | null | undefined,
): boolean {
  return customer?.isOrganization ?? ownerKindFromRegnum(ownerRegnum) === "Байгууллага";
}
