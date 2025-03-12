CREATE TABLE bots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    botName TEXT NOT NULL,
    username TEXT NOT NULL,
    points INT DEFAULT 0,
    code TEXT DEFAULT ''
);