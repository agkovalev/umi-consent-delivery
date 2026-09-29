# Production: cookie1.ru

Эта инструкция переносит **существующий** локальный реестр на Ubuntu VPS,
выделенный под cookie1.ru.
Браузеры продолжают получать JS/CSS с сайтов; `https://cookie1.ru` нужен PHP-клиенту
для ручной установки одобренных версий. `cookie1.ru` целиком выделен под API.

**Перед любыми изменениями VPS подтвердите цель:** 2026-09-29 публичный DNS
`cookie1.ru` указывал на 195.161.114.25; HTTPS отвечал Nginx/Strapi с признаками
другого приложения и истёкшим сертификатом. Не заменяйте его конфигурацию, пока
владелец не подтвердит, что это нужный сервер и текущий сайт можно убрать.

## 1. Зафиксировать исходный код и подготовить VPS

Работайте с проверенным коммитом в `main`, а не с текущей удалённой `main`, пока
туда не вошли MVP, shared-hosting installer и production-конфигурация. Запишите
полный SHA коммита, которым будет собран образ. Перед выпуском запустите `pnpm check`
и PHP container tests по [руководству проверок](TESTING.md). Не копируйте `.local`
через Git и не запускайте `pnpm pilot:prepare` на VPS.

На VPS нужны Docker Engine с Compose plugin, Nginx, Certbot, rsync, OpenSSH client,
`flock` (util-linux), Python 3, `build-essential` для native SQLite-модуля,
Node.js 22.22.2+ и закреплённый pnpm 11.22.0 через Corepack.
Устанавливайте Docker по [официальной инструкции для Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
Certbot — по [официальной инструкции для Nginx](https://certbot.eff.org/instructions?os=snap&ws=nginx).
Проверьте `docker compose version`, `node --version`, `corepack pnpm --version`.
Разместите проверенный исходный код в `/opt/umi-consent-delivery` и выполните:

```sh
cd /opt/umi-consent-delivery
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm check
docker compose -f compose.production.yaml config --services
docker compose -f compose.production.yaml build delivery
```

В списке Compose должен быть **только** `delivery`. Убедитесь, что порт 3100 свободен
и доступен только на loopback. Не запускайте рядом `compose.yaml`: он предназначен
для локального пилота и публикует дополнительный порт 8088.

DNS-запись A `cookie1.ru` должна указывать на IPv4 VPS. Конфигурация Nginx слушает
только IPv4; не публикуйте AAAA, пока не настроена отдельная проверенная IPv6-доставка.
До включения UFW разрешите
фактический SSH-порт, затем 80/443; проверьте вход во второй SSH-сессии, чтобы не
потерять доступ. Порт 3100 снаружи не открывайте.

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

Хеши должны совпасть. Затем из корня проверенного кода восстановите снимок:

```sh
corepack pnpm ops verify /srv/umi-consent-delivery/migration/SNAPSHOT /etc/umi-consent-delivery/public.pem
corepack pnpm ops restore /srv/umi-consent-delivery/migration/SNAPSHOT /srv/umi-consent-delivery/data /etc/umi-consent-delivery/public.pem
corepack pnpm ops verify /srv/umi-consent-delivery/data /etc/umi-consent-delivery/public.pem
```

`SNAPSHOT` — имя переданного каталога; `/srv/umi-consent-delivery/data` до restore
**не существует**. Родительский каталог существует и имеет права 0700. Restore
откажется перезаписать даже пустой каталог. Сверьте число релизов и установок со
снимком, затем проверьте `DELIVERY_DATA=/srv/umi-consent-delivery/data corepack pnpm admin sites`.
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

Для сертификата используйте HTTP webroot, чтобы продление не останавливало Nginx:

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

На подтверждённом выделенном VPS удалите дистрибутивный default-site из
`sites-enabled` перед проверкой, если он конфликтует с `cookie1.ru`. Nginx
проксирует только `/health` и `/v1/*`, задаёт
per-IP лимит на все HTTPS-запросы и отвечает 404 на остальные пути. Он передаёт
`Authorization` серверу; access log записывает путь без query string и без токена.
Лимит Nginx дополняет лимиты приложения и не является DDoS-защитой.

## 4. Проверить endpoint и переключить сайты

```sh
curl --fail https://cookie1.ru/health
curl -sS -o /dev/null -w '%{http_code}\n' https://cookie1.ru/v1/manifest
curl -sS -o /dev/null -w '%{http_code}\n' https://cookie1.ru/
```

Ожидаются `{"ok":true}`, `401` и `404`. Не вставляйте токен установки в командную
строку или URL для диагностики. На тестовом сайте поменяйте **только** приватное
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
sidecar. На Linux-хосте можно импортировать с `DELIVERY_DATA` работающего API:

```sh
cd /opt/umi-consent-delivery
DELIVERY_DATA=/srv/umi-consent-delivery/data corepack pnpm admin import VERSION /private/imports/umi-cookie-consent-vVERSION.zip /private/imports/umi-cookie-consent-vVERSION.zip.sha256 /etc/umi-consent-delivery/signing.pem
docker compose -f compose.production.yaml exec -T delivery node build/src/cli.js approve SITE_ID VERSION
```

Закрытый ключ доступен только host CLI в момент импорта, не API. После `approve`
сайт отдельно выполняет `install`, затем `activate`. При откате используйте
локальный `rollback` клиента на уже установленную версию; серверный downgrade
запрещён. Перед обслуживанием создавайте и проверяйте новый offsite snapshot.
