"use client";

/* eslint-disable @next/next/no-img-element -- the keepsake is a local blob: URL */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { lang, t } from "@/lib/i18n";
import { contactInEnglish } from "@/lib/ping-log/consent";
import { longPress, saveImage } from "@/lib/ping-log/save-image";
import type { LogEntry } from "@/lib/ping-log/store";
import { drawKeepsake, imageName } from "@/lib/ray/keepsake";

import { clock } from "../ui";
import { Print } from "./prints";
import { Icon, NoteBar, Phrases, ROOM, Screen, Sentences, TitleMark, useField, useRay } from "./stage";
import { TraceSection } from "./trace";

/**
 * The keepsake (作品, #14), after the replay: first the way the photos were
 * taken (振り返り3D, #50, trace.tsx), then the photos taken before arriving,
 * drawn as one picture (lib/ray/keepsake.ts) that the participant saves to
 * the phone. It is the one thing they take home. Each photo can be saved on
 * its own too, or deleted (#51), which draws the keepsake and the way again.
 * Nothing leaves the phone but through the share sheet or a download the
 * participant starts.
 */

/** 11月1日, or Nov 1 */
function day(iso: string): string {
  const date = new Date(iso);
  return lang() === "en" ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `${date.getMonth() + 1}月${date.getDate()}日`;
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
      aria-label={t(`${number}枚目の写真を保存`, `Save photo ${number}`)}
      onClick={() =>
        void saveImage(file).then((result) => {
          if (result === "unsupported") toast(t("画像を長押しして、保存してください。", "Press and hold the image to save it."));
        })
      }
    >
      <Icon name="download" />
      {t("保存", "Save")}
    </button>
  );
}

/** Under a photo: save it to the phone, or delete it after a question (#51). */
export function PhotoActions({ entry, number, onDelete }: { entry: LogEntry; number: number; onDelete: (entry: LogEntry, number: number) => void }) {
  return (
    <div className="print-actions">
      <SavePhoto entry={entry} number={number} />
      <button type="button" className="link print-actions__del" aria-label={t(`${number}枚目の写真を削除`, `Delete photo ${number}`)} onClick={() => onDelete(entry, number)}>
        {t("削除", "Delete")}
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
  onLeave: () => void;
  onTitle: () => void;
}) {
  useField("room", ROOM);
  const artRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const workId = useId();
  // Drawn again in the other language when it is switched.
  const language = lang();
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
      kept.map((entry, index) => ({ blob: entry.photo as Blob, takenAt: entry.record.takenAt, number: index + 1, place: entry.record.place ?? null })),
      root,
    ).then(
      (blob) => {
        if (!alive) return;
        const file = new File([blob], imageName(kept[0].record.takenAt), { type: "image/jpeg" });
        url = URL.createObjectURL(file);
        setArt({ file, url });
      },
      (error: unknown) => {
        if (alive) setProblem(error instanceof Error ? error.message : t("作品を作れませんでした。", "Could not make your artwork."));
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [kept, language]);

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
        <button type="button" className="icon-btn" aria-label={t("ホームへもどる", "Back to home")} onClick={onLeave}>
          <Icon name="close" />
        </button>
      </header>
      <h1 className="h1">
        <Phrases text={t("ご来場ありがとうございました", "Thank you for coming")} />
      </h1>
      {!kept.length && (
        <p className="body">
          <Sentences text={t("この端末には写真が残っていないので、作品を作れません。写真を撮ったブラウザで開くと、作品を保存できます。", "There are no photos left on this phone, so your artwork cannot be made. Open this page in the browser you took the photos with to save it.")} />
        </p>
      )}
      {kept.length > 0 && (
        <>
          {/* Mounted anew when a photo is deleted: a new canvas, and no chosen photo standing for another. */}
          <TraceSection key={kept.map((entry) => entry.id).join()} photos={kept} />

          <section className="keep__work" aria-labelledby={workId}>
            <p className="mono">Keepsake</p>
            <p className="body" id={workId}>
              {t("あなたの写真を一枚にまとめました。", "Your photos, put together as one picture.")}
            </p>
            <div ref={artRef} className="keep__art">
              {art ? (
                <img className="keep__img" src={art.url} alt={t(`作品。撮った${kept.length}枚の写真を、撮った順に一枚にまとめた画像`, `Your artwork: the ${kept.length} photos you took, put together in order as one picture`)} />
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
              {t("作品を保存する", "Save your artwork")}
            </button>
            {byHand && <NoteBar text={longPress()} />}
            <p className="small keep__note">
              <Sentences text={t(`この作品で収集された写真は、${day(deleteAfter)}以降にこのアプリを開いたとき、ブラウザ上から消去されます。アプリを閉じている間の自動消去は保証できません。保存した作品・写真は消えません。`, `The photos collected for this artwork are erased from the browser when you open this app on or after ${day(deleteAfter)}. They are not guaranteed to be erased while the app is closed. The artwork and photos you have saved stay.`)} />
            </p>
            {contact && (
              <p className="small keep__note">
                {t("問い合わせ先: ", "Contact: ")}<Contact value={lang() === "en" ? contactInEnglish(contact) : contact} />
              </p>
            )}
          </section>

          <section className="keep__photos" aria-labelledby={labelId}>
            <h2 className="h3" id={labelId}>
              {t("撮った写真", "Your photos")}
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
        {t("ホームへもどる", "Back to home")}
      </button>
    </Screen>
  );
}
