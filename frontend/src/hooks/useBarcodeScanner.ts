/**
 * useBarcodeScanner — wraps @zxing/browser BrowserMultiFormatReader with React lifecycle.
 *
 * Usage:
 *   const { videoRef, start, stop, error, scanning } = useBarcodeScanner({
 *     onDecode: (text) => { ... },
 *   });
 *   <video ref={videoRef} />
 *   <button onClick={start}>Start</button>
 *
 * Falls back gracefully when no camera is present — caller can still use the
 * keyboard-input <BarcodeInput /> for hardware scanners.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';

interface Options {
  onDecode: (text: string) => void;
  // Debounce identical scans within this many ms (typical scanners fire fast).
  dedupeMs?: number;
}

export function useBarcodeScanner({ onDecode, dedupeMs = 1500 }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastTextRef = useRef<{ text: string; at: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // ignore
    }
    controlsRef.current = null;
    setScanning(false);
  }, []);

  const start = useCallback(async () => {
    if (controlsRef.current) return;
    setError(null);
    try {
      const video = videoRef.current;
      if (!video) {
        setError('No video element');
        return;
      }
      const reader = readerRef.current ?? new BrowserMultiFormatReader();
      readerRef.current = reader;
      // Prefer rear camera on mobile.
      const constraints: MediaStreamConstraints = {
        video: { facingMode: { ideal: 'environment' } },
      };
      const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
        if (!result) return;
        const text = result.getText();
        const now = Date.now();
        const last = lastTextRef.current;
        if (last && last.text === text && now - last.at < dedupeMs) return;
        lastTextRef.current = { text, at: now };
        onDecode(text);
      });
      controlsRef.current = controls;
      setScanning(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Camera error';
      setError(msg);
      setScanning(false);
    }
  }, [onDecode, dedupeMs]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { videoRef, start, stop, scanning, error };
}
