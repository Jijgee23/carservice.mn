"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recordOrderPaymentAction } from "@/app/_actions/order-payments";
import { completeAllOrderItemsAction } from "@/app/_actions/orders";
import { getOrderQuickContextAction, type OrderQuickContext } from "@/app/_actions/order-quick-context";
import { Btn } from "@/app/_components/landing-ops-ui";
import { Modal } from "@/app/_components/modal";
import { RowActionsMenu, RowMenuButton } from "@/app/_components/row-actions";
import { useToast } from "@/app/_components/toast";
import { formatTugrik, type OrderStatus, type PaymentStatus } from "@/lib/orders";
import { PaymentMethodModal, choiceBankValue, type PaymentChoice } from "../_components/payment-method-modal";
import { NoOpenSessionNotice } from "../cash/session-warning";
import { StatusControls } from "./[id]/status-controls";

export type OrderRowActionsPerms = {
  canRecordPayments: boolean;
  canChangeItemStatus: boolean;
  canEditOrders: boolean;
};

type Dialog = "payment" | "status" | "completeAll" | null;

/**
 * Засварын хуудасны жагсаалтын мөрийн «⋯» үйлдлүүд: Төлбөр бүртгэх, Бүх
 * ажлыг дуусгах (ажиллаж буй), Төлөв өөрчлөх. Цэсэнд харагдах эсэхийг
 * мөрийн төлөв + эрхээр шийднэ; modal нээхэд л дэлгэрэнгүй өгөгдлийг
 * (үлдэгдэл, касс, шилжилт, «Дуусгах»-ын нөхцөл) серверээс ачаална.
 */
