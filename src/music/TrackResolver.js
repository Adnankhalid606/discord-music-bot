import { spawn } from 'node:child_process';
import { config } from '../config/config.js';

/**
 * Formats a duration in seconds to mm:ss or hh:mm:ss string.
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return 'Live / Unknown';
  }

  const sec = Math.floor(seconds);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;

  const paddedMins = hrs > 0 ? String(mins).padStart(2, '0') : String(mins).padStart(2, '0');
  const paddedSecs = String(remainingSecs).padStart(2, '0');

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${paddedMins}:${paddedSecs}`;
  }

  return `${paddedMins}:${paddedSecs}`;
}

/**
 * TrackResolver resolves search queries or video URLs into playable stream URLs
 * and track metadata using a standalone yt-dlp child process.
 */
export class TrackResolver {
  /**
   * @param {object} [options]
   * @param {string} [options.executablePath]
   * @param {number} [options.timeoutMs=30000]
   * @param {number} [options.maxBufferBytes=10485760] // 10MB
   */
  constructor({
    executablePath = config.ytDlpPath || 'yt-dlp',
    timeoutMs = 30000,
    maxBufferBytes = 10 * 1024 * 1024,
  } = {}) {
    this.executablePath = executablePath;
    this.timeoutMs = timeoutMs;
    this.maxBufferBytes = maxBufferBytes;

    // Internal delegate to facilitate unit testing with mocks
    this._spawn = spawn;
  }

  /**
   * Resolves a song name or video URL to playable metadata.
   *
   * @param {string} query - Track title or URL
   * @param {object} [options]
   * @param {AbortSignal} [options.signal] - Optional AbortSignal for early cancellation
   * @param {Function} [options.onProcessSpawn] - Optional callback receiving the spawned ChildProcess
   * @returns {Promise<{
   *   title: string,
   *   streamUrl: string,
   *   webpageUrl: string,
   *   duration: number|null,
   *   durationFormatted: string,
   *   uploader: string,
   *   thumbnail: string|null,
   *   query: string
   * }>}
   */
  async resolve(query, { signal, onProcessSpawn } = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Please provide a valid song name or URL.');
    }

    if (signal?.aborted) {
      const abortErr = new Error('Track resolution was aborted.');
      abortErr.name = 'AbortError';
      abortErr.code = 'ABORT_ERR';
      throw abortErr;
    }

    const trimmed = query.trim();
    const isUrl = /^https?:\/\//i.test(trimmed);
    const target = isUrl ? trimmed : `ytsearch1:${trimmed}`;

    console.log(`[TRACK RESOLVER] Resolving "${trimmed}" using executable: "${this.executablePath}"`);

