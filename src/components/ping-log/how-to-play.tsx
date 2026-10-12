"use client";

import { Fragment, useEffect, useRef } from "react";

import { REMINDER_PLAN } from "@/lib/ping-log/push";

import { PixelIcon, type PixelIconName } from "./pixel-icon";
import { Phrases, PxButton, Sentences, Window, useScrollHint } from "./ui";

const STEPS: { icon: PixelIconName; title: string; short: string; text: string }[] = [
  {
    icon: "camera",
    title: "写真を撮る",
    short: "写真を撮る",
    text: "残したい瞬間を見つけたら、「写真を撮る」を押して撮影します。",
  },
  {
    icon: "walk",
    title: "学祭をめぐる",
    short: "学祭をめぐる",
    text: "撮影と撮影のあいだは、自由に学祭をめぐってください。",
  },
  {
    icon: "qr",
    title: "ShibaLab で QR を読む",
    short: "ShibaLab\u00a0へ",
    text: "ShibaLab（教室棟301）には、好きなときに来てください。着いたら、ホームの「QR コードを読み取る」を押して、入口の QR コードを読み取ってください。",
  },
];

const notes = (maxPhotos: number) => [
  "撮った写真は、展示に出しません。",
  `撮影は${maxPhotos}枚までです。`,
  `撮影のリマインダーは任意です。オンにすると、${REMINDER_PLAN.intervalMinutes}分ごとに届きます。`,
  "撮りたいものがないときは、リマインダーをスキップして構いません。",
];

/** The loop in one line of three pictures, for the title screen. */
export function HowToStrip() {
  return (
    <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-1 text-center" aria-label="参加の流れ">
      {STEPS.map((step, index) => (
        <Fragment key={step.title}>
          {index > 0 && <li aria-hidden="true" className="px-pixel pt-4 text-[10px] text-(--px-ink-2)">&#9654;</li>}
          <li className="flex flex-col items-center gap-1.5">
            <span className="grid size-12 place-items-center border-3 border-(--px-k) bg-(--px-navy-2) text-(--px-yellow)">
              <PixelIcon name={step.icon} size={24} />
            </span>
            <span className="text-[14px] leading-snug">
              <Phrases text={step.short} />
            </span>
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
            <span className="block text-[15px] leading-relaxed text-(--px-ink-2)">
              <Sentences text={step.text} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The instructions, reopened from the menu, with the details people ask about. */
export function HowToDialog({ open, maxPhotos, onClose }: { open: boolean; maxPhotos: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLParagraphElement>(null);
  const scroll = useScrollHint<HTMLDivElement>();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // The title takes the focus, so the button at the foot does not open already ringed.
      title.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="howto-title" className="px-dialog">
      <Window className="mt-4">
        <p id="howto-title" ref={title} tabIndex={-1} className="px-window__title outline-none">
          遊び方
        </p>
        {/* The text scrolls; the button to close stays in view below it. */}
        <div className="flex max-h-[min(86dvh,700px)] flex-col">
          <div ref={scroll} className="px-scroll min-h-0 flex-1 space-y-5 overflow-y-auto pt-2 pr-1 pb-4">
            <HowToSteps />
            <ul className="space-y-1.5 border-t-3 border-(--px-navy-3) pt-4 text-[15px] text-(--px-ink-2)">
              {notes(maxPhotos).map((note) => (
                <li key={note} className="ml-4 list-['-_']">
                  <Sentences text={note} />
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t-3 border-(--px-navy-3) pt-3">
            <PxButton variant="secondary" block onClick={onClose}>閉じる</PxButton>
          </div>
        </div>
      </Window>
    </dialog>
  );
}
