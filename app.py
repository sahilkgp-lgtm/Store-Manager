from contextlib import contextmanager
from datetime import datetime
from functools import wraps
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, jsonify, render_template, request, session, redirect, url_for, send_file
from werkzeug.security import check_password_hash, generate_password_hash
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "agrikisan_secure_production_key_2026")

# --- DATABASE CONNECTION ---
@contextmanager
def db_connection():
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = psycopg2.connect(db_url, sslmode="require")
    else:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST", "localhost"),
            port=os.getenv("DB_PORT", "5432"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD"),
            dbname=os.getenv("DB_NAME", "Customers")
        )
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

# --- AUTH MIDDLEWARE ---
def login_and_subscription_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Unauthorized. Please log in."}), 401

        with db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, name, email, subscription_status, subscription_end FROM public.users WHERE id = %s;",
                    (user_id,)
                )
                user = cur.fetchone()

        if not user:
            session.clear()
            return jsonify({"error": "User not found."}), 401

        if user["subscription_status"] == "PENDING":
            return jsonify({"error": "Your account is pending distributor approval and activation."}), 403

        if user["subscription_status"] != "ACTIVE":
            return jsonify({"error": "Account is inactive. Contact your distributor.", "subscription_required": True}), 403

        if user.get("subscription_end") and user["subscription_end"] < datetime.now():
            return jsonify({"error": "Subscription expired. Please renew.", "expired": True}), 403

        return f(*args, **kwargs)
    return decorated_function

# --- PAGES ---
@app.get("/")
def home():
    if "user_id" not in session:
        return redirect(url_for("login_page"))
    return render_template("index.html")

@app.get("/login")
def login_page():
    return render_template("login.html")

@app.get("/payment-pending")
def payment_pending_page():
    if "pending_user_id" not in session and "user_id" not in session:
        return redirect(url_for("login_page"))
    return render_template("payment_pending.html")

@app.get("/admin/approvals")
def admin_approvals_page():
    return render_template("admin_approvals.html")

# --- AUTH & REGISTRATION ---
@app.post("/api/auth/register")
def auth_register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")

    if not name or not email or len(password) < 6:
        return jsonify({"error": "Valid name, email, and password (min 6 chars) required."}), 400

    hashed_pw = generate_password_hash(password)

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM public.users WHERE email = %s;", (email,))
            if cur.fetchone():
                return jsonify({"error": "An account with this email already exists."}), 400

            cur.execute("""
                INSERT INTO public.users (name, email, password_hash, subscription_status, subscription_end)
                VALUES (%s, %s, %s, 'PENDING', NULL)
                RETURNING id;
            """, (name, email, hashed_pw))
            user = cur.fetchone()

    session["pending_user_id"] = user["id"]
    return jsonify({"message": "Proceed to payment", "redirect": "/payment-pending"}), 201

@app.post("/api/auth/submit-payment-proof")
def submit_payment_proof():
    user_id = session.get("pending_user_id") or session.get("user_id")
    if not user_id:
        return jsonify({"error": "Session expired. Please log in again."}), 401

    data = request.get_json(silent=True) or {}
    utr = str(data.get("utr") or "").strip()
    if not utr:
        return jsonify({"error": "Please enter your UPI transaction / UTR reference."}), 400

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE public.users 
                SET payment_ref = %s, payment_submitted_at = NOW()
                WHERE id = %s;
            """, (utr, user_id))

    session.pop("pending_user_id", None)
    return jsonify({"message": "Payment details recorded. Please wait for distributor activation."})

@app.post("/api/auth/login")
def auth_login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.users WHERE email = %s;", (email,))
            user = cur.fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    if user["subscription_status"] == "PENDING":
        session["pending_user_id"] = user["id"]
        return jsonify({"error": "Account awaiting payment verification.", "redirect": "/payment-pending"}), 403

    if user["subscription_status"] != "ACTIVE":
        return jsonify({"error": "Account is inactive. Contact distributor.", "subscription_required": True}), 403

    if user.get("subscription_end") and user["subscription_end"] < datetime.now():
        return jsonify({"error": f"Subscription expired on {user['subscription_end'].strftime('%Y-%m-%d')}."}), 403

    session["user_id"] = user["id"]
    return jsonify({"message": "Logged in successfully", "user": {"name": user["name"], "email": user["email"]}})

@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"message": "Logged out successfully"})

@app.get("/api/auth/me")
def auth_me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, name, email, subscription_status, subscription_end FROM public.users WHERE id = %s;",
                (user_id,)
            )
            user = cur.fetchone()

    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401

    if user.get("subscription_end"):
        user["subscription_end"] = user["subscription_end"].isoformat()

    return jsonify(user)

@app.post("/api/auth/change-password")
@login_and_subscription_required
def change_password():
    data = request.get_json(silent=True) or {}
    old_password = str(data.get("old_password") or "")
    new_password = str(data.get("new_password") or "")

    if len(new_password) < 6:
        return jsonify({"error": "New password must be at least 6 characters long."}), 400

    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT password_hash FROM public.users WHERE id = %s;", (user_id,))
            user = cur.fetchone()

            if not user or not check_password_hash(user["password_hash"], old_password):
                return jsonify({"error": "Current password is incorrect."}), 400

            new_hash = generate_password_hash(new_password)
            cur.execute("UPDATE public.users SET password_hash = %s WHERE id = %s;", (new_hash, user_id))

    return jsonify({"message": "Password updated successfully."})

@app.delete("/api/auth/delete-account")
@login_and_subscription_required
def delete_account():
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.bill_items WHERE bill_id IN (SELECT id FROM public.bills WHERE user_id = %s);", (user_id,))
            cur.execute("DELETE FROM public.users WHERE id = %s;", (user_id,))

    session.clear()
    return jsonify({"message": "Account and all associated store data deleted permanently."})

# --- STORE PROFILE MANAGEMENT ---
@app.get("/api/profile")
@login_and_subscription_required
def get_profile():
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, name, email, store_name, store_address, store_license, subscription_status, subscription_end 
                FROM public.users WHERE id = %s;
            """, (user_id,))
            user = cur.fetchone()

    if not user:
        return jsonify({"error": "Profile not found."}), 404

    if user.get("subscription_end"):
        user["subscription_end"] = user["subscription_end"].isoformat()

    return jsonify(user)




