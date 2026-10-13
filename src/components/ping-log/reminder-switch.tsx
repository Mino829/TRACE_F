"use client";

import { useId, useState } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";
import { REMINDER_PLAN } from "@/lib/ping-log/push";

import { InstallGuide } from "./install-guide";
import { PixelIcon } from "./pixel-icon";
import { InfoButton, InfoNote, Sentences, Window, clock, useInfo } from "./ui";

type Props = {
  on: boolean;
  support: PushSupport;
  busy: boolean;
  /** While it is on: when the next reminder comes, or null past the day's last one. */
  nextAt: number | null;
  /** Resolves to an error message, or null once it is switched. */
  onChange: (on: boolean) => Promise<string | null>;
};

/**
 * The optional photo reminder as one switch. Turning it on asks for the
 * notification permission inside the tap, which iOS requires. Where this
 * browser cannot receive notifications, the tap opens the way to one that can.
 */
export function ReminderSwitch({ on, support, busy, nextAt, onChange }: Props) {
  const info = useInfo();
  const labelId = useId();
  const [problem, setProblem] = useState("");
  const [guide, setGuide] = useState(false);
  const blocked = support !== "supported";

  const toggle = async () => {
    if (!on && blocked) {
      setGuide((value) => !value);
      return;
    }
    setProblem("");
    setProblem((await onChange(!on)) ?? "");
  };

  return (
    <Window as="section" aria-labelledby={labelId}>
      <div className="flex items-center gap-3">
        <PixelIcon name="bell" size={22} className="shrink-0 text-(--px-yellow)" />
        <p className="min-w-0 flex-1 text-[17px]">
          <span id={labelId}>リマインダー</span>
          <InfoButton info={info} label="リマインダーについて" />
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          className="px-switch"
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span className="px-switch__track" aria-hidden="true">
            <span className="px-switch__text">{on ? "ON" : "OFF"}</span>
            <i className="px-switch__knob" />
          </span>
        </button>
      </div>
      <InfoNote info={info}>
        <Sentences
          text={`オンにすると、${REMINDER_PLAN.intervalMinutes}分ごとに撮影のリマインダーが届きます。リマインダーは、オンにした日の24時に止まります。${on && nextAt !== null ? `次は ${clock(nextAt)} ごろです。` : ""}`}
        />
      </InfoNote>
      {problem && (
        <p className="px-note mt-3" data-tone="warn" role="alert">
          <Sentences text={problem} />
        </p>
      )}
      {guide && blocked && (
        <div className="mt-3">
          <InstallGuide support={support} />
        </div>
      )}
    </Window>
  );
}
