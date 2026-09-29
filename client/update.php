<?php
// CLI only. PHP 7.3+, ext-curl, ext-openssl. No PHP code is downloaded or executed.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/updater.php';
try {
    if ($argc < 3) throw new RuntimeException('Usage: php update.php CONFIG check|install|activate|rollback [VERSION]');
    $configPath = realpath($argv[1]);
    if (!$configPath || (fileperms($configPath) & 0077)) throw new RuntimeException('Config must exist and have mode 0600');
    $config = json_decode(file_get_contents($configPath), true, 32, JSON_THROW_ON_ERROR);
    $updater = new UmiDeliveryUpdater($config);
    $command = $argv[2];
    if ($command === 'check') echo $updater->check()['version'] . "\n";
    elseif ($command === 'install') echo $updater->install() . " installed; activation is separate\n";
    elseif ($command === 'activate' || $command === 'rollback') { $updater->activate($argv[3] ?? ''); echo "Active: " . $argv[3] . "\n"; }
    else throw new RuntimeException('Unknown command');
} catch (Throwable $error) { fwrite(STDERR, $error->getMessage() . "\n"); exit(1); }
