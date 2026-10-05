# Tennis
All about Tennis rackets

## Racket Check

A web page where you take or upload a photo of your tennis racket and get
suggestions on what to change: strings, grip, frame, bumper guard, dampener and
overall setup. You can also add your level, playing style and how often you play
to get better suggestions.

The photo is analyzed by Claude (vision) through a small Node/Express server, so
your API key stays on the server and never reaches the browser.

### Run it

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # your Anthropic API key
npm start
```

Open http://localhost:3000. On a phone on the same network, open
`http://<your-computer-ip>:3000`; the upload button lets you use the camera.

### How it works

- `public/` holds the page. It shrinks the photo in the browser to 1568px max
  and sends it to the server as JPEG.
- `server.js` serves the page and has `POST /api/analyze`. That endpoint sends
  the photo and player info to `claude-opus-5-5` and asks for JSON that matches
  a fixed schema (structured outputs). The JSON holds the overall condition,
  racket details and a priority-sorted list of recommendations.
