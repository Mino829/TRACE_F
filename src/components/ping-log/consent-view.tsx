import { CONSENT_LEAD, CONSENT_SECTIONS } from "@/lib/ping-log/consent";

import { PRIMARY, SECONDARY } from "./ui";

type Props = {
  /** Present before consent: the button that gives it. */
  onAgree?: () => void;
  /** Present when reading it again afterwards. */
  onClose?: () => void;
};

export function ConsentView({ onAgree, onClose }: Props) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">参加の前に確認してください</h2>
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
      {onAgree && (
        <div className="space-y-2">
          <button type="button" className={`${PRIMARY} w-full`} onClick={onAgree}>同意して参加する</button>
          <p className="text-xs text-neutral-500">このあと、通知と位置情報の許可を求める画面が出ます。</p>
        </div>
      )}
      {onClose && <button type="button" className={SECONDARY} onClick={onClose}>閉じる</button>}
    </section>
  );
}
