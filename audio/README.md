# Local Audio Directory

This directory stores audio files for local playback via the `/playfile` and `!playfile` commands.

## How to Supply Test Audio

1. Place any supported audio file directly in this `audio/` directory (e.g. `sample.mp3` or `demo.wav`).
2. Run `/playfile file:sample.mp3` or `!playfile sample.mp3` in your Discord server while connected to a voice channel.

## Supported Formats

The bot supports standard audio containers and codecs decoded via FFmpeg:
- MP3 (`.mp3`)
- WAV (`.wav`)
- OGG / Opus (`.ogg`, `.opus`)
- FLAC (`.flac`)
- AAC / M4A (`.m4a`, `.aac`)
- WebM (`.webm`)

## Guidelines & Security

- Files must reside directly inside this `audio/` directory. Path traversal (e.g. `../` or subdirectories) is disallowed for security.
- Nothing else here 😒😒😒
