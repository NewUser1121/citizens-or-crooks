const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const app = express();
const port = 3000;

app.use(express.static(__dirname));
app.use(express.json());

const db = new sqlite3.Database('database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`
      CREATE TABLE IF NOT EXISTS bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        botName TEXT NOT NULL,
        username TEXT NOT NULL,
        points INTEGER DEFAULT 0,
        code TEXT DEFAULT ''
      )
    `, (err) => {
      if (err) console.error('Table creation error:', err);
    });
  }
});

const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('close', () => console.log('WebSocket client disconnected'));
});

function broadcastUpdate() {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'botUpdate' }));
    }
  });
}

app.get('/api/bots', (req, res) => {
  const { username } = req.query;
  let query = 'SELECT * FROM bots';
  const params = [];
  if (username) {
    query += ' WHERE username = ?';
    params.push(username);
  }
  query += ' ORDER BY points DESC';
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching bots:', err);
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/bots', (req, res) => {
  const { botName, username, code, id } = req.body;
  console.log('Received bot data:', { botName, username, code, id });

  if (!botName || !username) {
    res.status(400).json({ error: 'botName and username are required' });
    return;
  }

  if (id) {
    db.run(
      'UPDATE bots SET botName = ?, username = ?, code = ? WHERE id = ?',
      [botName, username, code || '', id],
      function (err) {
        if (err) {
          console.error('Update error:', err);
          res.status(500).json({ error: err.message });
          return;
        }
        console.log('Bot updated, ID:', id);
        res.json({ message: 'Bot updated', id });
        broadcastUpdate();
      }
    );
  } else {
    db.run(
      'INSERT INTO bots (botName, username, code, points) VALUES (?, ?, ?, 0)',
      [botName, username, code || ''],
      function (err) {
        if (err) {
          console.error('Insert error:', err);
          res.status(500).json({ error: err.message });
          return;
        }
        console.log('Bot created, ID:', this.lastID);
        res.json({ message: 'Bot created', id: this.lastID });
        broadcastUpdate();
      }
    );
  }
});

app.get('/api/bots/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM bots WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('Error fetching bot:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json(row);
  });
});

app.delete('/api/bots/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM bots WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('Delete error:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    if (this.changes === 0) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    console.log('Bot deleted, ID:', id);
    res.json({ message: 'Bot deleted', id });
    broadcastUpdate();
  });
});

app.post('/api/play', (req, res) => {
  const { bot1Id, bot2Id } = req.body;
  if (!bot1Id || !bot2Id) {
    res.status(400).json({ error: 'Two bot IDs are required' });
    return;
  }

  db.get('SELECT * FROM bots WHERE id = ?', [bot1Id], (err, bot1) => {
    if (err || !bot1) {
      res.status(500).json({ error: 'Bot 1 not found' });
      return;
    }
    db.get('SELECT * FROM bots WHERE id = ?', [bot2Id], (err, bot2) => {
      if (err || !bot2) {
        res.status(500).json({ error: 'Bot 2 not found' });
        return;
      }

      let bot1Points = 0;
      let bot2Points = 0;
      const bot1History = [];
      const bot2History = [];
      const results = [];

      for (let round = 1; round <= 20; round++) {
        const bot1Choice = interpretBotCode(bot1.code, bot2History, round);
        const bot2Choice = interpretBotCode(bot2.code, bot1History, round);

        bot1History.push(bot1Choice);
        bot2History.push(bot2Choice);

        const [userPts, oppPts] = calculateRoundPoints(bot1Choice, bot2Choice);
        bot1Points += userPts;
        bot2Points += oppPts;
        results.push({ round, bot1Choice, bot2Choice, bot1Points, bot2Points });
      }

      db.get('SELECT points FROM bots WHERE id = ?', [bot1Id], (err, row) => {
        const currentPoints = row ? row.points : 0;
        if (bot1Points > currentPoints) {
          db.run('UPDATE bots SET points = ? WHERE id = ?', [bot1Points, bot1Id], (err) => {
            if (err) console.error('Error updating bot1 points:', err);
          });
        }
      });
      db.get('SELECT points FROM bots WHERE id = ?', [bot2Id], (err, row) => {
        const currentPoints = row ? row.points : 0;
        if (bot2Points > currentPoints) {
          db.run('UPDATE bots SET points = ? WHERE id = ?', [bot2Points, bot2Id], (err) => {
            if (err) console.error('Error updating bot2 points:', err);
          });
        }
      });

      res.json({ results, bot1Points, bot2Points });
      broadcastUpdate();
    });
  });
});

app.post('/api/reset-leaderboard', (req, res) => {
  db.run('DELETE FROM bots', [], (err) => {
    if (err) {
      console.error('Error resetting leaderboard:', err);
      res.json({ success: false, error: err.message });
    } else {
      res.json({ success: true, message: 'Leaderboard reset successfully' });
      broadcastUpdate();
    }
  });
});

function interpretBotCode(code, opponentHistory, round) {
  if (!code || code.trim() === '') {
    return Math.random() > 0.5 ? 'steal' : 'stay';
  }

  const lines = code.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('//')) continue;

    if (['steal', 'stay'].includes(trimmedLine.toLowerCase())) {
      return trimmedLine.toLowerCase();
    }

    const percentageMatch = trimmedLine.match(/(\d+)% to (steal|stay)/i);
    if (percentageMatch) {
      const percent = parseInt(percentageMatch[1]) / 100;
      return Math.random() < percent ? percentageMatch[2].toLowerCase() : (percentageMatch[2] === 'steal' ? 'stay' : 'steal');
    }

    const ifMatch = trimmedLine.match(/if (.+) then (.+)( else (.+))?/i);
    if (ifMatch) {
      const condition = ifMatch[1].trim();
      const action = ifMatch[2].trim();
      const elseAction = ifMatch[4] ? ifMatch[4].trim() : null;

      if (evaluateCondition(condition, round, opponentHistory)) {
        return executeAction(action, opponentHistory, round);
      } else if (elseAction) {
        return interpretBotCode(elseAction, opponentHistory, round);
      }
    }
  }
  return Math.random() > 0.5 ? 'steal' : 'stay';
}

function evaluateCondition(condition, round, opponentHistory) {
  const nestedIfMatch = condition.match(/(.+) then (.+)/i);
  if (nestedIfMatch) {
    const subCondition = nestedIfMatch[1].trim();
    return evaluateCondition(subCondition, round, opponentHistory);
  }

  const parts = condition.split(' ');
  const operator = parts[0];
  const value = parts.slice(1).join(' ');

  if (operator === 'round_number') return parseInt(value) === round;
  if (operator === 'not') {
    if (value === 'round_number 1') return round !== 1;
    if (value === 'opponent_last_steal') return !(opponentHistory.length > 0 && opponentHistory[opponentHistory.length - 1] === 'steal');
  }
  if (operator === 'opponent_last_steal') return opponentHistory.length > 0 && opponentHistory[opponentHistory.length - 1] === 'steal';
  if (operator === 'opponent_steal_count') {
    const count = parseInt(value) || 0;
    return opponentHistory.filter(c => c === 'steal').length >= count;
  }
  if (operator === 'random') {
    const [min, max] = value.split('-').map(Number);
    return Math.random() * (max - min) + min > 50;
  }
  throw new Error(`Invalid condition: "${condition}"`);
}

function executeAction(action, opponentHistory, round) {
  const percentageMatch = action.match(/(\d+)% to (steal|stay)/i);
  if (percentageMatch) {
    const percent = parseInt(percentageMatch[1]) / 100;
    return Math.random() < percent ? percentageMatch[2].toLowerCase() : (percentageMatch[2] === 'steal' ? 'stay' : 'steal');
  }
  if (['steal', 'stay'].includes(action.toLowerCase())) return action.toLowerCase();
  return interpretBotCode(action, opponentHistory, round);
}

function calculateRoundPoints(choice1, choice2) {
  if (choice1 === 'steal' && choice2 === 'stay') return [8, 0];
  if (choice1 === 'stay' && choice2 === 'steal') return [0, 8];
  if (choice1 === 'stay' && choice2 === 'stay') return [4, 4];
  return [0, 0];
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`WebSocket running on ws://localhost:8080`);
});