export function OrderRowActions({
  order,
  perms,
}: {
  order: { id: string; number: string; status: OrderStatus; paymentStatus: PaymentStatus; isInternal: boolean };
  perms: OrderRowActionsPerms;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const final = order.status === "COMPLETED" || order.status === "CANCELLED";
  const showPayment =
    perms.canRecordPayments && !order.isInternal && order.status !== "CANCELLED" && order.paymentStatus !== "PAID";
  const showCompleteAll = perms.canChangeItemStatus && order.status === "IN_PROGRESS";
  const showStatus = perms.canEditOrders && !final;

  if (!showPayment && !showCompleteAll && !showStatus) {
    return <span className="text-[var(--oc-muted4)] text-xs">—</span>;
  }

  return (
    <>
      <RowActionsMenu>
        {showPayment ? <RowMenuButton onClick={() => setDialog("payment")}>Төлбөр бүртгэх</RowMenuButton> : null}
        {showCompleteAll ? (
          <RowMenuButton onClick={() => setDialog("completeAll")}>Бүх ажлыг дуусгах</RowMenuButton>
        ) : null}
        {showStatus ? <RowMenuButton onClick={() => setDialog("status")}>Төлөв өөрчлөх</RowMenuButton> : null}
      </RowActionsMenu>

      {dialog === "payment" ? <QuickPaymentDialog orderId={order.id} onClose={() => setDialog(null)} /> : null}
      {dialog === "status" ? <QuickStatusDialog orderId={order.id} onClose={() => setDialog(null)} /> : null}
      {dialog === "completeAll" ? (
        <CompleteAllDialog orderId={order.id} number={order.number} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

function useQuickContext(orderId: string, onClose: () => void) {
  const toast = useToast();
  const [ctx, setCtx] = useState<OrderQuickContext | null>(null);
  useEffect(() => {
    let alive = true;
    getOrderQuickContextAction(orderId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setCtx(res);
        else {
          toast.error(res.message);
          onClose();
        }
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Мэдээлэл ачаалж чадсангүй.");
        onClose();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  return ctx;
}

function LoadingDialog({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title} widthClassName="max-w-sm">
      <p className="text-sm text-[var(--oc-muted3)]">Ачаалж байна…</p>
    </Modal>
  );
}

function QuickPaymentDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const ctx = useQuickContext(orderId, onClose);

  if (!ctx) return <LoadingDialog title="Төлбөр бүртгэх" onClose={onClose} />;
  const payment = ctx.payment;
  if (!payment) {
    return (
      <Modal open onClose={onClose} title={`Төлбөр бүртгэх · #${ctx.number}`} widthClassName="max-w-sm">
        <p className="text-sm text-[var(--oc-muted2)]">Энэ засварын хуудсанд бүртгэх үлдэгдэл алга.</p>
      </Modal>
    );
  }

  async function record(choice: PaymentChoice, amount: string) {
    const fd = new FormData();
    fd.set("orderId", orderId);
    fd.set("method", choice.method);
    fd.set("amount", amount);
    if (choiceBankValue(choice)) fd.set("bank", choiceBankValue(choice));
    const res = await recordOrderPaymentAction(null, fd);
    if (res?.ok) {
      toast.success(
        "Төлбөр бүртгэгдлээ",
        res.change ? `Хариулт өгөх: ${formatTugrik(res.change)}` : `#${ctx!.number}`,
      );
      onClose();
      router.refresh();
      return { ok: true };
    }
    return { ok: false, message: res?.message };
  }

  return (
    <PaymentMethodModal
      mode="full"
      open
      onClose={onClose}
      title={`Төлбөр бүртгэх · #${ctx.number} · Үлдэгдэл ${formatTugrik(payment.remaining)}`}
      banks={payment.banks}
      canManageAccounts={payment.canManageAccounts}
      // QPay нэхэмжлэл (QR, хүлээгдэж буй төлөв) нь засварын хуудасны
      // дэлгэрэнгүйд — жагсаалтаас зөвхөн шууд бүртгэх аргууд.
      includeQpay={false}
      defaultAmount={payment.remaining}
      changeBase={Number.parseFloat(payment.remaining)}
      onRecord={record}
      recordBlockedNotice={!payment.cashSessionOpen ? <NoOpenSessionNotice /> : undefined}
      otherNote="QPay-ээр төлүүлэх бол засварын хуудсыг нээнэ үү."
    />
  );
}

function QuickStatusDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const ctx = useQuickContext(orderId, onClose);
  if (!ctx) return <LoadingDialog title="Төлөв өөрчлөх" onClose={onClose} />;

  // StatusControls нь changeOrderStatusAction-ийг өөрөө дуудаж (revalidatePath
  // → жагсаалт шинэчлэгдэнэ) toast гаргана; амжилттай бол modal хаагдана.
  return (
    <Modal open onClose={onClose} title={`Төлөв өөрчлөх · #${ctx.number}`} widthClassName="max-w-sm">
      <div className="flex flex-col gap-3">
        {ctx.canEditOrder ? (
          <StatusControls
            orderId={ctx.id}
            transitions={ctx.transitions}
            disabled={false}
            currentStatus={ctx.status}
            estimatedDurationMinutes={ctx.estimatedDurationMinutes}
            serviceItemDurationMinutes={ctx.serviceItemDurationMinutes}
            completeBlockedReason={ctx.completeBlockedReason}
            cancelBlockedReason={ctx.cancelBlockedReason}
            defaultExpanded
            onChanged={onClose}
          />
        ) : (
          <p className="text-sm text-[var(--oc-muted2)]">Танд энэ засварын хуудсыг засах эрх байхгүй.</p>
        )}
        <Link
          href={`/dashboard/orders/${ctx.id}`}
          className="text-xs text-[var(--oc-accent)] hover:text-[var(--oc-accent-hi)] underline underline-offset-2"
        >
          Засварын хуудсыг нээх
        </Link>
      </div>
    </Modal>
  );
}

function CompleteAllDialog({ orderId, number, onClose }: { orderId: string; number: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await completeAllOrderItemsAction(orderId);
      if (!res.ok) {
        toast.error("Алдаа гарлаа", res.message);
        return;
      }
      const skipped = res.skippedDiagnostics > 0 ? ` ${res.skippedDiagnostics} оношилгоо бөглөгдөөгүй тул алгаслаа.` : "";
      if (res.completed === 0) {
        toast.warning("Дуусгах ажил алга", `#${number}: дуусаагүй ажил байхгүй.${skipped}`);
      } else if (skipped) {
        toast.warning("Хэсэгчлэн дууслаа", `#${number}: ${res.completed} ажил дууслаа.${skipped}`);
      } else {
        toast.success("Бүх ажил дууслаа", `#${number}: ${res.completed} ажил дууссан гэж тэмдэглэлээ.`);
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open onClose={onClose} title={`Бүх ажлыг дуусгах · #${number}`} widthClassName="max-w-sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--oc-muted2)]">
          Энэ засварын хуудасны дуусаагүй бүх ажил, оношилгоог «Дууссан» болгоно. Бөглөгдөөгүй оношилгоо алгасагдана.
          Засварын хуудасны төлөв өөрчлөгдөхгүй — дараа нь «Төлөв өөрчлөх → Дуусгах».
        </p>
        <div className="flex justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Болих
          </Btn>
          <Btn type="button" onClick={run} disabled={pending}>
            {pending ? "Дуусгаж байна…" : "Дуусгах"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
