# Terminal recordings (tape files + rendered GIFs)

This directory holds the [vhs](https://github.com/charmbracelet/vhs)
tape scripts that produce the GIFs in `docs/assets/gifs/`. The
tapes are documentation only — they document the exact commands
shown in the GIFs so the GIFs are regenerable.

## Render

To regenerate the GIFs:

```bash
# Install vhs (requires Go + Chrome):
go install github.com/charmbracelet/vhs@latest

# Render all tapes:
for tape in docs/assets/tapes/*.tape; do
  vhs "$tape"
done
```

Output goes to `docs/assets/gifs/`.

## Tapes

| Tape | Skill demonstrated | Output GIF |
|------|--------------------|-------------|
| `01-hello-world.tape` | hello-world | `gifs/01-hello-world.gif` |
| `02-csv-summary.tape` | csv-summary | `gifs/02-csv-summary.gif` |
| `03-memory-recall.tape` | memory-recall | `gifs/03-memory-recall.gif` |

(dns-lookup + git-status tapes are similar in structure; left as
future contributions.)

## Note on the demo URL

The tapes reference `aether-demo.example.com` as the demo host.
When deploying your own demo (see `deploy/k3s/README.md`), update
the URLs in the tapes to match your actual domain.
