# Ветки проекта: prod / dev

Схема работы: всё новое пробуется в `dev`, стабильное живёт в `prod`.
В `prod` попадает только то, что уже проверено на стенде.

| Ветка | Назначение | Кто пишет |
|-------|-----------|-----------|
| `prod` | Стабильная версия, которая работает на стенде (по факту — бывший `main`). | Только merge из `dev` |
| `dev` | Тестовая ветка: новые идеи, эксперименты, отладка. | Вся текущая разработка |
| `feature/*` | Необязательно: одна крупная идея отдельно от `dev`. | Мержится в `dev` |

## Удалённые репозитории

| Remote | URL | Роль |
|--------|-----|------|
| `origin` | `https://gitverse.ru/Bfrees/parametru.git` | Основной репозиторий (GitVerse) |
| `github` | `https://github.com/Bfrees23/testik.param.git` | Зеркало, по желанию |

```bash
git push origin dev     # GitVerse (origin)
git push github dev     # зеркало GitHub, если нужно синхронизировать
```

Авторизация на GitVerse — personal access token, сохранённый в Windows
Credential Manager (Git Credential Manager). Логин `Bfrees`, токен — в поле
пароля. SSH-ключ `~/.ssh/id_ed25519` подготовлен, но в аккаунте GitVerse пока
не зарегистрирован.

Снимок прежней ветки `main` (коммит `25438d9`) остался в репозитории GitHub
(`origin/main` → теперь `github/main`) как архив — см. раздел «Что осталось
сделать вручную».

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
2. Смержить `dev` в `prod` (локально или через Pull Request на GitVerse):

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

## Что осталось сделать вручную

1. **GitVerse, default branch → `dev`**: профиль репозитория → Settings →
   Default branch. Так новые PR и `git clone` будут сразу нацелены на рабочую ветку.
2. **GitVerse, удалить стартовый `master`** (`df27e44` «Initial commit», история
   не связана с проектом), когда `dev` станет основной:

```bash
git push origin --delete master
```

3. **GitVerse, защитить `prod`** (по желанию): Settings → Branch protection для
   `prod`, включить «Require a pull request before merging».
4. **GitHub (зеркало)**: переключить default branch на `dev` и удалить архивные
   `main` и `master`, когда убедитесь, что `prod` на месте:

```bash
git push github --delete main
git push github --delete master
```
