import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TrackResolver, formatDuration } from '../src/music/TrackResolver.js';
import { resolveYtDlpPath } from '../src/config/config.js';
import { normalize } from 'node:path';

class MockChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = false;
    this.killSignal = null;
  }

  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.killSignal = signal;
    this.emit('close', 1, signal);
  }
}

describe('TrackResolver', () => {
  describe('resolveYtDlpPath', () => {
    test('returns yt-dlp by default when undefined or empty', () => {
      assert.equal(resolveYtDlpPath(undefined), 'yt-dlp');
      assert.equal(resolveYtDlpPath(''), 'yt-dlp');
      assert.equal(resolveYtDlpPath('   '), 'yt-dlp');
    });

    test('normalizes custom path with forward slashes for the current OS', () => {
      const input = 'C:/yt-dlp.exe';
      const resolved = resolveYtDlpPath(input);
      assert.equal(resolved, normalize(input));
    });
  });

  describe('formatDuration helper', () => {
    test('formats seconds to mm:ss and hh:mm:ss correctly', () => {
      assert.equal(formatDuration(0), '00:00');
      assert.equal(formatDuration(65), '01:05');
      assert.equal(formatDuration(215), '03:35');
      assert.equal(formatDuration(3665), '01:01:05');
      assert.equal(formatDuration(null), 'Live / Unknown');
    });
  });

  describe('resolve', () => {
    test('resolves a search query with mock yt-dlp', async () => {
      const resolver = new TrackResolver({ executablePath: 'yt-dlp' });

      resolver._spawn = (cmd, args) => {
        assert.equal(cmd, 'yt-dlp');
        assert.ok(args.includes('ytsearch1:Never Gonna Give You Up'));

        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const fakeOutput = JSON.stringify({
            _type: 'playlist',
            entries: [
              {
                id: 'dQw4w9WgXcQ',
                title: 'Never Gonna Give You Up',
                url: 'https://manifest.googlevideo.com/stream.m4a',
                webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                duration: 213,
                uploader: 'Rick Astley',
              },
            ],
          });
          mockProc.stdout.emit('data', Buffer.from(fakeOutput));
          mockProc.emit('close', 0, null);
        });
        return mockProc;
      };

      const track = await resolver.resolve('Never Gonna Give You Up');

      assert.equal(track.title, 'Never Gonna Give You Up');
      assert.equal(track.streamUrl, 'https://manifest.googlevideo.com/stream.m4a');
      assert.equal(track.webpageUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(track.duration, 213);
      assert.equal(track.durationFormatted, '03:33');
      assert.equal(track.uploader, 'Rick Astley');
    });

    test('resolves a direct URL without ytsearch prefix', async () => {
      const resolver = new TrackResolver({ executablePath: 'yt-dlp' });
      const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

      resolver._spawn = (cmd, args) => {
        assert.ok(!args.some(a => a.startsWith('ytsearch1:')));
        assert.ok(args.includes(testUrl));

        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const fakeOutput = JSON.stringify({
            id: 'dQw4w9WgXcQ',
            title: 'Direct Video Title',
            url: 'https://audio.googlevideo.com/direct',
            webpage_url: testUrl,
            duration: 180,
            uploader: 'Artist',
          });
          mockProc.stdout.emit('data', Buffer.from(fakeOutput));
          mockProc.emit('close', 0, null);
        });
        return mockProc;
      };

      const track = await resolver.resolve(testUrl);
      assert.equal(track.title, 'Direct Video Title');
      assert.equal(track.streamUrl, 'https://audio.googlevideo.com/direct');
      assert.equal(track.webpageUrl, testUrl);
    });

    test('extracts streamUrl from formats if top-level url equals webpage_url', async () => {
      const resolver = new TrackResolver({ executablePath: 'yt-dlp' });
      const testUrl = 'https://www.youtube.com/watch?v=test';

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const fakeOutput = JSON.stringify({
            title: 'Sample Track',
            url: testUrl, // Top level url is webpage_url
            webpage_url: testUrl,
            formats: [
              { format_id: '1', acodec: 'none', url: 'https://video-only.com' },
              { format_id: '2', acodec: 'opus', url: 'https://audio-stream.com' },
            ],
            duration: 120,
          });
          mockProc.stdout.emit('data', Buffer.from(fakeOutput));
          mockProc.emit('close', 0, null);
        });
        return mockProc;
      };

      const track = await resolver.resolve(testUrl);
      assert.equal(track.streamUrl, 'https://audio-stream.com');
      assert.equal(track.webpageUrl, testUrl);
    });

    test('throws friendly error when yt-dlp binary is missing (ENOENT)', async () => {
      const resolver = new TrackResolver({ executablePath: 'nonexistent-yt-dlp' });

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const err = new Error('spawn nonexistent-yt-dlp ENOENT');
          err.code = 'ENOENT';
          mockProc.emit('error', err);
        });
        return mockProc;
      };

      await assert.rejects(
        () => resolver.resolve('test song'),
        /yt-dlp executable was not found/
      );
    });

    test('throws error when search returns empty results', async () => {
      const resolver = new TrackResolver();

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const fakeOutput = JSON.stringify({
            _type: 'playlist',
            entries: [],
          });
          mockProc.stdout.emit('data', Buffer.from(fakeOutput));
          mockProc.emit('close', 0, null);
        });
        return mockProc;
      };

      await assert.rejects(
        () => resolver.resolve('some nonexistent obscure phrase 987654321'),
        /No search results found/
      );
    });

    test('throws error on process non-zero exit with unavailable video', async () => {
      const resolver = new TrackResolver();

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          mockProc.stderr.emit('data', Buffer.from('ERROR: [youtube] dQw4w9WgXcQ: Video unavailable'));
          mockProc.emit('close', 1, null);
        });
        return mockProc;
      };

      await assert.rejects(
        () => resolver.resolve('https://youtube.com/watch?v=deleted'),
        /unavailable or restricted/
      );
    });

    test('handles and terminates timed out processes', async () => {
      const resolver = new TrackResolver({ timeoutMs: 50 });

      let spawnedProc = null;
      resolver._spawn = () => {
        spawnedProc = new MockChildProcess();
        return spawnedProc;
      };

      await assert.rejects(
        () => resolver.resolve('hanging request'),
        /timed out/
      );

      assert.equal(spawnedProc.killed, true);
    });

    test('rejects malformed JSON output', async () => {
      const resolver = new TrackResolver();

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          mockProc.stdout.emit('data', Buffer.from('Not Valid JSON Output {{{{'));
          mockProc.emit('close', 0, null);
        });
        return mockProc;
      };

      await assert.rejects(
        () => resolver.resolve('corrupted output'),
        /Failed to parse track metadata/
      );
    });

    test('spawns without shell: true and passes args array', async () => {
      const configuredPath = 'C:\\yt-dlp.exe';
      const resolver = new TrackResolver({ executablePath: configuredPath });

      let capturedCmd = null;
      let capturedArgs = null;
      let capturedOptions = null;

      resolver._spawn = (cmd, args, options) => {
        capturedCmd = cmd;
        capturedArgs = args;
        capturedOptions = options;

        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const fakeOutput = JSON.stringify({
            title: 'Test',
            url: 'https://stream.fake',
            webpage_url: 'https://youtube.com/watch?v=123',
          });
          mockProc.stdout.emit('data', Buffer.from(fakeOutput));
          mockProc.emit('close', 0, null);
        });
        return mockProc;
      };

      await resolver.resolve('test query');

      assert.equal(capturedCmd, configuredPath);
      assert.ok(Array.isArray(capturedArgs));
      assert.equal(capturedOptions?.shell, undefined, 'Must not use shell: true');
    });

    test('distinguishes AbortError and does not report executable not found', async () => {
      const resolver = new TrackResolver({ executablePath: 'C:\\yt-dlp.exe' });

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          abortErr.code = 'ABORT_ERR';
          mockProc.emit('error', abortErr);
        });
        return mockProc;
      };

      await assert.rejects(
        () => resolver.resolve('aborted query'),
        (err) => {
          assert.equal(err.message, 'Track resolution was aborted.');
          assert.ok(!err.message.includes('executable was not found'));
          return true;
        }
      );
    });

    test('distinguishes generic non-zero exit code with stderr from executable not found', async () => {
      const resolver = new TrackResolver({ executablePath: 'C:\\yt-dlp.exe' });

      resolver._spawn = () => {
        const mockProc = new MockChildProcess();
        process.nextTick(() => {
          mockProc.stderr.emit('data', Buffer.from('Network connection reset by peer'));
          mockProc.emit('close', 2, null);
        });
        return mockProc;
      };

      await assert.rejects(
        () => resolver.resolve('network error query'),
        (err) => {
          assert.ok(err.message.includes('exited with code 2'));
          assert.ok(err.message.includes('Network connection reset'));
          assert.ok(!err.message.includes('executable was not found'));
          return true;
        }
      );
    });
  });
});
