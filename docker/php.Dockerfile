# Compatibility fixture only; PHP 7.3 is not a production hosting recommendation.
FROM php:7.3.33-apache-bullseye@sha256:b9872cd287ef72bc17d45d713aa2742f3d3bcf2503fea2506fd93aa94995219f
RUN php -r 'exit(extension_loaded("curl") && extension_loaded("openssl") ? 0 : 1);'
WORKDIR /app
CMD ["php", "-S", "0.0.0.0:8080", "-t", "/pilot/public"]
