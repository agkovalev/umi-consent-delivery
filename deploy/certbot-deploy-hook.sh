#!/bin/sh
set -eu

# Certbot calls this after a successful renewal. Other domains keep their
# existing renewal behavior.
case " ${RENEWED_DOMAINS:-} " in
  *" cookie1.ru "*)
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
    ;;
esac
