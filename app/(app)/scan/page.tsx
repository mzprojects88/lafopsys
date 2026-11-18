"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/patterns/page-header";
import { CardScanResult, cardToken } from "@/components/modules/patients/card-scan-result";
import { useBarcodeScanner } from "@/lib/hooks/use-barcode-scanner";

/**
 * Scan Patient ID cards one after another (0165), for the meal table or the front door: the camera
 * reads a card, the child shows below with their one-tap actions, then "Scan next card".
 */
export default function ScanPage() {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [notCard, setNotCard] = React.useState(false);
  const [restart, setRestart] = React.useState(0);
  const { cameraState, cameraError } = useBarcodeScanner(
    videoRef,
    (text) => {
      const t = cardToken(text);
      setToken(t);
      setNotCard(!t);
      if (!t) setTimeout(() => setRestart((n) => n + 1), 1200);
    },
    restart
  );

  const next = () => {
    setToken(null);
    setNotCard(false);
    setRestart((n) => n + 1);
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <PageHeader title="Scan ID cards" description="Hold a Patient ID card's code in front of the camera." />
      <div className="relative overflow-hidden rounded-2xl bg-black" style={{ display: token ? "none" : undefined }}>
        <video ref={videoRef} muted playsInline className="aspect-[3/4] w-full object-cover sm:aspect-video" />
        {cameraState !== "active" ? (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-theme-sm text-white">
            {cameraState === "starting" ? "Starting the camera…" : `The camera is not available${cameraError ? ` (${cameraError})` : ""}. Allow camera access for this site, or open the card's link with the phone's own camera.`}
          </p>
        ) : null}
      </div>
      {notCard ? <p className="text-theme-sm text-destructive">That code is not a Patient ID card. Try again.</p> : null}
      {token ? (
        <>
          <CardScanResult key={token} token={token} />
          <Button size="lg" onClick={next}>
            Scan next card
          </Button>
        </>
      ) : null}
    </div>
  );
}
