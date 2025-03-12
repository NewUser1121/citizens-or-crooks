const express = require('express');
const { Client } = require('pg');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Debug log for DATABASE_URL
console.log('DATABASE_URL:', process.env.DATABASE_URL);

// Use DATABASE_URL, with a fallback for local testing only
const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/citizens_db',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
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
    process.exit(1);
  }

  // API Routes
  // Get all bots or filter by username
  app.get('/api/bots', async (req, res) => {
    try {
      const username = req.query.username;
      let query = 'SELECT id AS id, "botName" AS botName, username AS username, points AS points FROM bots'; // Explicit column names
      let params = [];
      if (username) {
        query += ' WHERE username = $1';
        params.push(username);
      }
      const result = await client.query(query, params);
      // Debug log with exact field names
      const debugRows = result.rows.map(row => ({
        id: row.id,
        botName: row.botName, // Ensure correct field name
        username: row.username,
        points: row.points
      }));
      console.log('Fetched bots with fields:', debugRows);
      res.json(result.rows);
    } catch (err) {
      console.error('Error fetching bots:', err.stack);
      res.status(500).json({ error: 'Failed to fetch bots', details: err.message });
    }
  });

  // Get a specific bot by ID
  app.get('/api/bots/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const result = await client.query('SELECT * FROM bots WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error fetching bot:', err.stack);
      res.status(500).json({ error: 'Failed to fetch bot', details: err.message });
    }
  });

  // Create a new bot
  app.post('/api/bots', async (req, res) => {
    const { botName, username, code } = req.body;
    console.log('Received bot data:', { botName, username, code }); // Debug log
    if (!botName || !username || typeof botName !== 'string' || typeof username !== 'string' || botName.trim() === '' || username.trim() === '') {
      return res.status(400).json({ error: 'botName and username must be non-empty strings' });
    }
    try {
      const result = await client.query(
        'INSERT INTO bots (botName, username, code) VALUES ($1, $2, $3) RETURNING *',
        [botName.trim(), username.trim(), code || '']
      );
      console.log('Bot created successfully:', result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Error creating bot:', err.stack);
      res.status(500).json({ error: 'Failed to create bot', details: err.message });
    }
  });

  // Update an existing bot
  app.put('/api/bots/:id', async (req, res) => {
    const { id } = req.params;
    const { botName, username, code } = req.body;
    console.log('Received update data:', { id, botName, username, code }); // Debug log
    if (!botName || !username || typeof botName !== 'string' || typeof username !== 'string' || botName.trim() === '' || username.trim() === '') {
      return res.status(400).json({ error: 'botName and username must be non-empty strings' });
    }
    try {
      const result = await client.query(
        'UPDATE bots SET botName = $1, username = $2, code = $3 WHERE id = $4 RETURNING *',
        [botName.trim(), username.trim(), code || '', id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      console.log('Bot updated successfully:', result.rows[0]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error updating bot:', err.stack);
      res.status(500).json({ error: 'Failed to update bot', details: err.message });
    }
  });

  // Delete a bot
  app.delete('/api/bots/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const result = await client.query('DELETE FROM bots WHERE id = $1 RETURNING *', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Bot not found' });
      }
      console.log('Bot deleted successfully:', result.rows[0]);
      res.json({ message: 'Bot deleted successfully' });
    } catch (err) {
      console.error('Error deleting bot:', err.stack);
      res.status(500).json({ error: 'Failed to delete bot', details: err.message });
    }
  });

  // Reset leaderboard
  app.post('/api/reset-leaderboard', async (req, res) => {
    try {
      await client.query('TRUNCATE TABLE bots RESTART IDENTITY');
      console.log('Leaderboard reset successfully');
      res.json({ success: true });
    } catch (err) {
      console.error('Error resetting leaderboard:', err.stack);
      res.status(500).json({ success: false, error: 'Failed to reset leaderboard', details: err.message });
    }
  });

  // Play a game between two bots
  app.post('/api/play', async (req, res) => {
    const { bot1Id, bot2Id } = req.body;
    try {
      const bot1 = await client.query('SELECT * FROM bots WHERE id = $1', [bot1Id]);
      const bot2 = await client.query('SELECT * FROM bots WHERE id = $1', [bot2Id]);
      if (bot1.rows.length === 0 || bot2.rows.length === 0) {
        return res.status(404).json({ error: 'Bot not found' });
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
      console.error('Error playing game:', err.stack);
      res.status(500).json({ error: 'Failed to play game', details: err.message });
    }
  });

  // Default route to serve index.html
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
