const { Client } = require('pg');
const express = require('express');
const app = express();
app.use(express.urlencoded({ extended: true }));

app.post('/play', async (req, res) => {
  const { bot1Id, bot2Id } = req.body;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await client.connect();
    const bot1 = await client.query('SELECT * FROM bots WHERE id = $1', [bot1Id]);
    const bot2 = await client.query('SELECT * FROM bots WHERE id = $1', [bot2Id]);
    if (bot1.rows.length === 0 || bot2.rows.length === 0) {
      return res.json({ error: 'Bot not found' });
    }

    const bot1Data = bot1.rows[0];
    const bot2Data = bot2.rows[0];
    let bot1Points = 0, bot2Points = 0;
    const bot1History = [], bot2History = [];
    const results = [];

    for (let round = 1; round <= 20; round++) {
      const bot1Choice = interpretBotCode(bot1Data.code, bot2History, round);
      const bot2Choice = interpretBotCode(bot2Data.code, bot1History, round);

      bot1History.push(bot1Choice);
      bot2History.push(bot2Choice);

      if (bot1Choice === 'steal' && bot2Choice === 'stay') {
        bot1Points += 8; bot2Points += 0;
      } else if (bot1Choice === 'stay' && bot2Choice === 'steal') {
        bot1Points += 0; bot2Points += 8;
      } else if (bot1Choice === 'stay' && bot2Choice === 'stay') {
        bot1Points += 4; bot2Points += 4;
      }

      results.push({
        round, bot1Choice, bot2Choice, bot1Points, bot2Points,
      });
    }

    await client.query('UPDATE bots SET points = $1 WHERE id = $2', [bot1Points, bot1Id]);
    await client.query('UPDATE bots SET points = $1 WHERE id = $2', [bot2Points, bot2Id]);
    res.json({ results, bot1Points, bot2Points });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

function interpretBotCode(code, opponentHistory, round) {
  if (!code) return Math.random() > 0.5 ? 'steal' : 'stay';
  const lines = code.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (trimmed.toLowerCase() === 'steal' || trimmed.toLowerCase() === 'stay') return trimmed.toLowerCase();
    // Add more logic as in your original server.js (e.g., % chance, if-then-else)
  }
  return Math.random() > 0.5 ? 'steal' : 'stay';
}

module.exports = app;