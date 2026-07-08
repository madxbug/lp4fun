// Local dev helper: the production RPC proxy (rpc-proxy.segfaultx0.workers.dev) only sends
// CORS headers for https://lp4fun.vercel.app, so browser RPC calls fail on localhost.
// This forwards JSON-RPC to it and adds permissive CORS headers.
//
// Usage: node scripts/dev-rpc-proxy.js
// Then set NEXT_PUBLIC_RPC_ENDPOINT=http://localhost:8899 in .env.local
const http = require('http');

const UPSTREAM = process.env.RPC_UPSTREAM || 'https://rpc-proxy.segfaultx0.workers.dev';
const PORT = process.env.PORT || 8899;

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const upstream = await fetch(UPSTREAM, {
                method: req.method,
                headers: {'Content-Type': 'application/json'},
                body: req.method === 'POST' ? body : undefined,
            });
            const text = await upstream.text();
            res.writeHead(upstream.status, {'Content-Type': 'application/json'});
            res.end(text);
        } catch (e) {
            res.writeHead(502, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({error: String(e)}));
        }
    });
});

server.listen(PORT, () => console.log(`RPC CORS proxy on http://localhost:${PORT} -> ${UPSTREAM}`));
