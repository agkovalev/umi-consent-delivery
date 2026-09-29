# Проверки

`pnpm check` компилирует TypeScript и выполняет node:test через настоящий SQLite и Fastify inject. Покрывает API-доступ, разделение разрешений сайтов, ротацию/отзыв, точность выдачи, повреждение файлов и отказ импорта некорректного ZIP.

```sh
docker compose build
docker compose exec -T site php /app/tests/client-test.php
```

Если Compose-сервисы ещё не созданы, запустите клиентские тесты напрямую:

```sh
docker run --rm -v "$PWD/client:/app/client:ro" -v "$PWD/tests:/app/tests:ro" umi-consent-delivery-site php /app/tests/client-test.php
```

PHP-тест создаёт временный ключ и HTTP fixture на loopback. Проверяет первоначальную установку, upgrade, отдельную активацию, откат, downgrade, блокировку параллельного запуска, испорченную подпись/файл, обрыв, redirect, недоступность API и повторную проверку файлов при активации. Временные данные удаляются. CI выполняет те же проверки и npm audit high.

Полный пилот по README импортирует реальные v0.5.0 и v0.6.0 из соседнего проекта. Эти архивы и локальные ключи не входят в Git. После запуска и активации v0.6.0 выполните `pnpm exec playwright install chromium`, затем `pnpm test:browser`. Тест проверяет `window.UmiConsent.version`, загрузку обоих локальных assets, открытие настроек и отсутствие запросов браузера к API доставки/провайдерам.
