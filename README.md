# sub-mirror

Сервис зеркалирует подписки и при необходимости конвертирует их в формат Clash.
В контейнере запускаются два процесса: Node.js приложение и subconverter.

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
