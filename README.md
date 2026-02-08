# sub-mirror

Сервис зеркалирует xray подписки с возможность конвертации в формат Clash и передачи своих заголовков (включая X-HWID).
В контейнере запускаются два процесса: Node.js приложение и tindy2013/subconverter.

## Возможности
- Проксирование подписки с сохранением оригинального ответа.
- Конвертация через subconverter или встроенный fallback для VLESS.
- Кэширование результата на диске и выдача последней успешной версии.
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
- `GET /raw.txt`, `/subscription.yaml`, `/converted.txt`, `/status.json` — статические файлы из `data/`.

Пример:
```bash
curl "http://localhost:8788/sub?sub_url=https://example.com/sub"
```

## Параметры запросов и заголовки
Query параметры:
- `sub_url` — URL подписки (обязателен для `/sub` и `/last`, если не задан `SUB_URL`).
- `use_converter` — `1`/`0`, включить/выключить конвертацию для запроса.
- `app` — логическое имя клиента (используется для кэша), по умолчанию `default`.
- `hwid` — переопределить HWID для `app=happ`.

Заголовки:
- `X-Sub-Url` — альтернатива `sub_url`.
- `X-Use-Converter` — альтернатива `use_converter`.
- `X-Hwid` — альтернатива `hwid` для `app=happ`.

Пример с заголовками:
```bash
curl -H "X-Sub-Url: https://example.com/sub" -H "X-Use-Converter: 1" "http://localhost:8788/sub"
```

## Конфигурация
Основные переменные окружения:
- `SUB_URL` — URL подписки по умолчанию.
- `USE_CONVERTER` — `1`/`0`, включить subconverter.
- `CONVERTER_URL` — URL subconverter (по умолчанию `http://127.0.0.1:8787/sub`).
- `SOURCE_URL` — URL, который subconverter использует для чтения исходного файла.
- `APP_PORT`, `SUBCONVERTER_PORT` — порты приложения и subconverter.

## Данные и кэш
- `data/` монтируется как volume и хранит:
  - `raw.txt`, `subscription.yaml`, `converted.txt`, `status.json`
  - `cache/` — кэшированные ответы
