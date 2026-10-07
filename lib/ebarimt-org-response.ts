// Phase 4a — GET /api/v1/ebarimt/org-ийн цэвэр (pure) хариу/алдааны mapper.
// Route-оос тусгаарласан нь DB/auth-гүйгээр unit test хийхэд зориулав.

import type { EbarimtOrg } from "@/lib/ebarimt";

export type OrgLookupBody =
  | { status: 200; body: { regno: string; name: string; vatPayer: boolean | null; isGovernment: boolean | null } }
  | { status: 404 | 422 | 502; body: { error: string; code: string } };

export const ORG_LOOKUP_MESSAGES = {
  ORG_REGNO_INVALID: "Байгууллагын регистр 7 оронтой тоо байна.",
  ORG_NOT_FOUND: "Энэ регистрээр байгууллага олдсонгүй.",
  ORG_LOOKUP_FAILED: "ebarimt-аас мэдээлэл авч чадсангүй. Нэрийг гараар оруулна уу.",
} as const;

export function mapOrgLookupResult(regno: string, org: EbarimtOrg): OrgLookupBody {
  if (!org.found || !org.name) {
    return {
      status: 404,
      body: { error: ORG_LOOKUP_MESSAGES.ORG_NOT_FOUND, code: "ORG_NOT_FOUND" },
    };
  }
  return {
    status: 200,
    body: { regno, name: org.name, vatPayer: org.vatPayer, isGovernment: org.isGovernment },
  };
}

export function orgRegnoInvalidBody(): OrgLookupBody {
  return {
    status: 422,
    body: { error: ORG_LOOKUP_MESSAGES.ORG_REGNO_INVALID, code: "ORG_REGNO_INVALID" },
  };
}

export function orgLookupFailedBody(): OrgLookupBody {
  return {
    status: 502,
    body: { error: ORG_LOOKUP_MESSAGES.ORG_LOOKUP_FAILED, code: "ORG_LOOKUP_FAILED" },
  };
}
