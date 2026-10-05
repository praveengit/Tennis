# Scoring the analyzer

A set of real racket photos with the correct answers written down, and a
script that runs the analyzer on all of them and reports how often it gets
each check right. Use it to tell whether a change (to the knowledge base,
the reference photos or the model) actually helps.

## Adding a test photo

1. Put the photo in `evals/photos/`, e.g. `racket-01.jpg` (under 5 MB).
2. Add an entry to `evals/cases.json` with the answers you, or a stringer,
   are sure of. Leave out anything you're not sure of; only the answers you
   write down are scored.

```json
[
  {
    "file": "racket-01.jpg",
    "player": { "level": "Intermediate", "lastRestrung": "Over 6 months ago" },
    "expected": {
      "is_tennis_racket": true,
      "overall_condition": "fair",
      "strings_need_replacing": true,
      "frame_damage": false,
      "overgrip_worn": true,
      "grommets": "worn",
      "weave": "good"
    }
  }
]
```

`player` is optional and takes the same fields as the web form: `level`,
`style`, `frequency`, `lastRestrung`, `notes`.

## What each answer means

| Answer | Values | Scored as correct when |
|---|---|---|
| `is_tennis_racket` | `true` / `false` | the analyzer says the same |
| `overall_condition` | `excellent`, `good`, `fair`, `poor` | exact match |
| `strings_need_replacing` | `true` / `false` | `true` = a strings fix marked "Act now" or "Soon" |
| `frame_damage` | `true` / `false` | `true` = a frame fix marked "Act now" |
| `overgrip_worn` | `true` / `false` | `true` = a grip fix marked "Act now" or "Soon" |
| `grommets` | `good`, `worn`, `damaged` | the grommet check verdict matches |
| `weave` | `good`, `minor_issues`, `faulty` | the pattern & weave check verdict matches |

## Running it

```bash
npm run eval -- --dry-run            # check cases and photos, no API calls
npm run eval                         # score every case
npm run eval -- --only racket-01.jpg # one case
```

Each case is one API call, so a full run costs money: roughly a few cents per
photo with Claude Opus 5.5, more with many reference photos. The script prints
the tokens used. Full results, including every analysis, are saved in
`evals/results/` (not committed).

## Rules that keep the score honest

- Never use the same photo as a test photo and a reference photo
  (`knowledge/examples/`). The script refuses to run if it finds one.
- Aim for 30-50 photos covering every condition, including healthy rackets.
- Change one thing at a time, then re-run and compare the scores.
- Results vary a little between runs, so treat a change of one or two
  photos as noise.
