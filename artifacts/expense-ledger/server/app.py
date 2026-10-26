"""Flask API for Expense Ledger.

Set DB_HOST/DB_USER/DB_PASSWORD/DB_NAME to use MySQL. Without those settings,
the app uses a durable SQLite database in this artifact's instance directory.
"""

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import logging
import os
from pathlib import Path
import sqlite3
from typing import Any

import pymysql
import pymysql.cursors
from flask import Flask, jsonify, render_template, request

from analytics import process_expense_analytics
from plotting import generate_bar_chart, generate_pie_chart
import ollama_client as ai


ROOT = Path(__file__).resolve().parent
INSTANCE_DIR = ROOT / "instance"
SQLITE_PATH = Path(
    os.getenv("EXPENSE_SQLITE_PATH", str(INSTANCE_DIR / "expense-ledger.sqlite3"))
)
DB_MODE = os.getenv(
    "EXPENSE_DB",
    "mysql" if os.getenv("DB_HOST") else "sqlite",
).strip().lower()
API_PREFIX = "/ledger-api"
PAYMENT_METHODS = {
    "Credit Card",
    "Debit Card",
    "Cash",
    "UPI",
    "Bank Transfer",
}
DEFAULT_CATEGORIES = [
    "Food & Dining",
    "Transport",
    "Housing",
    "Utilities",
    "Entertainment",
    "Health",
    "Shopping",
    "Travel",
    "Other",
]

app = Flask(
    __name__,
    template_folder=str(ROOT / "templates"),
    static_folder=str(ROOT / "static"),
)
app.config["JSON_SORT_KEYS"] = False
app.logger.setLevel(logging.INFO)


def _placeholder() -> str:
    if DB_MODE not in {"sqlite", "mysql"}:
        raise RuntimeError("EXPENSE_DB must be either 'sqlite' or 'mysql'")
    return "%s" if DB_MODE == "mysql" else "?"


def _connect():
    if DB_MODE == "mysql":
        required = ("DB_HOST", "DB_USER", "DB_NAME")
        missing = [key for key in required if not os.getenv(key)]
        if missing:
            raise RuntimeError(
                "MySQL is selected but required database settings are missing."
            )
        return pymysql.connect(
            host=os.environ["DB_HOST"],
            user=os.environ["DB_USER"],
            password=os.getenv("DB_PASSWORD", ""),
            database=os.environ["DB_NAME"],
            port=int(os.getenv("DB_PORT", "3306")),
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True,
            connect_timeout=5,
            charset="utf8mb4",
        )

    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(SQLITE_PATH), timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def _cursor():
    connection = _connect()
    cursor = connection.cursor()
    try:
        yield cursor
    finally:
        cursor.close()
        connection.close()