@app.post("/api/profile/request-update")
@login_and_subscription_required
def request_profile_update():
    user_id = session.get("user_id")
    shop_name = request.form.get("shop_name")
    shop_address = request.form.get("shop_address")
    license_gstin = request.form.get("license_gstin")
    file = request.files.get("document")

    if not file:
        return jsonify({"error": "Verification document proof is required."}), 400

    upload_folder = "uploads/verification_docs"
    os.makedirs(upload_folder, exist_ok=True)
    file_path = os.path.join(upload_folder, f"user_{user_id}_{file.filename}")
    file.save(file_path)

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO public.profile_verification_requests 
                (user_id, new_shop_name, new_shop_address, new_license_gstin, document_proof_path, status)
                VALUES (%s, %s, %s, %s, %s, 'PENDING');
            """, (user_id, shop_name, shop_address, license_gstin, file_path))

    return jsonify({"message": "Verification request submitted successfully."})

# --- CUSTOMERS (SCOPED) ---
@app.get("/api/customers")
@login_and_subscription_required
def get_customers():
    user_id = session.get("user_id")
    query = """
        SELECT 
            c.*,
            GREATEST(
                COALESCE((SELECT MAX(created_at) FROM public.bills WHERE entity_id = c.id AND bill_type = 'SALE' AND user_id = %s), '1970-01-01'::timestamp),
                COALESCE((SELECT MAX(created_at) FROM public.ledger_entries WHERE entity_type = 'CUSTOMER' AND entity_id = c.id AND user_id = %s), '1970-01-01'::timestamp)
            ) AS last_activity
        FROM public.customers c
        WHERE c.user_id = %s
        ORDER BY last_activity DESC, c.id DESC;
    """
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (user_id, user_id, user_id))
            customers = cur.fetchall()

    for cust in customers:
        if cust.get("last_activity"):
            cust["last_activity"] = cust["last_activity"].isoformat()

    return jsonify(customers)

@app.post("/api/customers")
@login_and_subscription_required
def create_customer():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    phone = str(data.get("phone") or "").strip()
    if not name or not phone:
        return jsonify({"error": "Name and phone are required."}), 400

    query = """
        INSERT INTO public.customers (user_id, name, phone, location, gstin, dues, credit_limit, primary_crops, irrigation_source)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *;
    """
    params = (
        user_id, name, phone,
        data.get("location") or None,
        data.get("gstin") or None,
        float(data.get("dues") or 0),
        float(data.get("credit_limit") or 10000),
        data.get("primary_crops") or None,
        data.get("irrigation_source") or None
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            customer = cur.fetchone()

    return jsonify(customer), 201

@app.put("/api/customers/<int:id>")
@login_and_subscription_required
def update_customer(id):
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    query = """
        UPDATE public.customers
        SET name = %s, phone = %s, location = %s, gstin = %s,
            credit_limit = %s, primary_crops = %s, irrigation_source = %s
        WHERE id = %s AND user_id = %s
        RETURNING *;
    """
    params = (
        data.get("name"), data.get("phone"),
        data.get("location") or None,
        data.get("gstin") or None,
        float(data.get("credit_limit") or 10000),
        data.get("primary_crops") or None,
        data.get("irrigation_source") or None,
        id, user_id
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            customer = cur.fetchone()

    if not customer:
        return jsonify({"error": "Customer not found."}), 404
    return jsonify(customer)

# --- SUPPLIERS (SCOPED) ---
@app.get("/api/suppliers")
@login_and_subscription_required
def get_suppliers():
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.suppliers WHERE user_id = %s ORDER BY id DESC;", (user_id,))
            suppliers = cur.fetchall()
    return jsonify(suppliers)

@app.post("/api/suppliers")
@login_and_subscription_required
def create_supplier():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    agency = str(data.get("agency_name") or "").strip()
    phone = str(data.get("phone") or "").strip()
    if not agency or not phone:
        return jsonify({"error": "Agency name and phone are required."}), 400

    query = """
        INSERT INTO public.suppliers (user_id, agency_name, contact_name, phone, gstin, address, email, outstanding_balance)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *;
    """
    params = (
        user_id, agency,
        data.get("contact_name") or None,
        phone,
        data.get("gstin") or None,
        data.get("address") or None,
        data.get("email") or None,
        float(data.get("outstanding_balance") or 0)
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            supplier = cur.fetchone()

    return jsonify(supplier), 201

@app.put("/api/suppliers/<int:id>")
@login_and_subscription_required
def update_supplier(id):
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    query = """
        UPDATE public.suppliers
        SET agency_name = %s, contact_name = %s, phone = %s, gstin = %s, address = %s, email = %s
        WHERE id = %s AND user_id = %s
        RETURNING *;
    """
    params = (
        data.get("agency_name"), data.get("contact_name") or None,
        data.get("phone"), data.get("gstin") or None,
        data.get("address") or None, data.get("email") or None,
        id, user_id
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            supplier = cur.fetchone()

    if not supplier:
        return jsonify({"error": "Supplier not found."}), 404
    return jsonify(supplier)

# --- INVENTORY (SCOPED) ---
@app.get("/api/inventory")
@login_and_subscription_required
def get_inventory():
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.inventory WHERE user_id = %s ORDER BY id DESC;", (user_id,))
            items = cur.fetchall()

    for item in items:
        if item.get("expiry_date"):
            item["expiry_date"] = item["expiry_date"].isoformat()
        if item.get("date_of_purchase"):
            item["date_of_purchase"] = item["date_of_purchase"].isoformat()
        if item.get("updated_at"):
            item["updated_at"] = item["updated_at"].isoformat()

    return jsonify(items)

@app.post("/api/inventory")
@login_and_subscription_required
def create_inventory():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    batch = str(data.get("batch_no") or "").strip()
    if not name or not batch:
        return jsonify({"error": "Material name and batch number are required."}), 400

    query = """
        INSERT INTO public.inventory (user_id, name, brand, batch_no, expiry_date, stock_quantity, purchase_rate, mrp, cgst_pct, sgst_pct, min_stock_alert, supplier_name)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *;
    """
    params = (
        user_id, name,
        data.get("brand") or None,
        batch,
        data.get("expiry_date") or None,
        float(data.get("stock_quantity") or 0),
        float(data.get("purchase_rate") or 0),
        float(data.get("mrp") or 0),
        float(data.get("cgst_pct") or 0),
        float(data.get("sgst_pct") or 0),
        float(data.get("min_stock_alert") or 5),
        data.get("supplier_name") or None
    )
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            item = cur.fetchone()

    return jsonify(item), 201

@app.post("/api/inventory/<int:id>/adjust")
@login_and_subscription_required
def adjust_inventory(id):
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    qty = float(data.get("quantity") or data.get("quantity_change") or 0)
    direction = str(data.get("direction") or "ADD").upper()

    if qty <= 0:
        return jsonify({"error": "Adjustment quantity must be greater than zero."}), 400

    delta = qty if direction == "ADD" else -qty

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT stock_quantity FROM public.inventory WHERE id = %s AND user_id = %s;", (id, user_id))
            current = cur.fetchone()
            if not current:
                return jsonify({"error": "Inventory item not found."}), 404

            if float(current["stock_quantity"]) + delta < 0:
                return jsonify({"error": "Adjustment would result in negative stock."}), 400

            cur.execute("""
                UPDATE public.inventory 
                SET stock_quantity = stock_quantity + %s, updated_at = NOW() 
                WHERE id = %s AND user_id = %s 
                RETURNING *;
            """, (delta, id, user_id))
            updated = cur.fetchone()

    return jsonify({"message": "Stock adjusted successfully.", "item": updated})

# --- BILLS (SCOPED) ---
@app.get("/api/bills")
@login_and_subscription_required
def get_bills():
    user_id = session.get("user_id")
    bill_type = request.args.get("type", "SALE").upper()
    query = """
        SELECT 
            b.*,
            CASE 
                WHEN b.bill_type = 'SALE' THEN COALESCE(c.name, 'Cash Sale')
                ELSE COALESCE(s.agency_name, 'Supplier')
            END AS party_name
        FROM public.bills b
        LEFT JOIN public.customers c ON b.entity_id = c.id AND b.bill_type = 'SALE'
        LEFT JOIN public.suppliers s ON b.entity_id = s.id AND b.bill_type = 'PURCHASE'
        WHERE b.bill_type = %s AND b.user_id = %s
        ORDER BY b.created_at DESC, b.id DESC;
    """
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (bill_type, user_id))
            bills = cur.fetchall()

    for bill in bills:
        if bill.get("created_at"):
            bill["created_at"] = bill["created_at"].isoformat()

    return jsonify(bills)

@app.get("/api/bills/<int:id>")
@login_and_subscription_required
def get_single_bill(id):
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.bills WHERE id = %s AND user_id = %s;", (id, user_id))
            bill = cur.fetchone()
            if not bill:
                return jsonify({"error": "Bill not found."}), 404

            cur.execute("SELECT * FROM public.bill_items WHERE bill_id = %s ORDER BY id ASC;", (id,))
            bill["items"] = cur.fetchall()

    if bill.get("created_at"):
        bill["created_at"] = bill["created_at"].isoformat()

    return jsonify(bill)

@app.post("/api/bills/sale")
@login_and_subscription_required
def create_sale_bill():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    customer_id = data.get("entity_id") or None
    items = data.get("items") or []
    transport = float(data.get("transport") or 0)
    paid = float(data.get("paid") or 0)
    notes = data.get("notes") or None

    if not items:
        return jsonify({"error": "Bill items cannot be empty."}), 400

    total = transport
    for item in items:
        base = float(item["qty"]) * float(item["rate"])
        tax = base * (float(item.get("cgst", 0)) + float(item.get("sgst", 0))) / 100
        total += base + tax

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO public.bills (user_id, bill_type, entity_id, total_amount, paid_amount, transport_charges, notes, status)
                VALUES (%s, 'SALE', %s, %s, %s, %s, %s, 'POSTED')
                RETURNING id;
            """, (user_id, customer_id, total, paid, transport, notes))
            bill_id = cur.fetchone()["id"]

            for item in items:
                line_base = float(item["qty"]) * float(item["rate"])
                line_tax = line_base * (float(item.get("cgst", 0)) + float(item.get("sgst", 0))) / 100
                line_total = line_base + line_tax

                cur.execute("""
                    INSERT INTO public.bill_items (bill_id, inventory_id, material_name, brand, batch_no, qty, rate, cgst_pct, sgst_pct, total_price)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (bill_id, item["inventory_id"], item["name"], item.get("brand"), item.get("batch"), item["qty"], item["rate"], item.get("cgst", 0), item.get("sgst", 0), line_total))

                cur.execute("""
                    UPDATE public.inventory
                    SET stock_quantity = stock_quantity - %s, updated_at = NOW()
                    WHERE id = %s AND user_id = %s;
                """, (float(item["qty"]), item["inventory_id"], user_id))

            due_amount = total - paid
            if customer_id and due_amount != 0:
                cur.execute("""
                    UPDATE public.customers
                    SET dues = dues + %s
                    WHERE id = %s AND user_id = %s;
                """, (due_amount, customer_id, user_id))

    return jsonify({"message": "Sale saved successfully.", "id": bill_id}), 201

@app.post("/api/bills/purchase")
@login_and_subscription_required
def create_purchase_bill():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    supplier_id = data.get("entity_id")
    items = data.get("items") or []
    transport = float(data.get("transport") or 0)
    paid = float(data.get("paid") or 0)
    notes = data.get("notes") or None

    if not supplier_id or not items:
        return jsonify({"error": "Supplier and items are required."}), 400

    total = transport
    for item in items:
        base = float(item["qty"]) * float(item["rate"])
        tax = base * (float(item.get("cgst", 0)) + float(item.get("sgst", 0))) / 100
        total += base + tax

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO public.bills (user_id, bill_type, entity_id, total_amount, paid_amount, transport_charges, notes, status)
                VALUES (%s, 'PURCHASE', %s, %s, %s, %s, %s, 'POSTED')
                RETURNING id;
            """, (user_id, supplier_id, total, paid, transport, notes))
            bill_id = cur.fetchone()["id"]

            for item in items:
                line_base = float(item["qty"]) * float(item["rate"])
                line_tax = line_base * (float(item.get("cgst", 0)) + float(item.get("sgst", 0))) / 100
                line_total = line_base + line_tax

                cur.execute("""
                    SELECT id FROM public.inventory
                    WHERE LOWER(name) = LOWER(%s) AND LOWER(batch_no) = LOWER(%s) AND user_id = %s
                    LIMIT 1;
                """, (item["name"].strip(), item["batch"].strip(), user_id))
                existing = cur.fetchone()

                if existing:
                    inv_id = existing["id"]
                    cur.execute("""
                        UPDATE public.inventory
                        SET stock_quantity = stock_quantity + %s,
                            purchase_rate = %s,
                            mrp = COALESCE(%s, mrp),
                            updated_at = NOW()
                        WHERE id = %s AND user_id = %s;
                    """, (float(item["qty"]), float(item["rate"]), float(item.get("mrp") or 0), inv_id, user_id))
                else:
                    cur.execute("""
                        INSERT INTO public.inventory (user_id, name, brand, batch_no, expiry_date, stock_quantity, purchase_rate, mrp, cgst_pct, sgst_pct)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id;
                    """, (user_id, item["name"], item.get("brand"), item["batch"], item.get("expiry") or None, float(item["qty"]), float(item["rate"]), float(item.get("mrp") or 0), float(item.get("cgst", 0)), float(item.get("sgst", 0))))
                    inv_id = cur.fetchone()["id"]

                cur.execute("""
                    INSERT INTO public.bill_items (bill_id, inventory_id, material_name, brand, batch_no, qty, rate, cgst_pct, sgst_pct, total_price)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (bill_id, inv_id, item["name"], item.get("brand"), item["batch"], item["qty"], item["rate"], item.get("cgst", 0), item.get("sgst", 0), line_total))

            outstanding = total - paid
            if outstanding != 0:
                cur.execute("""
                    UPDATE public.suppliers
                    SET outstanding_balance = outstanding_balance + %s
                    WHERE id = %s AND user_id = %s;
                """, (outstanding, supplier_id, user_id))

    return jsonify({"message": "Purchase recorded successfully.", "id": bill_id}), 201

@app.delete("/api/bills/<int:id>")
@login_and_subscription_required
def void_bill(id):
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.bills WHERE id = %s AND user_id = %s;", (id, user_id))
            bill = cur.fetchone()
            if not bill:
                return jsonify({"error": "Bill not found."}), 404

            if bill["status"] == "VOIDED":
                return jsonify({"error": "Bill is already voided."}), 400

            cur.execute("SELECT * FROM public.bill_items WHERE bill_id = %s;", (id,))
            items = cur.fetchall()

            if bill["bill_type"] == "SALE":
                for item in items:
                    if item.get("inventory_id"):
                        cur.execute("UPDATE public.inventory SET stock_quantity = stock_quantity + %s WHERE id = %s AND user_id = %s;", (item["qty"], item["inventory_id"], user_id))
                
                due_to_reverse = float(bill["total_amount"]) - float(bill["paid_amount"])
                if bill.get("entity_id") and due_to_reverse != 0:
                    cur.execute("UPDATE public.customers SET dues = dues - %s WHERE id = %s AND user_id = %s;", (due_to_reverse, bill["entity_id"], user_id))

            elif bill["bill_type"] == "PURCHASE":
                for item in items:
                    if item.get("inventory_id"):
                        cur.execute("UPDATE public.inventory SET stock_quantity = stock_quantity - %s WHERE id = %s AND user_id = %s;", (item["qty"], item["inventory_id"], user_id))

                outstanding_to_reverse = float(bill["total_amount"]) - float(bill["paid_amount"])
                if bill.get("entity_id") and outstanding_to_reverse != 0:
                    cur.execute("UPDATE public.suppliers SET outstanding_balance = outstanding_balance - %s WHERE id = %s AND user_id = %s;", (outstanding_to_reverse, bill["entity_id"], user_id))

            cur.execute("UPDATE public.bills SET status = 'VOIDED' WHERE id = %s AND user_id = %s;", (id, user_id))

    return jsonify({"message": f"Bill #{id} successfully voided."})

# --- LEDGER (SCOPED) ---
@app.get("/api/ledger")
@login_and_subscription_required
def get_ledger():
    user_id = session.get("user_id")
    query = """
        SELECT 
            l.*,
            CASE 
                WHEN l.entity_type = 'CUSTOMER' THEN c.name
                ELSE s.agency_name
            END AS party_name,
            CASE 
                WHEN l.entity_type = 'CUSTOMER' THEN COALESCE(c.dues, 0)
                ELSE COALESCE(s.outstanding_balance, 0)
            END AS current_dues
        FROM public.ledger_entries l
        LEFT JOIN public.customers c ON l.entity_id = c.id AND l.entity_type = 'CUSTOMER'
        LEFT JOIN public.suppliers s ON l.entity_id = s.id AND l.entity_type = 'SUPPLIER'
        WHERE l.user_id = %s
        ORDER BY l.created_at DESC, l.id DESC;
    """
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (user_id,))
            entries = cur.fetchall()

    for entry in entries:
        if entry.get("created_at"):
            entry["created_at"] = entry["created_at"].isoformat()

    return jsonify(entries)

@app.get("/api/ledger/<int:id>")
@login_and_subscription_required
def get_single_ledger_entry(id):
    user_id = session.get("user_id")
    query = """
        SELECT 
            l.*,
            CASE 
                WHEN l.entity_type = 'CUSTOMER' THEN c.name
                ELSE s.agency_name
            END AS party_name,
            CASE 
                WHEN l.entity_type = 'CUSTOMER' THEN COALESCE(c.dues, 0)
                ELSE COALESCE(s.outstanding_balance, 0)
            END AS current_dues
        FROM public.ledger_entries l
        LEFT JOIN public.customers c ON l.entity_id = c.id AND l.entity_type = 'CUSTOMER'
        LEFT JOIN public.suppliers s ON l.entity_id = s.id AND l.entity_type = 'SUPPLIER'
        WHERE l.id = %s AND l.user_id = %s;
    """
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (id, user_id))
            entry = cur.fetchone()

    if not entry:
        return jsonify({"error": "Ledger entry not found."}), 404

    if entry.get("created_at"):
        entry["created_at"] = entry["created_at"].isoformat()

    return jsonify(entry)

@app.post("/api/ledger")
@login_and_subscription_required
def create_ledger_entry():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    entity_type = str(data.get("entity_type") or "CUSTOMER").upper()
    entity_id = data.get("entity_id")
    amount = float(data.get("amount") or 0)
    mode = data.get("payment_mode") or "Cash"
    notes = data.get("notes") or None

    if not entity_id or amount <= 0:
        return jsonify({"error": "Party and positive amount are required."}), 400

    entry_type = "RECEIPT" if entity_type == "CUSTOMER" else "PAYMENT"

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO public.ledger_entries (user_id, entity_type, entity_id, entry_type, amount, payment_mode, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *;
            """, (user_id, entity_type, entity_id, entry_type, amount, mode, notes))
            entry = cur.fetchone()

            if entity_type == "CUSTOMER":
                cur.execute("UPDATE public.customers SET dues = dues - %s WHERE id = %s AND user_id = %s;", (amount, entity_id, user_id))
            else:
                cur.execute("UPDATE public.suppliers SET outstanding_balance = outstanding_balance - %s WHERE id = %s AND user_id = %s;", (amount, entity_id, user_id))

    return jsonify(entry), 201

