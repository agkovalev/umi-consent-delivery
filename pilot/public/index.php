<?php
require '/app/client/asset-urls.php';
try { $assets = umiConsentAssetUrls('/pilot/private'); }
catch (Throwable $error) { http_response_code(503); echo 'Install and activate a release first.'; exit; }
?>
<!doctype html><html lang="ru"><meta charset="utf-8"><title>UMI Consent delivery pilot</title>
<link rel="stylesheet" href="<?= htmlspecialchars($assets['css'], ENT_QUOTES, 'UTF-8') ?>">
<h1>Пилот доставки</h1><button type="button" data-cc="show-preferencesModal">Настройки cookies</button>
<script>window.UmiConsentConfig = { preset: 'custom', locale: 'ru', revision: 1 };</script>
<script defer src="<?= htmlspecialchars($assets['js'], ENT_QUOTES, 'UTF-8') ?>"></script></html>
