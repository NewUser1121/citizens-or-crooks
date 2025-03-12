<?php
header('Content-Type: application/json');
$conn = new mysqli("localhost", "your_username", "your_password", "your_database");
if ($conn->connect_error) die(json_encode(["error" => "Connection failed: " . $conn->connect_error]));

if ($_SERVER["REQUEST_METHOD"] == "POST" && isset($_POST['bot1Id']) && isset($_POST['bot2Id'])) {
    $bot1Id = intval($_POST['bot1Id']);
    $bot2Id = intval($_POST['bot2Id']);

    $bot1Stmt = $conn->prepare("SELECT * FROM bots WHERE id = ?");
    $bot1Stmt->bind_param("i", $bot1Id);
    $bot1Stmt->execute();
    $bot1 = $bot1Stmt->get_result()->fetch_assoc();

    $bot2Stmt = $conn->prepare("SELECT * FROM bots WHERE id = ?");
    $bot2Stmt->bind_param("i", $bot2Id);
    $bot2Stmt->execute();
    $bot2 = $bot2Stmt->get_result()->fetch_assoc();

    if (!$bot1 || !$bot2) {
        echo json_encode(["error" => "Bot not found"]);
        exit;
    }

    $bot1Points = 0;
    $bot2Points = 0;
    $bot1History = [];
    $bot2History = [];
    $results = [];

    for ($round = 1; $round <= 20; $round++) {
        $bot1Choice = interpretBotCode($bot1['code'], $bot2History, $round);
        $bot2Choice = interpretBotCode($bot2['code'], $bot1History, $round);

        $bot1History[] = $bot1Choice;
        $bot2History[] = $bot2Choice;

        if ($bot1Choice === 'steal' && $bot2Choice === 'stay') {
            $bot1Points += 8; $bot2Points += 0;
        } elseif ($bot1Choice === 'stay' && $bot2Choice === 'steal') {
            $bot1Points += 0; $bot2Points += 8;
        } elseif ($bot1Choice === 'stay' && $bot2Choice === 'stay') {
            $bot1Points += 4; $bot2Points += 4;
        }

        $results[] = [
            "round" => $round,
            "bot1Choice" => $bot1Choice,
            "bot2Choice" => $bot2Choice,
            "bot1Points" => $bot1Points,
            "bot2Points" => $bot2Points
        ];
    }

    $updateStmt1 = $conn->prepare("UPDATE bots SET points = ? WHERE id = ?");
    $updateStmt1->bind_param("ii", $bot1Points, $bot1Id);
    $updateStmt1->execute();

    $updateStmt2 = $conn->prepare("UPDATE bots SET points = ? WHERE id = ?");
    $updateStmt2->bind_param("ii", $bot2Points, $bot2Id);
    $updateStmt2->execute();

    echo json_encode(["results" => $results, "bot1Points" => $bot1Points, "bot2Points" => $bot2Points]);
} else {
    echo json_encode(["error" => "Invalid request"]);
}

$conn->close();

function interpretBotCode($code, $opponentHistory, $round) {
    if (empty($code)) return rand(0, 1) ? 'steal' : 'stay';

    $lines = explode("\n", $code);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || str_starts_with($line, '//')) continue;

        if (strtolower($line) === 'steal' || strtolower($line) === 'stay') {
            return strtolower($line);
        }

        if (preg_match('/(\d+)% to (steal|stay)/i', $line, $matches)) {
            $percent = intval($matches[1]) / 100;
            return (rand(0, 100) / 100 < $percent) ? strtolower($matches[2]) : ($matches[2] === 'steal' ? 'stay' : 'steal');
        }

        if (preg_match('/if (.+) then (.+)( else (.+))?$/i', $line, $matches)) {
            $condition = trim($matches[1]);
            $action = trim($matches[2]);
            $elseAction = isset($matches[4]) ? trim($matches[4]) : null;

            if (evaluateCondition($condition, $round, $opponentHistory)) {
                return executeAction($action, $opponentHistory, $round);
            } elseif ($elseAction) {
                return interpretBotCode($elseAction, $opponentHistory, $round);
            }
        }
    }
    return rand(0, 1) ? 'steal' : 'stay';
}

function evaluateCondition($condition, $round, $opponentHistory) {
    $parts = explode(' ', $condition);
    $operator = array_shift($parts);
    $value = implode(' ', $parts);

    if ($operator === 'round_number') return intval($value) === $round;
    if ($operator === 'not') {
        if ($value === 'round_number 1') return $round !== 1;
        if ($value === 'opponent_last_steal') return !(count($opponentHistory) > 0 && end($opponentHistory) === 'steal');
    }
    if ($operator === 'opponent_last_steal') return count($opponentHistory) > 0 && end($opponentHistory) === 'steal';
    if ($operator === 'opponent_steal_count') {
        $count = intval($value);
        return count(array_filter($opponentHistory, fn($c) => $c === 'steal')) >= $count;
    }
    if ($operator === 'random') {
        list($min, $max) = array_map('intval', explode('-', $value));
        return (rand($min, $max) > 50);
    }
    return false;
}

function executeAction($action, $opponentHistory, $round) {
    if (preg_match('/(\d+)% to (steal|stay)/i', $action, $matches)) {
        $percent = intval($matches[1]) / 100;
        return (rand(0, 100) / 100 < $percent) ? strtolower($matches[2]) : ($matches[2] === 'steal' ? 'stay' : 'steal');
    }
    if (strtolower($action) === 'steal' || strtolower($action) === 'stay') return strtolower($action);
    return interpretBotCode($action, $opponentHistory, $round);
}
?>