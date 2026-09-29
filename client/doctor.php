<?php
// Keep this entrypoint parseable on old PHP; load the client only after the gate.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$failed = false;
function report($level, $message) {
    global $failed;
    if ($level === 'FAIL') $failed = true;
    echo $level . ' ' . $message . "\n";
}
if (version_compare(PHP_VERSION, '7.3.0', '<')) {
    report('FAIL', 'Нужен PHP CLI 7.3+; выберите другой PHP в панели хостинга.'); exit(1);
}
report('OK', 'PHP CLI ' . PHP_VERSION);
foreach (array('curl', 'openssl', 'json', 'hash') as $extension) {
    report(extension_loaded($extension) ? 'OK' : 'FAIL', 'Расширение ' . $extension . ': при отсутствии включите для CLI PHP.');
}
$disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
foreach (array('random_bytes', 'flock', 'rename', 'chmod', 'mkdir', 'tempnam', 'file_get_contents', 'file_put_contents', 'hash_file', 'openssl_verify', 'curl_init') as $function) {
    if (!is_callable($function) || in_array($function, $disabled, true)) report('FAIL', 'Недоступна функция ' . $function . '; уточните ограничения PHP у хостинга.');
}
if ($failed) exit(1);
set_error_handler(function () { throw new RuntimeException('Не удалось выполнить файловую/PHP операцию; проверьте права и open_basedir.'); });

function canonicalPath($path) {
    if (!is_string($path) || substr($path, 0, 1) !== '/' || strpos($path, "\0") !== false ||
        preg_match('~(^|/)\.\.?(/|$)~', $path)) throw new RuntimeException('Укажите абсолютные пути без . и .. в конфиге.');
    $path = rtrim($path, '/');
    if ($path === '') return '/';
    if (file_exists($path)) {
        $real = realpath($path);
        if ($real === false) throw new RuntimeException('Не удалось разрешить путь; проверьте open_basedir.');
        return $real;
    }
    return rtrim(canonicalPath(dirname($path)), '/') . '/' . basename($path);
}
function within($path, $root) { return $path === $root || strpos($path, rtrim($root, '/') . '/') === 0; }
function probeDirectory($path, $label) {
    $directory = is_dir($path) ? $path : dirname($path);
    if (!is_dir($directory)) throw new RuntimeException($label . ': создайте родительский каталог, затем повторите проверку.');
    $temporary = null; $moved = null; $handle = null;
    try {
        $temporary = tempnam($directory, '.consent-doctor-');
        if (!$temporary || dirname($temporary) !== realpath($directory)) throw new RuntimeException($label . ': нет доступа для записи.');
        chmod($temporary, 0600);
        if (file_put_contents($temporary, 'probe') !== 5) throw new RuntimeException('Пробная запись не удалась.');
        $handle = fopen($temporary, 'r+');
        if (!$handle || !flock($handle, LOCK_EX | LOCK_NB)) throw new RuntimeException('Блокировка файлов недоступна.');
        flock($handle, LOCK_UN); fclose($handle); $handle = null;
        // A second exclusively allocated name avoids replacing any existing file.
        $moved = tempnam($directory, '.consent-doctor-');
        if (!$moved || !rename($temporary, $moved) || file_get_contents($moved) !== 'probe') throw new RuntimeException('Атомарное переименование не удалось.');
        report('OK', $label . ': запись, блокировка и переименование доступны.');
        if (!is_dir($path)) report('WARN', $label . ': каталог отсутствует; установщик создаст его при запуске.');
    } finally {
        if (is_resource($handle)) fclose($handle);
        foreach (array($temporary, $moved) as $file) if ($file && file_exists($file)) unlink($file);
    }
}

