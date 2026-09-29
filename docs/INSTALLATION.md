# PHP-клиент

Требования: PHP CLI 7.3+, cURL, OpenSSL, исходящий HTTPS, запись в отдельный каталог assets и приватный каталог состояния. Установщик и конфиг располагаются вне web root. PHP 7.3 поддерживается для совместимости со старыми сайтами; образ пилота не является рекомендацией production-хостинга.

Конфиг JSON с правами 0600:

```json
{
  "baseUrl": "https://delivery.example",
  "token": "64 hex characters from site-add",
  "publicKey": "/srv/site-private/delivery-public.pem",
  "stateDir": "/srv/site-private/delivery",
  "assetDir": "/srv/site/public/assets/umi-consent"
}
```

Пути абсолютные. Приватный каталог состояния должен быть вне document root. Не размещайте его внутри assetDir. PEM получают от оператора по доверенному каналу, независимо от API доставки.

```sh
php /srv/updater/update.php /srv/site-private/config.json check
php /srv/updater/update.php /srv/site-private/config.json install
php /srv/updater/update.php /srv/site-private/config.json activate 0.6.0
php /srv/updater/update.php /srv/site-private/config.json rollback 0.5.0
```

`install` скачивает текущую одобренную версию, но не активирует её. `check`/`install` запоминают максимальную увиденную версию. `activate` и `rollback` повторно проверяют подпись и файлы локальной копии; сеть им не нужна. Повреждение, неверный ключ, отказ API, redirect или неполная загрузка завершают команду ненулевым exit code, активный указатель сохраняется. Lock запрещает параллельные операции. Каталоги версий сохраняются до ручного обслуживания.

## PHP-шаблон

Один раз подключите helper, затем получите обе ссылки одним вызовом:

```php
require '/srv/updater/asset-urls.php';
$consentAssets = umiConsentAssetUrls('/srv/site-private/delivery');
```

Выведите `$consentAssets['css']` в `<link rel="stylesheet">`, `$consentAssets['js']` в `<script defer>`, экранируя `htmlspecialchars(..., ENT_QUOTES, 'UTF-8')`. Конфиг `window.UmiConsentConfig` должен быть перед JS. Helper читает active-version один раз на HTML-ответ, поэтому JS/CSS относятся к одной версии. Для XSLT передайте эти две ссылки из серверного слоя; полноценный UMI/XSLT-адаптер потребует проверки конкретного сайта.

После активации сбросьте серверный HTML-кеш сайта, если он есть. Старые URL остаются рабочими для закешированных страниц. Смена asset-версии не увеличивает consent revision. При первом подключении установите и активируйте релиз до подключения helper в рабочем шаблоне.

Cron может выполнять `check` и передавать результат вашему мониторингу. Автоматический `activate` в пилоте не настраивается.
