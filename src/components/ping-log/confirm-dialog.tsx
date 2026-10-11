"use client";

import { useEffect, useRef } from "react";

import { PxButton, Sentences, Window } from "./ui";

type Props = {
  open: boolean;
  title: string;
  text: string;
  /** The button that goes ahead, in red: what it does, in a few words. */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** A question that needs a yes before something is deleted, in the game's window rather than the browser's own box. */
export function ConfirmDialog({ open, title, text, confirmLabel, onConfirm, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // The question takes the focus, so neither answer opens already ringed.
      heading.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="confirm-title" aria-describedby="confirm-text" className="px-dialog px-dialog--narrow">
      <Window tone="alert" className="mt-4">
        <p id="confirm-title" ref={heading} tabIndex={-1} className="px-window__title outline-none">
          {title}
        </p>
        <p id="confirm-text" className="pt-2 text-[15px] leading-relaxed">
          <Sentences text={text} />
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <PxButton
            variant="danger"
            block
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmLabel}
          </PxButton>
          <PxButton variant="secondary" block onClick={onClose}>
            キャンセル
          </PxButton>
        </div>
      </Window>
    </dialog>
  );
}
