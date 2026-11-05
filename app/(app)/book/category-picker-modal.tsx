"use client";

import { useState } from "react";
import { Modal } from "@/app/_components/modal";
import { CategoryPickerGrid, type ServiceKey } from "./category-picker-grid";

/**
 * Ажлын төрөл нэмэх/өөрчлөх modal. Дотор нь ӨӨРИЙН draft сонголттой (нээгдэх
 * үед одоогийн сонголтоор эхэлнэ) — backdrop/Esc/цуцлах бол хаяна, харин
 * "Хэрэглэх" дарвал эцэг рүү (`onApply`) шинэ сонголтоо дамжуулж хаана. Ингэснээр
 * modal доторх сонголт бүрд эцгийн (mobile-ийн жагсаалт дахин ачаалах гэх мэт)
 * үйлдэл шууд ажиллахгүй, зөвхөн хаах мөчид л нэг удаа шинэчлэгдэнэ.
 */
export function CategoryPickerModal({
  open,
  onClose,
  onApply,
  serviceKeys,
  currentSelected,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (ids: string[]) => void;
  serviceKeys: ServiceKey[];
  currentSelected: string[];
}) {
  const [draft, setDraft] = useState<string[]>(currentSelected);
  // Нээгдэх бүрд эцгийн одоогийн сонголтоор дахин эхэлнэ — React-ийн
  // зөвлөдөг "render-ийн үед нөхцөлт setState" загвар (useEffect биш): өмнөх
  // `open`-той харьцуулаад false→true шилжилтийг render дундаа шууд барина.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open && !prevOpen) {
    setPrevOpen(open);
    setDraft(currentSelected);
  } else if (open !== prevOpen) {
    setPrevOpen(open);
  }

  function toggle(id: string, checked: boolean) {
    setDraft((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  function apply() {
    onApply(draft);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Ажлын төрөл сонгох" widthClassName="max-w-2xl">
      <div className="flex flex-col gap-4">
        <CategoryPickerGrid serviceKeys={serviceKeys} selected={draft} onToggle={toggle} />
      </div>
      <div className="sticky bottom-0 -mx-5 mt-4 flex items-center justify-between gap-3 border-t border-[var(--oc-line)] bg-[var(--oc-panel)] px-5 pt-3">
        <span className="text-xs text-[var(--oc-muted3)]">
          {draft.length > 0 ? `${draft.length} сонгосон` : "Сонголтгүй бол салбар харагдахгүй"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-[var(--oc-muted3)] hover:text-[var(--oc-ink)] transition-colors"
          >
            Болих
          </button>
          <button
            type="button"
            onClick={apply}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-[var(--oc-accent)] text-[var(--oc-on-accent)] hover:bg-[var(--oc-accent-hi)] transition-colors"
          >
            Хэрэглэх{draft.length > 0 ? ` (${draft.length})` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
