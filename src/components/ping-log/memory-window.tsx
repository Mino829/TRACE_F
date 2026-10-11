"use client";

import type { ReactNode } from "react";

import { PixelIcon } from "./pixel-icon";
import { PixelSprite } from "./pixel-sprite";
import { InfoButton, InfoNote, PxButton, Sentences, Window, useInfo } from "./ui";

/**
 * きょうのメモリー: the day's photos, large, with a coin for each. The home
 * screen fills it from the phone's own photos and the arrival demo from its
 * drawings, so both show the same window.
 */

/** One photo in the strip: its picture (a phone photo or a demo drawing), its time, and its width over its height. */
export type MemoryPhoto = { id: string; time: string; ratio: number; image: ReactNode; unsent: boolean };

type Props = {
  /** Today's photos, newest first. */
  photos: MemoryPhoto[];
  max: number;
  busy?: boolean;
  /** Sends the photos still waiting; without it the unsent row is left out. */
  onResend?: () => void;
};

export function MemoryWindow({ photos, max, busy = false, onResend }: Props) {
  const info = useInfo();
  const unsent = photos.filter((photo) => photo.unsent).length;

  return (
    <Window
      as="section"
      aria-label="きょうのメモリー"
      title={
        <>
          きょうのメモリー
          <InfoButton info={info} label="きょうのメモリーについて" />
        </>
      }
    >
      <InfoNote info={info}>
        <Sentences text={`写真を撮ることで、コインを入手することができます。電波の良い場所で送信してください。撮影は${max}枚までです。`} />
      </InfoNote>

      {photos.length === 0 ? (
        <div className="px-strip-empty">
          <PixelIcon name="camera" size={36} />
          <p className="text-[15px]">
            <Sentences text="残したい瞬間を見つけたら、「写真を撮る」を押してください。" />
          </p>
        </div>
      ) : (
        // Focusable, so the arrow keys can scroll it too.
        <ul className="px-strip" aria-label="きょうの写真（新しい順）" tabIndex={0}>
          {photos.map((photo) => (
            <li key={photo.id} style={{ ["--ratio" as string]: photo.ratio }}>
              <figure className="px-polaroid">
                {photo.image}
                <figcaption className="px-polaroid__caption">{photo.time}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex items-center justify-between gap-3 border-t-3 border-(--px-navy-3) pt-3">
        <div className="px-coins min-w-0" role="img" aria-label={unsent ? `コイン${photos.length}枚。うち${unsent}枚は未送信` : `コイン${photos.length}枚`}>
          {/* Oldest first, so the faded coins of photos still waiting come last. */}
          {[...photos].reverse().map((photo) => (
            <PixelSprite key={photo.id} name="coin" scale={2} className={photo.unsent ? "is-unsent" : undefined} />
          ))}
        </div>
        <p className="shrink-0 text-[15px] text-(--px-yellow)" aria-label={`${max}枚のうち${photos.length}枚`}>
          <span className="px-pixel mr-1 text-[13px]">
            {photos.length} / {max}
          </span>
          枚
        </p>
      </div>

      {unsent > 0 && onResend && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] text-(--px-ink-2)">未送信の写真 {unsent}枚</p>
          <PxButton variant="secondary" size="sm" onClick={onResend} disabled={busy}>
            いま送る
          </PxButton>
        </div>
      )}
    </Window>
  );
}
