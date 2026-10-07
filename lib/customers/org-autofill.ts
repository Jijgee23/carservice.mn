// Phase 4a — форм дээрх eBarimt нэр автоматаар бөглөх шийдвэр (pure).
// Зөвхөн нэр хоосон, эсвэл өмнөх автоматаар бөглөсөн утгатай ижил (хэрэглэгч
// засаагүй) үед дарж бичнэ.
export function shouldAutofillOrgName(
  currentName: string,
  lastAutofill: string | null,
): boolean {
  const cur = currentName.trim();
  return cur === "" || (lastAutofill !== null && cur === lastAutofill.trim());
}
