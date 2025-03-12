const { Client } = require('pg');
const express = require('express');
const app = express();

app.get('/bots', async (req, res) => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await client.connect();
    const result = await client.query('SELECT id, botName, username, points FROM bots');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

module.exports = app;