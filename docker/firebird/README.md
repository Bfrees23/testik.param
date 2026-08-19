# Firebird в Docker (автоматически)

При `docker compose up -d`:
1. **firebird** — создаёт `tm07_bench.fdb`
2. **firebird-init** — один раз накатывает `database/schema.firebird.sql`
3. **php** — подключается к `firebird:/firebird/data/tm07_bench.fdb`

Проверка:

```bash
curl http://localhost:8081/api/bench-db-status.php?action=status
# "driver":"firebird", "firebirdReachable":true
```

Сброс БД:

```bash
docker compose down
docker volume rm tm07-bench_firebird_data
docker compose up -d
```
