const express = require('express');
const { Client } = require('pg');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logs for environment variables
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('DATABASE_URL_FALLBACK:', process.env.DATABASE_URL_FALLBACK);

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_FALLBACK || 'postgresql://localhost:5432/citizens_db',
  ssl: process.env.DATABASE_URL || process.env.DATABASE_URL_FALLBACK ? { rejectUnauthorized: false } : false,
});

async function startServer() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');
    await client.query(`
      CREATE TABLE IF NOT EXISTS bots (
        id SERIAL PRIMARY KEY,
        botName TEXT NOT NULL,
        username TEXT NOT NULL,
        points INTEGER DEFAULT 0,
        code TEXT DEFAULT ''
      )
    `);
  } catch (err) {
    console.error('Database connection error:', err.stack);
    process.exit(1); // Exit if connection fails
  }

  app.get('/api/bots', async (req, res) => {
    try {
      const result = await client.query('SELECT id, botName, username, points FROM bots');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/play', async (req, res) => {
    const { bot1Id, bot2Id } = req.body;
    try {
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

        results.push({ round, bot1Choice, bot2Choice, bot1Points, bot2Points });
      }

      await client.query('UPDATE bots SET points = $1 WHERE id = $2', [bot1Points, bot1Id]);
      await client.query('UPDATE bots SET points = $1 WHERE id = $2', [bot2Points, bot2Id]);
      res.json({ results, bot1Points, bot2Points });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  function interpretBotCode(code, opponentHistory, round) {
    if (!code) return Math.random() > 0.5 ? 'steal' : 'stay';
    const lines = code.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      if (trimmed.toLowerCase() === 'steal' || trimmed.toLowerCase() === 'stay') return trimmed.toLowerCase();
    }
    return Math.random() > 0.5 ? 'steal' : 'stay';
  }

  const port = process.env.PORT || 10000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch(console.error);