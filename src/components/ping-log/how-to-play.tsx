"use client";

import { Fragment, useEffect, useRef } from "react";

import { PixelIcon, type PixelIconName } from "./pixel-icon";
import { PxButton, Window } from "./ui";

const STEPS: { icon: PixelIconName; title: string; short: string; text: string }[] = [
  { icon: "bell", title: "通知が届く", short: "通知が届く", text: "10分ごとに、スマホに通知が届きます。画面が消えていても届きます。" },
  { icon: "pin", title: "階と場所を指す", short: "場所を指す", text: "通知を開いて、いまいる階を選び、地図でいまいる場所をタップします。" },
  { icon: "arrow", title: "送信する", short: "送信する", text: "「送信する」を押せば完了です。写真は添えても添えなくても構いません。" },
];

/** The loop in one line of three pictures, for the title screen. */
export function HowToStrip() {
  return (
    <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-1 text-center" aria-label="記録の流れ">
      {STEPS.map((step, index) => (
        <Fragment key={step.title}>
          {index > 0 && <li aria-hidden="true" className="px-pixel pt-4 text-[10px] text-(--px-ink-2)">&#9654;</li>}
          <li className="flex flex-col items-center gap-1.5">
            <span className="grid size-12 place-items-center border-3 border-(--px-k) bg-(--px-navy-2) text-(--px-yellow)">
              <PixelIcon name={step.icon} size={24} />
            </span>
            <span className="text-[14px] leading-snug">{step.short}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/** The same loop with the details, numbered like a game's instructions. */
export function HowToSteps() {
  return (
    <ol className="space-y-3">
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center border-3 border-(--px-k) bg-(--px-navy-2) text-(--px-yellow)">
            <PixelIcon name={step.icon} size={24} />
          </span>
          <span className="min-w-0">
            <span className="flex items-baseline gap-2 text-[17px]">
              <span className="px-pixel text-[10px] text-(--px-yellow)">{index + 1}</span>
              {step.title}
            </span>
            <span className="block text-[15px] leading-relaxed text-(--px-ink-2)">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The instructions, reopened from the menu, with the details people ask about. */
export function HowToDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="howto-title" className="px-dialog">
      <Window className="mt-4">
        <p id="howto-title" className="px-window__title">遊び方</p>
        <div className="max-h-[min(78dvh,640px)] space-y-5 overflow-y-auto">
          <HowToSteps />
          <ul className="space-y-1.5 border-t-3 border-(--px-navy-3) pt-4 text-[15px] text-(--px-ink-2)">
            <li className="ml-4 list-['-_']">通知はその日の24時に自動で止まります。</li>
            <li className="ml-4 list-['-_']">場所がわからないときは「場所がわからない」を選べば、そのまま送信できます。</li>
            <li className="ml-4 list-['-_']">通知を開けなかった回は、気にせず次の通知から続けてください。</li>
          </ul>
          <PxButton variant="secondary" block onClick={onClose}>閉じる</PxButton>
        </div>
      </Window>
    </dialog>
  );
}
