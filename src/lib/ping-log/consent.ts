/**
 * The consent shown before anything is recorded, following the seven items
 * trace-campus-installation/docs/privacy.md asks a consent screen to carry.
 *
 * Draft: the retention period, the use of photos, the contact and the
 * university's approval are still open in privacy.md. Bump CONSENT_VERSION
 * whenever the text changes; every phone is then asked again, and each record
 * carries the version it was given under.
 */

export const CONSENT_VERSION = "2026-10-07-draft";

export const CONSENT_LEAD = "参加は任意です。同意しなくても、不利益になることはありません。";

export const CONSENT_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "目的",
    items: [
      "TRACE は、キャンパスを歩く人の動きを光として展示する作品です。",
      "この記録は、キャンパスの中でスマホの位置情報がどれくらい正確に取れるかを調べ、作品の位置表示を改善するために使います。",
    ],
  },
  {
    title: "取得する情報",
    items: [
      "位置情報（緯度、経度、高さ、誤差の目安、速さ、向き）と、それを測った時刻",
      "地図で指した、いまいる場所と階（豊洲キャンパスで記録したとき）",
      "写真（添えたときだけ）と、写真に含まれる撮影日時、撮影位置、カメラの機種",
      "端末の種類（機種、OS、ブラウザ）、通信の種類（Wi-Fi かモバイル回線か、通信事業者名）、電池残量",
      "この端末で作る匿名の ID",
    ],
  },
  {
    title: "取得しない情報",
    items: [
      "氏名、学籍番号、メールアドレス、電話番号",
      "端末の製造番号や広告 ID",
      "IP アドレス（記録には残しません）",
      "記録するとき以外の位置情報と、キャンパスから離れた場所の位置情報",
    ],
  },
  {
    title: "利用方法",
    items: [
      "位置情報の誤差を分析し、作品の位置表示の改善に使います。",
      "この記録そのものは、展示には使いません。",
      "写真は記録した場所の様子の確認に使い、外部には公開しません。",
    ],
  },
  {
    title: "通知と停止",
    items: [
      "参加中は10分ごとに通知が届きます。通知はその日の24時に自動で止まります。",
      "「通知を停止する」で、いつでも止められます。",
    ],
  },
  {
    title: "保存期間と削除",
    items: [
      "送られたデータは TRACE の展示が終わるまで保存し、その後削除します。",
      "「参加をやめる」を押すと、この端末から送ったデータをすべて削除できます。",
    ],
  },
  {
    title: "問い合わせ先",
    items: ["TRACE 制作チーム（連絡先は準備中です）"],
  },
];

const CONSENT_KEY = "trace-consent";

export type Consent = { version: string; at: string };

/** The consent this phone gave to the current text, or null. */
export function loadConsent(): Consent | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? "null") as Consent | null;
    return stored?.version === CONSENT_VERSION ? stored : null;
  } catch {
    return null;
  }
}

export function saveConsent(): Consent {
  const consent = { version: CONSENT_VERSION, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Private mode: the consent lasts as long as the page.
  }
  return consent;
}

export function clearConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Nothing stored.
  }
}
