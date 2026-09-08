"""
Script to create or activate a shopkeeper account with an active subscription.
Run via: python create_user.py
"""
import sys
from datetime import datetime
from werkzeug.security import generate_password_hash
from app import db_connection

# ==========================================
# ✏️ EDIT SHOP DETAILS HERE
# ==========================================
STORE_NAME = "AgriKisan Main Store"
EMAIL      = "sahilchhimpa029@gmail.com"
PASSWORD   = "@agri10085"
DAYS_VALID = 365  # Subscription duration in days
CLAIM_OLD_DATA = True  # Set True to link previous unassigned stock/bills to this user
# ==========================================


def setup_shopkeeper():
    email = EMAIL.strip().lower()
    pw_hash = generate_password_hash(PASSWORD)

    print(f"Creating account for: {STORE_NAME} ({email})...")

    with db_connection() as conn:
        with conn.cursor() as cur:
            # Check if user already exists
            cur.execute("SELECT id FROM public.users WHERE email = %s", (email,))
            existing = cur.fetchone()

            if existing:
                user_id = existing[0]
                print(f"User already exists with ID {user_id}. Updating password and renewing subscription...")
                cur.execute("""
                    UPDATE public.users 
                    SET password_hash = %s,
                        name = %s,
                        subscription_status = 'ACTIVE',
                        subscription_end = NOW() + (%s || ' days')::INTERVAL
                    WHERE id = %s
                """, (pw_hash, STORE_NAME, DAYS_VALID, user_id))
            else:
                cur.execute("""
                    INSERT INTO public.users (name, email, password_hash, subscription_status, subscription_end)
                    VALUES (%s, %s, %s, 'ACTIVE', NOW() + (%s || ' days')::INTERVAL)
                    RETURNING id
                """, (STORE_NAME, email, pw_hash, DAYS_VALID))
                user_id = cur.fetchone()[0]
                print(f"Account created successfully with User ID: {user_id}")

            # Link any legacy data that has no owner yet
            if CLAIM_OLD_DATA:
                tables = ['customers', 'suppliers', 'inventory', 'bills', 'expenses', 'ledger_entries', 'contact_enquiries']
                for table in tables:
                    cur.execute(f"UPDATE public.{table} SET user_id = %s WHERE user_id IS NULL", (user_id,))
                print("Linked all unassigned legacy inventory, customers, and bills to this user.")

    print("\n-----------------------------------------")
    print(f" Ready to Login!")
    print(f" URL:      http://localhost:5000/login")
    print(f" Email:    {email}")
    print(f" Password: {PASSWORD}")
    print("-----------------------------------------")


if __name__ == "__main__":
    setup_shopkeeper()