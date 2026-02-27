# How to View Telos Visualization

## The Issue: CORS and file://

Modern browsers block `fetch()` requests when opening HTML files directly (file:// protocol) for security reasons. This means opening `web/index.html` by double-clicking will show "Failed to fetch" error.

## Solution: Serve via HTTP

### Option 1: Python HTTP Server (recommended)

```bash
cd /home/jared/.openclaw/agents/atlas/it003-telos/web
python3 -m http.server 8765
```

Then open: http://localhost:8765

### Option 2: Node.js HTTP Server

```bash
cd /home/jared/.openclaw/agents/atlas/it003-telos/web
npx http-server -p 8765
```

Then open: http://localhost:8765

### Option 3: Screenshot Script

```bash
cd /home/jared/.openclaw/agents/atlas
node scripts/screenshot.js http://localhost:8765/index.html /tmp/telos.png
```

## For Production

If you want to share Telos visualizations:

1. **Export to static hosting:** Upload `web/` folder to GitHub Pages, Netlify, or Vercel
2. **Embed data in HTML:** Modify `index.html` to include JSON inline instead of fetching
3. **Use local server:** Always serve via HTTP (not file://)

## Quick Command

Add this alias to your shell:

```bash
alias telos-viz="cd /home/jared/.openclaw/agents/atlas/it003-telos/web && python3 -m http.server 8765 && echo 'Open http://localhost:8765'"
```

Then just run: `telos-viz`
