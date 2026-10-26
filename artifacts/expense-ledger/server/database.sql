CREATE DATABASE IF NOT EXISTS expense_tracker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE expense_tracker;

CREATE TABLE IF NOT EXISTS categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
  expense_id INT AUTO_INCREMENT PRIMARY KEY,
  expense_date DATE NOT NULL,
  category_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255),
  payment_method VARCHAR(50),
  CONSTRAINT chk_expense_amount CHECK (amount > 0),
  CONSTRAINT fk_expense_category
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
  INDEX idx_expense_date (expense_date),
  INDEX idx_expense_category (category_id)
);

INSERT IGNORE INTO categories (category_name) VALUES
  ('Food & Dining'),
  ('Transport'),
  ('Housing'),
  ('Utilities'),
  ('Entertainment'),
  ('Health'),
  ('Shopping'),
  ('Travel'),
  ('Other');
