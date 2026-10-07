"use client";

/* eslint-disable @next/next/no-img-element -- the preview is a local blob: URL */

import { useEffect, useMemo, useRef, useState } from "react";

import { localToCampusPx, wgs84ToLocal, type CampusPx } from "@/lib/geo/campus-georeference";
import { campusLevels } from "@/lib/map/buildings";
import { geolocationMessage, startCapture, type CaptureHandle } from "@/lib/ping-log/capture";
import type { Consent } from "@/lib/ping-log/consent";
import { deviceContext, networkInfo, watchOrientation, type NetworkInfo, type OrientationSample } from "@/lib/ping-log/context";
import { preparePhoto } from "@/lib/ping-log/photo";
import { deviceId } from "@/lib/ping-log/push";
import {
  COORDINATE_VERSION,
  RECORD_SCHEMA,
  SOURCE_LABEL,
  TRUTH_CONFIDENCE,
  buildTruth,
  guessSource,
  nearCampus,
  type Capture,
  type Fix,
  type PhotoMeta,
  type TruthConfidence,
} from "@/lib/ping-log/record";
import type { LogEntry } from "@/lib/ping-log/store";

import { CampusPlan } from "./campus-plan";
import { PRIMARY, SECONDARY, choice, clock } from "./ui";

const WIFI_KEY = "trace-wifi";

