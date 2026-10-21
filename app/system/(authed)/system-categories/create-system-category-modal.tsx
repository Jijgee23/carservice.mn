"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, PlusIcon } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { SystemCategoryForm } from "./system-category-form";

export function CreateSystemCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Btn type="button" onClick={() => setOpen(true)}>
        <PlusIcon />
        Нэмэх
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title="Шинэ сэлбэгийн ангилал">
        <SystemCategoryForm
          onSuccess={() => {
            router.refresh();
            setOpen(false);
          }}
        />
      </Modal>
    </>
  );
}
