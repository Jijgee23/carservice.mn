"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";

/**
 * Server-action form submit that keeps every entered value on a failed result.
 *
 * `<form action={fn}>` makes React 19 reset all uncontrolled fields (selects, dates, textareas, file inputs)
 * once the action settles, even on `{ ok: false }`. Submitting via onSubmit + a transition runs the same
 * server action without the reset, so the user can fix the reported error and resubmit. On success the
 * caller closes/unmounts the form (or resets it explicitly) from `onSuccess`.
 */
export function useRetainedFormAction<S extends { ok: boolean } | null>(
  action: (prev: S, formData: FormData) => Promise<S>,
  onSuccess?: (result: S) => void,
  /** State returned when the action throws (network failure, unexpected server error). */
  errorState: S = { ok: false, message: "Алдаа гарлаа. Дахин оролдоно уу." } as unknown as S,
) {
  const [state, setState] = useState<S>(null as S);
  const stateRef = useRef<S>(null as S);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    // Like a native submit, include the pressed button's name/value (React 19 `<form action>` does this too).
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fd = new FormData(e.currentTarget, submitter instanceof HTMLElement ? (submitter as HTMLButtonElement | HTMLInputElement) : undefined);
    startTransition(async () => {
      let result: S;
      try {
        result = await action(stateRef.current, fd);
      } catch {
        result = errorState;
      }
      stateRef.current = result;
      setState(result);
      if (result?.ok) onSuccess?.(result);
    });
  }

  return { state, pending, onSubmit };
}
