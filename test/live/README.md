# Live-тесты Mass payouts на реальном NOWPayments API

Набор использует встроенный `node:test`, импортирует собранный SDK из `dist/` и не добавляет dependencies. Обычный `npm test` эти тесты не запускает.

## Покрытие

Safe read-only suite проверяет реальные ответы для:

- `getBalance()` и `getPayoutBalance()`;
- `validatePayoutAddress()`;
- `getMinimumPayoutAmount()`;
- `getPayoutFeeEstimate()`;
- `preflightPayout()`;
- `listPayouts()`, включая фильтры `new` и `rejected_not_checked`;
- `getPayoutStatus()`;
- `watchPayoutStatus()`;
- `onPayoutStatusChange()`;
- payout-события `parseWebhook()` на данных реальной выплаты;
- read-only методов `sdk.raw`: balance, address validation, minimum, fee, list и status.

Write suites отдельно проверяют:

- `createPayout()` с автоматическим 2FA;
- `createPayout()` без secret и явный `verifyPayout()`;
- `sdk.raw.createPayout()` и `sdk.raw.verifyPayout()`.

## Подготовка

```bash
cp .env.live.example .env.live
```

Минимум для safe-run:

```dotenv
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_PAYOUT_CURRENCY=trx
NOWPAYMENTS_PAYOUT_ADDRESS=...
```

Для валют с memo/tag задайте `NOWPAYMENTS_PAYOUT_EXTRA_ID`.

`.env.live` и `.nowpayments-live-payout-test-state.json` добавлены в `.gitignore`. Не коммитьте API key, dashboard password, JWT, 2FA secret или одноразовый код.

## 1. Безопасный read-only запуск

```bash
npm run test:live:payouts
```

Команда выполняет build, затем реальные GET/validation/preflight/status запросы. Выплата не создаётся.

Если `NOWPAYMENTS_PAYOUT_PROBE_AMOUNT` не задан, тест получает актуальный minimum и рассчитывает probe немного выше него с точностью до шести знаков.

Если на custody balance недостаточно средств, `preflightPayout()` должен вернуть `INSUFFICIENT_PAYOUT_BALANCE` или `INSUFFICIENT_PAYOUT_BALANCE_WITH_FEE`. Это считается успешной проверкой защитного поведения SDK и выводится как diagnostic.

Для status/watcher тестов payout ID выбирается в порядке:

1. `NOWPAYMENTS_EXISTING_PAYOUT_ID`;
2. последняя запись из локального state-файла;
3. самая новая выплата из `listPayouts()`.

Если payout history отсутствует, status/watcher subtests будут skipped.

Watcher-тесты считают первый реальный SDK-статус терминальным. Так проверяются HTTP polling и события, но suite не ждёт завершения blockchain-транзакции.

## 2. Реальная выплата с автоматическим 2FA

Настройте Bearer authentication:

```dotenv
NOWPAYMENTS_EMAIL=merchant@example.com
NOWPAYMENTS_PASSWORD=...
# либо NOWPAYMENTS_JWT_TOKEN=...
```

Задайте secret и все защитные параметры:

```dotenv
NOWPAYMENTS_2FA_SECRET=BASE32_SECRET_OR_OTPAUTH_URI
NOWPAYMENTS_LIVE_PAYOUT_CONFIRM=I_UNDERSTAND_THIS_SENDS_REAL_FUNDS
NOWPAYMENTS_LIVE_PAYOUT_AMOUNT=10
NOWPAYMENTS_LIVE_MAX_PAYOUT_AMOUNT=10
# Например, 10.5 после проверки fee в read-only suite
NOWPAYMENTS_LIVE_MAX_TOTAL_DEBIT=10.5
NOWPAYMENTS_LIVE_PAYOUT_RUN_ID=auto-trx-smoke-001
```

Запуск:

```bash
npm run test:live:payouts:auto-2fa
```

Тест передаёт `twoFactorSecret` в SDK, вызывает `createPayout()`, проверяет автоматический внутренний вызов `verifyPayout()`, затем получает individual payout status.

## 3. Реальная выплата без 2FA secret в SDK

Используются те же confirmation, amount, cap и run ID. Экземпляр SDK для этого теста намеренно создаётся **без** `twoFactorSecret`.

### Secret доступен тестовой обвязке

Можно оставить:

```dotenv
NOWPAYMENTS_2FA_SECRET=BASE32_SECRET
```

Secret не передаётся SDK, но тест генерирует TOTP непосредственно перед явным вызовом:

```js
await sdk.verifyPayout(batch.id, code);
```

### Secret отсутствует

Непосредственно перед запуском передайте свежий код:

```bash
NOWPAYMENTS_2FA_CODE=123456 npm run test:live:payouts:manual-2fa
```

Или временно заполните `NOWPAYMENTS_2FA_CODE` в `.env.live` и сразу запустите:

```bash
npm run test:live:payouts:manual-2fa
```

После `createPayout({ autoVerify: false })` тест проверяет `requiresVerification === true`, сохраняет batch ID и только затем вызывает `verifyPayout()`.

## Защита от повторной выплаты

Перед каждым write-test обязательны:

- точная confirmation phrase;
- фактическая сумма;
- независимый hard cap суммы;
- отдельный hard cap общего списания после preflight, включая sender-paid fee;
- стабильный run ID.

Каждый write-test сначала отдельно выполняет `preflightPayout()` и сравнивает `requiredAmount` с `NOWPAYMENTS_LIVE_MAX_TOTAL_DEBIT`. Только после успешной проверки разрешается create-запрос. Высокуровневый `createPayout()` затем повторяет собственный встроенный preflight.

Состояние сохраняется в `.nowpayments-live-payout-test-state.json`. При повторном запуске с тем же mode + run ID новая выплата не создаётся:

- verified batch будет skipped;
- unverified batch будет повторно подтверждён свежим кодом.

Для намеренной новой выплаты задайте новый `NOWPAYMENTS_LIVE_PAYOUT_RUN_ID`.

## 4. Дополнительная выплата через raw client

Этот тест создаёт **отдельную** реальную выплату и требует другую фразу:

```dotenv
NOWPAYMENTS_LIVE_RAW_PAYOUT_CONFIRM=I_UNDERSTAND_THIS_BYPASSES_HIGH_LEVEL_CREATE_AND_SENDS_REAL_FUNDS
NOWPAYMENTS_LIVE_RAW_PAYOUT_RUN_ID=raw-trx-smoke-001
```

Используются те же `NOWPAYMENTS_LIVE_PAYOUT_AMOUNT` и `NOWPAYMENTS_LIVE_MAX_PAYOUT_AMOUNT`.

Запуск:

```bash
npm run test:live:payouts:raw-write
```

Поскольку `sdk.raw.createPayout()` не выполняет high-level preflight под капотом, тест сначала явно вызывает `validatePayoutAddress()` и `preflightPayout()` с теми же данными, затем проверяет raw create/verify endpoints.

## Команды

```bash
# Только безопасные реальные запросы
npm run test:live:payouts

# Одна реальная выплата, secret передан SDK
npm run test:live:payouts:auto-2fa

# Одна реальная выплата, SDK без secret, verifyPayout вызывается явно
npm run test:live:payouts:manual-2fa

# Ещё одна реальная выплата через sdk.raw
npm run test:live:payouts:raw-write
```

Альтернативный env-файл:

```bash
NOWPAYMENTS_LIVE_ENV_FILE=.env.staging npm run test:live:payouts
```
