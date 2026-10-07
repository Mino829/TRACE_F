"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are local blob: URLs */

import { useEffect, useMemo } from "react";

import { distanceMetres, wgs84ToLocal } from "@/lib/geo/campus-georeference";
import { buildingById } from "@/lib/map/buildings";
import type { Consent } from "@/lib/ping-log/consent";
import { SOURCE_LABEL, TRUTH_CONFIDENCE } from "@/lib/ping-log/record";
import type { LogEntry } from "@/lib/ping-log/store";

import { CARD, LINK, SECONDARY, clock } from "./ui";

type Props = {
  apiUrl: string;
  deviceId: string;
  consent: Consent | null;
  notificationPermission: string;
  geolocationPermission: string | null;
  subscription: PushSubscription | null;
  expiresAt: string | null;
  nextPingAt: number;
  allowOutside: boolean;
  entries: LogEntry[];
  busy: boolean;
  onAllowOutside: (value: boolean) => void;
  onTest: () => void;
  onRecordNow: () => void;
  onResend: () => void;
  onExport: () => void;
  onClearLocal: () => void;
};

function fullTime(value: number | string): string {
  return new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The errors this record would contribute to an analysis, worked out on the phone for a quick look. */
function summary(entry: LogEntry) {
  const { record } = entry;
  const last = record.capture.fixes.at(-1) ?? record.capture.coarse;
  const error = last && record.truth
    ? distanceMetres(wgs84ToLocal({ lat: last.latitude, lon: last.longitude }), record.truth.local)
    : null;
  return { last, error };
}

export function DeveloperView(props: Props) {
  const { entries } = props;
  const thumbs = useMemo<Record<string, string>>(
    () => Object.fromEntries(entries.filter((entry) => entry.photo).map((entry) => [entry.id, URL.createObjectURL(entry.photo as Blob)])),
    [entries],
  );
  useEffect(() => () => Object.values(thumbs).forEach((url) => URL.revokeObjectURL(url)), [thumbs]);
  const unsent = entries.filter((entry) => !entry.sentAt).length;
  const canRecord = props.consent !== null && !props.busy;

  const state: [string, string][] = [
    ["通知サーバー", props.apiUrl || "未設定（NEXT_PUBLIC_PUSH_API_URL）"],
    ["匿名ID", props.deviceId],
    ["同意", props.consent ? `${props.consent.version}（${fullTime(props.consent.at)}）` : "未同意"],
    ["通知の許可", props.notificationPermission],
    ["位置情報の許可", props.geolocationPermission ?? "不明"],
    ["購読", props.subscription ? new URL(props.subscription.endpoint).host : "なし"],
    ["購読の期限", props.expiresAt ? fullTime(props.expiresAt) : "—"],
    ["次の通知", props.subscription ? clock(props.nextPingAt) : "—"],
  ];

  return (
    <>
      <section className={CARD}>
        <h2 className="font-bold">状態</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {state.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-neutral-500">{label}</dt>
              <dd className="font-mono break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={CARD}>
        <h2 className="font-bold">操作</h2>
        {!props.consent && <p className="text-sm text-neutral-500">記録と通知は、参加者向け画面で同意すると使えます。</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={SECONDARY} onClick={props.onRecordNow} disabled={!canRecord}>今すぐ記録する</button>
          <button type="button" className={SECONDARY} onClick={props.onTest} disabled={!props.subscription || props.busy}>テスト通知を送る</button>
          <button type="button" className={SECONDARY} onClick={props.onResend} disabled={!unsent || props.busy}>未送信を再送（{unsent}件）</button>
          <button type="button" className={SECONDARY} onClick={props.onExport} disabled={!entries.length}>記録を書き出す</button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={props.allowOutside} onChange={(event) => props.onAllowOutside(event.target.checked)} />
          <span>キャンパスの外でも記録する（動作確認用。参加者には使わせないでください）</span>
        </label>
        <p className="text-xs text-neutral-500">書き出しは、この端末に残っている記録の JSON です（写真は含みません）。サーバーの全データは push-worker/README.md の手順で取り出します。</p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">この端末の記録（{entries.length}件）</h2>
          {entries.length > 0 && <button type="button" className={LINK} onClick={props.onClearLocal}>端末から削除</button>}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500">まだ記録はありません。</p>
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {entries.map((entry) => {
              const { record } = entry;
              const { last, error } = summary(entry);
              return (
                <li key={entry.id} className="flex gap-3 py-3">
                  {thumbs[entry.id] && <img src={thumbs[entry.id]} alt="" className="size-16 shrink-0 rounded object-cover" />}
                  <div className="min-w-0 space-y-0.5 text-xs">
                    <p className="text-sm font-bold">
                      {fullTime(record.takenAt)}・{record.kind === "ping" ? "通知から" : "手動"}・{entry.sentAt ? "送信済み" : "未送信"}
                    </p>
                    {last ? (
                      <p className="font-mono">
                        {last.latitude.toFixed(6)}, {last.longitude.toFixed(6)} ±{last.accuracy.toFixed(0)}m
                        {last.altitude !== null && ` 高度${last.altitude.toFixed(1)}m`}
                      </p>
                    ) : (
                      <p>測位なし</p>
                    )}
                    <p className="text-neutral-500">
                      測位{record.capture.fixes.length}回
                      {record.sourceGuess && `・${SOURCE_LABEL[record.sourceGuess]}（推定）`}
                      {record.capture.coarse && `・低精度 ±${record.capture.coarse.accuracy.toFixed(0)}m`}
                      {record.network?.type && `・回線 ${record.network.type}`}
                      {record.selfReport.wifi && `・Wi-Fi ${record.selfReport.wifi === "on" ? "オン" : "オフ"}`}
                    </p>
                    {record.truth ? (
                      <p>
                        指した場所 {record.truth.levelLabel}
                        {record.truth.buildingIds.length > 0 && `（${record.truth.buildingIds.map((id) => buildingById(id)?.name ?? id).join("、")}）`}
                        ・{TRUTH_CONFIDENCE[record.truth.confidence].label}
                        {error !== null && `・ずれ ${error.toFixed(1)}m`}
                      </p>
                    ) : (
                      <p className="text-neutral-500">{record.truthSkipped ? "場所はわからないと回答" : "場所の入力なし"}</p>
                    )}
                    {record.forcedOutside && <p className="text-neutral-500">キャンパスの外で記録（動作確認）</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
