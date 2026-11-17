import { ServiceKeysPicker } from "./service-keys-picker";

type Choice = { id: string; name: string; description: string | null };

/**
 * Эзэн «үзүүлдэг үйлчилгээ»-гээ баталгаажуулаагүй үед dashboard-ын дээгүүр
 * гардаг, хааж болохгүй dialog (app/dashboard/layout.tsx). Хадгалмагц layout
 * дахин render хийгдэж (revalidatePath) алга болно.
 */
export function ServiceKeysGate({
  keys,
  initialSelected,
}: {
  keys: Choice[];
  initialSelected: string[];
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-keys-gate-title"
        className="w-full max-w-2xl rounded-2xl border border-[var(--oc-line)] bg-[var(--oc-panel)] p-5 shadow-2xl sm:p-6"
      >
        <h2 id="service-keys-gate-title" className="text-lg font-semibold text-[var(--oc-ink)]">
          Танайх ямар үйлчилгээ үзүүлдэг вэ?
        </h2>
        <p className="mt-1 mb-5 text-sm text-[var(--oc-muted)]">
          Жолооч нар carservice.mn дээр хийлгэх ажлаараа хайхад таны байгууллага
          гарч ирнэ, онлайн цаг захиалгад ашиглагдана. Үзүүлдэг бүх үйлчилгээгээ
          сонгоно уу — дараа нь Тохиргооноос өөрчилж болно.
        </p>
        <ServiceKeysPicker
          keys={keys}
          initialSelected={initialSelected}
          submitLabel="Хадгалаад үргэлжлүүлэх"
        />
      </div>
    </div>
  );
}
