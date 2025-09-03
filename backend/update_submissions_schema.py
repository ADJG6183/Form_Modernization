import os
import sys
import sqlite3

# Path to the SQLite database file
DB_PATH = os.path.join('instance', 'files.db')

def update_submissions_table():
    """Add portfolio_id, filled_file_id, form_data, form_metadata, submitted_at, and status columns to submissions table"""
    try:
        # Connect to the database
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check if the submissions table has the expected structure from SQLAlchemy model
        cursor.execute("PRAGMA table_info(submissions)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]
        
        columns_to_add = {
            'portfolio_id': 'INTEGER',
            'filled_file_id': 'INTEGER',
            'form_data': 'TEXT',
            'form_metadata': 'TEXT',
            'submitted_at': 'DATETIME',
            'status': 'VARCHAR(20)'
        }
        
        for col_name, col_type in columns_to_add.items():
            if col_name not in column_names:
                print(f"Adding {col_name} column to submissions table...")
                cursor.execute(f"ALTER TABLE submissions ADD COLUMN {col_name} {col_type}")
                print(f"Column {col_name} added successfully!")
            else:
                print(f"Column {col_name} already exists in submissions table.")
        
        # Remove form_id constraint if it exists (since we're moving to portfolio_id)
        if 'form_id' in column_names:
            # SQLite doesn't support dropping columns directly, so we need to recreate the table
            print("Migrating submissions table to new schema...")
            
            # Create new table with desired schema
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS submissions_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    portfolio_id INTEGER,
                    filled_file_id INTEGER,
                    form_data TEXT,
                    form_metadata TEXT,
                    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    user_email VARCHAR(255),
                    status VARCHAR(20) DEFAULT 'submitted'
                )
            """)
            
            # Copy data from old table to new, mapping columns appropriately
            try:
                cursor.execute("""
                    INSERT INTO submissions_new (id, user_email, form_data)
                    SELECT id, user_email, data FROM submissions
                """)
                print("Data migrated successfully!")
            except Exception as e:
                print(f"Error migrating data: {e}")
            
            # Drop old table and rename new one
            cursor.execute("DROP TABLE submissions")
            cursor.execute("ALTER TABLE submissions_new RENAME TO submissions")
            print("Table structure updated successfully!")
        
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"Error updating submissions table: {e}")
        return False

if __name__ == "__main__":
    print(f"Updating database schema in {DB_PATH}...")
    if os.path.exists(DB_PATH):
        if update_submissions_table():
            print("Submissions table schema updated successfully!")
        else:
            print("Failed to update submissions table schema.")
            sys.exit(1)
    else:
        print(f"Database file {DB_PATH} not found!")
        sys.exit(1)
    
    print("Done!")
