FROM nginx:stable

ENV TZ=Europe/Moscow

RUN apt-get update \
      && apt-get install -y mc cron logrotate tzdata curl \
      && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
      && echo $TZ > /etc/timezone \
      && rm -rf /var/lib/apt/lists/*

COPY ./conf.d/default.conf /etc/nginx/conf.d/default.conf

WORKDIR /var/www

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
