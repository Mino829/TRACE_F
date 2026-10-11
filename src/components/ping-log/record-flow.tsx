"use client";

/* eslint-disable @next/next/no-img-element -- the preview is a local blob: URL */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { localToCampusPx, wgs84ToLocal, type CampusPx, type Wgs84 } from "@/lib/geo/campus-georeference";
import { buildingById, levelLabel } from "@/lib/map/buildings";
import { geolocationMessage, startCapture, type CaptureHandle } from "@/lib/ping-log/capture";
import { DEVELOPER_CONSENT_VERSION } from "@/lib/ping-log/consent";
import { deviceContext, networkInfo, watchOrientation, type NetworkInfo, type OrientationSample } from "@/lib/ping-log/context";
import { preparePhoto } from "@/lib/ping-log/photo";
import { deviceId } from "@/lib/ping-log/push";
import {
  COORDINATE_VERSION,
  RECORD_SCHEMA,
  SOURCE_LABEL,
  campusTruth,
  guessSource,
  mapTruth,
  nearCampus,
  type Capture,
  type Fix,
  type MapLayer,
  type PhotoMeta,
} from "@/lib/ping-log/record";
import type { LogEntry, SaveOutcome } from "@/lib/ping-log/store";

import { CampusPlan } from "./campus-plan";
import { ClearTitle, CoinGain, Confetti } from "./clear-screen";
import { PixelIcon } from "./pixel-icon";
import { PxButton, PxLink, Window, clock } from "./ui";
import { WorldMap } from "./world-map";

/**
 * The developer screen's accuracy test, full screen, one decision per step:
 * the floor, then the spot on the map, then a look before sending. The phone
 * measures its own position the whole time, so the steps cost no waiting, and
 * shows it on the map and in the raw readings. Visitors never see this; it
 * needs no participant's consent.
 */

type Step = "floor" | "place" | "review" | "done";
type Where = "plan" | "map";

const STEPS: { key: Exclude<Step, "done">; label: string; question: string }[] = [
  { key: "floor", label: "階", question: "いまいる階は？" },
  { key: "place", label: "場所", question: "いまいる場所は？" },
  { key: "review", label: "送信", question: "この内容で送ります" },
];
/** The lift panel, top row first: 2F to 20F in fives, the low floors nearest the thumb. */
const LIFT_ROWS = [[17, 18, 19, 20], [12, 13, 14, 15, 16], [7, 8, 9, 10, 11], [2, 3, 4, 5, 6]];
const BASEMENT_FLOORS = [0, -1];
const WIFI_KEY = "trace-wifi";
/** Lets the lit button and the display show the choice before the next step slides in. */
const ADVANCE_MS = 320;
const RECORD_HASH = "#record";

function loadWifi(): "on" | "off" | null {
  try {
    const value = window.localStorage.getItem(WIFI_KEY);
    return value === "on" || value === "off" ? value : null;
  } catch {
    return null;
  }
}

type Props = {
  kind: "ping" | "manual";
  promptedAt: string | null;
  /** While the accuracy ping is on. */
  subscribed: boolean;
  nextPingAt: number | null;
  /** Records made today before this one, for the count on the clear screen. */
  todayCount: number;
  onSave: (entry: LogEntry) => Promise<SaveOutcome>;
  onClose: () => void;
};