# --- PARTY STATEMENTS ---
@app.get("/api/parties/<type>/<int:id>/statement")
@login_and_subscription_required
def get_party_statement(type, id):
    user_id = session.get("user_id")
    party_type = type.upper()
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if party_type == "CUSTOMER":
                cur.execute("SELECT id, name, phone, dues AS pending FROM public.customers WHERE id = %s AND user_id = %s;", (id, user_id))
            else:
                cur.execute("SELECT id, agency_name, phone, outstanding_balance AS pending FROM public.suppliers WHERE id = %s AND user_id = %s;", (id, user_id))
            party = cur.fetchone()

            if not party:
                return jsonify({"error": "Party not found"}), 404

            cur.execute("""
                SELECT 'BILL' AS record_type, id AS ref_id, created_at AS date, total_amount AS amount, paid_amount AS paid, status, notes
                FROM public.bills
                WHERE entity_id = %s AND bill_type = %s AND user_id = %s
                UNION ALL
                SELECT 'LEDGER' AS record_type, id AS ref_id, created_at AS date, amount, amount AS paid, entry_type AS status, notes
                FROM public.ledger_entries
                WHERE entity_id = %s AND entity_type = %s AND user_id = %s
                ORDER BY date DESC;
            """, (id, "SALE" if party_type == "CUSTOMER" else "PURCHASE", user_id, id, party_type, user_id))
            history = cur.fetchall()

    for row in history:
        if row.get("date"):
            row["date"] = row["date"].isoformat()

    return jsonify({"party": party, "history": history})

