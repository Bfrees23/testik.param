# Ветки проекта: prod / dev

Схема работы: всё новое пробуется в `dev`, стабильное живёт в `prod`.
В `prod` попадает только то, что уже проверено на стенде.

| Ветка | Назначение | Кто пишет |
|-------|-----------|-----------|
| `prod` | Стабильная версия, которая работает на стенде (по факту — бывший `main`). | Только merge из `dev` |
| `dev` | Тестовая ветка: новые идеи, эксперименты, отладка. | Вся текущая разработка |
| `feature/*` | Необязательно: одна крупная идея отдельно от `dev`. | Мержится в `dev` |

Снимок прежней ветки `main` (коммит `25438d9`) пока сохранён в `origin/main`
как архив — см. раздел «Что осталось сделать в GitHub».

## Повседневная работа (в dev)

```bash
git switch dev
git pull                      # подтянуть свежий dev
# ... правки ...
git add -A
git commit -m "Короткое описание изменения"
git push
```

Проверка перед пушем — те же шаги, что в CI:

```bash
./scripts/sync-public-js.sh --check     # JS-зеркала public/js синхронны
./scripts/check-critical-invariants.sh  # критичные инварианты исходников
```

Необязательно, но удобно для крупной идеи, которую хочется изолировать:

```bash
git switch -c feature/moya-ideya dev
# ... работа, коммиты, пуш ...
git switch dev
git merge --no-ff feature/moya-ideya
```

## Выпуск в prod

1. Убедиться, что `dev` протестирован на стенде и CI зелёный.
2. Смержить `dev` в `prod` (локально или через Pull Request на GitHub):

```bash
git switch prod
git pull
git merge --no-ff dev
git push
```

3. По желанию — поставить тег релиза:

```bash
git tag -a v1.0.0 -m "Релиз 1.0.0"
git push origin v1.0.0
```

Если на стенде стоит кодовая копия (docker compose / рабочая папка), после
переключения на `prod` её нужно пересобрать/перезапустить как обычно.

### Срочная правка прямо в prod (hotfix)

```bash
git switch prod
git pull
# ... правка ...
git commit -am "Hotfix: ..."
git push
git switch dev
git merge --no-ff prod      # чтобы правка не потерялась в dev
git push
```

## CI

`.github/workflows/ci.yml` запускается на push в `dev` и `prod` и на pull request
в эти же ветки: проверка JS-зеркал, критичных инвариантов, затем docker-стек и
API smoke-тесты из `selenium-bot`.

## Что осталось сделать в GitHub (один раз, вручную)

1. **Default branch → `dev`**: Settings → Branches → Default branch → `dev`.
   Так новые PR и `git clone` будут сразу нацелены на рабочую ветку.
2. **Защитить `prod`** (по желанию): Settings → Branches → Add branch protection
   rule для `prod`, включить «Require a pull request before merging».
3. **Удалить архивный `main`**, когда убедитесь, что `prod` на месте:

```bash
git push origin --delete main
git branch -d main          # если локальная main ещё осталась
```

Старые ветки `master` (локально и в origin) — легаси, можно удалить тем же
способом: `git push origin --delete master`.
