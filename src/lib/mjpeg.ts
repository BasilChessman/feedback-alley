// Plays a motion-JPEG stream (multipart/x-mixed-replace, e.g. VizionCUE's countdown picture) onto a canvas.
//
// Why not just <img src=…mjpg>: Safari keeps the frames of a streamed <img> in memory, so a display left open
// during a show slowly gets choppier and eventually warns about memory. Here the stream is read directly, only the
// newest frame is kept, and a frame is skipped when the previous one is still being drawn, so memory stays flat
// whatever the browser.

const END = [13, 10, 13, 10]; // \r\n\r\n: end of a part's headers
const decoder = new TextDecoder();

function find(buf: Uint8Array, seq: number[], from = 0) {
  outer: for (let i = from; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) if (buf[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

/** Answers at all? (An opaque no-cors request succeeds even when the source sends no CORS headers.) */
async function reachable(url: string) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    await fetch(url, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    ctl.abort(); // don't keep the stream open
  }
}

/** Does this address look like a motion-JPEG stream? */
export function isMjpeg(src: string) {
  try {
    const path = new URL(src, window.location.href).pathname.toLowerCase();
    return path.endsWith('.mjpg') || path.endsWith('.mjpeg');
  } catch {
    return false;
  }
}

/**
 * Play `url` onto `canvas` until the returned stop function is called. Reconnects after a second if the stream
 * ends or fails once it has worked. `onUnsupported` is called if the stream can't be read at all (e.g. a camera
 * without CORS headers, or no Content-Length per frame), so the caller can fall back to a plain <img>.
 */
export function playMjpeg(url: string, canvas: HTMLCanvasElement, onUnsupported: () => void): () => void {
  const ctx = canvas.getContext('2d');
  let stopped = false;
  let abort: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let pending: Blob | null = null;
  let drawing = false;
  let worked = false;

  const show = () => {
    if (drawing || !pending || stopped || !ctx) return;
    const blob = pending;
    pending = null;
    drawing = true;
    createImageBitmap(blob)
      .then((bm) => {
        if (!stopped) {
          if (canvas.width !== bm.width || canvas.height !== bm.height) {
            canvas.width = bm.width;
            canvas.height = bm.height;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bm, 0, 0);
        }
        bm.close?.();
      })
      .catch(() => {})
      .finally(() => {
        drawing = false;
        show();
      });
  };

  const run = async () => {
    abort = new AbortController();
    const signal = abort.signal;
    try {
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      let skipped = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped) break;
        const joined = new Uint8Array(buf.length + value.length);
        joined.set(buf);
        joined.set(value, buf.length);
        buf = joined;
        for (;;) {
          const h = find(buf, END);
          if (h < 0) break;
          const head = decoder.decode(buf.subarray(0, h));
          const len = /content-length:\s*(\d+)/i.exec(head);
          if (!len) {
            // Frames without a length can't be cut out reliably: let the browser show it instead.
            if (++skipped > 3 && !worked) { stopped = true; onUnsupported(); return; }
            buf = buf.slice(h + 4);
            continue;
          }
          const n = Number(len[1]);
          const start = h + 4;
          if (buf.length < start + n) break;
          const type = /content-type:\s*([^\s;]+)/i.exec(head)?.[1] ?? 'image/jpeg';
          pending = new Blob([buf.slice(start, start + n)], { type }); // only the newest frame is kept
          buf = buf.slice(start + n);
          worked = true;
          show();
        }
        if (buf.length > 20_000_000) buf = new Uint8Array(0); // never let a broken stream grow without limit
      }
    } catch {
      if (stopped || signal.aborted) return;
      // Never worked: is the source unreachable (keep trying), or reachable but unreadable here (no CORS headers)?
      if (!worked && (await reachable(url))) { stopped = true; onUnsupported(); return; }
    }
    if (!stopped) retry = setTimeout(run, 1000); // the source restarted or the network dropped: keep trying
  };

  run();
  return () => {
    stopped = true;
    clearTimeout(retry);
    abort?.abort();
  };
}