# --- EXPENSES (SCOPED) ---
@app.get("/api/expenses")
@login_and_subscription_required
def get_expenses():
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.expenses WHERE user_id = %s ORDER BY expense_date DESC, id DESC;", (user_id,))
            expenses = cur.fetchall()

    for exp in expenses:
        if exp.get("expense_date"):
            exp["expense_date"] = exp["expense_date"].isoformat()

    return jsonify(expenses)

@app.post("/api/expenses")
@login_and_subscription_required
def create_expense():
    user_id = session.get("user_id")
    data = request.get_json(silent=True) or {}
    category = str(data.get("category") or "").strip()
    amount = float(data.get("amount") or 0)
    expense_date = data.get("expense_date")
    notes = data.get("notes") or None

    if not category or amount <= 0:
        return jsonify({"error": "Category and valid amount are required."}), 400

    query = """
        INSERT INTO public.expenses (user_id, category, amount, expense_date, notes)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING *;
    """
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (user_id, category, amount, expense_date, notes))
            exp = cur.fetchone()

    return jsonify(exp), 201

# --- SUMMARY METRICS & HISTORIES ---
@app.get("/api/reports/summary")
@login_and_subscription_required
def get_report_summary():
    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COALESCE(SUM(total_amount), 0) AS sales_total,
                    COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE THEN total_amount ELSE 0 END), 0) AS sales_today
                FROM public.bills 
                WHERE bill_type = 'SALE' AND status = 'POSTED' AND user_id = %s;
            """, (user_id,))
            sales = cur.fetchone()

            cur.execute("""
                SELECT 
                    COALESCE(SUM(total_amount), 0) AS purchases_total,
                    COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE THEN total_amount ELSE 0 END), 0) AS purchases_today
                FROM public.bills 
                WHERE bill_type = 'PURCHASE' AND status = 'POSTED' AND user_id = %s;
            """, (user_id,))
            purchases = cur.fetchone()

            cur.execute("""
                SELECT 
                    COALESCE(SUM(amount), 0) AS expenses_total,
                    COALESCE(SUM(CASE WHEN expense_date = CURRENT_DATE THEN amount ELSE 0 END), 0) AS expenses_today
                FROM public.expenses
                WHERE user_id = %s;
            """, (user_id,))
            expenses = cur.fetchone()

            cur.execute("SELECT COALESCE(SUM(dues), 0) AS dues FROM public.customers WHERE user_id = %s;", (user_id,))
            customer_dues = cur.fetchone()["dues"]

            cur.execute("SELECT COALESCE(SUM(outstanding_balance), 0) AS outstanding FROM public.suppliers WHERE user_id = %s;", (user_id,))
            supplier_outstanding = cur.fetchone()["outstanding"]

            cur.execute("SELECT COUNT(*) AS count FROM public.inventory WHERE stock_quantity <= min_stock_alert AND user_id = %s;", (user_id,))
            low_stock = cur.fetchone()["count"]

    return jsonify({
        "sales_total": sales["sales_total"],
        "sales_today": sales["sales_today"],
        "purchases_total": purchases["purchases_total"],
        "purchases_today": purchases["purchases_today"],
        "expenses_total": expenses["expenses_total"],
        "expenses_today": expenses["expenses_today"],
        "customer_dues": customer_dues,
        "supplier_outstanding": supplier_outstanding,
        "low_stock_count": low_stock
    })

@app.get("/api/reports/date-history")
@login_and_subscription_required
def get_date_history():
    user_id = session.get("user_id")
    target_date = request.args.get("date")
    if not target_date:
        return jsonify({"error": "Date parameter required"}), 400

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT b.id, b.total_amount, b.paid_amount, COALESCE(c.name, 'Cash Sale') AS party_name
                FROM public.bills b
                LEFT JOIN public.customers c ON b.entity_id = c.id
                WHERE b.bill_type = 'SALE' AND b.status = 'POSTED' AND b.created_at::date = %s AND b.user_id = %s
                ORDER BY b.id ASC;
            """, (target_date, user_id))
            sales = cur.fetchall()

            cur.execute("""
                SELECT b.id, b.total_amount, b.paid_amount, COALESCE(s.agency_name, 'Supplier') AS party_name
                FROM public.bills b
                LEFT JOIN public.suppliers s ON b.entity_id = s.id
                WHERE b.bill_type = 'PURCHASE' AND b.status = 'POSTED' AND b.created_at::date = %s AND b.user_id = %s
                ORDER BY b.id ASC;
            """, (target_date, user_id))
            purchases = cur.fetchall()

            cur.execute("""
                SELECT category, amount, notes FROM public.expenses
                WHERE expense_date = %s AND user_id = %s ORDER BY id ASC;
            """, (target_date, user_id))
            expenses = cur.fetchall()

    return jsonify({"sales": sales, "purchases": purchases, "expenses": expenses})