    // Array of arguments passed to child process (strictly avoiding shell injection)
    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--format', 'bestaudio/best',
      '--no-warnings',
      '--prefer-free-formats',
      target,
    ];

    return new Promise((resolvePromise, rejectPromise) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let settled = false;
      let timeoutId = null;

      const cleanup = (child) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (signal && abortHandler) {
          try {
            signal.removeEventListener('abort', abortHandler);
          } catch {}
          abortHandler = null;
        }
        if (child) {
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.removeAllListeners();
        }
      };

      const safeReject = (err, child) => {
        if (settled) return;
        settled = true;
        cleanup(child);
        rejectPromise(err);
      };

      const safeResolve = (val, child) => {
        if (settled) return;
        settled = true;
        cleanup(child);
        resolvePromise(val);
      };

      let child;
      let abortHandler = null;

      try {
        child = this._spawn(this.executablePath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        if (typeof onProcessSpawn === 'function') {
          try {
            onProcessSpawn(child);
          } catch {}
        }

        if (signal) {
          abortHandler = () => {
            try {
              child.kill('SIGTERM');
            } catch {}
            safeReject(new Error('Track resolution was aborted.'), child);
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        }
      } catch (spawnErr) {
        if (spawnErr.code === 'ENOENT') {
          return safeReject(
            new Error(
              `yt-dlp executable was not found at "${this.executablePath}". Please ensure yt-dlp is installed and available in PATH, or set YT_DLP_PATH in your .env file.`
            )
          );
        }
        return safeReject(new Error(`Failed to spawn yt-dlp: ${spawnErr.message}`));
      }

      // Guard against runaway child process with bounded timeout
      timeoutId = setTimeout(() => {
        safeReject(
          new Error(`Search and stream resolution timed out after ${Math.round(this.timeoutMs / 1000)}s.`),
          child
        );
        try {
          child.kill('SIGTERM');
          // Fallback force-kill on Windows if still running
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch {}
          }, 1000).unref();
        } catch {}
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        // Guard against memory exhaustion
        if (stdoutBuffer.length > this.maxBufferBytes) {
          try {
            child.kill('SIGKILL');
          } catch {}
          safeReject(new Error('yt-dlp output exceeded maximum buffer limit.'), child);
        }
      });

      child.stderr?.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        if (err.code === 'ENOENT') {
          safeReject(
            new Error(
              `yt-dlp executable was not found at "${this.executablePath}". Please ensure yt-dlp is installed and available in PATH, or set YT_DLP_PATH in your .env file.`
            ),
            child
          );
        } else if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
          safeReject(new Error('Track resolution was aborted.'), child);
        } else {
          safeReject(new Error(`yt-dlp process error: ${err.message}`), child);
        }
      });

      child.on('close', (code, signal) => {
        if (settled) return;

        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          return safeReject(new Error(`Track resolution process was terminated (${signal}).`), child);
        }

        if (code !== 0) {
          const lowerStderr = stderrBuffer.toLowerCase();
          if (
            lowerStderr.includes('video unavailable') ||
            lowerStderr.includes('private video') ||
            lowerStderr.includes('sign in to confirm your age')
          ) {
            return safeReject(new Error('The requested video is unavailable or restricted.'), child);
          }

          if (lowerStderr.includes('not a valid url') || lowerStderr.includes('unsupported url')) {
            return safeReject(new Error(`Invalid or unsupported video URL: "${trimmed}".`), child);
          }

          return safeReject(
            new Error(
              `Failed to resolve track (yt-dlp exited with code ${code}): ${stderrBuffer.trim() || 'Unknown error'}`
            ),
            child
          );
        }

        try {
          const parsed = JSON.parse(stdoutBuffer);

          let entry = parsed;
          if (parsed._type === 'playlist') {
            entry = Array.isArray(parsed.entries) ? parsed.entries[0] : null;
          }

          if (!entry || (!entry.id && !entry.title && !entry.url)) {
            return safeReject(new Error(`No search results found for "${trimmed}".`), child);
          }

          // Extract human-friendly source link
          const webpageUrl =
            entry.webpage_url ||
            entry.original_url ||
            (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : trimmed);

          // Extract direct playable stream URL
          let streamUrl = null;
          if (entry.url && entry.url !== entry.webpage_url && !entry.url.includes('youtube.com/watch')) {
            streamUrl = entry.url;
          } else if (Array.isArray(entry.formats) && entry.formats.length > 0) {
            // Find best audio format with valid direct URL
            const audioFormats = entry.formats.filter((f) => f.url && f.acodec && f.acodec !== 'none');
            const bestFormat = audioFormats[audioFormats.length - 1] || entry.formats[entry.formats.length - 1];
            streamUrl = bestFormat?.url || entry.url;
          } else {
            streamUrl = entry.url;
          }

          if (!streamUrl) {
            return safeReject(new Error(`Could not resolve a playable audio stream for "${trimmed}".`), child);
          }

          const duration = typeof entry.duration === 'number' ? entry.duration : null;

          safeResolve(
            {
              title: entry.title || 'Unknown Title',
              streamUrl,
              webpageUrl,
              duration,
              durationFormatted: formatDuration(duration),
              uploader: entry.uploader || entry.channel || 'Unknown Uploader',
              thumbnail: entry.thumbnail || null,
              query: trimmed,
            },
            child
          );
        } catch (parseErr) {
          safeReject(new Error(`Failed to parse track metadata from yt-dlp: ${parseErr.message}`), child);
        }
      });
    });
  }
}

export const trackResolver = new TrackResolver();
