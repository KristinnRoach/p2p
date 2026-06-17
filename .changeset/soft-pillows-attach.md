---
"@kidlib/p2p": minor
---

Add Solid media playback helpers to `@kidlib/p2p/solid`:

- `attachMediaStream(video, stream, options)`: framework-agnostic controller that sets `srcObject`, attempts `play()`, and exposes `resumePlayback()` for retrying after autoplay is blocked.
- `createMediaPlayback(options)`: Solid wrapper exposing reactive `playbackBlocked` / `playbackError` signals plus `attach`/`detach`/`resumePlayback`, with auto-cleanup on dispose.

Wire `resumePlayback()` to a user gesture (e.g. a "Continue call" button) to recover when the browser blocks autoplay. UI rendering stays in the consuming app.
