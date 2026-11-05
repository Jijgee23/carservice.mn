"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { getBranchDaySlots } from "@/app/_actions/appointments";
import { BookingCalendar } from "@/app/_components/booking-calendar";
import type { DayAvailability } from "@/lib/appointment-slots";
import { todayKey } from "@/lib/appointments-calendar";
import type { Weekday } from "@/lib/branches";
import type { ScheduleException, ScheduleSeason, ScheduleRule } from "@/lib/branch-effective-schedule";

/** Гаднаас (categoryIds солигдоход) дуудах имплиэйтив API. */
export type BranchTimePickerHandle = {
  // `nextCategoryIds`-г ЗААВАЛ дамжуулна: parent-ийн setState батчлагдсан тул
  // энэ дуудлагын үед props хараахан шинэчлэгдээгүй байж болзошгүй — closure
  // дэх хуучин `categoryIds` prop-оор биш, шинэ утгаар л дуудна.
  reload: (nextCategoryIds: string[]) => void;
};

/**
 * Салбар + өдөр + боломжит цагийн сонгогч. Хэрэглэгчийн захиалга болон ажилтны
 * цаг бүртгэх формд адил ашиглагдана. Хоёр grid нүд (календар | цаг) буцаана —
 * эцэг grid-д шууд багана болж байрлана.
 *
 * Салбар солих үед `key={branchId}`-ээр remount хийж дотоод төлвийг тэглэнэ.
 * `categoryIds` өөрчлөгдөхөд (ижил салбар дээр) эцэг компонент `ref.reload()`-ийг
 * шууд (event handler-аас) дуудаж, огноог хэвээр үлдээгээд зөвхөн боломжит
 * цагийг дахин татна — booking v2: сонгосон ангиллуудын нийт хугацаа
 * өөрчлөгдөж болно. (Effect дотор шууд setState дуудахаас зайлсхийв.)
 *
 * Сонгосон өдөр/боломжит хугацааг `onDateChange`/`onAvailabilityChange`-ээр
 * гаднаа (жишээ нь: appointment-form.tsx-ийн бодит хуваарийн preview grid,
 * order-form.tsx-ийн адил зарчмаар) мэдээлнэ — энэ компонент өөрөө grid
 * харуулахгүй, зөвхөн сонголтын логикыг эзэмшинэ; харагдацын байршлыг эцэг
 * шийднэ (жишээ нь: календарын Өдөр харагдацтай адил бүтэн өргөнөөр дээд
 * хэсэгт).
 */
export const BranchTimePicker = forwardRef<
  BranchTimePickerHandle,
  {
    branchId: string;
    categoryIds?: string[];
    openWeekdays?: Weekday[];
    schedule?: {
      openTime: string | null;
      closeTime: string | null;
      schedules: ScheduleRule[];
      scheduleExceptions?: ScheduleException[];
      scheduleSeasons?: ScheduleSeason[];
    };
    value: string; // сонгосон цагийн ISO
    onChange: (iso: string) => void;
    error?: string;
    // Хуваарийн хуудаснаас цаг дээр дарж орж ирсэн бол урьдчилан бөглөх
    // огноо ("YYYY-MM-DD") болон яг тэр цагийн ISO. Ачаалагдсан боломжит
    // цагуудын дунд яг таарах слот байвал л автоматаар сонгоно.
    initialDate?: string;
    initialIso?: string;
    // Сонгосон огноо ("YYYY-MM-DD") болон тухайн өдрийн боломжит
    // мэдээллийг (тухайлбал нийт үргэлжлэх хугацаа) гаднаа мэдээлнэ.
    onDateChange?: (dateStr: string) => void;
    onAvailabilityChange?: (availability: DayAvailability | null) => void;
    // Зөвхөн ажилтны (утсаар) урсгалд зориулав: дүүрсэн (капацитигаас
    // давсан) цагийг ч сонгох боломжтой болгоно — өнгөрсөн цаг л хатуу
    // хориотой хэвээр. Онлайн хэрэглэгчийн урсгалд (энэ prop ирээгүй бол,
    // анхдагчаар false) хамаарахгүй, хатуу хориглол хэвээр.
    allowOverbook?: boolean;
  }
