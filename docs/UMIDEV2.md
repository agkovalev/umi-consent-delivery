# Интеграция umidev2

Проверена 2026-09-29 на PHP 8.3.31:

- Сайт: http://localhost:8081/ и https://umi-cookie-consent.cloudpub.ru/.
- Delivery: https://umi-consent-delivery.cloudpub.ru/ → локальный порт 3100.
- Реестр: установка `umidev2`, домен `umi-cookie-consent.cloudpub.ru`, разрешение v0.6.0.
- Код сайта: `/Users/agkovalev/WEBDEV/LOCAL_SERVER/umidev2`, ветка `feature/consent-delivery`.

PHP CLI сайта проверил TLS, скачал подписанный манифест и файлы, проверил подпись
доверенным public.pem и SHA-256, затем отдельно активировал v0.6.0.
Манифест без Bearer-ключа через публичный туннель возвращает 401.
Домен в реестре служит метаданными; доступ разрешает секрет установки.

Приватная установка `.consent-delivery` смонтирована только в PHP-контейнер вне
document root. Config имеет права 0600; PHP-FPM читает только helper и указатель
активной версии. Nginx обслуживает локальные `/assets/umi-consent/0.6.0/`.
Закрытый signing key остаётся у оператора и на сайт не копируется.

В репозитории сайта находятся `docker-compose.override.yml`,
`scripts/consent-template.patch` и runbook `docs/CONSENT_DELIVERY.md`.
Сам head.phtml игнорируется существующими правилами сайта: патч хранит только
подключение helper и замену двух URL. UmiConsentConfig, revision=1 и исходные
assets v0.4.0 сохранены. В этой установке подписанным клиентом установлен только
v0.6.0; возврат к старому подключению описан в runbook сайта.

## Результат браузерной проверки

Локальный и публичный адреса прошли `pnpm test:site`: runtime v0.6.0,
оба локальных assets одной версии, открытие настроек, сохранение отказа после
перезагрузки, отсутствие обращений браузера к delivery API и ошибок JavaScript.

До согласия обнаружены попытки внешних запросов к `mc.yandex.ru`, `ulogin.ru`,
`sonar.semantiqo.com`. Тест их блокирует. Существующий bundle
`public_html/templates/demomarket/compiled/demomarket.lib.js` содержит загрузку
Metrica tag.js и Sonar checking.js; исходники виджетов находятся в
`js/lib/yandex_share.js` и `js/lib/ulogin.js`. На странице подключена minified-копия
этого bundle. Эти файлы не изменялись при подключении доставки.
Полный аудит и исправление consent-gating сторонних виджетов остаются отдельной задачей.

CloudPub-туннели зависят от локальной машины; production-hosting, резервные копии
и эксплуатационные лимиты пока не настроены.