@app.get("/api/all-transactions")
@login_and_subscription_required
def get_all_transactions():
    user_id = session.get("user_id")
    query = """
        SELECT 
            b.id::text AS ref_id,
            b.created_at,
            b.bill_type AS txn_type,
            b.total_amount AS amount,
            b.paid_amount,
            b.status,
            COALESCE(c.name, s.agency_name, 'Cash Party') AS party_name
        FROM public.bills b
        LEFT JOIN public.customers c ON b.entity_id = c.id AND b.bill_type IN ('SALE', 'REFUND')
        LEFT JOIN public.suppliers s ON b.entity_id = s.id AND b.bill_type = 'PURCHASE'
        WHERE b.user_id = %s
        
        UNION ALL
        
        SELECT 
            'L-' || l.id::text AS ref_id,
            l.created_at,
            l.entry_type AS txn_type,
            l.amount,
            l.amount AS paid_amount,
            l.payment_mode AS status,
            COALESCE(c2.name, s2.agency_name, 'Party') AS party_name
        FROM public.ledger_entries l
        LEFT JOIN public.customers c2 ON l.entity_id = c2.id AND l.entity_type = 'CUSTOMER'
        LEFT JOIN public.suppliers s2 ON l.entity_id = s2.id AND l.entity_type = 'SUPPLIER'
        WHERE l.user_id = %s
        
        ORDER BY created_at DESC;
    """
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (user_id, user_id))
            transactions = cur.fetchall()

    for txn in transactions:
        if txn.get("created_at"):
            txn["created_at"] = txn["created_at"].isoformat()

    return jsonify(transactions)

