# 📥 Скачать SETKI.PRO KEEPER

## Последняя версия: v0.5.2

### 🚀 Быстрая загрузка (прямые ссылки)

#### Windows (64-bit)
```
https://github.com/chistikov-d/setki.pro-keeper/releases/download/v0.5.2/SETKI-PRO-KEEPER_0.5.2_x64-setup.exe
```
**Размер:** ~15 MB
**Установка:** Запустите .exe файл и следуйте инструкциям

#### Linux (рекомендуется .deb для старых систем)

**Debian/Ubuntu пакет (.deb) - для Linux Mint 19.3, Ubuntu 18.04+:**
```
https://github.com/chistikov-d/setki.pro-keeper/releases/download/v0.5.2/setki-keeper_0.5.2_amd64.deb
```
**Размер:** ~15 MB
**Совместимость:** Linux Mint 19.3+, Ubuntu 18.04+, Debian 10+
**Установка:**
```bash
sudo dpkg -i setki-keeper_0.5.2_amd64.deb
sudo apt-get install -f  # Установка зависимостей, если нужно
```

**AppImage (универсальный) - для современных систем:**
```
https://github.com/chistikov-d/setki.pro-keeper/releases/download/v0.5.2/setki-keeper_0.5.2_amd64.AppImage
```
**Размер:** ~20 MB
**Совместимость:** Ubuntu 20.04+, современные дистрибутивы
**Установка:**
```bash
chmod +x setki-keeper_0.5.2_amd64.AppImage
./setki-keeper_0.5.2_amd64.AppImage
```

#### Android (ARM64)
```
https://github.com/chistikov-d/setki.pro-keeper/releases/download/v0.5.2/setki-keeper_0.5.2_arm64-v8a.apk
```
**Размер:** ~25 MB
**Требования:** Android 7.0+ (API 24)
**Установка:** Включите "Неизвестные источники" и откройте APK

---

## 🌐 Альтернативные зеркала (если GitHub медленный)

### jsDelivr CDN (автоматическое зеркало)

**Windows:**
```
https://cdn.jsdelivr.net/gh/chistikov-d/setki.pro-keeper@v0.5.2/releases/SETKI-PRO-KEEPER_0.5.2_x64-setup.exe
```

**Linux (.deb для старых систем):**
```
https://cdn.jsdelivr.net/gh/chistikov-d/setki.pro-keeper@v0.5.2/releases/setki-keeper_0.5.2_amd64.deb
```

**Linux (AppImage для новых систем):**
```
https://cdn.jsdelivr.net/gh/chistikov-d/setki.pro-keeper@v0.5.2/releases/setki-keeper_0.5.2_amd64.AppImage
```

> ⚡ jsDelivr использует глобальную CDN сеть и часто работает быстрее в России

---

## 🖥️ Совместимость

### Linux
| Дистрибутив | Версия | Формат | Статус |
|------------|--------|--------|--------|
| **Linux Mint** | 19.3+ (Tricia) | .deb | ✅ Поддерживается |
| **Ubuntu** | 18.04+ (Bionic) | .deb | ✅ Поддерживается |
| **Ubuntu** | 20.04+ (Focal) | .deb / AppImage | ✅ Поддерживается |
| **Debian** | 10+ (Buster) | .deb | ✅ Поддерживается |
| **Fedora** | 30+ | AppImage | ✅ Поддерживается |
| **Arch Linux** | Rolling | AppImage | ✅ Поддерживается |

**Требования:**
- **Процессор:** x86_64 (64-bit)
- **ОЗУ:** Минимум 2 GB, рекомендуется 4 GB
- **Библиотеки:** webkit2gtk-4.0, gtk-3.0 (автоматически устанавливаются с .deb)

### Windows
| Версия | Статус |
|--------|--------|
| **Windows 11** | ✅ Поддерживается |
| **Windows 10** | ✅ Поддерживается |
| **Windows 8.1** | ⚠️ Не тестировалось |
| **Windows 7** | ❌ Не поддерживается |

### Android
| Версия | API Level | Статус |
|--------|-----------|--------|
| **Android 14** | API 34 | ✅ Поддерживается |
| **Android 13** | API 33 | ✅ Поддерживается |
| **Android 10-12** | API 29-32 | ✅ Поддерживается |
| **Android 7-9** | API 24-28 | ✅ Поддерживается |
| **Android 6 и ниже** | API <24 | ❌ Не поддерживается |

---

## 📦 Все версии

Полный список релизов: [GitHub Releases](https://github.com/chistikov-d/setki.pro-keeper/releases)

---

## ✅ Проверка подлинности

После скачивания проверьте контрольную сумму файла:

### Windows
```powershell
Get-FileHash SETKI-PRO-KEEPER_0.5.2_x64-setup.exe -Algorithm SHA256
```

### Linux
```bash
sha256sum setki-keeper_0.5.2_amd64.AppImage
```

Контрольные суммы публикуются в [Release Notes](https://github.com/chistikov-d/setki.pro-keeper/releases/tag/v0.5.2)

---

## 🛠️ Что нового в v0.5.2

### Исправления
- **Отмена действий**: Теперь корректно синхронизируется с локальным сервером
- **Курсор мыши**: Больше не уходит на второй монитор (публичное табло)

Полный список изменений: [CHANGELOG.md](CHANGELOG.md)

---

## 📞 Поддержка

- **Документация**: [README.md](README.md)
- **Руководство пользователя**: [docs/USER_MANUAL.md](docs/USER_MANUAL.md)
- **Руководство администратора**: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)
- **Проблемы**: [GitHub Issues](https://github.com/chistikov-d/setki.pro-keeper/issues)

---

## 💡 Советы по ускорению загрузки

1. **Используйте прямые ссылки** (см. выше) вместо страницы релиза
2. **jsDelivr CDN** - если GitHub медленный в вашем регионе
3. **Менеджер загрузок** - используйте aria2, wget или любой download manager для многопоточной загрузки
4. **VPN/Proxy** - если GitHub блокируется вашим провайдером

### Пример с wget (многопоточная загрузка):
```bash
wget -c https://github.com/chistikov-d/setki.pro-keeper/releases/download/v0.5.2/setki-keeper_0.5.2_amd64.AppImage
```

### Пример с aria2 (до 16 потоков):
```bash
aria2c -x 16 -s 16 https://github.com/chistikov-d/setki.pro-keeper/releases/download/v0.5.2/setki-keeper_0.5.2_amd64.AppImage
```