>(function BranchTimePicker(
  {
    branchId,
    categoryIds = [],
    openWeekdays,
    schedule,
    value,
    onChange,
    error,
    initialDate,
    initialIso,
    onDateChange,
    onAvailabilityChange,
    allowOverbook = false,
  },
  ref,
) {
  const [date, setDate] = useState(initialDate ?? "");
  const [availability, setAvailability] = useState<DayAvailability | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const reqIdRef = useRef(0);
  const today = todayKey();

  function applyAvailability(res: DayAvailability | null) {
    setAvailability(res);
    onAvailabilityChange?.(res);
  }

  // Эхний ачаалалт: хуваарийн хуудаснаас урьдчилсан огноотой ирсэн бол
  // тухайн өдрийн боломжит цагийг шууд татаж, яг таарах слот байвал сонгоно.
  useEffect(() => {
    if (!initialDate || !branchId) return;
    onDateChange?.(initialDate);
    const id = ++reqIdRef.current;
    setLoadingSlots(true);
    getBranchDaySlots(branchId, initialDate, categoryIds)
      .then((res) => {
        if (id !== reqIdRef.current) return;
        applyAvailability(res);
        if (initialIso) {
          const match = res.slots.find((s) => s.iso === initialIso && s.available);
          if (match) onChange(match.iso);
        }
      })
      .catch(() => {
        if (id === reqIdRef.current) applyAvailability(null);
      })
      .finally(() => {
        if (id === reqIdRef.current) setLoadingSlots(false);
      });
    // Зөвхөн mount дээр нэг удаа — цаашид onDateChange/reload-оор л ачаална.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSlots(d: string) {
    if (!branchId || !d) {
      applyAvailability(null);
      return;
    }
    const id = ++reqIdRef.current;
    setLoadingSlots(true);
    try {
      const res = await getBranchDaySlots(branchId, d, categoryIds);
      if (id === reqIdRef.current) applyAvailability(res);
    } catch {
      if (id === reqIdRef.current) applyAvailability(null);
    } finally {
      if (id === reqIdRef.current) setLoadingSlots(false);
    }
  }

  function handleCalendarChange(d: string) {
    setDate(d);
    onChange(""); // өдөр солиход сонгосон цагийг цэвэрлэнэ
    onDateChange?.(d);
    void loadSlots(d);
  }

  useImperativeHandle(ref, () => ({
    reload: (nextCategoryIds: string[]) => {
      if (!date || !branchId) return;
      onChange(""); // хугацаа өөрчлөгдсөн тул өмнөх сонголт хүчингүй болж болзошгүй
      const id = ++reqIdRef.current;
      setLoadingSlots(true);
      getBranchDaySlots(branchId, date, nextCategoryIds)
        .then((res) => {
          if (id === reqIdRef.current) applyAvailability(res);
        })
        .catch(() => {
          if (id === reqIdRef.current) applyAvailability(null);
        })
        .finally(() => {
          if (id === reqIdRef.current) setLoadingSlots(false);
        });
    },
  }));

  return (
    <>
      {/* Өдөр (календар) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--oc-ink2)]">Өдөр</span>
        {branchId ? (
          <BookingCalendar
            value={date}
            today={today}
            onChange={handleCalendarChange}
            openWeekdays={openWeekdays}
            schedule={schedule}
          />
        ) : (
          <p className="text-xs text-[var(--oc-muted3)]">Эхлээд салбараа сонгоно уу.</p>
        )}
        {error ? <p className="text-red-400 light:text-red-600 text-xs">{error}</p> : null}
      </div>

      {/* Боломжит цаг */}
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-[var(--oc-ink2)]">Боломжит цаг</div>
        {!branchId || !date ? (
          <p className="text-xs text-[var(--oc-muted3)]">Салбар, өдрөө сонгоно уу.</p>
        ) : loadingSlots ? (
          <p className="text-xs text-[var(--oc-muted3)]">Ачааллаж байна...</p>
        ) : !availability || !availability.open ? (
          <p className="text-xs text-[var(--oc-muted3)]">
            {availability?.reason ?? "Энэ өдөр цаг авах боломжгүй."}
          </p>
        ) : availability.slots.length === 0 ? (
          <p className="text-xs text-[var(--oc-muted3)]">Цагийн нүх алга.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {availability.slots.map((slot) => {
              const selected = slot.iso === value;
              // Сервер `available`-г "ирээдүйд + сул" гэж тооцдог (харах:
              // lib/appointment-slots.ts) — өнгөрсөн цагийг захиалгатай
              // цагаас ялгаж харуулахын тулд энд тусад нь шалгана.
              const isPast = new Date(slot.iso).getTime() <= Date.now();
              // Дүүрсэн ч сонгож болох (зөвхөн ажилтны урсгалд, өнгөрсөн биш):
              // хатуу хориглохгүй, харин тодруулж (амбер) харуулна — сервер
              // талд baталгаажуулах давхар алхам шаардана.
              const overbookable = allowOverbook && !slot.available && !isPast;
              const disabled = isPast || (!slot.available && !overbookable);
              return (
                <button
                  key={slot.iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(slot.iso)}
                  title={
                    isPast
                      ? "Өнгөрсөн"
                      : overbookable
                        ? "Захиалгатай — сонговол баталгаажуулах хэрэгтэй"
                        : !slot.available
                          ? "Захиалгатай"
                          : undefined
                  }
                  className={`px-2 py-2 rounded-lg text-sm tabular-nums border transition-colors ${
                    selected
                      ? overbookable
                        ? "bg-amber-600 border-amber-500 text-[#fff] font-semibold"
                        : "bg-[var(--oc-accent)] border-[var(--oc-accent)] text-[var(--oc-on-accent)] font-semibold shadow-sm"
                      : slot.available
                        ? "border-[var(--oc-line)] bg-[var(--oc-panel)] text-[var(--oc-ink2)] hover:border-[var(--oc-accent)]/60 hover:bg-[var(--oc-accent)]/10"
                        : overbookable
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300 light:text-amber-700 hover:border-amber-500/60 hover:bg-amber-500/20"
                          : "border-[var(--oc-line2)] bg-[var(--oc-panel2)] text-[var(--oc-muted4)] line-through cursor-not-allowed"
                  }`}
                >
                  {slot.time}
                </button>
              );
            })}
          </div>
        )}
        {availability?.scheduleLabel ? (
          <p className="text-xs text-[var(--oc-warn)]">{availability.scheduleLabel}</p>
        ) : null}
        {availability?.open && availability.slots.length > 0 ? (
          <div className="flex items-center gap-3 text-[11px] text-[var(--oc-muted3)]">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded border border-[var(--oc-line)] bg-[var(--oc-panel)]" />
              Сул
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-[var(--oc-panel2)] border border-[var(--oc-line2)]" />
              Захиалгатай
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
});
