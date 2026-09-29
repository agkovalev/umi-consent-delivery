# Production: cookie1.ru

Эта инструкция переносит **существующий** локальный реестр на Ubuntu VPS
195.161.114.25, где уже работают Nginx и другие сайты. Для `cookie1.ru` создаётся
отдельный virtual host; конфигурации Strapi и остальных сайтов сохраняются.
Браузеры продолжают получать JS/CSS с сайтов; `https://cookie1.ru` нужен PHP-клиенту
для ручной установки одобренных версий. `cookie1.ru` целиком выделен под API.

Владелец подтвердил, что существующие сайты VPS надо сохранить. 2026-09-29
публичный DNS `cookie1.ru` указывал на этот VPS, но Nginx не имел отдельного
`server_name cookie1.ru`: запросы попадали в чужой default vhost с просроченным
сертификатом. Для нового vhost нужен собственный доверенный сертификат.

## 1. Зафиксировать исходный код и подготовить VPS

Работайте с проверенным коммитом в `main`, а не с текущей удалённой `main`, пока
туда не вошли MVP, shared-hosting installer и production-конфигурация. Запишите
полный SHA коммита, которым будет собран образ. Перед выпуском запустите `pnpm check`
и PHP container tests по [руководству проверок](TESTING.md). Не копируйте `.local`
через Git и не запускайте `pnpm pilot:prepare` на VPS.

На VPS уже есть Docker Engine с Compose, Nginx и Certbot. Проверьте наличие
`rsync`, OpenSSH client, `flock` (util-linux), Python 3. Host Node.js 18 не
заменяйте: сервис и операции запускаются в образе с Node.js 22.23.1. Разместите
проверенный исходный код в `/opt/umi-consent-delivery` и выполните:

```sh
cd /opt/umi-consent-delivery
docker compose -f compose.production.yaml config --services
docker compose -f compose.production.yaml build delivery
docker run --rm --network none umi-consent-delivery:0.1.0 pnpm check
```

В списке Compose должен быть **только** `delivery`. Убедитесь, что порт 3100 свободен
и доступен только на loopback. Не запускайте рядом `compose.yaml`: он предназначен
для локального пилота и публикует дополнительный порт 8088.

DNS A `cookie1.ru` уже указывает на VPS. Другие DNS-записи, vhost и firewall
правила не меняйте. Порт 3100 снаружи не открывайте.

## 2. Снять свежую копию работающего пилота

На исходном Mac, в репозитории `umi-consent-delivery`, остановите **только** API
пилота. Существующие файлы на клиентских сайтах от этого не перестанут работать.
Используйте новое имя снимка и существующий доверенный `public.pem`:

```sh
docker compose stop delivery
pnpm ops backup .local/service .local/migration-cookie1-YYYYMMDDTHHMMSSZ .local/pilot/private/public.pem
pnpm ops verify .local/migration-cookie1-YYYYMMDDTHHMMSSZ .local/pilot/private/public.pem
docker compose start delivery
curl --fail http://127.0.0.1:3100/health
```

Если backup/verify завершился ошибкой, всё равно запустите API обратно, выясните
причину и создайте **новый** снимок. Не берите старый учебный `restore-drill` и не
копируйте `delivery.sqlite` вместе с живыми WAL/SHM-файлами. На время переноса
не меняйте права и разрешённые версии на исходном API: иначе снимок устареет.

Передайте каталог нового снимка, `.local/pilot/private/public.pem` и
`.local/offline/signing.pem` на VPS по доверенному SSH-каналу, не выводя содержимое
ключей на экран. Для первого переноса используйте приватный staging-каталог,
например `/srv/umi-consent-delivery/migration`, с правами 0700. Закрытый ключ
переместите в `/etc/umi-consent-delivery/signing.pem` (0600, каталог 0700),
публичный — в `/etc/umi-consent-delivery/public.pem`. Оригинальный закрытый ключ
и отдельную защищённую копию оставьте у оператора. Ни один PEM не находится в
Git, Docker image или mount работающего контейнера.