try {
    $configFile = null; $online = false; $webRoot = null;
    for ($i = 1; $i < $argc; $i++) {
        if ($argv[$i] === '--online') $online = true;
        elseif ($argv[$i] === '--web-root' && isset($argv[$i + 1])) $webRoot = $argv[++$i];
        elseif (substr($argv[$i], 0, 2) !== '--' && $configFile === null) $configFile = $argv[$i];
        else throw new RuntimeException('Использование: php doctor.php [CONFIG] [--online] [--web-root /absolute/public_html]');
    }
    if ($configFile === null) {
        if ($online || $webRoot !== null) throw new RuntimeException('Для этих параметров укажите CONFIG.');
        report('WARN', 'Для проверки путей и доступа укажите config.json; для HTTPS добавьте --online.');
        exit(0);
    }
    $configPath = realpath($configFile);
    if (!$configPath || !is_file($configPath) || (fileperms($configPath) & 0077)) throw new RuntimeException('Конфиг должен быть читаемым файлом с правами 0600; выполните chmod 600 config.json.');
    $config = json_decode(file_get_contents($configPath), true);
    if (!is_array($config) || json_last_error() !== JSON_ERROR_NONE) throw new RuntimeException('Некорректный JSON; проверьте запятые и кавычки.');
    foreach (array('baseUrl','token','publicKey','stateDir','assetDir') as $field) {
        if (!isset($config[$field]) || !is_string($config[$field]) || strpos($config[$field], 'REPLACE_') !== false) throw new RuntimeException('Заполните обязательные поля и замените все REPLACE_ в конфиге.');
    }
    $state = canonicalPath($config['stateDir']); $assets = canonicalPath($config['assetDir']);
    if (within($state, $assets) || within($assets, $state)) throw new RuntimeException('Каталоги state и assets должны быть раздельными, без вложения друг в друга.');
    if ($webRoot !== null) {
        $public = canonicalPath($webRoot);
        if (!is_dir($public)) throw new RuntimeException('Web root должен существовать; уточните путь в панели.');
        foreach (array($state, $configPath, realpath(__DIR__)) as $private) {
            if (within($private, $public)) throw new RuntimeException('Клиент, конфиг и state должны находиться вне web root.');
        }
        if (!within($assets, $public)) report('WARN', 'assets вне web root; проверьте отдельное сопоставление каталога с URL на сервере.');
        report('OK', 'Приватные файлы расположены вне указанного web root.');
    } else report('WARN', 'CLI не знает web root. Повторите с --web-root /absolute/public_html для проверки размещения.');
    require __DIR__ . '/updater.php';
    $client = new UmiDeliveryUpdater($config, true);
    report('OK', 'Конфиг, endpoint, формат ключа установки и доверенный RSA PEM.');
    probeDirectory($state, 'state'); probeDirectory($assets, 'assets');
    report('WARN', 'Отдельно проверьте чтение helper и active-version из PHP сайта: его пользователь/open_basedir могут отличаться от CLI.');
    if ($online) {
        try {
            $manifest = $client->probe();
            report('OK', 'HTTPS/доступ и подпись манифеста проверены; доступная версия ' . $manifest['version'] . '. Состояние не изменено.');
            if (strpos($config['baseUrl'], 'http://') === 0) report('WARN', 'Использован локальный HTTP; проверка TLS для внешнего хостинга ещё требуется.');
        } catch (Throwable $error) {
            $message = $error->getMessage();
            if (strpos($message, 'HTTP 401') !== false) $hint = '401: ключ неверен или отозван; обратитесь к оператору.';
            elseif (strpos($message, 'HTTP 403') !== false) $hint = '403: оператор должен разрешить версию для установки.';
            elseif (strpos($message, 'HTTP 429') !== false) $hint = '429: превышен лимит; повторите позднее.';
            elseif (strpos($message, 'HTTP 0') !== false) $hint = 'Сеть/TLS: проверьте DNS, исходящий HTTPS и сертификаты CA; не отключайте проверку TLS.';
            elseif (strpos($message, 'HTTP ') !== false) $hint = 'HTTP-ошибка: уточните endpoint и состояние сервера у оператора. Редиректы не разрешены.';
            else $hint = 'Подпись или структура ответа неверна; сверьте доверенный PEM с оператором.';
            report('FAIL', $hint);
        }
    }
} catch (Throwable $error) {
    // Client messages are static; never print PHP/JSON excerpts or input data.
    $safe = array('baseUrl must be an HTTPS origin (HTTP allowed only on loopback)', 'Paths must be absolute', 'Invalid token format', 'Invalid trusted RSA public key');
    $message = $error->getMessage();
    if (in_array($message, $safe, true)) report('FAIL', 'Проверьте endpoint, 64-символьный ключ установки, абсолютные пути и RSA PEM (3072+ бит).');
    else report('FAIL', $message);
}
exit($failed ? 1 : 0);
