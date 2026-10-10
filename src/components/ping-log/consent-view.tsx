"use client";

import { useEffect, useRef } from "react";

import { CONSENT_LEAD, CONSENT_SECTIONS } from "@/lib/ping-log/consent";

import { PRIMARY, SECONDARY } from "./ui";

type Props = {
  open: boolean;
  /** Present before consent: the button that gives it. */
  onAgree?: () => void;
  onClose: () => void;
};

/**
 * The consent text as a panel over the dimmed page. A native <dialog> opened
 * with showModal() keeps focus inside it, closes on Escape, and draws its own
 * backdrop.
 */
export function ConsentDialog({ open, onAgree, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="consent-title"
      className="m-auto w-[min(100%-2rem,28rem)] rounded-lg border border-neutral-300 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60 dark:border-neutral-700"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="space-y-5 overflow-y-auto p-5">
          <div className="space-y-1">
            <h2 id="consent-title" className="text-lg font-bold">参加の前に確認してください</h2>
            <p className="text-sm leading-relaxed">{CONSENT_LEAD}</p>
          </div>
          {CONSENT_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <h3 className="text-sm font-bold">{section.title}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-neutral-200 p-4 dark:border-neutral-800">
          {onAgree ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={SECONDARY} onClick={onClose}>同意しない</button>
                <button type="button" className={PRIMARY} onClick={onAgree}>同意して参加する</button>
              </div>
              <p className="text-xs text-neutral-500">通知と位置情報の許可は、同意のあとで求めます。</p>
            </>
          ) : (
            <button type="button" className={`${SECONDARY} w-full`} onClick={onClose}>閉じる</button>
          )}
        </div>
      </div>
    </dialog>
  );
}
