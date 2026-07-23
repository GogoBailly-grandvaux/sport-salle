<?php
/**
 * Sport Salle — migration du schéma (idempotente et sans danger).
 * N'exécute QUE les `CREATE TABLE IF NOT EXISTS` du schéma officiel embarqué :
 * ne modifie ni ne supprime jamais rien. Peut être rappelée à volonté
 * (installation initiale, réparation, nouvelle version du schéma).
 */
require __DIR__ . '/lib.php';

$b = read_body();
if (($b['action'] ?? '') !== 'migrate') { fail(400, 'action inconnue'); }

$files = [__DIR__ . '/schema.sql', __DIR__ . '/schema-v2.sql'];
$results = [];
foreach ($files as $f) {
  if (!file_exists($f)) { $results[] = ['file' => basename($f), 'error' => 'absent']; continue; }
  $sql = file_get_contents($f);
  $sql = preg_replace('/^\s*--.*$/m', '', $sql); // retire les commentaires (sinon ^CREATE ne matche pas)
  // sécurité : on ne garde que les CREATE TABLE IF NOT EXISTS
  $stmts = array_filter(array_map('trim', explode(';', $sql)), fn($s) => $s !== '');
  foreach ($stmts as $stmt) {
    if (!preg_match('/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([a-z_]+)`?/i', $stmt, $m)) { continue; }
    try {
      db()->exec($stmt);
      $results[] = ['table' => $m[1], 'ok' => true];
    } catch (PDOException $e) {
      $results[] = ['table' => $m[1], 'ok' => false, 'error' => $e->getMessage()];
    }
  }
}
$st = db()->query('SHOW TABLES');
ok(['results' => $results, 'tables' => $st->fetchAll(PDO::FETCH_COLUMN)]);
