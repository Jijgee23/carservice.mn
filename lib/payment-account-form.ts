// Pure FormData -> service payload mapping for the payment-account server actions (testable without "use server").

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function createPayloadFromForm(fd: FormData): Record<string, unknown> {
  return {
    type: text(fd, "type"),
    name: text(fd, "name"),
    accountNumber: text(fd, "accountNumber"),
    terminalId: text(fd, "terminalId"),
    merchantId: text(fd, "merchantId"),
    isTest: fd.get("isTest") === "on",
  };
}

/** Type is never read (immutable). `isTestPresent` marks that the checkbox was rendered, so absent `isTest` means false. */
export function updatePayloadFromForm(fd: FormData): { id: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { name: text(fd, "name"), accountNumber: text(fd, "accountNumber") };
  if (fd.has("terminalId")) data.terminalId = text(fd, "terminalId");
  if (fd.has("merchantId")) data.merchantId = text(fd, "merchantId");
  if (fd.has("isTestPresent")) data.isTest = fd.get("isTest") === "on";
  return { id: text(fd, "id"), data };
}
