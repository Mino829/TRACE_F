/**
 * The circumstances of a record that might explain its error later: which
 * phone and browser, which network, the battery, the compass. Every field is
 * best effort; a browser that lacks an API leaves its field null.
 */

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
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
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

async function permission(name: PermissionName): Promise<string | null> {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return null;
  }
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
  const battery = await nav.getBattery?.().then((value) => ({ level: value.level, charging: value.charging }), () => null) ?? null;
  return {
    userAgent: navigator.userAgent,
    userAgentData,
    screen: { width: window.screen.width, height: window.screen.height, devicePixelRatio: window.devicePixelRatio },
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    geolocationPermission: await permission("geolocation"),
    notificationPermission: typeof Notification === "undefined" ? null : Notification.permission,
    battery,
  };
}

/**
 * Listens to the compass while a record is being taken and returns the last
 * reading. Android delivers it without asking; iOS stays silent unless the
 * page was granted motion access, which this page does not ask for.
 */
export function watchOrientation(): () => OrientationSample | null {
  let last: OrientationSample | null = null;
  const onEvent = (event: DeviceOrientationEvent) => {
    const ios = event as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
    if (event.alpha === null && ios.webkitCompassHeading === undefined) return;
    last = {
      at: Date.now(),
      absolute: event.absolute || event.type === "deviceorientationabsolute",
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      compassHeading: numberOrNull(ios.webkitCompassHeading),
      compassAccuracy: numberOrNull(ios.webkitCompassAccuracy),
    };
  };
  const absolute = "ondeviceorientationabsolute" in window;
  const type = absolute ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(type, onEvent as EventListener);
  return () => {
    window.removeEventListener(type, onEvent as EventListener);
    return last;
  };
}
