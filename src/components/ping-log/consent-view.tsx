"use client";

import { useEffect, useRef } from "react";

import { CONSENT_LEAD, CONSENT_SECTIONS } from "@/lib/ping-log/consent";

import { PxButton, Window } from "./ui";

type Props = {
  open: boolean;
  /** Present before consent: the button that gives it. */
  onAgree?: () => void;
  onClose: () => void;
};

/**
 * The consent text as a window over the dimmed page. A native <dialog>
 * opened with showModal() keeps focus inside it, closes on Escape, and draws
 * its own backdrop. The answer buttons stay in view below the text.
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
      <Window className="mt-4">
        <p id="consent-title" className="px-window__title">参加の前に読んでください</p>
        <div className="flex max-h-[min(80dvh,700px)] flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pt-2 pr-1 pb-4">
            <p className="text-[16px]">{CONSENT_LEAD}</p>
            {CONSENT_SECTIONS.map((section) => (
              <section key={section.title} className="space-y-1.5">
                <h3 className="flex items-center gap-2 text-[17px] text-(--px-yellow)">
                  <span className="inline-block size-2.5 bg-(--px-yellow)" aria-hidden="true" />
                  {section.title}
                </h3>
                <ul className="space-y-1 pl-5 text-[15px] leading-relaxed text-(--px-ink-2)">
                  {section.items.map((item) => <li key={item} className="list-['-_']">{item}</li>)}
                </ul>
              </section>
            ))}
          </div>
          <div className="border-t-3 border-(--px-navy-3) pt-3">
            {onAgree ? (
              <>
                <div className="grid grid-cols-[2fr_3fr] gap-1">
                  <PxButton variant="secondary" block onClick={onClose}>同意しない</PxButton>
                  <PxButton block onClick={onAgree}>同意して参加する</PxButton>
                </div>
                <p className="text-[13px] text-(--px-ink-2)">通知と位置情報の許可は、このあと1つずつ求めます。</p>
              </>
            ) : (
              <PxButton variant="secondary" block onClick={onClose}>閉じる</PxButton>
            )}
          </div>
        </div>
      </Window>
    </dialog>
  );
}
