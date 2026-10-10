"use client";

import { useEffect, useRef } from "react";

import { PixelIcon, type PixelIconName } from "./pixel-icon";
import { Eyebrow, PxButton } from "./ui";

const STEPS: { icon: PixelIconName; title: string; text: string }[] = [
  { icon: "bell", title: "通知が届く", text: "10分ごとに、スマホに通知が届きます。画面が消えていても届きます。" },
  { icon: "pin", title: "場所を指す", text: "通知を開いて、いまいる階を選び、地図でいまいる場所をタップします。" },
  { icon: "arrow", title: "送信する", text: "送信を押せば完了です。写真は添えても添えなくても構いません。" },
];

/** The loop in three steps, numbered like a game's instructions. */
export function HowToSteps() {
  return (
    <ol className="space-y-2.5">
      {STEPS.map((step, index) => (
        <li key={step.title} className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center bg-(--px-teal-deep) text-(--px-teal)">
            <PixelIcon name={step.icon} size={22} />
          </span>
          <span className="min-w-0">
            <span className="flex items-baseline gap-2 font-bold text-(--px-ink)">
              <span className="px-pixel text-[9px] text-(--px-pink-soft)">{`0${index + 1}`}</span>
              {step.title}
            </span>
            <span className="block text-sm leading-relaxed text-(--px-muted)">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The same instructions, reopened later from the menu, with the details people ask about. */
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
      <div className="px-frame">
        <div className="px-panel px-dark max-h-[min(86dvh,720px)] space-y-5 overflow-y-auto">
          <div className="space-y-2">
            <Eyebrow>How to play</Eyebrow>
            <h2 id="howto-title" className="text-xl font-black text-(--px-teal)">遊び方</h2>
          </div>
          <HowToSteps />
          <ul className="space-y-1 border-t-4 border-(--px-panel-2) pt-4 text-sm text-(--px-muted)">
            <li className="list-['-_'] ml-4">通知はその日の24時に自動で止まります。</li>
            <li className="list-['-_'] ml-4">場所がわからないときは「場所がわからない」を選べば、そのまま送信できます。</li>
            <li className="list-['-_'] ml-4">通知を開けなかった回は、気にせず次の通知から続けてください。</li>
          </ul>
          <PxButton variant="secondary" block onClick={onClose}>閉じる</PxButton>
        </div>
      </div>
    </dialog>
  );
}
