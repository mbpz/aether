# Rendered GIFs

This directory contains the rendered GIFs from
[`docs/assets/tapes/`](../tapes/README.md).

## Status

The GIFs are rendered locally by the maintainer (requires `vhs` +
Chrome) and are git-ignored (see root `.gitignore`). The tape
files in `docs/assets/tapes/` are the source of truth — they are
checked in and the GIFs are reproducible from them.

## How the README displays the demos

The README's "Try Aether in 5 minutes" section references GIFs in
this directory. If you are browsing the repo on GitHub and the GIFs
are missing (which they will be — they're git-ignored), the GIF
placeholders fall back to the static `*.tape` text. To see the GIFs
locally, render them with `vhs` per `docs/assets/tapes/README.md`.
