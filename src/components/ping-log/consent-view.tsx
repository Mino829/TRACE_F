"use client";

import { useEffect, useRef } from "react";

import { CONSENT_LEAD, CONSENT_SECTIONS } from "@/lib/ping-log/consent";

import { Eyebrow, PxButton } from "./ui";

type Props = {
  open: boolean;
  /** Present before consent: the button that gives it. */
  onAgree?: () => void;
  onClose: () => void;
};

/**
 * The consent text as a framed window over the dimmed page. A native <dialog>
 * opened with showModal() keeps focus inside it, closes on Escape, and draws
 * its own backdrop.
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
    <dialog ref={dialog} onClose={onClose} aria-labelledby="consent-title" className="px-dialog">
      <div className="px-frame">
        <div className="px-panel px-dark flex max-h-[min(86dvh,720px)] flex-col p-0!">
          <div className="space-y-5 overflow-y-auto px-5 pt-6 pb-5">
            <div className="space-y-2">
              <Eyebrow>Please read</Eyebrow>
              <h2 id="consent-title" className="text-xl font-black text-(--px-teal)">参加の前に確認してください</h2>
              <p className="text-sm">{CONSENT_LEAD}</p>
            </div>
            {CONSENT_SECTIONS.map((section) => (
              <section key={section.title} className="space-y-1.5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-(--px-pink-soft)">
                  <span className="inline-block size-2 bg-(--px-pink-soft)" aria-hidden="true" />
                  {section.title}
                </h3>
                <ul className="space-y-1 pl-4 text-sm leading-relaxed text-(--px-muted)">
                  {section.items.map((item) => <li key={item} className="list-['-_']">{item}</li>)}
                </ul>
              </section>
            ))}
          </div>
          <div className="space-y-2 border-t-4 border-(--px-panel-2) px-5 pt-4 pb-5">
            {onAgree ? (
              <>
                <div className="grid grid-cols-[2fr_3fr] gap-3">
                  <PxButton variant="secondary" block onClick={onClose}>同意しない</PxButton>
                  <PxButton block onClick={onAgree}>同意して参加する</PxButton>
                </div>
                <p className="text-xs text-(--px-muted)">通知と位置情報の許可は、同意のあとで求めます。</p>
              </>
            ) : (
              <PxButton variant="secondary" block onClick={onClose}>閉じる</PxButton>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
