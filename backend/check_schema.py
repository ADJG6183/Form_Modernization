import os
import sqlite3

# Path to the SQLite database file
DB_PATH = os.path.join('instance', 'files.db')

def check_table_schema(table_name):
    """Check the schema of a specific table"""
    try:
        # Connect to the database
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Get table info
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()
        
        print(f"Schema for table {table_name}:")
        for col in columns:
            print(f"  {col[1]} ({col[2]}) {'PRIMARY KEY' if col[5] == 1 else ''} {'NOT NULL' if col[3] == 1 else 'NULL'}")
        
        # Check if table has data
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cursor.fetchone()[0]
        print(f"Table {table_name} has {count} rows")
        
        conn.close()
        return True
    except Exception as e:
        print(f"Error checking schema: {e}")
        return False

if __name__ == "__main__":
    print(f"Checking database schema in {DB_PATH}...")
    if os.path.exists(DB_PATH):
        check_table_schema('submissions')
        print("\n")
        check_table_schema('files')
        print("\n")
        check_table_schema('created_files')
        print("\n")
        check_table_schema('filled_forms')
        print("\n")
        check_table_schema('pdf_portfolios')
    else:
        print(f"Database file {DB_PATH} not found!")
