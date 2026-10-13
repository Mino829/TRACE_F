"use client";

import { useState } from "react";

import type { Consent } from "@/lib/ping-log/consent";
import type { PushSupport } from "@/lib/ping-log/environment";
import type { Shot } from "@/lib/ping-log/photo-entry";
import type { LogEntry, SaveOutcome } from "@/lib/ping-log/store";
import { TRACE_API_URL } from "@/lib/trace-api/client";
import { reducedMotion } from "@/lib/ray/fx";

import { DemoFlow } from "./demo";
import { ConsentLayer, HowToLayer, InstallLayer, MenuLayer, WithdrawLayer, type MenuItem, type OverlayName } from "./overlays";
import { PhotoScreen } from "./photo";
import { ConsentScreen, HomeScreen, PingScreen, SkipScreen, TitleScreen } from "./screens";
import { RayStage, SWAP, useRay } from "./stage";

import "./ray.css";

/**
 * The participant's side of /log in ShibaLab's RAY look. Everything it does
 * comes from PingLogScreen through these props; this file only decides which
 * screen is up and how one gives way to the next.
 */

export type RayAppProps = {
  joined: boolean;
  consent: Consent | null;
  /** The consent screen before joining. */
  consentOpen: boolean;
  onOpenConsent: () => void;
  onCloseConsent: () => void;
  onAgree: () => Promise<void>;
  joining: boolean;
  joinError: string;
  /** Notes for the top of the title or home screen. */
  notes: string[];
  busy: boolean;
  support: PushSupport;
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  maxPhotos: number;
  pendingAt: string | null;
  /** The reminder opened the page, or arrived while it was open: its own screen. */
  pingOpen: boolean;
  onClosePing: () => void;
  reminderOn: boolean;
  nextReminderAt: number | null;
  onReminder: (on: boolean) => Promise<string | null>;
  shot: Shot | null;
  onRetake: () => void;
  onSave: (entry: LogEntry) => Promise<SaveOutcome>;
  onCloseShot: () => void;
  /** When the skipped reminder was due, while its clear screen is up. */
  skipped: string | null;
  onCloseSkip: () => void;
  /** Where the arrival demo was opened from, while it is up. */
  demo: "home" | "developer" | null;
  onArrive: () => void;
  onCloseDemo: () => void;
  onTakePhoto: () => void;
  onSkip: () => void;
  onResend: () => void;
  onWithdraw: () => Promise<void>;
  onDeveloper: () => void;
  /** The participant's home, from the TRACE mark: from the demo, even one opened on the developer screen. */
  onHome: () => void;
};

export function RayApp(props: RayAppProps) {
  const [overlay, setOverlay] = useState<OverlayName | null>(null);
  const close = () => setOverlay(null);

  const menuItems: MenuItem[] = [
    { label: "遊び方", onSelect: () => setOverlay("howto") },
    ...(props.consent ? [{ label: "同意した内容", onSelect: () => setOverlay("consent") }] : []),
    ...(props.consent ? [{ label: "参加をやめる", onSelect: () => setOverlay("withdraw"), disabled: props.busy }] : []),
  ];

  const layer =
    overlay === "menu" ? (
      <MenuLayer items={menuItems} onClose={close} />
    ) : overlay === "howto" ? (
      <HowToLayer maxPhotos={props.maxPhotos} onClose={close} />
    ) : overlay === "install" ? (
      <InstallLayer support={props.support} beforeJoining={!props.joined} onClose={close} />
    ) : overlay === "consent" ? (
      <ConsentLayer onClose={close} />
    ) : overlay === "withdraw" ? (
      <WithdrawLayer
        onConfirm={async () => {
          await props.onWithdraw();
          close();
        }}
        onClose={close}
      />
    ) : null;

  return (
    <div className="ray">
      <RayStage overlay={layer}>
        <Current {...props} inert={overlay !== null} openOverlay={setOverlay} />
      </RayStage>
    </div>
  );
}

function Current(props: RayAppProps & { inert: boolean; openOverlay: (name: OverlayName) => void }) {
  const { go, field, fx } = useRay();
  const { inert } = props;
  const full = props.photos.length >= props.maxPhotos;
  const onMenu = () => props.openOverlay("menu");
  const onInstall = () => props.openOverlay("install");

  // A skip still clears: the screen tears and flashes negative, as a photo does.
  const skip = async () => {
    if (!reducedMotion()) {
      void fx?.tear(300, 1);
      field?.burst(0.9);
      await fx?.flash(SWAP, 90);
    }
    props.onSkip();
  };

  if (props.demo) {
    return <DemoFlow closeLabel={props.demo === "home" ? "ホームへもどる" : "開発者の画面にもどる"} inert={inert} onClose={props.onCloseDemo} onHome={props.onHome} />;
  }

  if (!props.joined) {
    if (props.consentOpen) {
      return (
        <ConsentScreen
          busy={props.joining}
          error={props.joinError}
          inert={inert}
          // With the backend, joining waits for the network: the screen changes once it has.
          onAgree={() => (TRACE_API_URL ? void props.onAgree() : void go(() => void props.onAgree()))}
          onDecline={() => void go(props.onCloseConsent)}
        />
      );
    }
    return (
      <TitleScreen
        notes={props.notes}
        support={props.support}
        inert={inert}
        onStart={() => void go(props.onOpenConsent)}
        onDeveloper={props.onDeveloper}
        onMenu={onMenu}
        onInstall={onInstall}
      />
    );
  }

  if (props.shot && props.consent) {
    return (
      <PhotoScreen
        key={props.shot.id}
        shot={props.shot}
        consent={props.consent}
        offerReminder={props.shot.number === 1 && !props.reminderOn}
        support={props.support}
        reminderOn={props.reminderOn}
        busy={props.busy}
        nextReminderAt={props.nextReminderAt}
        inert={inert}
        onRetake={props.onRetake}
        onSave={props.onSave}
        onReminder={props.onReminder}
        onInstall={onInstall}
        onClose={props.onCloseShot}
      />
    );
  }

  if (props.skipped) {
    return <SkipScreen at={props.skipped} nextReminderAt={props.nextReminderAt} inert={inert} onClose={() => void go(props.onCloseSkip)} />;
  }

  if (props.pingOpen && props.pendingAt) {
    return (
      <PingScreen
        pendingAt={props.pendingAt}
        full={full}
        inert={inert}
        onTakePhoto={props.onTakePhoto}
        onSkip={() => void skip()}
        onClose={() => void go(props.onClosePing)}
      />
    );
  }

  return (
    <HomeScreen
      photos={props.photos}
      maxPhotos={props.maxPhotos}
      pendingAt={props.pendingAt}
      reminderOn={props.reminderOn}
      nextReminderAt={props.nextReminderAt}
      support={props.support}
      busy={props.busy}
      message={props.notes.join("")}
      inert={inert}
      onTakePhoto={props.onTakePhoto}
      onSkip={() => void skip()}
      onReminder={props.onReminder}
      onResend={props.onResend}
      onArrive={() => void go(props.onArrive)}
      onDeveloper={props.onDeveloper}
      onMenu={onMenu}
      onInstall={onInstall}
    />
  );
}
