/**
 * Draft consent for photo memory. GPS is not requested: places are selected
 * checkpoints, not phone measurements. Retention, contact and institutional
 * review are still open; changing the text requires fresh consent for photos.
 * Older saved consent remains readable for withdrawal and deletion.
 */
export const CONSENT_VERSION = "2026-10-26-photo-no-gps-draft-3";

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
      "写真ごとに自分で選ぶ、キャンパス内のチェックポイント（端末の位置情報は取得しません）",
      "端末の種類（機種、OS、ブラウザ）と、通信の状態（端末から得られる場合）",
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
      "保存期間と問い合わせ先は現在確認中です。この同意文はまだ草案で、大学による承認済みの案内ではありません。",
      "「参加をやめる」を押すと、この端末から送ったデータをすべて削除できます。",
    ],
  },
  {
    title: "問い合わせ先",
    items: ["TRACE 制作チーム（連絡先は準備中です）"],
  },
];

/**
 * English translations of TRACE_B's consent text, by version, for reading
 * only: the Japanese text is what is agreed to. A new version in TRACE_B
 * needs its own entry here, or English shows that there is none yet.
 */
const CONSENT_EN: Record<string, string> = {
  "2026-10-31-v1": `TRACE is an artwork that traces your day as a path of light, based on the photos you take at the festival and the places you choose. Taking part is optional. You can see the exhibit without taking part.

[Photos and records]
Photo images are kept only in this phone's browser and are not sent to the server. The server keeps each photo's ID, the time it was taken, the place you chose, the estimated route, and the state of your arrival and playback. GPS is not used. When you scan the QR code at the booth, the route estimated from the places you chose is played on the exhibit screen. It is not a record of how you actually moved. Please do not use photos that show other people's faces or personal information, or anything that must not be photographed.

[Storage and deletion]
Your participation is valid for 6 hours from when you join. Participation and photo records on the server are cleared regularly, with a deletion deadline of 30 hours after you join. You can also stop taking part or delete your data yourself on the screen. Stopping is not deleting: until the deadline, you can still view and delete your data. Deletion may be delayed by outages and the like, and audit logs, delivery events and backups may keep records for a set period.
Images cannot be moved to another device automatically, and may be lost when browser data is cleared or storage runs low. Photos are not guaranteed to be deleted automatically while the page stays closed on your phone. Save the photos you want to keep yourself, and delete the ones you do not need from your phone.

[Optional reminder]
Only if you would like a prompt to take a photo every 30 minutes, turn on the reminder and allow browser notifications. Without them you can still take part, take photos, play your route at the exhibit and delete your data. For notifications, the subscription address and notification keys are encrypted and stored on the server, and your phone's push delivery service is used. Notifications do not contain photos, place names, routes or participation IDs. Depending on the OS, browser and connection, notifications may be delayed, not arrive, or arrive twice.
Registering a photo postpones the next reminder. Reminders stop at the earliest of: your arrival, stopping your participation, turning notifications off, deleting your data, or the end of your participation period. To stop them, turn the reminder off. On iPhone, notifications work in the web app added to the home screen.

[External services and contact]
Cloudflare and Google Cloud are used for communication and processing, and not all processing is guaranteed to take place in Tokyo. Connection and security logs are kept according to each service's settings.
For questions, please ask the staff at the ASYNC booth in Classroom Building, Room 301.`,
};

export function consentInEnglish(version: string): string | null {
  return CONSENT_EN[version] ?? null;
}

/** TRACE_B's contact, which is Japanese; the one in use has an English name. */
export function contactInEnglish(contact: string): string {
  return contact === "教室棟301のASYNCブースのスタッフ" ? "The staff at the ASYNC booth, Classroom Building, Room 301" : contact;
}

const CONSENT_KEY = "trace-consent";

export type Consent = { version: string; at: string; body?: string; language?: string };

/** Saved consent, including older versions retained solely to allow withdrawal. */
export function loadConsent(): Consent | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? "null") as Consent | null;
    return stored && typeof stored.version === "string" && typeof stored.at === "string" ? stored : null;
  } catch {
    return null;
  }
}

export function saveConsent(terms: { version: string; body: string; language: string }): Consent {
  const consent = { ...terms, at: new Date().toISOString() };
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
