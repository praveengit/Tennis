# Reference photos

Labelled photos that show Claude what each condition looks like. They are sent
with every analysis, before the player's photo, and are cached, so after the
first request they cost little.

## Adding a photo

1. Put the photo in this folder, e.g. `strings-notched-01.jpg`.
   Use `.jpg`, `.png`, `.webp` or `.gif`, under 5 MB (about 1600px on the
   long side is plenty).
2. Add an entry to `examples.json`:

```json
[
  { "file": "strings-notched-01.jpg", "label": "Strings: deep notching on polyester mains at the sweet spot. Restring now." },
  { "file": "grommets-cracked-01.jpg", "label": "Grommets: cracked grommet at 2 o'clock, string touching the frame. Replace the grommet set." },
  { "file": "weave-error-01.jpg", "label": "Weave: crosses 7 and 8 from the top have the same over/under (weave error)." }
]
```

3. Restart the server. It prints how many reference photos it loaded.

## What makes a good reference photo

- One condition per photo, close enough to see it clearly.
- A label that says what is shown, where, and what to do about it.
- Both bad and good examples (a healthy grommet strip is as useful as a
  cracked one).
- 2-4 photos per condition, 20 photos at most in total.

Never reuse a photo from `evals/photos/` here. The scoring script checks this,
because a test photo that is also a reference photo makes the score look
better than it is.
