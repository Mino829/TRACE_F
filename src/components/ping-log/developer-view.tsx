"use client";

import { buildingById } from "@/lib/map/buildings";
import type { Consent } from "@/lib/ping-log/consent";
import { isUploadablePhoto, type PushPlan } from "@/lib/ping-log/push";
import { PURPOSE_LABEL, SOURCE_LABEL, haversineMetres, purposeOf, type Truth } from "@/lib/ping-log/record";
import type { LogEntry } from "@/lib/ping-log/store";

import { BlobImage } from "./blob-image";
import { Eyebrow, Frame, PxButton, PxLink, clock } from "./ui";

type Props = {
  apiUrl: string;
  deviceId: string;
  /** The participant screen's current or legacy consent. */
  consent: Consent | null;
  notificationPermission: string;
  pushSupport: string;
  subscription: PushSubscription | null;
  /** What the phone's one subscription is for while it lasts. */
  plan: PushPlan | null;
  expiresAt: string | null;
  nextPingAt: number | null;
  entries: LogEntry[];
  busy: boolean;
  onStopNotifications: () => void;
  onTest: () => void;
  onResend: () => void;
  onClearLocal: () => void;
  onOpenDemo: () => void;
};

function fullTime(value: number | string): string {
  return new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function planLabel(plan: PushPlan): string {
  return `${plan.purpose === "accuracy" ? "旧・精度テスト" : "撮影のリマインダー"}（${plan.intervalMinutes}分ごと）`;
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
  const { entries, plan } = props;
  const unsent = entries.filter((entry) => !entry.sentAt && isUploadablePhoto(entry)).length;
  const legacy = entries.filter((entry) => !entry.sentAt && !isUploadablePhoto(entry)).length;
  const accuracyOn = plan?.purpose === "accuracy";

  const state: [string, string][] = [
    ["通知サーバー", props.apiUrl || "未設定（NEXT_PUBLIC_PUSH_API_URL）"],
    ["匿名ID", props.deviceId],
    ["参加者の同意", props.consent ? `${props.consent.version}（${fullTime(props.consent.at)}）` : "未同意"],
    ["通知の対応", props.pushSupport],
    ["通知の許可", props.notificationPermission],
    ["購読", props.subscription ? new URL(props.subscription.endpoint).host : "なし"],
    ["通知の目的", plan ? planLabel(plan) : "—"],
    ["購読の期限", props.expiresAt ? fullTime(props.expiresAt) : "—"],
    ["次の通知", props.nextPingAt !== null ? clock(props.nextPingAt) : "—"],
  ];

  return (
    <>
      <Frame tone="dim">
        <Eyebrow className="mb-3">Status</Eyebrow>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {state.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-(--px-ink-2)">{label}</dt>
              <dd className="font-mono break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </Frame>

      <Frame tone="dim" panelClassName="space-y-3">
        <Eyebrow>Records</Eyebrow>
        <h2 className="text-[17px]">過去の記録</h2>
        <p className="text-sm leading-relaxed text-(--px-ink-2)">
          位置情報の測定と精度テストの新規記録は停止しています。未送信の旧記録 {legacy}件は端末に残し、送信しません。送信できるのは位置情報を含まないチェックポイント付きの写真だけです。
        </p>
        {accuracyOn && (
          <PxButton variant="secondary" size="sm" onClick={props.onStopNotifications} disabled={props.busy}>旧・精度テストの通知を止める</PxButton>
        )}
        <div className="grid grid-cols-2 gap-2 border-t-3 border-(--px-navy-3) pt-3">
          <PxButton variant="secondary" size="sm" onClick={props.onTest} disabled={!props.subscription || accuracyOn || props.busy}>テスト通知を送る</PxButton>
          <PxButton variant="secondary" size="sm" onClick={props.onResend} disabled={!unsent || props.busy}>写真を再送（{unsent}件）</PxButton>
        </div>
      </Frame>

      <Frame tone="dim" panelClassName="space-y-3">
        <Eyebrow>Demo</Eyebrow>
        <h2 className="text-[17px]">会場到着のデモ</h2>
        <p className="text-sm leading-relaxed text-(--px-ink-2)">
          ShibaLab（教室棟301）に着いたときの画面の流れを、見本の写真9枚で見られます。QR コードの読み取り、到着、写真ストーリー、おわりの4画面です。この開発者向けデモは記録を保存せず、サーバーにも送りません。参加者のホームでは実際の会場 QR コードを読み取ります。
        </p>
        <PxButton size="sm" icon="arrow" onClick={props.onOpenDemo}>デモを見る</PxButton>
      </Frame>

      <section className="px-window space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-black">この端末の記録（{entries.length}件）</h2>
          {entries.length > 0 && <PxLink onClick={props.onClearLocal}>端末から削除</PxLink>}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-(--px-ink-2)">まだ記録はありません。</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const { record } = entry;
              const { last, error } = summary(entry);
              const purpose = purposeOf(record);
              return (
                <li key={entry.id} className="px-panel flex gap-3 p-3!">
                  {entry.photo && <BlobImage blob={entry.photo} alt="" className="size-16 shrink-0 object-cover" />}
                  <div className="min-w-0 space-y-0.5 text-xs">
                    <p className="text-sm font-bold">
                      {fullTime(record.takenAt)}・{PURPOSE_LABEL[purpose]}・{record.tutorial ? "練習" : record.kind === "ping" ? "通知から" : "手動"}・{entry.sentAt ? "送信済み" : "未送信"}
                    </p>
                    {last ? (
                      <p className="font-mono">
                        {last.latitude.toFixed(6)}, {last.longitude.toFixed(6)} ±{last.accuracy.toFixed(0)}m
                        {last.altitude !== null && ` 高度${last.altitude.toFixed(1)}m`}
                      </p>
                    ) : record.place ? (
                      <p>選択した場所：{record.place.name}</p>
                    ) : (
                      <p>測位なし（旧記録）</p>
                    )}
                    {purpose === "accuracy" && (
                      <p className="text-(--px-ink-2)">
                        測位{record.capture.fixes.length}回
                        {record.sourceGuess && `・${SOURCE_LABEL[record.sourceGuess]}（推定）`}
                        {record.capture.coarse && `・低精度 ±${record.capture.coarse.accuracy.toFixed(0)}m`}
                        {record.network?.type && `・回線 ${record.network.type}`}
                        {record.selfReport.wifi && `・Wi-Fi ${record.selfReport.wifi === "on" ? "オン" : "オフ"}`}
                      </p>
                    )}
                    {purpose === "photo-memory" ? null : record.truth ? (
                      <p>
                        指した場所 {record.truth.levelLabel}・{describeTruth(record.truth)}
                        {error !== null && <span className="text-(--px-cyan)">{`・ずれ ${error.toFixed(1)}m`}</span>}
                      </p>
                    ) : (
                      <p className="text-(--px-ink-2)">{record.truthSkipped ? "場所はわからないと回答" : "場所の入力なし"}</p>
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
