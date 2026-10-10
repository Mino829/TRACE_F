"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are local blob: URLs */

import { useEffect, useMemo } from "react";

import { buildingById } from "@/lib/map/buildings";
import type { Consent } from "@/lib/ping-log/consent";
import { SOURCE_LABEL, haversineMetres, type Truth } from "@/lib/ping-log/record";
import type { LogEntry } from "@/lib/ping-log/store";

import { Eyebrow, Frame, PxButton, PxLink, clock } from "./ui";

type Props = {
  apiUrl: string;
  deviceId: string;
  consent: Consent | null;
  notificationPermission: string;
  geolocationPermission: string | null;
  pushSupport: string;
  subscription: PushSubscription | null;
  expiresAt: string | null;
  nextPingAt: number;
  entries: LogEntry[];
  busy: boolean;
  onTest: () => void;
  onRecordNow: () => void;
  onResend: () => void;
  onClearLocal: () => void;
  onResetSetup: () => void;
};

function fullTime(value: number | string): string {
  return new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The error this record would contribute to an analysis, worked out on the phone for a quick look. */
function summary(entry: LogEntry) {
  const { record } = entry;
  const last = record.capture.fixes.at(-1) ?? record.capture.coarse;
  const error = last && record.truth ? haversineMetres({ lat: last.latitude, lon: last.longitude }, record.truth.wgs84) : null;
  return { last, error };
}

function describeTruth(truth: Truth): string {
  if (truth.method === "map") return `地図（ズーム${truth.zoom}、${truth.layer === "gsi-photo" ? "航空写真" : "地図"}）`;
  const names = truth.buildingIds.map((id) => buildingById(id)?.name ?? id).join("、");
  return `図面${names ? `（${names}）` : "（屋外）"}`;
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
    ["通知の対応", props.pushSupport],
    ["通知の許可", props.notificationPermission],
    ["位置情報の許可", props.geolocationPermission ?? "不明"],
    ["購読", props.subscription ? new URL(props.subscription.endpoint).host : "なし"],
    ["購読の期限", props.expiresAt ? fullTime(props.expiresAt) : "—"],
    ["次の通知", props.subscription ? clock(props.nextPingAt) : "—"],
  ];

  return (
    <>
      <Frame tone="dim">
        <Eyebrow soft className="mb-3">Status</Eyebrow>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {state.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-(--px-muted)">{label}</dt>
              <dd className="font-mono break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </Frame>

      <Frame tone="dim" panelClassName="space-y-3">
        <Eyebrow soft>Debug</Eyebrow>
        {!props.consent && <p className="text-sm text-(--px-muted)">記録と通知は、参加者向け画面で同意すると使えます。</p>}
        <div className="grid grid-cols-2 gap-2">
          <PxButton variant="secondary" size="sm" onClick={props.onRecordNow} disabled={!canRecord}>今すぐ記録する</PxButton>
          <PxButton variant="secondary" size="sm" onClick={props.onTest} disabled={!props.subscription || props.busy}>テスト通知を送る</PxButton>
          <PxButton variant="secondary" size="sm" onClick={props.onResend} disabled={!unsent || props.busy}>未送信を再送（{unsent}件）</PxButton>
          <PxButton variant="secondary" size="sm" onClick={props.onResetSetup} disabled={props.busy}>準備の画面を見る</PxButton>
        </div>
        <p className="text-xs leading-relaxed text-(--px-muted)">記録は送信したときに自動でサーバーへ保存されます。送れなかった記録は、次にページを開いたときに送り直します。サーバーのデータの取り出し方は push-worker/README.md にあります。「準備の画面を見る」は、はじめの準備の表示を確かめるためのものです（同意も記録も消しません）。</p>
      </Frame>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-black">この端末の記録（{entries.length}件）</h2>
          {entries.length > 0 && <PxLink onClick={props.onClearLocal}>端末から削除</PxLink>}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-(--px-text-soft)">まだ記録はありません。</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const { record } = entry;
              const { last, error } = summary(entry);
              return (
                <li key={entry.id} className="px-panel flex gap-3 p-3!">
                  {thumbs[entry.id] && <img src={thumbs[entry.id]} alt="" className="size-16 shrink-0 object-cover" />}
                  <div className="min-w-0 space-y-0.5 text-xs">
                    <p className="text-sm font-bold">
                      {fullTime(record.takenAt)}・{record.tutorial ? "練習" : record.kind === "ping" ? "通知から" : "手動"}・{entry.sentAt ? "送信済み" : "未送信"}
                    </p>
                    {last ? (
                      <p className="font-mono">
                        {last.latitude.toFixed(6)}, {last.longitude.toFixed(6)} ±{last.accuracy.toFixed(0)}m
                        {last.altitude !== null && ` 高度${last.altitude.toFixed(1)}m`}
                      </p>
                    ) : (
                      <p>測位なし</p>
                    )}
                    <p className="text-(--px-muted)">
                      測位{record.capture.fixes.length}回
                      {record.sourceGuess && `・${SOURCE_LABEL[record.sourceGuess]}（推定）`}
                      {record.capture.coarse && `・低精度 ±${record.capture.coarse.accuracy.toFixed(0)}m`}
                      {record.network?.type && `・回線 ${record.network.type}`}
                      {record.selfReport.wifi && `・Wi-Fi ${record.selfReport.wifi === "on" ? "オン" : "オフ"}`}
                    </p>
                    {record.truth ? (
                      <p>
                        指した場所 {record.truth.levelLabel}・{describeTruth(record.truth)}
                        {error !== null && <span className="text-(--px-teal)">{`・ずれ ${error.toFixed(1)}m`}</span>}
                      </p>
                    ) : (
                      <p className="text-(--px-muted)">{record.truthSkipped ? "場所はわからないと回答" : "場所の入力なし"}</p>
                    )}
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
