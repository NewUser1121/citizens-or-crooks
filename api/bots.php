<?php
header('Content-Type: application/json');
$conn = new mysqli("localhost", "your_username", "your_password", "your_database");
if ($conn->connect_error) die(json_encode(["error" => "Connection failed: " . $conn->connect_error]));

$result = $conn->query("SELECT id, botName, username, points FROM bots");
$bots = [];
while ($row = $result->fetch_assoc()) {
    $bots[] = $row;
}
echo json_encode($bots);

$conn->close();
?>