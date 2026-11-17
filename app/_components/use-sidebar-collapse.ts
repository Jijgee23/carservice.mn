"use client";

import { useEffect, useState } from "react";

// Admin/consumer/system бүх sidebar нэг localStorage key, нэг CSS var
// (`--sidebar-w`, root дээр) хуваалцана — нэгэн зэрэг зөвхөн нэг нь DOM-д
// байдаг тул мөргөлдөхгүй, хэрэглэгчийн хумьсан сонголт бүх хэсэгт нэгдмэл.
// Root layout-ийн inline script нь paint-аас өмнө var-ыг тохируулж
// "flash of wrong width"-ээс сэргийлдэг (харах: app/layout.tsx).
const STORAGE_KEY = "carcare:sidebar:collapsed";

export const SIDEBAR_EXPANDED_W = "14rem";
export const SIDEBAR_COLLAPSED_W = "4rem";

type SidebarCollapseConfig = {
  storageKey?: string;
  cssVar?: string;
  expandedW?: string;
  collapsedW?: string;
};

/**
 * Sidebar-ийн хумигдсан/дэлгэрэнгүй төлөв. Анхны утга нь server-тэй адил
 * (false, дэлгэрэнгүй) — hydration mismatch гарахгүй. Mount-ийн дараа
 * localStorage-с сэргээж, харгалзах CSS var-ыг шинэчилнэ.
 */
export function useSidebarCollapse(config: SidebarCollapseConfig = {}) {
  const {
    storageKey = STORAGE_KEY,
    cssVar = "--sidebar-w",
    expandedW = SIDEBAR_EXPANDED_W,
    collapsedW = SIDEBAR_COLLAPSED_W,
  } = config;

  const [collapsed, setCollapsedState] = useState(false);

  function applyWidth(next: boolean) {
    document.documentElement.style.setProperty(
      cssVar,
      next ? collapsedW : expandedW,
    );
  }

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(storageKey) === "1";
    } catch {
      // localStorage хаалттай байж болно — алгасна
    }
    if (saved) {
      setCollapsedState(true);
      applyWidth(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    setCollapsedState((prev) => {
      const next = !prev;
      applyWidth(next);
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return { collapsed, toggle };
}
