/** Network and device context for photos; legacy orientation fields remain readable. */

export type NetworkInfo = {
  /** "wifi" | "cellular" | ...; Android Chrome only. */
  type: string | null;
  effectiveType: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean | null;
};

export type DeviceContext = {
  userAgent: string;
  /** Chromium's client hints: platform, OS version, phone model. */
  userAgentData: { platform: string | null; platformVersion: string | null; model: string | null; mobile: boolean | null } | null;
  screen: { width: number; height: number; devicePixelRatio: number };
  language: string;
  timeZone: string;
  standalone: boolean;
  geolocationPermission: string | null;
  notificationPermission: string | null;
  battery: { level: number; charging: boolean } | null;
};

export type OrientationSample = {
  at: number;
  /** True when alpha is relative to north (Android's deviceorientationabsolute). */
  absolute: boolean;
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** iOS only, and only after the page was given motion access. */
  compassHeading: number | null;
  compassAccuracy: number | null;
};

type NavigatorExtras = Navigator & {
  connection?: { type?: string; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  userAgentData?: { platform?: string; mobile?: boolean; getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>> };
  standalone?: boolean;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function networkInfo(): NetworkInfo | null {
  const connection = (navigator as NavigatorExtras).connection;
  if (!connection) return null;
  return {
    type: stringOrNull(connection.type),
    effectiveType: stringOrNull(connection.effectiveType),
    downlinkMbps: numberOrNull(connection.downlink),
    rttMs: numberOrNull(connection.rtt),
    saveData: typeof connection.saveData === "boolean" ? connection.saveData : null,
  };
}


export async function deviceContext(): Promise<DeviceContext> {
  const nav = navigator as NavigatorExtras;
  let userAgentData: DeviceContext["userAgentData"] = null;
  if (nav.userAgentData) {
    const high: Record<string, unknown> = await nav.userAgentData.getHighEntropyValues?.(["platformVersion", "model"]).catch(() => ({})) ?? {};
    userAgentData = {
      platform: stringOrNull(nav.userAgentData.platform),
      platformVersion: stringOrNull(high.platformVersion),
      model: stringOrNull(high.model),
      mobile: typeof nav.userAgentData.mobile === "boolean" ? nav.userAgentData.mobile : null,
    };
  }
  return {
    userAgent: navigator.userAgent,
    userAgentData,
    screen: { width: window.screen.width, height: window.screen.height, devicePixelRatio: window.devicePixelRatio },
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    geolocationPermission: null,
    notificationPermission: typeof Notification === "undefined" ? null : Notification.permission,
    battery: null,
  };
}