# --- DISTRIBUTOR ADMIN MANAGEMENT ENDPOINTS ---
@app.get("/api/admin/pending-users")
def get_pending_users():
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, name, email, subscription_status, subscription_end, payment_ref, payment_submitted_at, created_at 
                FROM public.users 
                ORDER BY id DESC;
            """)
            users = cur.fetchall()

    for u in users:
        if u.get("subscription_end"):
            u["subscription_end"] = u["subscription_end"].isoformat()
        if u.get("payment_submitted_at"):
            u["payment_submitted_at"] = u["payment_submitted_at"].isoformat()
        if u.get("created_at"):
            u["created_at"] = u["created_at"].isoformat()

    return jsonify(users)

@app.post("/api/admin/verify-user/<int:user_id>")
def verify_and_activate_user(user_id):
    data = request.get_json(silent=True) or {}
    validity_date = data.get("validity_date")  # "YYYY-MM-DD"

    if not validity_date:
        return jsonify({"error": "Please provide a validity date (YYYY-MM-DD)."}), 400

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE public.users 
                SET subscription_status = 'ACTIVE',
                    subscription_end = %s
                WHERE id = %s
                RETURNING id, name, email, subscription_status, subscription_end;
            """, (validity_date, user_id))
            updated_user = cur.fetchone()

    if not updated_user:
        return jsonify({"error": "User not found."}), 404

    if updated_user.get("subscription_end"):
        updated_user["subscription_end"] = updated_user["subscription_end"].isoformat()

    return jsonify({
        "message": f"Store '{updated_user['name']}' activated successfully until {validity_date}.",
        "user": updated_user
    })

