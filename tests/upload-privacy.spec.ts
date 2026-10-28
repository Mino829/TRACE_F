import { expect, test } from "@playwright/test";

import { CONSENT_VERSION } from "../src/lib/ping-log/consent";
import { uploadEntry } from "../src/lib/ping-log/push";
import type { LogEntry } from "../src/lib/ping-log/store";

const takenAt = "2026-10-26T04:00:00.000Z";

function checkpointPhoto(): LogEntry {
  return {
    id: "photo-1",
    photo: new Blob(["photo"], { type: "image/jpeg" }),
    sentAt: null,
    record: {
      schema: 3,
      purpose: "photo-memory",
      id: "photo-1",
      kind: "manual",
      tutorial: false,
      deviceId: "device-1",
      consentVersion: CONSENT_VERSION,
      consentedAt: takenAt,
      promptedAt: null,
      takenAt,
      capture: { startedAt: 0, endedAt: 0, options: {}, fixes: [], coarse: null, coarseError: null, errors: [] },
      sourceGuess: null,
      coordinateVersion: "campus-v1",
      insideCampus: false,
      reportedLevel: null,
      truth: null,
      truthSkipped: false,
      selfReport: { wifi: null },
      device: {
        userAgent: "test", userAgentData: null,
        screen: { width: 390, height: 844, devicePixelRatio: 1 },
        language: "ja", timeZone: "Asia/Tokyo", standalone: false,
        geolocationPermission: null, notificationPermission: null, battery: null,
      },
      network: null,
      networkAtSend: null,
      orientation: null,
      photo: { type: "image/jpeg", bytes: 5, width: 1, height: 1, lastModified: 0, exif: null },
      place: { checkpointId: "research-9f", name: "研究棟9F", building: "kenkyu", floor: "9F", graphVersion: "graph-v1", selectedAt: takenAt },
    },
  };
}

test("queued location records never leave the device, but checkpoint photos can upload", async () => {
  const original = globalThis.fetch;
  const uploaded: string[] = [];
  globalThis.fetch = async (_input, init) => {
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error("Expected a photo upload");
    const record = form.get("record");
    if (typeof record !== "string") throw new Error("Expected a record");
    uploaded.push(record);
    return new Response(null, { status: 200 });
  };
  try {
    const oldAccuracy = checkpointPhoto();
    oldAccuracy.record.schema = 2;
    oldAccuracy.record.purpose = "accuracy";
    oldAccuracy.record.capture.fixes.push({
      receivedAt: 0, timestamp: 0, latitude: 35.6, longitude: 139.8,
      accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    });
    await expect(uploadEntry(oldAccuracy)).rejects.toThrow("位置情報を含む旧記録は送信しません");

    const oldPhoto = checkpointPhoto();
    oldPhoto.record.capture.fixes.push({ ...oldAccuracy.record.capture.fixes[0] });
    await expect(uploadEntry(oldPhoto)).rejects.toThrow("位置情報を含む旧記録は送信しません");
    expect(uploaded).toEqual([]);

    await uploadEntry(checkpointPhoto());
    expect(uploaded).toHaveLength(1);
    const record = JSON.parse(uploaded[0]);
    expect(record.capture.fixes).toEqual([]);
    expect(record.place.checkpointId).toBe("research-9f");
  } finally {
    globalThis.fetch = original;
  }
});
