import os
import sys
import sqlite3

# Path to the SQLite database file
DB_PATH = os.path.join('instance', 'files.db')

def add_column_to_created_files():
    """Add original_file_id column to created_files table if it doesn't exist"""
    try:
        # Connect to the database
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check if the column already exists
        cursor.execute("PRAGMA table_info(created_files)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]
        
        if 'original_file_id' not in column_names:
            print("Adding original_file_id column to created_files table...")
            cursor.execute("ALTER TABLE created_files ADD COLUMN original_file_id INTEGER")
            conn.commit()
            print("Column added successfully!")
        else:
            print("Column original_file_id already exists in created_files table.")
        
        conn.close()
        return True
    except Exception as e:
        print(f"Error updating database: {e}")
        return False

if __name__ == "__main__":
    print(f"Updating database schema in {DB_PATH}...")
    if os.path.exists(DB_PATH):
        if add_column_to_created_files():
            print("Database schema updated successfully!")
        else:
            print("Failed to update database schema.")
            sys.exit(1)
    else:
        print(f"Database file {DB_PATH} not found!")
        sys.exit(1)
    
    print("Done!")
