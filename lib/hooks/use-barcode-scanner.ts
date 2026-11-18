"use client";
// Copied from LAF Inventory (lib/hooks/use-barcode-scanner.ts), 19 Nov 2026: the same camera loop reads Patient ID cards (0165).

import * as React from "react";
import type { IScannerControls } from "@zxing/browser";
import type { DecodeHintType } from "@zxing/library";

export type CameraState = "starting" | "active" | "unavailable";

// Without explicit hints, the underlying reader still tries 1D formats, but
// a bare decode() (no TRY_HARDER) skips the more thorough multi-orientation/
// sub-pixel passes that real-world 1D barcodes (motion blur, slight tilt,
// imperfect lighting from a handheld phone camera) typically need -- this is
// the difference between "detects a candidate but keeps failing checksum"
// and "actually reads it." Restricting POSSIBLE_FORMATS to what a product
// barcode / QR code could plausibly be also skips wasted attempts against
// formats we'll never see (PDF417, MaxiCode, Aztec, DataMatrix), which
// speeds up each frame.
//
// @zxing/browser + @zxing/library are the largest client dependency in the
// app, so they are imported on first use (inside start() below) rather than
// at module load -- every route that merely *can* open a scanner (Intake,
// item detail, add item) no longer pays for them up front.
type ZxingLibrary = typeof import("@zxing/library");
function buildHints({ DecodeHintType, BarcodeFormat }: ZxingLibrary) {
  return new Map<DecodeHintType, unknown>([
    [DecodeHintType.TRY_HARDER, true],
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
        BarcodeFormat.QR_CODE,
      ],
    ],
  ]);
}

// Barcode decode quality is resolution-sensitive -- the browser's default
// getUserMedia resolution (sometimes as low as 640x480) makes dense narrow
// bars hard to resolve. Request a higher ideal resolution explicitly rather
// than relying on decodeFromVideoDevice's own defaults.
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
};

// ZXing's scan loop sleeps 500 ms after every frame that has no code in it,
// so out of the box it looks only twice a second -- on a hand that is still
// lining the code up, that reads as "nothing is happening". ~120 ms keeps
// the preview smooth (a TRY_HARDER pass at 1080p can itself take 100-300 ms
// on a mid-range phone, so 0 would starve the video) while looking eight
// times a second.
const ZXING_OPTIONS = { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 120 };

// The browser's own BarcodeDetector (Chromium on Android) decodes off the
// main thread with the platform's scanner and answers in a few frames. It is
// an accelerator, never the baseline: Safari has none, and a Chromium build
// without the platform backend reports no formats or throws on detect(), so
// every step falls back to ZXing.
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar", "qr_code"];
const NATIVE_INTERVAL_MS = 80;

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorCtor {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

async function createNativeDetector(): Promise<NativeDetector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = await Ctor.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length > 0 ? new Ctor({ formats }) : null;
  } catch {
    return null;
  }
}

/**
 * Shared camera-decode loop for every barcode/QR scanning surface in the app
 * (currently /scan and Intake's bin picker). Stops scanning the instant
 * anything decodes -- the caller's `onDecode` decides what to do with the
 * code (navigate, fill a field, show a dialog, etc.) and, if it wants to
 * keep scanning, bumps `restartToken` to resume.
 */
