const express = require('express');
const path = require('path');

const app = express();
const PORT = 5000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the demo interface at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo-frontend.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo frontend server running at http://0.0.0.0:${PORT}`);
});

module.exports = app;