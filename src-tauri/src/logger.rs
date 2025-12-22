use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use chrono::Local;

/// Максимальный размер лог-файла (1 MB)
const MAX_LOG_SIZE: u64 = 1 * 1024 * 1024;

/// Простой файловый логгер для отладки с автоочисткой
pub struct FileLogger {
    file: Mutex<File>,
    log_path: PathBuf,
}

impl FileLogger {
    /// Создать новый логгер
    pub fn new(log_path: PathBuf) -> anyhow::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;

        Ok(Self {
            file: Mutex::new(file),
            log_path,
        })
    }

    /// Проверить размер файла и очистить если превышен лимит
    fn check_and_rotate(&self) -> anyhow::Result<()> {
        if let Ok(metadata) = std::fs::metadata(&self.log_path) {
            if metadata.len() > MAX_LOG_SIZE {
                // Перезаписываем файл (truncate)
                let new_file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&self.log_path)?;

                if let Ok(mut file) = self.file.lock() {
                    *file = new_file;
                }
            }
        }
        Ok(())
    }

    /// Записать лог
    pub fn log(&self, level: &str, message: &str) {
        // Проверяем размер перед записью
        let _ = self.check_and_rotate();

        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let log_line = format!("[{}] [{}] {}\n", timestamp, level, message);

        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(log_line.as_bytes());
            let _ = file.flush();
        }
    }

    /// INFO лог
    pub fn info(&self, message: &str) {
        self.log("INFO", message);
    }

    /// DEBUG лог
    pub fn debug(&self, message: &str) {
        self.log("DEBUG", message);
    }

    /// WARN лог
    pub fn warn(&self, message: &str) {
        self.log("WARN", message);
    }

    /// ERROR лог
    pub fn error(&self, message: &str) {
        self.log("ERROR", message);
    }
}
