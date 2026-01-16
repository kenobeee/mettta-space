#!/bin/bash
set -e

SERVER="root@85.198.100.83"
DOMAIN="mettta.space"
APP_DIR="/var/www/mira"
SERVICE_NAME="mira-server"

echo "🚀 Начинаем деплой на $SERVER..."

# Проверяем sshpass
if ! command -v sshpass &> /dev/null; then
    echo "❌ sshpass не установлен. Установите: brew install hudochenkov/sshpass/sshpass"
    exit 1
fi

# Создаём структуру директорий на сервере
echo "📁 Создаём директории..."
sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER << 'EOF'
mkdir -p /var/www/mira/{frontend,backend}
mkdir -p /var/www/mira/backend/src
EOF

# Собираем десктопные инсталляторы (локально)
echo "💻 Собираем desktop инсталляторы локально (mac)..."
npm run build:desktop

# Копируем фронтенд
echo "📦 Копируем фронтенд..."
sshpass -p 'Komarik_174' scp -r -o StrictHostKeyChecking=no apps/web/dist/* $SERVER:$APP_DIR/frontend/

# Копируем бэкенд
echo "📦 Копируем бэкенд..."
sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER "rm -rf $APP_DIR/backend/* $APP_DIR/backend/.* 2>/dev/null || true"
# Используем tar для копирования с исключениями
cd apps/server
tar --exclude='node_modules' --exclude='.git' -czf - . | sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER "cd $APP_DIR/backend && tar -xzf -"
cd ../..
# Копируем shared пакет
sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER "mkdir -p $APP_DIR/backend/packages/shared"
cd packages/shared
tar --exclude='node_modules' --exclude='.git' -czf - . | sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER "cd $APP_DIR/backend/packages/shared && tar -xzf -"
cd ../..

# Устанавливаем зависимости и запускаем на сервере
echo "⚙️  Устанавливаем зависимости и настраиваем сервис..."
sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER << EOF
cd $APP_DIR/backend

# Устанавливаем Node.js если нет
if ! command -v node &> /dev/null; then
    echo "📥 Устанавливаем Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Устанавливаем PM2 если нет
if ! command -v pm2 &> /dev/null; then
    echo "📥 Устанавливаем PM2..."
    npm install -g pm2
fi

# Устанавливаем зависимости (нужен tsx для запуска TS)
echo "📦 Устанавливаем зависимости..."
# Обновляем путь к shared пакету в package.json сервера
sed -i "s|file:../packages/shared|file:./packages/shared|g" package.json || true
npm install

# Создаём .env для сервера
cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3001
ENVEOF

# Останавливаем старый сервис если есть
pm2 delete $SERVICE_NAME 2>/dev/null || true

# Запускаем сервис через npm start
echo "🚀 Запускаем сервер..."
pm2 start npm --name $SERVICE_NAME -- start
pm2 save
pm2 startup systemd -u root --hp /root || true

echo "✅ Сервер запущен!"
EOF

# Копируем и настраиваем nginx
echo "🌐 Настраиваем nginx..."
sshpass -p 'Komarik_174' scp -o StrictHostKeyChecking=no deploy/nginx.conf.temp $SERVER:/tmp/nginx-mira-temp.conf
sshpass -p 'Komarik_174' scp -o StrictHostKeyChecking=no deploy/nginx.conf $SERVER:/tmp/nginx-mira.conf

sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER << EOF
# Обновляем пакеты
apt-get update -qq

# Устанавливаем nginx если нет
if ! command -v nginx &> /dev/null; then
    echo "📥 Устанавливаем nginx..."
    apt-get install -y nginx
fi

# Создаём директорию для certbot
mkdir -p /var/www/certbot

# Копируем временный конфиг (без SSL)
cp /tmp/nginx-mira-temp.conf /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/

# Удаляем дефолтный конфиг если есть
rm -f /etc/nginx/sites-enabled/default

# Проверяем конфиг
nginx -t

# Запускаем nginx
systemctl start nginx || service nginx start
systemctl enable nginx || update-rc.d nginx enable

# Устанавливаем certbot если нет
if ! command -v certbot &> /dev/null; then
    echo "📥 Устанавливаем certbot..."
    apt-get install -y certbot python3-certbot-nginx
fi

# Получаем SSL сертификат (если ещё нет)
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
    echo "🔒 Получаем SSL сертификат..."
    certbot certonly --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --force-renewal || echo "⚠️  Не удалось получить сертификат. Проверьте DNS настройки."
fi

# Если сертификат получен, переключаемся на полный конфиг с SSL
if [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
    echo "✅ SSL сертификат найден, применяем полный конфиг..."
    cp /tmp/nginx-mira.conf /etc/nginx/sites-available/$DOMAIN
    nginx -t && systemctl reload nginx || service nginx reload
else
    echo "⚠️  SSL сертификат не получен, используем HTTP конфиг"
fi

echo "✅ Nginx настроен!"
EOF

echo "📡 Настраиваем TURN (coturn)..."
sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER << 'EOF'
set -e
apt-get update -qq
if ! command -v turnserver &> /dev/null; then
  apt-get install -y coturn
fi

cat > /etc/turnserver.conf << 'CONF'
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=85.198.100.83
external-ip=85.198.100.83
fingerprint
lt-cred-mech
realm=mettta.space
server-name=mettta.space
user=mira:mira_turn_secret
total-quota=100
stale-nonce
no-loopback-peers
no-multicast-peers
no-sslv3
no-tlsv1
no-tlsv1_1
cert=/etc/letsencrypt/live/mettta.space/fullchain.pem
private-key=/etc/letsencrypt/live/mettta.space/privkey.pem
no-stdout-log
log-file=/var/log/turnserver/turn.log
allowed-peer-ip=0.0.0.0-255.255.255.255
allowed-peer-ip=::/0
CONF

systemctl enable coturn
systemctl restart coturn
EOF

# Копируем desktop инсталляторы
echo "💾 Копируем desktop инсталляторы..."
sshpass -p 'Komarik_174' ssh -o StrictHostKeyChecking=no $SERVER "mkdir -p $APP_DIR/frontend/downloads"

MAC_INSTALLER=$(ls apps/desktop/dist/metttaspace-*.dmg 2>/dev/null | head -n 1)

if [ -n "$MAC_INSTALLER" ]; then
  sshpass -p 'Komarik_174' scp -o StrictHostKeyChecking=no "$MAC_INSTALLER" $SERVER:$APP_DIR/frontend/downloads/metttaspace-mac.dmg
fi

echo "🎉 Деплой завершён!"
echo "🌐 Откройте https://$DOMAIN в браузере"

