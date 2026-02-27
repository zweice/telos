#!/usr/bin/env node
// server.js — Simple HTTP server with cache-control headers

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT) || 8088;
const ROOT = path.join(__dirname, 'web');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const CACHE_CONTROL = {
  '.html': 'no-store',
  '.js': 'no-store',
  '.json': 'no-store',
  '.css': 'no-store',
  '.png': 'max-age=31536000, immutable',
  '.jpg': 'max-age=31536000, immutable',
  '.svg': 'max-age=31536000, immutable'
};

const server = http.createServer((req, res) => {
  let url = req.url;
  if (url === '/') url = '/index.html';

  const filePath = path.join(ROOT, url);
  const ext = path.extname(filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(500);
      return res.end('Internal server error');
    }

    const contentType = MIME_TYPES[ext] || 'text/plain';
    const cacheControl = CACHE_CONTROL[ext] || 'no-store';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  });
});

const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  console.log(`✅ Telos dashboard running at http://${HOST}:${PORT}`);
  console.log(`📁 Serving from: ${ROOT}`);
  console.log(`🔒 Security headers: X-Frame-Options=DENY, X-Content-Type-Options=nosniff`);
  console.log(`🚫 Cache disabled for HTML/JS/JSON (no-store)`);
});
