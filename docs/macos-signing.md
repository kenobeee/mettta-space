# Подпись и нотаризация macOS-установщика

Чтобы пользователи могли ставить приложение без предупреждений Gatekeeper («damaged», «from an unidentified developer»), нужны **подпись** и **нотаризация** Apple.

## Требования

- **Платный Apple Developer** ($99/год): [developer.apple.com](https://developer.apple.com)
- Бесплатный аккаунт не может нотаризовать приложения

## Шаг 1: Сертификат Developer ID Application

1. На Mac откройте **Keychain Access** → создайте **Certificate Signing Request (CSR)**:
   - Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority
   - Email — ваш Apple ID, имя — любое, сохранить на диск

2. В [Apple Developer → Certificates](https://developer.apple.com/account/resources/certificates/list):
   - Create a certificate → **Developer ID Application** (для распространения вне App Store)
   - Загрузите CSR и скачайте `.cer`

3. Откройте `.cer` — сертификат появится в Keychain Access → My Certificates.

4. Экспорт в `.p12` для CI:
   - Keychain Access → My Certificates → развернуть сертификат
   - ПКМ по **приватному ключу** → Export "…" → сохранить как `.p12`, задать пароль

5. Конвертация в Base64 (для секрета):
   ```bash
   openssl base64 -A -in certificate.p12 -out certificate-base64.txt
   ```
   Содержимое `certificate-base64.txt` — это значение секрета `APPLE_CERTIFICATE_BASE64`.

## Шаг 2: App-specific password для нотаризации

1. [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. Создайте пароль (например, «GitHub Actions Notarization»)
3. Этот пароль — значение секрета `APPLE_APP_SPECIFIC_PASSWORD`

## Шаг 3: Team ID

В [Apple Developer → Membership](https://developer.apple.com/account#MembershipDetailsCard) скопируйте **Team ID** (10 символов).

## Шаг 4: Секреты в GitHub

В репозитории: **Settings → Secrets and variables → Actions** → New repository secret.

| Секрет | Описание |
|--------|----------|
| `APPLE_CERTIFICATE_BASE64` | Содержимое `certificate-base64.txt` (весь вывод `openssl base64 -A -in certificate.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Пароль, заданный при экспорте `.p12` |
| `KEYCHAIN_PASSWORD` | Любой пароль для временного keychain в CI (например, `build-keychain`) |
| `APPLE_ID` | Email вашего Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password из шага 2 |
| `APPLE_TEAM_ID` | Team ID из шага 3 |

После добавления секретов при запуске workflow **Build macOS installer** сборка будет подписываться и нотаризоваться; пользователи смогут устанавливать DMG без предупреждений.

## Без секретов

Если секреты не заданы, workflow по-прежнему собирает DMG, но без подписи. Пользователям при первом запуске нужно: **ПКМ по приложению → Открыть** или выполнить в Терминале:  
`xattr -cr /путь/к/metttaspace.app`