@app.get("/api/admin/profile-requests")
def get_pending_profile_requests():
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    r.id, r.user_id, u.email, u.name AS user_name,
                    u.store_name AS old_store_name, 
                    u.store_address AS old_store_address, 
                    u.store_license AS old_store_license,
                    r.new_shop_name, r.new_shop_address, r.new_license_gstin, 
                    r.document_proof_path, r.created_at
                FROM public.profile_verification_requests r
                JOIN public.users u ON r.user_id = u.id
                WHERE r.status = 'PENDING'
                ORDER BY r.created_at DESC;
            """)
            requests = cur.fetchall()

    for req in requests:
        if req.get("created_at"):
            req["created_at"] = req["created_at"].isoformat()

    return jsonify(requests)

@app.get("/api/admin/profile-requests/<int:request_id>/document")
def view_request_document(request_id):
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT document_proof_path FROM public.profile_verification_requests WHERE id = %s;", (request_id,))
            record = cur.fetchone()

    if not record or not record.get("document_proof_path") or not os.path.exists(record["document_proof_path"]):
        return jsonify({"error": "Document not found on disk."}), 404

    return send_file(record["document_proof_path"])

@app.post("/api/admin/profile-requests/<int:request_id>/decide")
def decide_profile_request(request_id):
    data = request.get_json(silent=True) or {}
    decision = str(data.get("decision") or "").upper()

    if decision not in ["APPROVE", "REJECT"]:
        return jsonify({"error": "Decision must be 'APPROVE' or 'REJECT'."}), 400

    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT user_id, new_shop_name, new_shop_address, new_license_gstin 
                FROM public.profile_verification_requests 
                WHERE id = %s AND status = 'PENDING';
            """, (request_id,))
            req = cur.fetchone()

            if not req:
                return jsonify({"error": "Pending request not found."}), 404

            if decision == "APPROVE":
                cur.execute("""
                    UPDATE public.users 
                    SET store_name = %s, store_address = %s, store_license = %s
                    WHERE id = %s;
                """, (req["new_shop_name"], req["new_shop_address"], req["new_license_gstin"], req["user_id"]))
                cur.execute("UPDATE public.profile_verification_requests SET status = 'APPROVED' WHERE id = %s;", (request_id,))
                msg = "Request approved. Store details updated."
            else:
                cur.execute("UPDATE public.profile_verification_requests SET status = 'REJECTED' WHERE id = %s;", (request_id,))
                msg = "Request rejected. Live store details remain unchanged."

    return jsonify({"message": msg, "decision": decision})

@app.post("/api/help-enquiry")
@login_and_subscription_required
def help_enquiry():
    data = request.get_json(silent=True) or {}
    message = str(data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message cannot be empty."}), 400

    user_id = session.get("user_id")
    with db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT name, email FROM public.users WHERE id = %s;", (user_id,))
            user = cur.fetchone()

            cur.execute("""
                INSERT INTO public.contact_enquiries (name, phone, message)
                VALUES (%s, %s, %s);
            """, (user["name"], user["email"], message))

    return jsonify({"message": "Query sent successfully."}), 201

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)