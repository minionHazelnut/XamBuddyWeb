import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, inspect
from database import AsyncSessionLocal, engine

async def check_schema():
    """Check actual database schema"""
    async with engine.begin() as conn:
        try:
            # Sync inspection
            inspector = inspect(conn.sync_connection)
            tables = inspector.get_table_names()
            print(f"📋 Tables in database: {tables}")
            
            if 'questions' in tables:
                columns = inspector.get_columns('questions')
                print(f"\n📊 Columns in 'questions' table:")
                for col in columns:
                    print(f"  - {col['name']}: {col['type']} (nullable: {col['nullable']})")
                    
                # Get sample data
                result = await conn.execute(text("SELECT * FROM questions LIMIT 3"))
                rows = result.fetchall()
                print(f"\n📝 Sample data:")
                for row in rows:
                    print(f"  {dict(row._mapping)}")
            else:
                print("❌ 'questions' table not found")
                
        except Exception as e:
            print(f"❌ Error checking schema: {e}")

if __name__ == "__main__":
    asyncio.run(check_schema())
