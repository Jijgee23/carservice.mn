import { revalidatePath } from "next/cache";

/**
 * Invalidate every cash route (income, expense, sessions, session detail, settlements, report, types).
 * `revalidatePath("/dashboard/cash")` alone only covers that single page; the "layout" type covers
 * every route nested under it.
 */
export function revalidateCashPaths(): void {
  revalidatePath("/dashboard/cash", "layout");
}