На VPS сравните публичную часть закрытого ключа с точными байтами PEM:

```sh
openssl pkey -in /etc/umi-consent-delivery/signing.pem -pubout -outform PEM | sha256sum
sha256sum /etc/umi-consent-delivery/public.pem
```

Хеши должны совпасть. Затем из корня проверенного кода восстановите снимок через
одноразовый контейнер с тем же Node/SQLite, что у API:

```sh
deploy/ops.sh verify /srv/umi-consent-delivery/migration/SNAPSHOT /etc/umi-consent-delivery/public.pem
deploy/ops.sh restore /srv/umi-consent-delivery/migration/SNAPSHOT /srv/umi-consent-delivery/data /etc/umi-consent-delivery/public.pem
deploy/ops.sh verify /srv/umi-consent-delivery/data /etc/umi-consent-delivery/public.pem
```

`SNAPSHOT` — имя переданного каталога; `/srv/umi-consent-delivery/data` до restore
**не существует**. Родительский каталог существует и имеет права 0700. Restore
откажется перезаписать даже пустой каталог. Сверьте число релизов и установок со
снимком, затем проверьте
`docker run --rm --network none -e DELIVERY_DATA=/data --mount type=bind,source=/srv/umi-consent-delivery/data,target=/data umi-consent-delivery:0.1.0 node build/src/cli.js sites`.
Ключи установок при этой проверке не выводятся.

## 3. Поднять API и HTTPS

```sh
cd /opt/umi-consent-delivery
docker compose -f compose.production.yaml up -d --wait delivery
docker compose -f compose.production.yaml ps
curl --fail http://127.0.0.1:3100/health
```

Compose монтирует только каталог данных в `/data`, публикует 3100 на
`127.0.0.1`, сохраняет ограничения RAM/CPU/PID и ротацию журналов. Закрытый ключ
в контейнер не монтируется.

Сначала проверьте `nginx -T`, что у `cookie1.ru` нет отдельного `server_name`, а
порт 80 доступен. Сохраните root-only копию действующей конфигурации Nginx перед
добавлением **нового** vhost. Не удаляйте и не правьте существующие сайты. Для
сертификата используйте HTTP webroot, чтобы продление не останавливало Nginx:

```sh
sudo install -d -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
sudo install -m 0644 deploy/nginx/limits.conf /etc/nginx/conf.d/umi-consent-delivery-limit.conf
sudo install -m 0644 deploy/nginx/cookie1-bootstrap.conf /etc/nginx/sites-available/cookie1.ru
sudo ln -s /etc/nginx/sites-available/cookie1.ru /etc/nginx/sites-enabled/cookie1.ru
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d cookie1.ru
sudo install -m 0644 deploy/nginx/cookie1.ru.conf /etc/nginx/sites-available/cookie1.ru
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Новый vhost перехватывает только Host `cookie1.ru` и проксирует `/health` и `/v1/*`.
Другие vhost, включая Strapi, сохраняются без правок. На `/v1/*` Nginx задаёт
per-IP лимит и отвечает 404 на остальные пути. Он передаёт
`Authorization` серверу; access log записывает путь без query string и без токена.
Лимит Nginx дополняет лимиты приложения и не является DDoS-защитой.

## 4. Проверить endpoint и переключить сайты

```sh
curl --fail https://cookie1.ru/health
curl -sS -o /dev/null -w '%{http_code}\n' https://cookie1.ru/v1/manifest
curl -sS -o /dev/null -w '%{http_code}\n' https://cookie1.ru/
```

Ожидаются `{"ok":true}`, `401` и `404`. Отдельно сравните ответы существующих
доменов VPS до/после изменения Nginx. Не вставляйте токен установки в командную
строку или URL для диагностики. У `umidev2` сейчас старый клиент без `doctor.php`:
обновите его приватные `updater.php` и `doctor.php` из проверенного ZIP v0.1.0,
сохранив `config.json`, state и активные assets. Затем поменяйте **только** приватное
`baseUrl` на `https://cookie1.ru` и выполните `doctor.php --online --web-root ...`.
Проверка должна получить подписанный манифест без FAIL. Начните с `umidev2`, затем
переключайте другие установки. Не меняйте `window.UmiConsentConfig` и `revision`.
Старый CloudPub-туннель оставьте до завершения проверки всех клиентов.

На сайте проверьте локальные JS/CSS из одной папки версии, открытие настроек и
сохранение отказа; в браузере не должно быть запросов к `cookie1.ru`. При проблеме
верните прежний `baseUrl` у клиента, пока старый endpoint работает. Установленная
версия библиотеки продолжит работать и при недоступном API.

## 5. Ежедневные копии, восстановление и наблюдение

Создайте на отдельном SSH-сервере с `rsync` и `sha256sum` **выделенный** каталог для этого сервиса
и файл `.umi-consent-delivery-backups` внутри него. Настройте на VPS SSH alias
с проверенным host key и ключом без интерактивного ввода. Проверка marker в скрипте
не даст `rsync --delete` очистить ошибочно указанный каталог. Доступ к этому
хранилищу должен быть ограничен: снимки содержат реестр, хеши токенов и журнал.

```sh
sudo install -d -m 0700 /srv/umi-consent-delivery/backups /etc/umi-consent-delivery
sudo install -m 0600 deploy/backup.env.example /etc/umi-consent-delivery/backup.env
sudoedit /etc/umi-consent-delivery/backup.env
sudo install -m 0644 deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start umi-consent-backup.service
sudo systemctl start umi-consent-restore-drill.service
sudo systemctl enable --now umi-consent-backup.timer umi-consent-restore-drill.timer
sudo systemctl list-timers 'umi-consent-*'
```

Перед запуском задайте в `backup.env` действующие `BACKUP_SSH_HOST` и
`BACKUP_REMOTE_DIR`; примерные значения не являются адресами вашего хранилища.
Первый backup создаёт и проверяет snapshot, архивирует его, передаёт архив и
checksum offsite, проверяет checksum там и сохраняет последние 14 ежедневных
снимков в обоих местах. Еженедельное задание **скачивает внешнюю копию**,
сверяет её с локальным checksum, безопасно распаковывает и проверяет
восстановление в отдельный каталог. Оно оставляет четыре последних результата.
Проверяйте журнал через
`journalctl -u umi-consent-backup.service -u umi-consent-restore-drill.service`.
Копию signing key храните отдельно от автоматических снимков.

Настройте во внешнем сервисе мониторинга `https://cookie1.ru/health` с уведомлением
об ошибке и отдельное уведомление о сбое systemd backup/restore-drill. Канал
уведомлений зависит от учётной записи оператора; без него нельзя считать
production-приёмку завершённой. Проверяйте срок TLS и `certbot renew --dry-run`.

## 6. Следующие релизы и откат

Подписывать новый релиз нужно только проверенным ZIP библиотеки и его SHA-256
sidecar. Для импорта используйте **отдельный** контейнер: ключ монтируется только
в него, не в постоянно работающий API.

```sh
cd /opt/umi-consent-delivery
docker run --rm --network none -e DELIVERY_DATA=/data --mount type=bind,source=/srv/umi-consent-delivery/data,target=/data --mount type=bind,source=/srv/umi-consent-delivery/imports,target=/imports,readonly --mount type=bind,source=/etc/umi-consent-delivery/signing.pem,target=/run/signing.pem,readonly umi-consent-delivery:0.1.0 node build/src/cli.js import VERSION /imports/umi-cookie-consent-vVERSION.zip /imports/umi-cookie-consent-vVERSION.zip.sha256 /run/signing.pem
docker compose -f compose.production.yaml exec -T delivery node build/src/cli.js approve SITE_ID VERSION
```

Закрытый ключ доступен только host CLI в момент импорта, не API. После `approve`
сайт отдельно выполняет `install`, затем `activate`. При откате используйте
локальный `rollback` клиента на уже установленную версию; серверный downgrade
запрещён. Перед обслуживанием создавайте и проверяйте новый offsite snapshot.
