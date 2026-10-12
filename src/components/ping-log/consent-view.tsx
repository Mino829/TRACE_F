"use client";

import { useEffect, useRef } from "react";

import { CONSENT_LEAD, CONSENT_SECTIONS } from "@/lib/ping-log/consent";

import { PxButton, Sentences, Window, useScrollHint } from "./ui";

type Props = {
  open: boolean;
  /** Present before consent: the button that gives it. */
  onAgree?: () => void;
  /** Joining is under way: the answer buttons wait. */
  busy?: boolean;
  /** Why joining failed, shown above the answer buttons. */
  error?: string;
  onClose: () => void;
};

/**
 * The consent text as a window over the dimmed page. A native <dialog>
 * opened with showModal() keeps focus inside it, closes on Escape, and draws
 * its own backdrop. The answer buttons stay in view below the text.
 */
export function ConsentDialog({ open, onAgree, busy = false, error = "", onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLParagraphElement>(null);
  const scroll = useScrollHint<HTMLDivElement>();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // The title takes the focus: the text comes first, and no answer opens already ringed.
      title.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="consent-title" className="px-dialog">
      <Window className="mt-4">
        <p id="consent-title" ref={title} tabIndex={-1} className="px-window__title outline-none">
          参加の前に読んでください
        </p>
        <div className="flex max-h-[min(86dvh,700px)] flex-col">
          <div ref={scroll} className="px-scroll min-h-0 flex-1 space-y-5 overflow-y-auto pt-2 pr-1 pb-4">
            <p className="text-[16px]">
              <Sentences text={CONSENT_LEAD} />
            </p>
            {CONSENT_SECTIONS.map((section) => (
              <section key={section.title} className="space-y-1.5">
                <h3 className="flex items-center gap-2 text-[17px] text-(--px-yellow)">
                  <span className="inline-block size-2.5 bg-(--px-yellow)" aria-hidden="true" />
                  {section.title}
                </h3>
                <ul className="space-y-1 pl-5 text-[15px] leading-relaxed text-(--px-ink-2)">
                  {section.items.map((item) => (
                    <li key={item} className="list-['-_']">
                      <Sentences text={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="border-t-3 border-(--px-navy-3) pt-3">
            {onAgree ? (
              <>
                {error && (
                  <p className="px-note mb-3" data-tone="warn" role="alert">
                    <Sentences text={error} />
                  </p>
                )}
                {/* Stacked: side by side, the two do not fit a phone's width. */}
                <div className="flex flex-col gap-2">
                  <PxButton block onClick={onAgree} disabled={busy}>{busy ? "参加しています…" : "同意して参加する"}</PxButton>
                  <PxButton variant="secondary" block onClick={onClose} disabled={busy}>同意しない</PxButton>
                </div>
                <p className="mt-1 text-[13px] text-(--px-ink-2)">
                  <Sentences text="カメラなどの許可は、はじめて撮影するときに求めます。" />
                </p>
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
