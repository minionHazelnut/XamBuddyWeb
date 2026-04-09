import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from database import AsyncSessionLocal, Question

async def test_connection():
    """Test database connection and add sample data"""
    async with AsyncSessionLocal() as db:
        try:
            # Test connection
            result = await db.execute(select(func.count()).select_from(Question))
            count = result.scalar()
            print(f"✅ Database connected! Current questions count: {count}")
            
            # Add sample data if empty
            if count == 0:
                print("📝 Adding sample questions...")
                
                sample_questions = [
                    Question(
                        question="What is 2 + 2?",
                        answer="4",
                        subject="math",
                        difficulty="easy",
                        exam_type="10th CBSE Board",
                        chapter="Basic Arithmetic",
                        question_type="short"
                    ),
                    Question(
                        question="What is the derivative of x^2?",
                        answer="2x",
                        subject="math",
                        difficulty="medium",
                        exam_type="12th CBSE Board",
                        chapter="Calculus",
                        question_type="short"
                    ),
                    Question(
                        question="What is H2O?",
                        answer="Water",
                        subject="science",
                        difficulty="easy",
                        exam_type="10th CBSE Board",
                        chapter="Chemical Compounds",
                        question_type="short"
                    ),
                    Question(
                        question="When did World War II end?",
                        answer="1945",
                        subject="history",
                        difficulty="easy",
                        exam_type="10th CBSE Board",
                        chapter="World History",
                        question_type="short"
                    )
                ]
                
                for q in sample_questions:
                    db.add(q)
                
                await db.commit()
                print(f"✅ Added {len(sample_questions)} sample questions")
                
                # Verify data
                result = await db.execute(select(func.count()).select_from(Question))
                new_count = result.scalar()
                print(f"✅ Total questions in database: {new_count}")
                
                # Show sample data
                result = await db.execute(select(Question).limit(3))
                questions = result.scalars().all()
                print("\n📋 Sample questions:")
                for q in questions:
                    print(f"  - {q.subject}: {q.question} -> {q.answer}")
                
            else:
                # Show existing data
                result = await db.execute(select(Question).limit(5))
                questions = result.scalars().all()
                print("\n📋 Existing questions:")
                for q in questions:
                    print(f"  - [{q.subject}] {q.question} -> {q.answer}")
                    
        except Exception as e:
            print(f"❌ Database error: {e}")
            await db.rollback()

if __name__ == "__main__":
    asyncio.run(test_connection())