export function useBarcodeScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onDecode: (code: string) => void,
  restartToken = 0
) {
  const controlsRef = React.useRef<IScannerControls | undefined>(undefined);
  const onDecodeRef = React.useRef(onDecode);
  React.useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);
  const [cameraState, setCameraState] = React.useState<CameraState>("starting");
  // The specific browser-reported reason the camera failed (e.g.
  // "NotAllowedError: Permission denied", "NotReadableError: Could not
  // start video source") -- cameraState alone collapses every failure into
  // one generic "unavailable", which isn't enough to tell a permission
  // denial apart from the camera being held by another app/tab.
  const [cameraError, setCameraError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator.mediaDevices availability can't be known during render (SSR has no navigator)
      setCameraState("unavailable");
      setCameraError("getUserMedia not supported in this browser");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | undefined;
    let attachedVideo: HTMLVideoElement | undefined;
    let nativeTimer: ReturnType<typeof setTimeout> | undefined;
    setCameraState("starting");
    setCameraError(null);

    // Deliberately not using reader.decodeFromConstraints()/decodeFromVideoElement()
    // -- both funnel through prepareVideoElement(), which sets the `autoplay`
    // HTML attribute *before* srcObject is assigned. That can trigger the
    // browser's own native autoplay attempt, racing the library's own
    // explicit `await video.play()` a moment later -- reproducible in this
    // app as "AbortError: The play() request was interrupted by a new load
    // request", leaving the stream attached but never actually rendering
    // frames (a black video, camera permission already granted). Attaching
    // and playing the stream ourselves, once, before ever handing the video
    // to the library, avoids the race entirely; reader.scan() below is the
    // library's pure frame-decode loop with no attach/autoplay side effects
    // of its own.
    async function start() {
      const video = videoRef.current;
      if (!video) {
        setCameraState("unavailable");
        setCameraError("Video element not ready");
        return;
      }
      // Loaded up front only when there is no native detector; the fallback
      // path loads it lazily if the native one gives up mid-way.
      let zxing: [typeof import("@zxing/browser"), ZxingLibrary] | null = null;
      try {
        const native = await createNativeDetector();
        if (!native) zxing = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
        if (cancelled) return;
        attachedVideo = video;
        video.srcObject = stream;
        if (video.readyState < 1) {
          await new Promise<void>((resolve) => {
            video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          });
        }
        if (cancelled) return;
        await video.play();
        if (cancelled) return;

        if (native) {
          let stopped = false;
          controlsRef.current = { stop: () => { stopped = true; if (nativeTimer) clearTimeout(nativeTimer); } } as IScannerControls;
          const tick = async () => {
            if (cancelled || stopped) return;
            let text: string | undefined;
            try {
              if (video.readyState >= 2) text = (await native.detect(video)).find((c) => c.rawValue)?.rawValue;
            } catch (err) {
              // The platform backend is missing after all: hand over to ZXing.
              console.warn("[scan] native detector failed, falling back:", err);
              stopped = true;
              await startZxing();
              return;
            }
            if (cancelled || stopped) return;
            if (text) {
              stopped = true;
              onDecodeRef.current(text);
              return;
            }
            nativeTimer = setTimeout(tick, NATIVE_INTERVAL_MS);
          };
          nativeTimer = setTimeout(tick, NATIVE_INTERVAL_MS);
          setCameraState("active");
          return;
        }

        await startZxing();
        setCameraState("active");
      } catch (err) {
        if (!cancelled) {
          setCameraState("unavailable");
          setCameraError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        }
      }

      async function startZxing() {
        const video = videoRef.current;
        if (!video || cancelled) return;
        const [{ BrowserMultiFormatReader }, zxingLibrary] = zxing ?? (await Promise.all([import("@zxing/browser"), import("@zxing/library")]));
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader(buildHints(zxingLibrary), ZXING_OPTIONS);
        controlsRef.current = reader.scan(video, (result, error) => {
          if (cancelled) return;
          if (!result) {
            // NotFoundException fires on essentially every frame with no code
            // in view -- expected, not logged. Anything else (e.g. a real
            // decode/checksum error worth knowing about) gets surfaced so a
            // future "camera works but won't detect" report has something to
            // go on beyond guesswork.
            if (error && error.constructor?.name !== "NotFoundException") {
              console.warn("[scan] decode error:", error);
            }
            return;
          }
          controlsRef.current?.stop();
          onDecodeRef.current(result.getText());
        });
      }
    }
    start();

    return () => {
      cancelled = true;
      if (nativeTimer) clearTimeout(nativeTimer);
      controlsRef.current?.stop();
      controlsRef.current = undefined;
      stream?.getTracks().forEach((track) => track.stop());
      if (attachedVideo) attachedVideo.srcObject = null;
    };
    // videoRef intentionally excluded (a ref, stable identity); onDecode
    // changes are picked up via onDecodeRef without needing to restart the
    // camera -- only restartToken should ever restart the decode loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartToken]);

  return { cameraState, cameraError, stop: () => controlsRef.current?.stop() };
}
