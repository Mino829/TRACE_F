"use client";

/* eslint-disable @next/next/no-img-element -- the keepsake is a local blob: URL */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { LONG_PRESS, saveImage } from "@/lib/ping-log/save-image";
import type { LogEntry } from "@/lib/ping-log/store";
import { drawKeepsake, imageName } from "@/lib/ray/keepsake";

import { clock } from "../ui";
import { Print } from "./prints";
import { Icon, NoteBar, Phrases, ROOM, Screen, Sentences, TitleMark, useField, useRay } from "./stage";

/**
 * The keepsake (作品, #14), after the replay: the photos taken before
 * arriving, drawn as one picture (lib/ray/keepsake.ts) that the participant
 * saves to the phone. It is the one thing they take home. Each photo can be
 * saved on its own too, or deleted (#51), which draws the keepsake again.
 * Nothing leaves the phone but through the share sheet or a download the
 * participant starts.
 */

/** 11月1日 18:00 */
function dayTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(iso)}`;
}

function photoFile(entry: LogEntry): File | null {
  return entry.photo ? new File([entry.photo], imageName(entry.record.takenAt, true), { type: entry.photo.type || "image/jpeg" }) : null;
}

/** Saves one photo as the phone keeps it: shrunk, and without the camera's metadata. */
export function SavePhoto({ entry, number }: { entry: LogEntry; number: number }) {
  const { toast } = useRay();
  const file = useMemo(() => photoFile(entry), [entry]);
  if (!file) return null;
  return (
    <button
      type="button"
      className="link save-photo"
      aria-label={`${number}枚目の写真を保存`}
      onClick={() =>
        void saveImage(file).then((result) => {
          if (result === "unsupported") toast("画像を長押しして、保存してください。");
        })
      }
    >
      <Icon name="download" />
      保存
    </button>
  );
}

/** Under a photo: save it to the phone, or delete it after a question (#51). */
export function PhotoActions({ entry, number, onDelete }: { entry: LogEntry; number: number; onDelete: (entry: LogEntry, number: number) => void }) {
  return (
    <div className="print-actions">
      <SavePhoto entry={entry} number={number} />
      <button type="button" className="link print-actions__del" aria-label={`${number}枚目の写真を削除`} onClick={() => onDelete(entry, number)}>
        削除
      </button>
    </div>
  );
}

/** Where to ask about the data, as TRACE_B gives it: a web page or an address opens as a link. */
function Contact({ value }: { value: string }) {
  if (/^https?:\/\//.test(value)) {
    return (
      <a className="latin" href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }
  if (/^[^\s@]+@[^\s@]+$/.test(value)) {
    return (
      <a className="latin" href={`mailto:${value}`}>
        {value}
      </a>
    );
  }
  return <>{value}</>;
}

export function KeepsakeScreen({
  photos,
  deleteAfter,
  contact,
  inert,
  onDelete,
  onTrace,
  onLeave,
  onTitle,
}: {
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  deleteAfter: string;
  /** Where to ask about the data (TRACE_B's public config); empty when it gives none. */
  contact: string;
  inert: boolean;
  onDelete: (entry: LogEntry, number: number) => void;
  /** Opens 振り返り3D (#50). */
  onTrace: () => void;
  onLeave: () => void;
  onTitle: () => void;
}) {
  useField("room", ROOM);
  const artRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const traceId = useId();
  const kept = useMemo(() => photos.filter((entry) => entry.photo), [photos]);
  const [art, setArt] = useState<{ file: File; url: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [byHand, setByHand] = useState(false);

  // Drawn once the screen is up, so the file is ready when the button is tapped: the share sheet needs that tap.
  useEffect(() => {
    const root = artRef.current;
    if (!root || !kept.length) return;
    let alive = true;
    let url = "";
    drawKeepsake(
      kept.map((entry, index) => ({ blob: entry.photo as Blob, takenAt: entry.record.takenAt, number: index + 1 })),
      root,
    ).then(
      (blob) => {
        if (!alive) return;
        const file = new File([blob], imageName(kept[0].record.takenAt), { type: "image/jpeg" });
        url = URL.createObjectURL(file);
        setArt({ file, url });
      },
      (error: unknown) => {
        if (alive) setProblem(error instanceof Error ? error.message : "作品を作れませんでした。");
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [kept]);

  const save = async () => {
    if (!art) return;
    setByHand((await saveImage(art.file)) === "unsupported");
  };

  return (
    <Screen className="keep" inert={inert}>
      <header className="mast">
        <div className="mast__mark">
          <TitleMark onTitle={onTitle} />
          <span className="mono">
            <span className="keep-case">ShibaLab</span> 301
          </span>
        </div>
        <button type="button" className="icon-btn" aria-label="ホームへもどる" onClick={onLeave}>
          <Icon name="close" />
        </button>
      </header>
      <p className="mono">Keepsake</p>
      <h1 className="h1">
        <Phrases text="あなたの作品" />
      </h1>
      {kept.length ? (
        <p className="body">
          <Sentences text={"撮った写真を、\n撮った順に一枚にまとめました。写真の一番明るいところを、\n光の線でつないでいます。"} />
        </p>
      ) : (
        <p className="body">
          <Sentences text={"この端末には写真が残っていないので、\n作品を作れません。写真を撮ったブラウザで開くと、\n作品を保存できます。"} />
        </p>
      )}
      {kept.length > 0 && (
        <>
          <div ref={artRef} className="keep__art">
            {art ? (
              <img className="keep__img" src={art.url} alt={`作品。撮った${kept.length}枚の写真を撮った順に並べ、光の線でつないだ画像`} />
            ) : (
              !problem && (
                <p className="keep__wait mono mono--dim" role="status">
                  Developing
                </p>
              )
            )}
          </div>
          <NoteBar text={problem} alert />
          <button type="button" className="btn keep__save" disabled={!art} onClick={() => void save()}>
            <Icon name="download" />
            作品を保存する
          </button>
          {byHand && <NoteBar text={LONG_PRESS} />}
          <p className="small keep__note">
            <Sentences text={`TRACE の中の写真は、\n${dayTime(deleteAfter)}を過ぎると削除されます。作品や写真を保存しても、\nこの日時は延びません。`} />
          </p>
          {contact && (
            <p className="small keep__note">
              問い合わせ先: <Contact value={contact} />
            </p>
          )}

          <section className="keep__trace" aria-labelledby={traceId}>
            <p className="mono">Trace</p>
            <h2 className="h3" id={traceId}>
              あなたの軌跡
            </h2>
            <p className="body">
              <Sentences text={"写真を撮った場所を、\n撮った順に 3D の地図でたどれます。"} />
            </p>
            <button type="button" className="btn btn--line" onClick={onTrace}>
              <Icon name="arrow" />
              軌跡を見る
            </button>
          </section>

          <section className="keep__photos" aria-labelledby={labelId}>
            <h2 className="h3" id={labelId}>
              撮った写真
            </h2>
            <ul>
              {kept.map((entry, index) => {
                const meta = entry.record.photo;
                return (
                  <li key={entry.id}>
                    <Print
                      source={{ blob: entry.photo as Blob }}
                      number={index + 1}
                      time={clock(entry.record.takenAt)}
                      ratio={meta && meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 3 / 4}
                    />
                    <PhotoActions entry={entry} number={index + 1} onDelete={onDelete} />
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
      <button type="button" className="btn btn--line keep__home" onClick={onLeave}>
        ホームへもどる
      </button>
    </Screen>
  );
}
