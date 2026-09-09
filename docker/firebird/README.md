# Firebird в Docker — legacy

Стенд по умолчанию использует **PostgreSQL** (`docker-compose` service `postgres`,
схема `database/schema.postgres.sql`).

Скрипты Firebird (`schema.firebird.sql`, IBExpert) сохранены для:

- отката (`TM07_DB_DRIVER=firebird` + сервис firebird — нужно вернуть в compose вручную);
- миграции данных: `database/migrate_to_postgres.php`;
- опционального слоя BPK в `.fdb` (не требуется runtime PHP стенда).

Проверка Postgres:

```bash
curl -s http://localhost:8081/api/bench-db-status.php?action=status
# "driver":"pgsql", "postgresReachable":true
```

Сброс Postgres:

```bash
docker compose down
docker volume rm tm07-bench_postgres_data
docker compose up -d --build
```
