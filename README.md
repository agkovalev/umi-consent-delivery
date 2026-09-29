# umi-consent-delivery

Доставка подписанных обновлений umi-cookie-consent авторизованным установкам. Сервис: Node.js/TypeScript, Fastify, SQLite. Клиент: PHP CLI. Управление и активация выполняются вручную.

## Установка на shared-хостинг

Для установки **на обычный shared-хостинг** начните с [START-HERE](START-HERE.md)
и [инструкции интегратора](docs/INTEGRATOR.md). Docker и Node.js на клиентском сайте
не нужны. Выдача ключей и управление сервером: [инструкция оператора](docs/OPERATOR.md).

Универсальный ZIP без секретов: `pnpm client:archive`. Архив и SHA-256 sidecar
появятся в `release/`. Версия клиента берётся из package.json и независима от версии библиотеки.

## Локальный пилот

Нужны Node.js 22.22.2+, pnpm 11.22.0, Docker Compose. В соседнем `umi-cookie-consent/release` должны находиться ZIP и SHA-256 sidecar релизов v0.5.0 и v0.6.0.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pilot:prepare
docker compose up -d --build --wait
docker compose exec -T site php /app/tests/client-test.php
docker compose exec -T site php /app/client/update.php /pilot/private/config.json install
docker compose exec -T site php /app/client/update.php /pilot/private/config.json activate 0.6.0
```

Откройте [тестовый сайт](http://localhost:8088). API доступен на [localhost:3100](http://localhost:3100/health). Оба порта опубликованы только на loopback. PHP и delivery разделяют сетевой namespace для локального HTTP; файлы сайта и закрытый signing key не смонтированы в delivery-контейнер.

`pilot:prepare` создаёт `.local/service`, `.local/pilot` и `.local/offline`, импортирует оба релиза и разрешает пилоту v0.6.0. Секреты не печатаются. Для другого расположения архивов: `pnpm pilot:prepare /absolute/release/path`. Данные сохраняются при `docker compose down`. Каталог `.local` исключён из Git и Docker build context; закрытый ключ не смонтирован ни в один контейнер.

## Команды оператора

После `pnpm build`, по умолчанию используется `.local/service`; другой путь задаётся через `DELIVERY_DATA`.

```sh
pnpm admin keygen /secure/private.pem /secure/public.pem
pnpm admin import 0.6.0 /releases/umi-cookie-consent-v0.6.0.zip /releases/umi-cookie-consent-v0.6.0.zip.sha256 /secure/private.pem
pnpm admin site-add example example.ru
pnpm admin approve example 0.6.0
pnpm admin sites
pnpm admin site-revoke example
pnpm admin site-rotate example
```

`site-add` и `site-rotate` намеренно выводят новый ключ один раз. Сохраните его в конфиге сайта с правами 0600; не отправляйте вывод в общие логи. Ротация снова включает доступ и сохраняет назначения версий.

Для работающего Docker-пилота операции реестра выполняйте через
`docker compose exec -T delivery node build/src/cli.js COMMAND ...`, а не host CLI.
На Docker Desktop нельзя полагаться на совместное открытие WAL из macOS и контейнера.
Импорт с закрытым ключом на хосте выполняйте при остановленном API.
Полная последовательность и выбор команды admin — в [руководстве оператора](docs/OPERATOR.md).

Домен — запись в реестре, доступ определяется ключом установки. Отзыв запрещает последующее скачивание, но не удаляет установленные файлы. Владелец сайта отдельно запускает `install`, затем `activate`; нет браузерной зависимости от сервиса доставки.

Подробнее: [документация](docs/INDEX.md), [контракт API](docs/ARCHITECTURE.md), [установка](docs/INSTALLATION.md). Сервис развёрнут на `https://cookie1.ru`; [production-инструкция](docs/PRODUCTION.md) описывает перенос и проверки. Внешнее хранилище копий пока не подключено. Политика лицензирования самой библиотеки не меняется.
