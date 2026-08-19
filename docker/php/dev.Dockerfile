FROM php:8.3-fpm-trixie

# Установщик расширений и Composer
COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
COPY --from=composer/composer:2 /usr/bin/composer /usr/bin/composer

# Общие системные зависимости для обоих образов
# chromium + DejaVu: HTML→PDF/PNG растеризация шильдиков (engine=html)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl zip unzip cron supervisor msmtp msmtp-mta nodejs \
    chromium \
    fonts-dejavu-core fonts-dejavu-extra \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем все расширения, КРОМЕ xdebug
RUN install-php-extensions \
    opcache pcntl gd zip intl iconv mysqli pdo_mysql pdo_firebird \
    sockets ldap soap tidy xsl bcmath exif smbclient redis imagick xdebug

# Совпадает с точкой монтирования ./src в compose (см. prod.yml / dev.yml)
WORKDIR /app

# PHP dependencies (TCPDF for nameplate PDF). Keep composer.json in this build context.
COPY composer.json composer.lock* /app/
RUN composer install --no-dev --no-interaction --no-progress 2>/dev/null || true

# Копируем конфигурационные файлы
COPY ./conf.d/zzz-www.conf /usr/local/etc/php-fpm.d/zzz-www.conf
COPY ./conf.d/php.ini /usr/local/etc/php/conf.d/php.ini
COPY ./conf.d/dev.opcache.ini /usr/local/etc/php/conf.d/opcache.ini
COPY ./conf.d/xdebug.ini /usr/local/etc/php/conf.d/xdebug.ini

# Настройка пользователя для работы с контейнером
RUN usermod -u 1000 www-data && groupmod -g 1000 www-data

# Меняем пользователя
USER www-data:www-data

# Проброс портов
EXPOSE 9000

# Запуск контейнера
CMD ["bash", "-c", "docker-php-entrypoint php-fpm"]