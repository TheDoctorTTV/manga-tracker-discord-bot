const http = require('http');
const { STATUS_PORT } = require('../config');

function startStatusServer() {
  const statusServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Bot is running!');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  statusServer.listen(STATUS_PORT, '0.0.0.0', () => {
    console.log(`Health check endpoint running at http://0.0.0.0:${STATUS_PORT}/status`);
  });

  return statusServer;
}

module.exports = {
  startStatusServer,
};
