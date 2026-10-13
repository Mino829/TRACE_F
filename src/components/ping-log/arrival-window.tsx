"use client";

import { PxButton, Sentences, Window } from "./ui";

/**
 * The way into ShibaLab, at the foot of home. People come whenever they like,
 * so it waits there quietly rather than calling them; at the door they read
 * the entrance's QR code with this button.
 */
export function ArrivalWindow({ onScan }: { onScan: () => void }) {
  return (
    <Window title="ShibaLab" as="section">
      <p className="text-[15px] leading-relaxed">
        <Sentences text={"ShibaLab（教室棟301）には、好きなときに来てください。着いたら、入口の QR コードを読み取ってください。"} />
      </p>
      <div className="mt-3">
        <PxButton variant="secondary" block icon="qr" onClick={onScan}>
          QR&nbsp;コードを読み取る
        </PxButton>
      </div>
    </Window>
  );
}
