    root /var/www/public;
    index index.html index.php;
    charset utf-8;

    client_max_body_size 50M;

    # Docker DNS: перерезолвить php после recreate контейнера (иначе No route to host).
    resolver 127.0.0.11 valid=10s ipv6=off;
    set $tm07_php_upstream php:9000;


    error_log  /var/log/nginx/error.log error;
    access_log /var/log/nginx/access.log main if=$loggable;

    location = /favicon.ico {
        alias /var/www/public/favicon.svg;
        default_type image/svg+xml;
        access_log off;
    }

    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff2|ttf)$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
        access_log off;
    }

    if ($request_method !~ ^(GET|POST|HEAD|OPTIONS)$) {
        return 405;
    }

    location = /api/auth.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/auth.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/admin-settings.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/admin-settings.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/bench-cycle-progress.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/bench-cycle-progress.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/bench-db-status.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/bench-db-status.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/bench-events.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/bench-events.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/odata-1c.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/odata-1c.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/counters.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/counters.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/tm07-serial-registry.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/tm07-serial-registry.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/tm07-firmware.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/tm07-firmware.php;
        fastcgi_read_timeout 300;
        fastcgi_buffering off;
    }

    location = /api/passport-generate.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/passport-generate.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/nameplate-print.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/nameplate-print.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/nameplate-template.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/nameplate-template.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/btw-inspect.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/btw-inspect.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    location = /api/site-action-log.php {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/site-action-log.php;
        fastcgi_read_timeout 120;
        fastcgi_buffering off;
    }

    # Остальные /api/*.php → /app/api (если точный location не подхватился без reload).
    location ~ ^/api/([^/]+\.php)$ {
        include fastcgi_params;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_param SCRIPT_FILENAME /app/api/$1;
        fastcgi_read_timeout 300;
        fastcgi_buffering off;
    }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ \.php$ {
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        fastcgi_pass $tm07_php_upstream;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
        fastcgi_read_timeout 600;
        fastcgi_buffering off;
    }

    add_header X-Robots-Tag "noindex, nofollow" always;
