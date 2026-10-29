"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The operator's Google sign-in on the booth page (trace-campus-installation#32):
 * Google Identity Services draws its own button; the ID token it hands back
 * goes to `onToken` and nowhere else (no storage, no URL).
 */

type CredentialResponse = { credential?: string };
type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (response: CredentialResponse) => void; auto_select?: boolean }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
      prompt: () => void;
      disableAutoSelect?: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";

function loadScript(): Promise<GoogleIdentity> {
  if (window.google) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google のログインを読み込めませんでした。")));
    script.onerror = () => reject(new Error("Google のログインを読み込めませんでした。ネットワークを確かめてください。"));
    document.head.appendChild(script);
  });
}

export function GoogleSignIn({ clientId, onToken }: { clientId: string; onToken: (idToken: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let alive = true;
    loadScript()
      .then((google) => {
        if (!alive || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          auto_select: true,
          callback: (response) => {
            if (alive && response.credential) onTokenRef.current(response.credential);
          },
        });
        google.accounts.id.renderButton(ref.current, { type: "standard", theme: "outline", size: "large", text: "signin_with", locale: "ja" });
        google.accounts.id.prompt();
      })
      .catch((problem: unknown) => {
        if (alive) setError(problem instanceof Error ? problem.message : String(problem));
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  return (
    <div className="dsp-signin">
      <div ref={ref} />
      {error && <p className="dsp-mono dsp-error">{error}</p>}
    </div>
  );
}
