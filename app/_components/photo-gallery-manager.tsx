"use client";

import { useActionState, useRef } from "react";
import { addTenantPhotosAction, removeTenantPhotoAction, type PhotoActionState } from "@/app/_actions/tenant-photos";
import { ConfirmForm } from "@/app/_components/confirm-form";
import { Btn } from "@/app/_components/landing-ops-ui";

// Dashboard-ын зургийн сан удирдлага (байгууллага: branchId байхгүй; салбар: branchId).
export function PhotoGalleryManager({
  photos,
  branchId,
  max,
  maxPerUpload,
}: {
  photos: Array<{ id: string; url: string }>;
  branchId?: string;
  max: number;
  maxPerUpload: number;
}) {
  const [state, formAction, pending] = useActionState<PhotoActionState, FormData>(addTenantPhotosAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const full = photos.length >= max;

  return (
    <div className="flex flex-col gap-4">
      {state?.message ? (
        <div
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "bg-[var(--oc-ok)]/10 border border-[var(--oc-ok)]/25 rounded-lg px-4 py-2.5 text-sm text-[var(--oc-ok)]"
              : "bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-sm text-red-400 light:text-red-600"
          }
        >
          {state.message}
        </div>
      ) : null}

      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p) => (
            <li key={p.id} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-[var(--oc-line)] bg-[var(--oc-panel2)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              <ConfirmForm action={removeTenantPhotoAction} message="Энэ зургийг устгах уу?" className="absolute top-1.5 right-1.5">
                <input type="hidden" name="photoId" value={p.id} />
                <button
                  type="submit"
                  aria-label="Зураг устгах"
                  className="w-7 h-7 rounded-full bg-black/60 text-white text-sm leading-none hover:bg-red-600 transition-colors"
                >
                  ×
                </button>
              </ConfirmForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--oc-muted3)]">Зураг оруулаагүй байна.</p>
      )}

      <form
        ref={formRef}
        action={async (fd) => {
          formAction(fd);
          formRef.current?.reset();
        }}
        className="flex flex-col sm:flex-row sm:items-center gap-3"
      >
        {branchId ? <input type="hidden" name="branchId" value={branchId} /> : null}
        <input
          type="file"
          name="files"
          multiple
          required
          disabled={full || pending}
          accept="image/png,image/jpeg,image/webp"
          aria-label="Зураг сонгох"
          className="text-sm text-[var(--oc-muted2)] file:mr-3 file:rounded-md file:border file:border-[var(--oc-line)] file:bg-[var(--oc-panel2)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--oc-ink2)]"
        />
        <Btn type="submit" size="sm" disabled={full || pending}>
          {pending ? "Хадгалж..." : "Зураг нэмэх"}
        </Btn>
      </form>
      <p className="text-[11px] text-[var(--oc-muted4)]">
        PNG, JPG, WEBP · зураг бүр 2MB хүртэл · нэг удаад {maxPerUpload} хүртэл · нийт {photos.length}/{max}
      </p>
    </div>
  );
}
