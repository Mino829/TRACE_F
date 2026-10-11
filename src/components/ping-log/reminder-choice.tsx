"use client";

import { REMINDER_INTERVALS, type ReminderInterval } from "@/lib/ping-log/push";

import { PxButton } from "./ui";

/**
 * Turning the photo reminder on, one button per interval. The tap itself asks
 * for notification permission, which iOS only allows from a tap.
 */
export function ReminderChoice({ busy, onChoose }: { busy: boolean; onChoose: (interval: ReminderInterval) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1" role="group" aria-label="リマインダーの間隔">
      {REMINDER_INTERVALS.map((interval) => (
        <PxButton key={interval} block variant="secondary" icon="bell" onClick={() => onChoose(interval)} disabled={busy}>
          {interval}分ごと
        </PxButton>
      ))}
    </div>
  );
}