export function RecordFlow({ kind, promptedAt, subscribed, nextPingAt, todayCount, onSave, onClose }: Props) {
  const [step, setStep] = useState<Step>("floor");
  const [intro, setIntro] = useState(kind === "ping");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [level, setLevel] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Where | null>(null);
  const [mark, setMark] = useState<{ px: CampusPx; at: number; viewScale: number } | null>(null);
  const [pin, setPin] = useState<{ point: Wgs84; at: number; zoom: number; layer: MapLayer } | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [wifi, setWifi] = useState<"on" | "off" | null>(loadWifi);
  const [photo, setPhoto] = useState<{ blob: Blob; meta: PhotoMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const handle = useRef<CaptureHandle | null>(null);
  const stopOrientation = useRef<(() => OrientationSample | null) | null>(null);
  const networkAtStart = useRef<NetworkInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const floorScroll = useRef<HTMLDivElement>(null);
  const advance = useRef<number | undefined>(undefined);
  const stepRef = useRef<Step>(step);
  const onCloseRef = useRef(onClose);
  const closing = useRef(false);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Measure from the moment the screen opens; lock the page behind it.
  useEffect(() => {
    networkAtStart.current = networkInfo();
    stopOrientation.current = watchOrientation();
    handle.current = startCapture(setCapture);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(advance.current);
      handle.current?.stop();
      stopOrientation.current?.();
      document.body.style.overflow = overflow;
    };
  }, []);

  // The phone's back button steps back through the flow, and leaves it from the first step.
  useEffect(() => {
    // Drop the notification's ?prompt= from the entry underneath, so going back does not reopen an answered ping.
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (window.location.hash !== RECORD_HASH) window.history.pushState(null, "", RECORD_HASH);
    const onPop = () => {
      if (closing.current) return;
      const current = stepRef.current;
      if (current === "place" || current === "review") {
        setStep(current === "review" ? "place" : "floor");
        window.history.pushState(null, "", RECORD_HASH);
      } else {
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // On a short screen the panel scrolls; start at its foot, where 1F and the low floors are.
  useEffect(() => {
    if (step === "floor" && floorScroll.current) floorScroll.current.scrollTop = floorScroll.current.scrollHeight;
  }, [step]);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo.blob) : null), [photo]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const latest: Fix | null = capture?.fixes.at(-1) ?? capture?.coarse ?? null;
  // Decided once, from the first fix, so the screen does not swap under the person as fixes come in.
  const first = [capture?.coarse, capture?.fixes[0]].filter((fix): fix is Fix => Boolean(fix)).sort((a, b) => a.receivedAt - b.receivedAt)[0] ?? null;
  const startedNearCampus = first ? nearCampus(first) : false;
  const where: Where = chosen ?? (startedNearCampus ? "plan" : "map");
  const denied = capture?.errors.some((item) => item.code === 1) ?? false;
  const lastError = capture?.errors.at(-1) ?? null;
  const me = latest ? localToCampusPx(wgs84ToLocal({ lat: latest.latitude, lon: latest.longitude })) : null;
  const latestKey = latest?.receivedAt;
  const meOnMap = useMemo(
    () => (latest ? { lat: latest.latitude, lon: latest.longitude, accuracy: latest.accuracy } : null),
    // The fix object is rebuilt on every update; its arrival time identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latestKey],
  );
  const placed = where === "plan" ? mark !== null : pin !== null;
  const elapsed = capture ? Math.max(0, Math.round((now - capture.startedAt) / 1000)) : 0;

  const close = () => {
    closing.current = true;
    if (window.location.hash === RECORD_HASH) window.history.back();
    onClose();
  };

  const chooseFloor = (value: number) => {
    setLevel(value);
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => setStep("place"), ADVANCE_MS);
  };

  const confirmPlace = () => {
    setUnknown(false);
    setStep("review");
  };

  const skipPlace = () => {
    setUnknown(true);
    setStep("review");
  };

  const chooseWifi = (value: "on" | "off") => {
    try {
      window.localStorage.setItem(WIFI_KEY, value);
    } catch {
      // Private mode: asked again next time.
    }
    setWifi(value);
  };

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

  const send = async () => {
    if (!handle.current) return;
    setBusy(true);
    setError("");
    try {
      const final = handle.current.stop();
      const orientation = stopOrientation.current?.() ?? null;
      const id = crypto.randomUUID();
      const takenAt = new Date().toISOString();
      const last = final.fixes.at(-1) ?? final.coarse;
      const truth = unknown || level === null
        ? null
        : where === "plan" && mark
          ? campusTruth(mark.px, level, mark.at, mark.viewScale)
          : where === "map" && pin
            ? mapTruth(pin.point, level, pin.at, pin.zoom, pin.layer)
            : null;
      const entry: LogEntry = {
        id,
        photo: photo?.blob ?? null,
        sentAt: null,
        record: {
          schema: RECORD_SCHEMA,
          purpose: "accuracy",
          id,
          kind,
          tutorial: false,
          deviceId: deviceId(),
          // The team's own test: no participant's consent stands behind it.
          consentVersion: DEVELOPER_CONSENT_VERSION,
          consentedAt: takenAt,
          promptedAt,
          takenAt,
          capture: final,
          sourceGuess: last ? guessSource(last) : null,
          coordinateVersion: COORDINATE_VERSION,
          insideCampus: startedNearCampus,
          reportedLevel: level,
          truth,
          truthSkipped: unknown,
          selfReport: { wifi },
          device: await deviceContext(),
          network: networkAtStart.current,
          networkAtSend: networkInfo(),
          orientation,
          photo: photo?.meta ?? null,
        },
      };
      setOutcome(await onSave(entry));
      setStep("done");
      navigator.vibrate?.(40);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "記録できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const marked = mark && level !== null && where === "plan" ? campusTruth(mark.px, level, mark.at, mark.viewScale) : null;
  const markedIn = marked?.method === "campus-plan" ? marked.buildingIds.map((id) => buildingById(id)?.name ?? id) : [];
  const placeSummary = unknown
    ? "わからない"
    : where === "plan" && mark
      ? `図面で指しました（${markedIn.length ? markedIn.join("、") : "建物の外"}）`
      : where === "map" && pin
        ? "地図で指しました"
        : "まだ指していません";
  const current = STEPS.find((item) => item.key === step);

  return (
    <div className="px-stage fixed inset-0 z-40 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="flow-title">
      <header className="flex items-center gap-2 px-2 pt-[max(6px,env(safe-area-inset-top))]">
        <button type="button" onClick={close} className="flex min-h-11 min-w-11 items-center gap-2 px-2 text-[15px] text-(--px-ink-2) focus-visible:outline-3 focus-visible:outline-(--px-focus)">
          <PixelIcon name="cross" size={14} />
          {step === "done" ? "閉じる" : kind === "ping" ? "スキップ" : "やめる"}
        </button>
        <p className="px-label mx-auto">{kind === "ping" ? "Ping" : "Record"}</p>
        <SignalMeter fix={latest} measuring={capture !== null && !denied} denied={denied} />
      </header>

      {current && (
        <div className="space-y-3 px-4 pt-1 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="flow-title" ref={titleRef} tabIndex={-1} className="text-[26px] leading-tight outline-none">
              {current.question}
            </h2>
            {promptedAt && <p className="shrink-0 text-[13px] text-(--px-ink-2)">{clock(promptedAt)} の通知</p>}
          </div>
          <StepBar step={step} />
        </div>
      )}

      {step === "floor" && (
        <div ref={floorScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-3">
          <div className="mt-auto">
            <Window>
              <LiftPanel level={level} onChoose={chooseFloor} />
            </Window>
          </div>
        </div>
      )}

      {step === "place" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-1">
          {denied ? (
            <div className="grid flex-1 place-items-center">
              <Window tone="alert">
                <p className="text-[16px]">位置情報が許可されていないため、記録できません。スマホの設定で、このサイト（またはブラウザ）の位置情報を許可してから、もう一度開いてください。</p>
              </Window>
            </div>
          ) : !latest ? (
            <div className="grid flex-1 place-items-center text-center">
              <Window className="w-full">
                <div className="space-y-3 py-2">
                  <div className="px-loader" aria-hidden="true"><i /><i /><i /></div>
                  <p className="text-[17px]" role="status">位置を測っています（{elapsed}秒）</p>
                  {elapsed >= 15 && <p className="text-[14px] text-(--px-ink-2)">時間がかかっています。屋外や窓の近くだと測りやすくなります。</p>}
                  {lastError && lastError.code !== 1 && <p className="text-[14px] text-(--px-ink-2)">{geolocationMessage(lastError.code)}</p>}
                  <PxLink onClick={skipPlace}>場所がわからないまま進む</PxLink>
                </div>
              </Window>
            </div>
          ) : (
            <>
              {startedNearCampus && (
                <div role="radiogroup" aria-label="指す地図" className="grid grid-cols-2 gap-2">
                  <button type="button" role="radio" aria-checked={where === "plan"} className="px-tile min-h-11! py-1! text-[15px]" onClick={() => setChosen("plan")}>キャンパスの図面</button>
                  <button type="button" role="radio" aria-checked={where === "map"} className="px-tile min-h-11! py-1! text-[15px]" onClick={() => setChosen("map")}>地図・航空写真</button>
                </div>
              )}
              <p className="flex items-center gap-2 text-[15px]" role="status">
                <span className="px-blink text-(--px-yellow)" aria-hidden="true">&#9654;</span>
                {placed ? "合っていれば「ここで決定」。ずれていたら、もう一度タップ" : "地図で、いまいる場所をタップしてください"}
              </p>
              <div className="px-mapframe relative min-h-[240px] flex-1">
                {where === "plan" ? (
                  <CampusPlan
                    className="h-full"
                    level={level ?? 1}
                    mark={mark?.px ?? null}
                    onMarkChange={(px, viewScale) => setMark({ px, at: Date.now(), viewScale })}
                    me={me}
                    meAccuracyMetres={latest.accuracy}
                  />
                ) : (
                  <WorldMap
                    className="h-full"
                    centre={{ lat: latest.latitude, lon: latest.longitude }}
                    pin={pin?.point ?? null}
                    onPin={(point, zoom, layer) => setPin({ point, at: Date.now(), zoom, layer })}
                    me={meOnMap}
                  />
                )}
              </div>
              <PxLink onClick={skipPlace} className="self-start">場所がわからない</PxLink>
            </>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 pt-4 pb-4">
          <Window title="記録の内容">
            <dl className="divide-y-3 divide-(--px-navy-3)">
              <SummaryRow label="階" value={level !== null ? levelLabel(level) : "選んでいません"} onEdit={() => setStep("floor")} />
              <SummaryRow label="場所" value={placeSummary} onEdit={() => setStep("place")} />
            </dl>
          </Window>
          <Window tone="dim" title="写真（なくても送れます）">
            {photo && preview ? (
              <div className="flex items-center gap-3">
                <img src={preview} alt="添える写真" className="size-16 border-3 border-(--px-ink) object-cover" />
                <PxLink onClick={() => setPhoto(null)} disabled={busy}>写真を外す</PxLink>
              </div>
            ) : (
              <PxButton variant="secondary" icon="camera" onClick={() => inputRef.current?.click()} disabled={busy}>写真を撮る</PxButton>
            )}
          </Window>
          <Window tone="dim" title="この端末の Wi-Fi">
            <div role="radiogroup" aria-label="この端末の Wi-Fi" className="grid grid-cols-2 gap-2">
              <button type="button" role="radio" aria-checked={wifi === "on"} className="px-tile" onClick={() => chooseWifi("on")}>オン</button>
              <button type="button" role="radio" aria-checked={wifi === "off"} className="px-tile" onClick={() => chooseWifi("off")}>オフ</button>
            </div>
            <p className="mt-2 text-[14px] text-(--px-ink-2)">前回の答えを覚えています。変わったときだけ押し直してください。</p>
          </Window>
          {latest && capture && <FixDetails capture={capture} latest={latest} inside={nearCampus(latest)} elapsed={elapsed} />}
          {error && <p className="px-note" data-tone="warn" role="alert">{error}</p>}
        </div>
      )}

      {step === "done" && (
        <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden px-4 text-center">
          <Confetti />
          <div className="relative w-full space-y-6">
            <ClearTitle />
            <CoinGain />
            <Window className="text-left">
              <div role="status" className="space-y-2">
                <p className="text-[19px]">{outcome === "sent" ? "記録を送信しました" : "この端末に保存しました"}</p>
                <p className="text-[15px] text-(--px-ink-2)">
                  {`きょう${todayCount + 1}回目の記録です。`}
                  {outcome === "queued" && "電波のよい場所でページを開くと、自動で送られます。"}
                  {outcome === "local" && "通知サーバーが設定されていないため、送信はしていません。"}
                </p>
                {subscribed && nextPingAt !== null && <p className="text-[15px] text-(--px-ink-2)">次の通知は {clock(nextPingAt)} ごろです。</p>}
              </div>
            </Window>
          </div>
        </div>
      )}

      <div className="px-actionbar">
        {step === "floor" && (
          <PxButton block icon="arrow" onClick={() => setStep("place")} disabled={level === null}>
            {level === null ? "階を選んでください" : "つぎへ"}
          </PxButton>
        )}
        {step === "place" && (
          denied ? (
            <PxButton block variant="secondary" onClick={close}>閉じる</PxButton>
          ) : (
            <>
              <PxButton variant="secondary" onClick={() => setStep("floor")}>もどる</PxButton>
              <PxButton block icon="check" onClick={confirmPlace} disabled={!placed}>
                {placed ? "ここで決定" : "場所をタップ"}
              </PxButton>
            </>
          )
        )}
        {step === "review" && (
          <>
            <PxButton variant="secondary" onClick={() => setStep("place")} disabled={busy}>もどる</PxButton>
            <PxButton block icon="arrow" onClick={() => void send()} disabled={busy}>{busy ? "送信しています…" : "送信する"}</PxButton>
          </>
        )}
        {step === "done" && <PxButton block onClick={close}>ホームへもどる</PxButton>}
      </div>

      {intro && (
        <div className="px-encounter" aria-hidden="true" onAnimationEnd={(event) => event.target === event.currentTarget && setIntro(false)}>
          <div className="px-encounter__box">
            <Window tone="alert" className="px-4 text-center">
              <p className="px-pixel text-[32px] text-(--px-yellow)">!</p>
              <p className="mt-1 text-[20px]">記録の時間です</p>
            </Window>
          </div>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void onPhoto(event.target.files?.[0])} />
    </div>
  );
}

/**
 * Choosing the floor as you would in a lift: a panel of floor buttons read
 * from the bottom up, the ground floor wide on the ground line, the
 * basements below it, and a display that lights with the choice.
 */
function LiftPanel({ level, onChoose }: { level: number | null; onChoose: (value: number) => void }) {
  const note = level === null ? "押してください" : level === 1 ? "地上・屋外" : level <= 0 ? "地下" : "";
  return (
    <div className="px-lift" role="group" aria-label="いまいる階">
      <div className="px-lift__display" aria-hidden="true">
        <span className={level === null ? "px-blink" : undefined}>{level === null ? "--" : levelLabel(level)}</span>
        <small>{note}</small>
      </div>
      <div className="px-lift__grid">
        {LIFT_ROWS.map((row) => (
          <Fragment key={row[0]}>
            {row.map((value) => (
              <button key={value} type="button" className="px-lift__btn" aria-pressed={level === value} onClick={() => onChoose(value)}>
                {levelLabel(value)}
              </button>
            ))}
            {Array.from({ length: 5 - row.length }, (_, index) => <span key={`gap-${index}`} aria-hidden="true" />)}
          </Fragment>
        ))}
      </div>
      <button type="button" className="px-lift__btn px-lift__btn--ground" aria-pressed={level === 1} onClick={() => onChoose(1)}>
        <span>1F</span>
        <small>地上・屋外</small>
      </button>
      <div className="px-lift__ground" aria-hidden="true">
        <span>地下</span>
      </div>
      <div className="px-lift__grid">
        {BASEMENT_FLOORS.map((value) => (
          <button key={value} type="button" className="px-lift__btn" aria-pressed={level === value} onClick={() => onChoose(value)}>
            {levelLabel(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const index = STEPS.findIndex((item) => item.key === step);
  return (
    <ol className="px-steps" aria-label="記録の手順">
      {STEPS.map((item, position) => (
        <li key={item.key} className="px-step" data-state={position < index ? "done" : position === index ? "current" : "todo"} aria-current={position === index ? "step" : undefined}>
          <span className="px-step__no" aria-hidden="true">{position < index ? <PixelIcon name="check" size={12} /> : position + 1}</span>
          {item.label}
        </li>
      ))}
    </ol>
  );
}

/** Four bars for how well the phone has its position, like a game's signal meter. */
function SignalMeter({ fix, measuring, denied }: { fix: Fix | null; measuring: boolean; denied: boolean }) {
  const level = fix ? (fix.accuracy <= 10 ? 4 : fix.accuracy <= 30 ? 3 : fix.accuracy <= 100 ? 2 : 1) : 0;
  const label = denied ? "位置情報が使えません" : fix ? `測位できています（誤差の目安 約${Math.round(fix.accuracy)}m）` : "位置を測っています";
  return (
    <div className="flex min-w-11 items-center justify-end gap-1.5 pr-2" role="img" aria-label={label}>
      <svg viewBox="0 0 15 12" width={25} height={20} shapeRendering="crispEdges" aria-hidden="true" className={!fix && measuring ? "px-blink" : undefined}>
        {[0, 1, 2, 3].map((bar) => (
          <rect key={bar} x={bar * 4} y={9 - bar * 3} width={3} height={3 + bar * 3} style={{ fill: denied ? "#4b5180" : bar < level ? "var(--px-green)" : "var(--px-navy-3)" }} />
        ))}
      </svg>
      <span className="text-[12px] text-(--px-ink-2)" aria-hidden="true">{denied ? "測位不可" : fix ? "測位OK" : "測位中"}</span>
    </div>
  );
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="grid grid-cols-[3em_1fr_auto] items-center gap-3 py-1">
      <dt className="text-[15px] text-(--px-ink-2)">{label}</dt>
      <dd className="min-w-0 text-[17px] leading-snug">{value}</dd>
      <dd>
        <PxLink onClick={onEdit} className="text-[14px]!" aria-label={`${label}を変更`}>変更</PxLink>
      </dd>
    </div>
  );
}

/** The raw readings, for checking on site what the phone is doing. */
function FixDetails({ capture, latest, inside, elapsed }: { capture: Capture; latest: Fix; inside: boolean; elapsed: number }) {
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
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 bg-(--px-navy) p-3 font-mono text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-(--px-ink-2)">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
