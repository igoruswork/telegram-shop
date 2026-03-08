# 🛍 Telegram Mini Shop

Стартовий шаблон для **Telegram Mini App** — каталог товарів з кошиком.

**Стек:** React 18 + Vite 5 + Supabase (Realtime) + GitHub Actions → GitHub Pages

---

## 🚀 3 кроки до запуску

### 1. Supabase

1. Перейдіть на [supabase.com](https://supabase.com) → **New Project**
2. Відкрийте **SQL Editor** → вставте вміст файлу `supabase/migrations/001_create_tables.sql` → натисніть **Run**
3. Перейдіть **Settings → API** → скопіюйте `Project URL` і `anon / public` key

### 2. GitHub

1. Створіть новий репозиторій на GitHub
2. Завантажте цей проєкт:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```
3. Перейдіть **Repo → Settings → Secrets and variables → Actions** → додайте:
   - `VITE_SUPABASE_URL` — ваш Project URL
   - `VITE_SUPABASE_ANON_KEY` — ваш anon key
4. Перейдіть **Repo → Settings → Pages** → Source: **GitHub Actions**
5. Push в `main` — деплой автоматично запуститься

### 3. Telegram Bot

1. Створіть бота через [@BotFather](https://t.me/BotFather)
2. Використайте команду `/newapp` або `/setmenubutton`
3. Вкажіть URL: `https://YOUR_USER.github.io/YOUR_REPO/`

---

## 📁 Структура проєкту

```
├── .github/workflows/deploy.yml    # CI/CD → GitHub Pages
├── supabase/migrations/
│   └── 001_create_tables.sql       # SQL таблиці + тестові дані
├── src/
│   ├── lib/
│   │   ├── supabase.js             # Supabase клієнт
│   │   └── useTelegram.js          # Hook для Telegram WebApp API
│   ├── components/
│   │   └── CartDrawer.jsx          # Sliding cart drawer
│   ├── pages/
│   │   ├── GatePage.jsx            # Вхідна сторінка (телефон + прізвище)
│   │   ├── CatalogPage.jsx         # Сітка товарів 2×N + фільтри
│   │   └── ProductPage.jsx         # Детальна сторінка товару
│   ├── App.jsx                     # Головний компонент
│   ├── styles.css                  # Глобальні стилі
│   └── main.jsx                    # Entry point
├── index.html
├── vite.config.js
└── package.json
```

---

## ✨ Можливості

| Функція | Опис |
|---------|------|
| **Гейт-сторінка** | Телефон + прізвище для доступу; дані зберігаються в `access_log` |
| **Каталог 2×N** | Сітка карток з фото, ціною, бейджами |
| **Фільтри** | Горизонтальний скрол по категоріях + живий пошук |
| **Кошик** | Sliding drawer знизу, FAB-кнопка з сумою |
| **Замовлення** | Зберігається в таблицю `orders` Supabase |
| **Realtime** | Зміни в Supabase миттєво відображаються на сайті |
| **view = TRUE / FALSE** | Товари з `view = FALSE` приховані від відвідувачів |
| **Haptic feedback** | На всіх кнопках (Telegram) |
| **Адаптивний дизайн** | Оптимізовано для мобільних |

---

## 🗄 Таблиця `products` в Supabase

| Колонка | Тип | Опис |
|---------|-----|------|
| `id` | bigint | Авто-ID |
| `name` | text | Назва товару |
| `category` | text | Категорія |
| `p_category` | text | Підкатегорія |
| `badge` | text | Бейдж (Хіт, Новинка, Акція) |
| `view` | boolean | `TRUE` — показувати, `FALSE` — приховати |
| `number_sites` | int | Порядок відображення |
| `sku` | text | Штрихкод |
| `price` | numeric | Ціна |
| `thumbnail_url` | text | URL картинки |

---

## 🔧 Локальна розробка

```bash
cp .env.example .env
# Заповніть .env своїми ключами Supabase

npm install
npm run dev
```

Відкрийте `http://localhost:5173` у браузері.

---

## 📝 Ліцензія

MIT
# telegram-shop
# telegram-shop