def _initialize_sqlite() -> None:
    if DB_MODE != "sqlite":
        return
    with _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS categories (
              category_id INTEGER PRIMARY KEY AUTOINCREMENT,
              category_name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS expenses (
              expense_id INTEGER PRIMARY KEY AUTOINCREMENT,
              expense_date TEXT NOT NULL,
              category_id INTEGER NOT NULL,
              amount NUMERIC NOT NULL CHECK (amount > 0),
              description TEXT CHECK (length(description) <= 255),
              payment_method TEXT,
              FOREIGN KEY (category_id) REFERENCES categories(category_id)
            );
            CREATE INDEX IF NOT EXISTS idx_expense_date ON expenses(expense_date);
            CREATE INDEX IF NOT EXISTS idx_expense_category ON expenses(category_id);
            """
        )
        connection.executemany(
            "INSERT OR IGNORE INTO categories (category_name) VALUES (?)",
            [(name,) for name in DEFAULT_CATEGORIES],
        )


def _row_dict(row: Any) -> dict[str, Any]:
    return dict(row)


def _clean_expenses(rows: list[Any]) -> list[dict[str, Any]]:
    cleaned = []
    for source in rows:
        row = _row_dict(source)
        value = row.get("expense_date")
        if isinstance(value, (date, datetime)):
            row["expense_date"] = value.strftime("%Y-%m-%d")
        row["amount"] = float(row["amount"])
        cleaned.append(row)
    return cleaned


def _request_args():
    if request.method in {"POST", "PUT", "PATCH"}:
        body = request.get_json(silent=True)
        if isinstance(body, dict):
            return body
    return request.args


def _filters(select_sql: str) -> tuple[str, list[Any]]:
    source = _request_args()
    query = select_sql + (
        " FROM expenses e JOIN categories c "
        "ON e.category_id = c.category_id WHERE 1=1"
    )
    params: list[Any] = []
    placeholder = _placeholder()

    for key, operator in (
        ("start_date", ">="),
        ("end_date", "<="),
    ):
        value = str(source.get(key, "")).strip()
        if value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError as error:
                raise ValueError(f"{key} must be a valid YYYY-MM-DD date") from error
            query += f" AND e.expense_date {operator} {placeholder}"
            params.append(value)

    category = str(source.get("category_id", "")).strip()
    if category and category.lower() != "all":
        try:
            category_id = int(category)
        except ValueError as error:
            raise ValueError("category_id must be a positive integer") from error
        if category_id < 1:
            raise ValueError("category_id must be a positive integer")
        query += f" AND e.category_id = {placeholder}"
        params.append(category_id)
    return query, params


def _validate_expense(data: Any) -> tuple[tuple[Any, ...] | None, str | None]:
    if not isinstance(data, dict):
        return None, "A JSON expense object is required"

    date_value = str(data.get("expense_date", "")).strip()
    try:
        datetime.strptime(date_value, "%Y-%m-%d")
    except ValueError:
        return None, "Date is required and must use YYYY-MM-DD"

    try:
        category_id = int(data.get("category_id"))
    except (TypeError, ValueError):
        return None, "A valid category is required"
    if category_id < 1:
        return None, "A valid category is required"

    try:
        amount = Decimal(str(data.get("amount")))
        if not amount.is_finite() or amount <= 0:
            return None, "Amount must be greater than 0"
        amount = amount.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return None, "Enter a valid amount greater than 0"
    if amount > Decimal("99999999.99"):
        return None, "Amount exceeds the maximum supported value"

    description = str(data.get("description") or "").strip()
    if len(description) > 255:
        return None, "Description must be 255 characters or fewer"
    method = str(data.get("payment_method") or "Credit Card").strip()
    if method not in PAYMENT_METHODS:
        return None, "Select a supported payment method"

    return (date_value, category_id, amount, description or None, method), None


def _failure(message: str, status: int = 500):
    return jsonify(success=False, error=message), status


def _database_error(error: Exception):
    app.logger.exception("Expense database request failed")
    message = (
        "The expense database is unavailable. Check the MySQL settings and run "
        "server/database.sql, or use the default SQLite mode."
        if DB_MODE == "mysql"
        else "The local expense database could not be opened."
    )
    return _failure(message, 503)


def _analytics():
    query, params = _filters(
        "SELECT e.expense_date, e.amount, c.category_name"
    )
    with _cursor() as cursor:
        cursor.execute(query, params)
        rows = _clean_expenses(cursor.fetchall())
    return process_expense_analytics(rows)


@app.get(f"{API_PREFIX}/")
def service_home():
    return render_template("index.html")


@app.get("/")
def workflow_health():
    return jsonify(status="ok", service="expense-ledger-api")


@app.get(f"{API_PREFIX}/healthz")
def health():
    try:
        with _cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        database = DB_MODE
    except Exception as error:
        return _database_error(error)
    return jsonify(status="ok", database=database)


@app.get(f"{API_PREFIX}/categories")
def list_categories():
    try:
        with _cursor() as cursor:
            cursor.execute(
                "SELECT category_id, category_name FROM categories "
                "ORDER BY category_name"
            )
            categories = [_row_dict(row) for row in cursor.fetchall()]
        return jsonify(success=True, categories=categories)
    except Exception as error:
        return _database_error(error)


@app.get(f"{API_PREFIX}/expenses")
def list_expenses():
    try:
        query, params = _filters(
            "SELECT e.expense_id, e.expense_date, e.category_id, "
            "c.category_name, e.amount, e.description, e.payment_method"
        )
        with _cursor() as cursor:
            cursor.execute(
                query + " ORDER BY e.expense_date DESC, e.expense_id DESC",
                params,
            )
            rows = _clean_expenses(cursor.fetchall())
        return jsonify(success=True, expenses=rows)
    except ValueError as error:
        return _failure(str(error), 400)
    except Exception as error:
        return _database_error(error)


@app.post(f"{API_PREFIX}/expenses")
def create_expense():
    values, error = _validate_expense(request.get_json(silent=True))
    if error:
        return _failure(error, 400)
    try:
        with _cursor() as cursor:
            cursor.execute(
                "INSERT INTO expenses "
                "(expense_date, category_id, amount, description, payment_method) "
                f"VALUES ({', '.join([_placeholder()] * 5)})",
                values,
            )
            expense_id = cursor.lastrowid
        return jsonify(success=True, expense_id=int(expense_id)), 201
    except Exception as error:
        return _database_error(error)


@app.put(f"{API_PREFIX}/expenses/<int:expense_id>")
def update_expense(expense_id: int):
    values, error = _validate_expense(request.get_json(silent=True))
    if error:
        return _failure(error, 400)
    try:
        with _cursor() as cursor:
            cursor.execute(
                "UPDATE expenses SET expense_date = "
                f"{_placeholder()}, category_id = {_placeholder()}, "
                f"amount = {_placeholder()}, description = {_placeholder()}, "
                f"payment_method = {_placeholder()} "
                f"WHERE expense_id = {_placeholder()}",
                values + (expense_id,),
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    f"SELECT 1 FROM expenses WHERE expense_id = {_placeholder()}",
                    (expense_id,),
                )
                if cursor.fetchone() is None:
                    return _failure("Expense not found", 404)
        return jsonify(success=True)
    except Exception as error:
        return _database_error(error)


@app.patch(f"{API_PREFIX}/expenses/<int:expense_id>/category")
def move_expense_category(expense_id: int):
    data = request.get_json(silent=True) or {}
    try:
        category_id = int(data.get("category_id"))
    except (TypeError, ValueError):
        return _failure("A valid category_id is required", 400)
    if category_id < 1:
        return _failure("A valid category_id is required", 400)
    try:
        with _cursor() as cursor:
            cursor.execute(
                f"UPDATE expenses SET category_id = {_placeholder()} "
                f"WHERE expense_id = {_placeholder()}",
                (category_id, expense_id),
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    f"SELECT 1 FROM expenses WHERE expense_id = {_placeholder()}",
                    (expense_id,),
                )
                if cursor.fetchone() is None:
                    return _failure("Expense not found", 404)
        return jsonify(success=True)
    except Exception as error:
        return _database_error(error)


@app.delete(f"{API_PREFIX}/expenses/<int:expense_id>")
def delete_expense(expense_id: int):
    try:
        with _cursor() as cursor:
            cursor.execute(
                f"DELETE FROM expenses WHERE expense_id = {_placeholder()}",
                (expense_id,),
            )
            if cursor.rowcount == 0:
                return _failure("Expense not found", 404)
        return jsonify(success=True)
    except Exception as error:
        return _database_error(error)


@app.get(f"{API_PREFIX}/analytics")
def get_analytics():
    try:
        data = _analytics()
        return jsonify(
            success=True,
            analytics=data,
            charts={
                "bar_chart": generate_bar_chart(data["monthly_totals"]),
                "pie_chart": generate_pie_chart(data["category_breakdown"]),
            },
        )
    except ValueError as error:
        return _failure(str(error), 400)
    except Exception as error:
        return _database_error(error)


@app.get(f"{API_PREFIX}/ai/status")
def ai_status():
    return jsonify(ai.status())


@app.post(f"{API_PREFIX}/ai/categorize")
def ai_categorize():
    description = str(
        (request.get_json(silent=True) or {}).get("description") or ""
    ).strip()
    if not description:
        return _failure("Description is required", 400)
    try:
        with _cursor() as cursor:
            cursor.execute(
                "SELECT category_id, category_name FROM categories "
                "ORDER BY category_name"
            )
            categories = [_row_dict(row) for row in cursor.fetchall()]
        name, source = ai.categorize(
            description,
            [category["category_name"] for category in categories],
        )
        category = next(
            item for item in categories if item["category_name"] == name
        )
        return jsonify(
            success=True,
            category_id=category["category_id"],
            category_name=name,
            source=source,
        )
    except Exception as error:
        return _database_error(error)


@app.post(f"{API_PREFIX}/ai/insights")
def ai_insights():
    try:
        data = _analytics()
        text, source = ai.insights(data)
        return jsonify(success=True, insights=text, source=source)
    except ValueError as error:
        return _failure(str(error), 400)
    except Exception as error:
        return _database_error(error)


@app.errorhandler(404)
def not_found(_error):
    return _failure("Route not found", 404)


@app.errorhandler(405)
def method_not_allowed(_error):
    return _failure("Method not allowed", 405)


try:
    _initialize_sqlite()
except Exception:
    app.logger.exception("Could not initialize the local SQLite store")


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "5001")),
        debug=False,
    )
