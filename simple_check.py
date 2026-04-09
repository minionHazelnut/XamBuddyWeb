import asyncio
import asyncpg
from sqlalchemy import text

async def simple_check():
    """Simple database schema check"""
    conn = await asyncpg.connect("postgresql://postgres:xambuddypwd@139.59.93.35:5432/xambuddydb")
    
    try:
        # Get table names
        tables = await conn.fetch("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        
        print("📋 Tables in database:")
        for table in tables:
            print(f"  - {table['table_name']}")
        
        # Get columns for questions table
        columns = await conn.fetch("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'questions' AND table_schema = 'public'
            ORDER BY ordinal_position
        """)
        
        if columns:
            print(f"\n📊 Columns in 'questions' table:")
            for col in columns:
                print(f"  - {col['column_name']}: {col['data_type']} (nullable: {col['is_nullable']})")
                
            # Get sample data
            rows = await conn.fetch("SELECT * FROM questions LIMIT 3")
            print(f"\n📝 Sample data:")
            for row in rows:
                print(f"  {dict(row)}")
        else:
            print("❌ 'questions' table not found")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(simple_check())
