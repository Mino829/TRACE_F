"use client";

import { Fragment, useEffect, useRef } from "react";

import { PxButton, Window } from "./ui";

/** danger: undoes the joining. quiet: not for participants, set apart in smaller type. */
export type MenuItem = { label: string; onSelect: () => void; tone?: "danger" | "quiet"; disabled?: boolean };

/**
 * The header's menu: the things a participant needs now and then, kept off
 * the home screen. It drops from the button at the top right; a tap outside
 * it or Escape closes it. Items with a tone come last, below a rule.
 */
export function MenuDialog({ open, items, onClose }: { open: boolean; items: MenuItem[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // The title takes the focus, so no item opens already ringed.
      title.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  const firstSetApart = items.findIndex((item) => item.tone);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the dimmed page lands on the dialog itself.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      aria-labelledby="menu-title"
      className="px-dialog px-dialog--menu"
    >
      <Window className="mt-4">
        <p id="menu-title" ref={title} tabIndex={-1} className="px-window__title outline-none">
          メニュー
        </p>
        <ul className="px-menu">
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {index === firstSetApart && index > 0 && <li role="separator" className="px-menu__rule" />}
              <li>
                <button
                  type="button"
                  className="px-menu__item"
                  data-tone={item.tone}
                  disabled={item.disabled}
                  onClick={() => {
                    onClose();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
        <div className="mt-2">
          <PxButton variant="secondary" size="sm" block onClick={onClose}>
            閉じる
          </PxButton>
        </div>
      </Window>
    </dialog>
  );
}
