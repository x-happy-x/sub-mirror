# sub-mirror

Сервис зеркалирует xray подписки с возможность конвертации в формат Clash и передачей заголовков через профили (`*.yml`) или напрямую из запроса.
В контейнере запускаются два процесса: Node.js приложение и tindy2013/subconverter.

## Возможности
- Проксирование подписки с сохранением оригинального ответа.
- Конвертация через subconverter или встроенный fallback для VLESS.
- Кэширование результата на диске и выдача последней успешной версии.
- Профили в отдельных YAML-файлах с возможностью комбинировать несколько профилей.
- Режимы подстановки заголовков: приоритет запроса, всегда из файла, обязательные заголовки из запроса.
- Простые эндпоинты для проверки состояния.

## Быстрый старт (Docker)
```bash
docker compose up --build
```
Порты по умолчанию:
- `8788` — Node.js приложение
- `8787` — subconverter

## Использование образа из GHCR
```bash
docker pull ghcr.io/x-happy-x/sub-mirror:latest
docker run --rm -p 8788:8788 -p 8787:8787 -v ./data:/data ghcr.io/x-happy-x/sub-mirror:latest
```

## Локальный запуск (без Docker)
Требуется Node.js 18+.
```bash
export SUB_URL="https://example.com/sub"
export USE_CONVERTER=1
export CONVERTER_URL="http://127.0.0.1:8787/sub"
export SOURCE_URL="http://127.0.0.1:8788/source.txt"
node app/server.js
```

## Основные эндпоинты
- `GET /sub?sub_url=...` — получить подписку с конвертацией (если включена).
- `GET /last?sub_url=...` — отдать последнюю успешную версию из кэша.
- `GET /health` — простая проверка живости.
- `ANY /debug/echo` — отладочный endpoint: возвращает метод, query, заголовки и тело запроса.
- `GET /profile/random` — генератор случайного профиля по шаблонам устройств.
- `GET /raw.txt`, `/subscription.yaml`, `/converted.txt`, `/status.json` — статические файлы из `data/`.

Пример:
```bash
curl "http://localhost:8788/sub?sub_url=https://example.com/sub"
```

## Параметры запросов и заголовки
Query параметры:
- `sub_url` — URL подписки (обязателен для `/sub` и `/last`, если не задан `SUB_URL`).
- `use_converter` — `1`/`0`, включить/выключить конвертацию для запроса.
- `profile` — имя профиля (можно передавать несколько раз).
- `profiles` — список профилей через запятую, применяется слева направо.
- `hwid` — переопределить значение заголовка `x-hwid` (если профиль использует этот заголовок).

Заголовки:
- `X-Sub-Url` — альтернатива `sub_url`.
- `X-Use-Converter` — альтернатива `use_converter`.
- `X-Profile` / `X-Profiles` — альтернатива параметрам `profile`/`profiles`.
- `X-Hwid` — альтернатива `hwid`.

Пример с заголовками:
```bash
curl -H "X-Sub-Url: https://example.com/sub" -H "X-Use-Converter: 1" "http://localhost:8788/sub"
```

## Профили (`*.yml`)
Профили ищутся в:
- `PROFILE_DIR` (если задана переменная окружения)
- `/data/profiles`
- `./profiles`

Пример профиля:
```yaml
sub_url: "https://example.com/sub"
use_converter: true
header_policy: prefer_request
allow_hwid_override: true
headers:
  user-agent: "MyClient/1.0"
  x-api-key: "from-file"
required_headers:
  - x-session-id
```

`header_policy`:
- `prefer_request` — заголовки из запроса перекрывают значения из файла.
- `file_only` — для совпадающих ключей всегда используются значения из файла.
- `require_request` — как `prefer_request`, но заголовки из `required_headers` обязательны в запросе.

`allow_hwid_override`:
- `true` — `hwid`/`X-Hwid` из запроса может переопределить `x-hwid` в профиле.
- `false` — `x-hwid` берется только из профиля и не заменяется из запроса.

Совмещение профилей:
```bash
curl "http://localhost:8788/sub?profiles=base,region_ru,happ"
```
Если один ключ задан в нескольких профилях, используется значение из последнего профиля в списке.

Готовые профили в репозитории:
- `happ`
- `linux-notebook`
- `aqm-lx1`
- `ios26`
- `android16`
- `windows11`

## Echo endpoint
Проверка входящих заголовков и тела:
```bash
curl -X POST "http://localhost:8788/debug/echo?x=1&x=2" \
  -H "X-Test: hello" \
  -H "Content-Type: application/json" \
  -d '{"ping":"pong"}'
```

## Генератор случайного профиля
Вернуть JSON:
```bash
curl "http://localhost:8788/profile/random"
```

Вернуть сразу YAML:
```bash
curl "http://localhost:8788/profile/random?format=yml"
```

Фиксированный (незаменяемый) HWID:
```bash
curl "http://localhost:8788/profile/random?fixed_hwid=1&format=yml"
```

Выбор конкретного шаблона:
```bash
curl "http://localhost:8788/profile/random?template=iphone-13-mini&format=yml"
```

Сразу сохранить в `./profiles`:
```bash
curl "http://localhost:8788/profile/random?template=aqm-lx1&name=my-phone-profile&save=1&format=yml"
```

Поддерживаемые `template`:
- `linux-notebook`
- `aqm-lx1`
- `2509fpn0bc`
- `iphone-13-mini`
- `pc-x-x86-64`

## Конфигурация
Основные переменные окружения:
- `SUB_URL` — URL подписки по умолчанию.
- `USE_CONVERTER` — `1`/`0`, включить subconverter.
- `CONVERTER_URL` — URL subconverter (по умолчанию `http://127.0.0.1:8787/sub`).
- `SOURCE_URL` — URL, который subconverter использует для чтения исходного файла.
- `PROFILE_DIR` — каталог с профилями (`*.yml`), если нужно переопределить путь.
- `APP_PORT`, `SUBCONVERTER_PORT` — порты приложения и subconverter.

## Данные и кэш
- `data/` монтируется как volume и хранит:
  - `raw.txt`, `subscription.yaml`, `converted.txt`, `status.json`
  - `cache/` — кэшированные ответы
