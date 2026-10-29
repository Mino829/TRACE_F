/**
 * Draft consent for photo memory. GPS is not requested: places are selected
 * checkpoints, not phone measurements. Retention, contact and institutional
 * review are still open; changing the text requires fresh consent for photos.
 * Older saved consent remains readable for withdrawal and deletion.
 */
export const CONSENT_VERSION = "2026-10-26-photo-no-gps-draft-3";

export const CONSENT_LEAD = "参加は任意です。同意しなくても、\n不利益になることはありません。";

export const CONSENT_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "目的",
    items: [
      "TRACE は、学祭で撮った写真を、\nあなたの一日のメモリーとして残す作品です。",
      "撮った写真は、あなただけが見られる\n写真ストーリーを作るために使います。",
      "下の「取得する情報」は、\nShibaLab（教室棟301）の展示を\n作るためにも使います。",
    ],
  },
  {
    title: "取得する情報",
    items: [
      "撮った写真と、撮影した時刻",
      "写真ごとに自分で選ぶ、\nキャンパス内のチェックポイント\n（端末の位置情報は取得しません）",
      "端末の種類（機種、OS、ブラウザ）と、\n通信の状態\n（端末から得られる場合）",
      "この端末で作る匿名の ID",
    ],
  },
  {
    title: "取得しない情報",
    items: [
      "端末の位置情報（GPS など）",
      "氏名、学籍番号、メールアドレス、電話番号",
      "端末の製造番号や広告 ID",
      "IP アドレス（記録には残しません）",
      "写真に埋め込まれた撮影位置や機種などの情報\n（送る前に取り除きます）",
    ],
  },
  {
    title: "利用方法",
    items: [
      "写真は展示に出しません。写真ストーリーとして、\nあなたのスマホにだけ表示します。",
      "展示に、名前は出ません。",
    ],
  },
  {
    title: "撮影の注意",
    items: [
      "名札や授業の資料は撮らないでください。",
      "撮影が禁止されている場所では\n撮らないでください。",
    ],
  },
  {
    title: "リマインダー",
    items: [
      "撮影のリマインダーは任意です。オンにすると、30分ごとに通知が届きます。",
      "通知はその日の24時に自動で止まります。ホームのリマインダーのスイッチで、\nいつでも止められます。",
    ],
  },
  {
    title: "保存期間と削除",
    items: [
      "保存期間と問い合わせ先は現在確認中です。この同意文はまだ草案で、\n大学による承認済みの案内ではありません。",
      "「参加をやめる」を押すと、この端末から\n送ったデータをすべて削除できます。",
    ],
  },
  {
    title: "問い合わせ先",
    items: ["TRACE 制作チーム（連絡先は準備中です）"],
  },
];

const CONSENT_KEY = "trace-consent";

export type Consent = { version: string; at: string };

/** Saved consent, including older versions retained solely to allow withdrawal. */
export function loadConsent(): Consent | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? "null") as Consent | null;
    return stored && typeof stored.version === "string" && typeof stored.at === "string" ? stored : null;
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