function loadWifi(): "on" | "off" | null {
  try {
    const value = window.localStorage.getItem(WIFI_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

function saveWifi(value: "on" | "off"): void {
  try {
    window.localStorage.setItem(WIFI_KEY, value);
  } catch {
    // Private mode: asked again next time.
  }
}

function metres(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}m`;
}

type Props = {
  kind: "ping" | "manual";
  promptedAt: string | null;
  consent: Consent;
  /** Shows the raw fixes and the phone's own position on the plan. */
  developer: boolean;
  /** Developer override: record even when the phone is away from campus. */
  allowOutside: boolean;
  /** Start measuring without waiting for a tap (the person already asked, or already allowed location). */
  autoStart: boolean;
  onSave: (entry: LogEntry) => Promise<void>;
  onClose: () => void;
};

export function RecordCard({ kind, promptedAt, consent, developer, allowOutside, autoStart, onSave, onClose }: Props) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [level, setLevel] = useState<number | null>(null);
  const [mark, setMark] = useState<{ px: CampusPx; at: number } | null>(null);
  const [confidence, setConfidence] = useState<TruthConfidence | null>(null);
  const [wifi, setWifi] = useState<"on" | "off" | null>(loadWifi);
  const [photo, setPhoto] = useState<{ blob: Blob; meta: PhotoMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handle = useRef<CaptureHandle | null>(null);
  const stopOrientation = useRef<(() => OrientationSample | null) | null>(null);
  const networkAtStart = useRef<NetworkInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => {
    if (handle.current) return;
    networkAtStart.current = networkInfo();
    stopOrientation.current = watchOrientation();
    handle.current = startCapture(setCapture);
  };

  useEffect(() => {
    let cancelled = false;
    if (autoStart) {
      // Through a promise so the measuring starts after this render, not inside it.
      Promise.resolve().then(() => {
        if (!cancelled) start();
      });
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      handle.current?.stop();
      stopOrientation.current?.();
    };
    // Runs once: the capture belongs to this card for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo.blob) : null), [photo]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const latest: Fix | null = capture?.fixes.at(-1) ?? capture?.coarse ?? null;
  const inside = latest ? nearCampus(latest) : null;
  const denied = capture?.errors.some((item) => item.code === 1) ?? false;
  const lastError = capture?.errors.at(-1) ?? null;
  const recordable = latest !== null && (inside === true || allowOutside);
  const me = latest ? localToCampusPx(wgs84ToLocal({ lat: latest.latitude, lon: latest.longitude })) : null;
  const truthReady = mark !== null && level !== null && confidence !== null;
  const elapsed = capture ? Math.max(0, Math.round((now - capture.startedAt) / 1000)) : 0;

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setPhoto(await preparePhoto(file));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "写真を読み込めませんでした。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const send = async (withTruth: boolean) => {
    if (!handle.current || !latest) return;
    setBusy(true);
    setError("");
    try {
      const final = handle.current.stop();
      const orientation = stopOrientation.current?.() ?? null;
      const id = crypto.randomUUID();
      const last = final.fixes.at(-1) ?? final.coarse;
      const entry: LogEntry = {
        id,
        photo: photo?.blob ?? null,
        sentAt: null,
        record: {
          schema: RECORD_SCHEMA,
          id,
          kind,
          deviceId: deviceId(),
          consentVersion: consent.version,
          consentedAt: consent.at,
          promptedAt,
          takenAt: new Date().toISOString(),
          capture: final,
          sourceGuess: last ? guessSource(last) : null,
          coordinateVersion: COORDINATE_VERSION,
          insideCampus: last ? nearCampus(last) : false,
          forcedOutside: last ? !nearCampus(last) : false,
          truth: withTruth && truthReady ? buildTruth(mark.px, level, confidence, mark.at) : null,
          truthSkipped: !withTruth,
          selfReport: { wifi },
          device: await deviceContext(),
          network: networkAtStart.current,
          networkAtSend: networkInfo(),
          orientation,
          photo: photo?.meta ?? null,
        },
      };
      await onSave(entry);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "記録できませんでした。");
      setBusy(false);
    }
  };

  const chooseWifi = (value: "on" | "off") => {
    saveWifi(value);
    setWifi(value);
  };

  return (
    <section className="space-y-4 rounded-lg border-2 border-foreground p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{kind === "ping" ? "記録の時間です" : "いまの場所を記録します"}</p>
          {promptedAt && <p className="text-sm text-neutral-500">{clock(promptedAt)} の通知</p>}
        </div>
        <button type="button" className="text-sm text-neutral-500 underline" onClick={onClose} disabled={busy}>
          {kind === "ping" ? "今回はスキップ" : "やめる"}
        </button>
      </div>

      {!capture ? (
        <button type="button" className={`${PRIMARY} w-full`} onClick={start}>記録をはじめる</button>
      ) : !latest ? (
        <div className="space-y-1 text-sm">
          {denied ? (
            <p>{geolocationMessage(1)}</p>
          ) : (
            <>
              <p>位置を測っています（{elapsed}秒）</p>
              {lastError && <p className="text-neutral-500">{geolocationMessage(lastError.code)}</p>}
            </>
          )}
        </div>
      ) : !recordable ? (
        <div className="space-y-3 text-sm">
          <p>豊洲キャンパスから離れた場所にいるため、今回は記録しません。</p>
          <p className="text-neutral-500">キャンパスの外の位置情報は送らない決まりです。キャンパス内で、もう一度開いてください。</p>
          <button type="button" className={SECONDARY} onClick={onClose}>閉じる</button>
        </div>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            スマホの位置を測りながら、いまいる場所を地図で教えてください。測った回数 {capture.fixes.length}回、誤差の目安 約{metres(latest.accuracy)}
          </p>

          <div className="space-y-2">
            <p className="text-sm font-bold">いまいる階</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {campusLevels.map((item) => (
                <button key={item.level} type="button" className={`${choice(level === item.level)} shrink-0`} onClick={() => setLevel(item.level)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500">屋外の地面にいるときは 1F を選んでください。</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-bold">いまいる場所</p>
            <CampusPlan
              level={level ?? 1}
              mark={mark?.px ?? null}
              onMarkChange={(px) => setMark({ px, at: Date.now() })}
              me={developer ? me : null}
              meAccuracyMetres={developer ? latest.accuracy : null}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-bold">指した場所の確かさ</p>
            <div className="grid gap-1.5">
              {(Object.keys(TRUTH_CONFIDENCE) as TruthConfidence[]).map((key) => (
                <button key={key} type="button" className={`${choice(confidence === key)} text-left`} onClick={() => setConfidence(key)}>
                  {TRUTH_CONFIDENCE[key].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold">この端末の Wi-Fi</span>
            <button type="button" className={choice(wifi === "on")} onClick={() => chooseWifi("on")}>オン</button>
            <button type="button" className={choice(wifi === "off")} onClick={() => chooseWifi("off")}>オフ</button>
          </div>

          <div className="space-y-2">
            {photo && preview ? (
              <div className="flex items-center gap-3">
                <img src={preview} alt="" className="size-16 rounded object-cover" />
                <button type="button" className="text-sm text-neutral-500 underline" onClick={() => setPhoto(null)} disabled={busy}>写真を外す</button>
              </div>
            ) : (
              <button type="button" className={SECONDARY} onClick={() => inputRef.current?.click()} disabled={busy}>写真を添える（任意）</button>
            )}
            <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void onPhoto(event.target.files?.[0])} />
          </div>

          {developer && <FixDetails capture={capture} latest={latest} inside={inside} elapsed={elapsed} />}

          <div className="grid gap-2">
            <button type="button" className={PRIMARY} onClick={() => void send(true)} disabled={busy || !truthReady}>
              {busy ? "送信しています…" : "送信する"}
            </button>
            {!truthReady && <p className="text-xs text-neutral-500">階、場所、確かさを選ぶと送信できます。</p>}
            <button type="button" className={SECONDARY} onClick={() => void send(false)} disabled={busy}>
              いまいる場所がわからない（測った位置だけ送る）
            </button>
          </div>
        </>
      )}

      {error && <p className="text-sm" role="alert">{error}</p>}
    </section>
  );
}

/** The raw readings, for checking on site what the phone is doing. */
function FixDetails({ capture, latest, inside, elapsed }: { capture: Capture; latest: Fix; inside: boolean | null; elapsed: number }) {
  const rows: [string, string][] = [
    ["測位", `${capture.fixes.length}回（${elapsed}秒）`],
    ["最新", `${latest.latitude.toFixed(6)}, ${latest.longitude.toFixed(6)}`],
    ["誤差", `±${latest.accuracy.toFixed(1)}m`],
    ["高度", latest.altitude === null ? "なし" : `${latest.altitude.toFixed(1)}m ±${latest.altitudeAccuracy?.toFixed(1) ?? "?"}m`],
    ["速さ / 向き", `${latest.speed ?? "—"} / ${latest.heading ?? "—"}`],
    ["取得元（推定）", SOURCE_LABEL[guessSource(latest)]],
    ["低精度の測位", capture.coarse ? `±${capture.coarse.accuracy.toFixed(0)}m` : capture.coarseError ?? "待機中"],
    ["キャンパス", inside ? "範囲内" : "範囲外"],
    ["エラー", capture.errors.length ? capture.errors.map((item) => item.code).join(", ") : "なし"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-neutral-500">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
