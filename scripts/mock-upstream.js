/**
 * Mock upstream OpenAI-compatible — untuk testing lokal tanpa provider asli.
 * Jalankan: node scripts/mock-upstream.js   (listen :9999)
 */
import http from 'node:http';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const isStream = body.includes('"stream":true');
    if (isStream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const chunks = ['Halo', ' dari', ' mock', ' upstream', '!'];
      let i = 0;
      const t = setInterval(() => {
        if (i >= chunks.length) {
          clearInterval(t);
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            choices: [{ delta: { content: chunks[i++] }, index: 0 }],
          })}\n\n`
        );
      }, 30);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: 'mock',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Halo dari mock upstream!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
    }));
  });
});

server.listen(9999, () => console.log('mock upstream → http://localhost:9999/v1'));
