/**
 * The consent shown before anything is recorded, following the seven items
 * trace-campus-installation/docs/privacy.md asks a consent screen to carry.
 *
 * It covers the photo memory only. The accuracy runs on the developer screen
 * are the team's own and never ask for it; their records carry
 * DEVELOPER_CONSENT_VERSION instead.
 *
 * What the exhibition does with the places stays unsaid until the visitor
 * arrives at ShibaLab: the location is disclosed in "取得する情報" and used,
 * in general terms, for the exhibition, and nowhere else before arrival.
 *
 * Draft: the retention period, the contact and the university's approval are
 * still open in privacy.md. Bump CONSENT_VERSION whenever the text changes;
 * every phone is then asked again, and each record carries the version it was
 * given under.
 */

export const CONSENT_VERSION = "2026-10-26-photo-draft-3";

/** What the developer screen's records and accuracy pings carry in place of a participant's consent. */
export const DEVELOPER_CONSENT_VERSION = "developer-accuracy";

export const CONSENT_LEAD = "参加は任意です。同意しなくても、不利益になることはありません。";

export const CONSENT_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "目的",
    items: [
      "TRACE は、学祭で撮った写真を、あなたの一日のメモリーとして残す作品です。",
      "撮った写真は、あなただけが見られる写真ストーリーを作るために使います。",
      "下の「取得する情報」は、ShibaLab（教室棟301）の展示を作るためにも使います。",
    ],
  },
  {
    title: "取得する情報",
    items: [
      "撮った写真と、撮影した時刻",
      "撮影したときの位置情報（撮影のたびに1回だけ測ります。それ以外のときは測りません）",
      "端末の種類（機種、OS、ブラウザ）と、通信の種類（Wi-Fi かモバイル回線か、通信事業者名）",
      "この端末で作る匿名の ID",
    ],
  },
  {
    title: "取得しない情報",
    items: [
      "氏名、学籍番号、メールアドレス、電話番号",
      "端末の製造番号や広告 ID",
      "IP アドレス（記録には残しません）",
      "写真に埋め込まれた撮影位置や機種などの情報（送る前に取り除きます）",
    ],
  },
  {
    title: "利用方法",
    items: [
      "写真は展示に出しません。写真ストーリーとして、あなたのスマホにだけ表示します。",
      "展示に、名前は出ません。",
    ],
  },
  {
    title: "撮影の注意",
    items: [
      "名札や授業の資料は撮らないでください。",
      "撮影が禁止されている場所では撮らないでください。",
    ],
  },
  {
    title: "リマインダー",
    items: [
      "撮影のリマインダーは任意です。オンにすると、30分ごとに通知が届きます。",
      "通知はその日の24時に自動で止まります。ホームのリマインダーのスイッチで、いつでも止められます。",
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
