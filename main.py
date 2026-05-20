import os
import sqlite3
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, date, timedelta
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, status, Response, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import google_calendar

# Initialize FastAPI application
app = FastAPI(title="Growlouder  Onboarding System", version="1.0.0")

# Database Path
DB_PATH = os.path.join(os.path.dirname(__file__), "submissions.db")

# Simple admin credentials
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "Admin@0202"
SESSION_TOKEN = "brandcraft_admin_session_secure_token_xyz123"

# Load .env file manually
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip()

# Email config (update these with real SMTP credentials)
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@Growlouder .com")

# Initialize SQLite database
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create submissions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            full_name TEXT NOT NULL,
            contact_number TEXT NOT NULL,
            business_name TEXT NOT NULL,
            city_state TEXT NOT NULL,
            industry TEXT NOT NULL,
            monthly_investment TEXT NOT NULL,
            business_age TEXT NOT NULL,
            team_size TEXT NOT NULL,
            social_profile TEXT,
            website TEXT,
            hear_about_us TEXT NOT NULL,
            biggest_challenge TEXT
        )
    """)

    # Create dynamic form options table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS form_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            option_value TEXT NOT NULL
        )
    """)

    # -------------------------------------------------------
    # NEW: Scheduling / Availability tables
    # -------------------------------------------------------

    # Admin availability settings (one row stores current config)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS availability_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day_of_week INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            slot_duration INTEGER NOT NULL DEFAULT 30,
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Global scheduling config (form active/inactive, custom slot)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schedule_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            form_active INTEGER NOT NULL DEFAULT 1,
            slot_duration INTEGER NOT NULL DEFAULT 30,
            custom_slot_minutes INTEGER,
            break_start TEXT DEFAULT '13:00',
            break_end TEXT DEFAULT '14:00',
            break_enabled INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Dynamic migrations: Check if break columns exist in schedule_config
    cursor.execute("PRAGMA table_info(schedule_config)")
    cols = [row[1] for row in cursor.fetchall()]
    if "break_start" not in cols:
        cursor.execute("ALTER TABLE schedule_config ADD COLUMN break_start TEXT DEFAULT '13:00'")
    if "break_end" not in cols:
        cursor.execute("ALTER TABLE schedule_config ADD COLUMN break_end TEXT DEFAULT '14:00'")
    if "break_enabled" not in cols:
        cursor.execute("ALTER TABLE schedule_config ADD COLUMN break_enabled INTEGER DEFAULT 0")

    # Insert default config if not present
    cursor.execute("SELECT COUNT(*) FROM schedule_config")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO schedule_config (id, form_active, slot_duration, break_start, break_end, break_enabled) VALUES (1, 1, 30, '13:00', '14:00', 0)")

    # Initialize default availability (Mon–Fri, 9am–6pm)
    cursor.execute("SELECT COUNT(*) FROM availability_settings")
    if cursor.fetchone()[0] == 0:
        defaults = [
            (1, "09:00", "18:00", 30),  # Monday
            (2, "09:00", "18:00", 30),  # Tuesday
            (3, "09:00", "18:00", 30),  # Wednesday
            (4, "09:00", "18:00", 30),  # Thursday
            (5, "09:00", "18:00", 30),  # Friday
        ]
        cursor.executemany(
            "INSERT INTO availability_settings (day_of_week, start_time, end_time, slot_duration, is_active) VALUES (?,?,?,?,1)",
            defaults
        )

    # Bookings table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booked_date TEXT NOT NULL,
            booked_time TEXT NOT NULL,
            client_name TEXT NOT NULL,
            client_email TEXT NOT NULL,
            client_phone TEXT,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'confirmed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Dynamic migrations: Check if meet_link column exists in bookings table
    cursor.execute("PRAGMA table_info(bookings)")
    bookings_cols = [row[1] for row in cursor.fetchall()]
    if "meet_link" not in bookings_cols:
        cursor.execute("ALTER TABLE bookings ADD COLUMN meet_link TEXT")

    # Blocked dates table (admin can block specific dates)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS blocked_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blocked_date TEXT NOT NULL UNIQUE,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Date breaks table (admin can block specific time slots on specific dates)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS date_breaks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            break_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Check if form_options is empty and seed defaults
    cursor.execute("SELECT COUNT(*) FROM form_options")
    count = cursor.fetchone()[0]
    if count == 0:
        default_options = [
            ("industry", "Healthcare / Clinic"),
            ("industry", "Real Estate"),
            ("industry", "Coach / Consultant"),
            ("industry", "Tech & IT"),
            ("industry", "Entrepreneur"),
            ("industry", "Podcaster"),
            ("industry", "Astrologist / Numerologist / Vastu Shastra"),
            ("industry", "Other"),
            ("investment", "Below ₹ 44,999"),
            ("investment", "₹ 44,999 - ₹ 64,999"),
            ("investment", "₹ 64,999 - ₹ 84,999"),
            ("investment", "Above ₹ 99,999"),
            ("business_age", "Just started"),
            ("business_age", "0 - 1 Year"),
            ("business_age", "1 - 3 Year"),
            ("business_age", "3 - 10 Year"),
            ("business_age", "10+ Year"),
            ("team_size", "Solo Founder"),
            ("team_size", "2 - 5"),
            ("team_size", "5 - 10"),
            ("team_size", "10 - 20"),
            ("team_size", "20+"),
            ("hear_about_us", "Reference"),
            ("hear_about_us", "Exisiting Client's Profile"),
            ("hear_about_us", "Google Search"),
            ("hear_about_us", "Linkedin"),
            ("hear_about_us", "Instagram"),
        ]
        cursor.executemany("INSERT INTO form_options (category, option_value) VALUES (?, ?)", default_options)

    # Dynamic migrations: Check if email column exists in submissions table
    cursor.execute("PRAGMA table_info(submissions)")
    submission_cols = [row[1] for row in cursor.fetchall()]
    if "email" not in submission_cols:
        cursor.execute("ALTER TABLE submissions ADD COLUMN email TEXT")

    conn.commit()
    conn.close()

init_db()

# ================================================================
# Pydantic Models
# ================================================================
class SubmissionCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)
    contact_number: str = Field(..., min_length=5, max_length=20)
    email: str = Field(..., min_length=5, max_length=150)
    business_name: str = Field(..., min_length=2, max_length=150)
    city_state: str = Field(..., min_length=2, max_length=100)
    industry: str = Field(..., min_length=2, max_length=100)
    monthly_investment: List[str] = Field(..., min_items=1)
    business_age: List[str] = Field(..., min_items=1)
    team_size: str = Field(...)
    social_profile: Optional[str] = None
    website: Optional[str] = None
    hear_about_us: str = Field(...)
    biggest_challenge: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class OptionCreate(BaseModel):
    category: str = Field(..., min_length=2, max_length=50)
    option_value: str = Field(..., min_length=1, max_length=150)

class AvailabilitySlot(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6)
    start_time: str
    end_time: str
    is_active: bool = True

class AvailabilityUpdate(BaseModel):
    slots: List[AvailabilitySlot]

class ScheduleConfigUpdate(BaseModel):
    form_active: bool
    slot_duration: int = Field(..., ge=0, le=240)
    custom_slot_minutes: Optional[int] = None
    break_start: Optional[str] = "13:00"
    break_end: Optional[str] = "14:00"
    break_enabled: Optional[bool] = False

class DateBreakCreate(BaseModel):
    break_date: str
    start_time: str
    end_time: str
    reason: Optional[str] = None

class BookingCreate(BaseModel):
    booked_date: str
    booked_time: str
    client_name: str = Field(..., min_length=2, max_length=100)
    client_email: str = Field(..., min_length=5, max_length=150)
    client_phone: Optional[str] = None
    notes: Optional[str] = None

class BookingStatusUpdate(BaseModel):
    status: str

class BlockDateRequest(BaseModel):
    date: str
    reason: Optional[str] = None

class BookingItem(BaseModel):
    booked_date: str
    booked_time: str

class BatchBookingCreate(BaseModel):
    bookings: List[BookingItem]
    client_name: str = Field(..., min_length=2, max_length=100)
    client_email: str = Field(..., min_length=5, max_length=150)
    client_phone: Optional[str] = None
    notes: Optional[str] = None

# ================================================================
# Auth Helper
# ================================================================
def verify_session(request: Request):
    token = request.cookies.get("admin_session")
    if token != SESSION_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized admin session")
    return True

# ================================================================
# Email Helper
# ================================================================
def send_cancellation_email(client_email: str, client_name: str, booked_date: str, booked_time: str):
    """Send cancellation notification email to client."""
    if not SMTP_USER or not SMTP_PASS:
        print(f"[EMAIL SKIP] SMTP not configured. Would email {client_email} about cancellation.")
        return False
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Booking Cancelled – Growlouder  Consultation'
        msg['From'] = SMTP_FROM
        msg['To'] = client_email

        html = f"""
        <html><body style="font-family:Arial,sans-serif;background:#f8f9fc;padding:40px 20px;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #eee;">
            <h2 style="color:#6c5ce7;margin-bottom:8px;">Booking Cancelled</h2>
            <p style="color:#475569;">Hi <strong>{client_name}</strong>,</p>
            <p style="color:#475569;">Your consultation booking has been <strong style="color:#d63031;">cancelled</strong>.</p>
            <div style="background:#f1f2f6;border-radius:12px;padding:16px;margin:20px 0;">
                <p style="margin:4px 0;color:#1e293b;"><strong>📅 Date:</strong> {booked_date}</p>
                <p style="margin:4px 0;color:#1e293b;"><strong>⏰ Time:</strong> {booked_time}</p>
            </div>
            <p style="color:#475569;">If you'd like to rebook, please visit our booking page.</p>
            <p style="color:#64748b;font-size:13px;margin-top:24px;">— Growlouder  Team</p>
        </div>
        </body></html>
        """
        msg.attach(MIMEText(html, 'html'))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, client_email, msg.as_string())
        print(f"[EMAIL SENT] Cancellation email to {client_email}")
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return False

def send_confirmation_email(client_email: str, client_name: str, booked_date: str, booked_time: str, slot_duration: int = 30):
    """Send confirmation email to client with ICS attachment and Meet link."""
    if not SMTP_USER or not SMTP_PASS:
        print(f"[EMAIL SKIP] SMTP not configured. Would email {client_email} about confirmation.")
        return False
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Booking Confirmed – Growlouder  Consultation'
        msg['From'] = SMTP_FROM
        msg['To'] = client_email

        # Try generating dynamic Google Meet link
        dynamic_link = google_calendar.create_google_meet(client_email, client_name, booked_date, booked_time, slot_duration)
        calendar_generated = dynamic_link is not None
        meet_link = dynamic_link if dynamic_link else "https://meet.google.com/xyz-abcd-xyz" # Fallback

        html = f"""
        <html><body style="font-family:Arial,sans-serif;background:#f8f9fc;padding:40px 20px;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #eee;">
            <h2 style="color:#6c5ce7;margin-bottom:8px;">Booking Confirmed!</h2>
            <p style="color:#475569;">Hi <strong>{client_name}</strong>,</p>
            <p style="color:#475569;">Your consultation booking has been <strong style="color:#00cec9;">confirmed</strong>.</p>
            <div style="background:#f1f2f6;border-radius:12px;padding:16px;margin:20px 0;">
                <p style="margin:4px 0;color:#1e293b;"><strong>📅 Date:</strong> {booked_date}</p>
                <p style="margin:4px 0;color:#1e293b;"><strong>⏰ Time:</strong> {booked_time}</p>
                <p style="margin:4px 0;color:#1e293b;"><strong>🔗 Meet Link:</strong> <a href="{meet_link}" style="color:#6c5ce7;">{meet_link}</a></p>
            </div>
            <p style="color:#475569;">A calendar invite has been attached to this email.</p>
            <p style="color:#64748b;font-size:13px;margin-top:24px;">— Growlouder  Team</p>
        </div>
        </body></html>
        """
        msg.attach(MIMEText(html, 'html'))
        
        try:
            dt_start = datetime.strptime(f"{booked_date} {booked_time}", "%Y-%m-%d %H:%M")
            dt_end = dt_start + timedelta(minutes=slot_duration)
            dtstamp = datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
            dtstart = dt_start.strftime('%Y%m%dT%H%M%S')
            dtend = dt_end.strftime('%Y%m%dT%H%M%S')
            
            ics_content = f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Growlouder //Consultation//EN\nCALSCALE:GREGORIAN\nMETHOD:REQUEST\nBEGIN:VEVENT\nDTSTART:{dtstart}\nDTEND:{dtend}\nDTSTAMP:{dtstamp}\nORGANIZER;CN=Growlouder :mailto:{SMTP_FROM}\nATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN={client_name}:mailto:{client_email}\nSUMMARY:Growlouder  Consultation\nDESCRIPTION:Join here: {meet_link}\nLOCATION:{meet_link}\nSTATUS:CONFIRMED\nSEQUENCE:0\nBEGIN:VALARM\nTRIGGER:-PT15M\nDESCRIPTION:Reminder\nACTION:DISPLAY\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR"
            
            part = MIMEText(ics_content, 'calendar', 'utf-8')
            part.add_header('Content-Disposition', 'attachment; filename="invite.ics"')
            part.add_header('Content-Class', 'urn:content-classes:calendarmessage')
            part.add_header('Method', 'REQUEST')
            msg.attach(part)
        except Exception as e_ics:
            print(f"[ICS ERROR] {e_ics}")

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, client_email, msg.as_string())
        print(f"[EMAIL SENT] Confirmation email to {client_email}")
        return {"success": True, "meet_link": meet_link, "calendar_generated": calendar_generated}
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return {"success": False, "meet_link": None, "calendar_generated": False}

# ================================================================
# Original Form Submission Endpoints
# ================================================================
@app.post("/api/submit")
def create_submission(submission: SubmissionCreate):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        investment_str = ", ".join(submission.monthly_investment)
        business_age_str = ", ".join(submission.business_age)
        cursor.execute("""
            INSERT INTO submissions (
                full_name, contact_number, email, business_name, city_state,
                industry, monthly_investment, business_age, team_size,
                social_profile, website, hear_about_us, biggest_challenge
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            submission.full_name, submission.contact_number, submission.email, submission.business_name,
            submission.city_state, submission.industry, investment_str, business_age_str,
            submission.team_size, submission.social_profile or "", submission.website or "",
            submission.hear_about_us, submission.biggest_challenge or ""
        ))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {"status": "success", "message": "Submission recorded successfully", "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/form-options")
def get_form_options():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM form_options ORDER BY category, id")
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/api/form-options")
def add_form_option(option: OptionCreate, authenticated: bool = Depends(verify_session)):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        valid_categories = ["industry", "investment", "business_age", "team_size", "hear_about_us"]
        if option.category not in valid_categories:
            raise HTTPException(status_code=400, detail=f"Invalid category.")
        cursor.execute("INSERT INTO form_options (category, option_value) VALUES (?, ?)", (option.category, option.option_value))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {"status": "success", "message": "Option added successfully", "id": new_id}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.delete("/api/form-options/{option_id}")
def delete_form_option(option_id: int, authenticated: bool = Depends(verify_session)):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM form_options WHERE id = ?", (option_id,))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="Option not found")
        cursor.execute("DELETE FROM form_options WHERE id = ?", (option_id,))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Option deleted successfully"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# ================================================================
# Auth Endpoints
# ================================================================
@app.post("/api/login")
def login(data: LoginRequest, response: Response):
    if data.username == ADMIN_USERNAME and data.password == ADMIN_PASSWORD:
        response.set_cookie(key="admin_session", value=SESSION_TOKEN, httponly=True, samesite="lax", max_age=3600 * 24)
        return {"status": "success", "message": "Login successful"}
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(key="admin_session")
    return {"status": "success", "message": "Logged out successfully"}

@app.get("/api/check-session")
def check_session(request: Request):
    token = request.cookies.get("admin_session")
    if token == SESSION_TOKEN:
        return {"status": "authenticated"}
    return JSONResponse(status_code=401, content={"status": "unauthenticated"})

@app.get("/api/submissions")
def get_submissions(authenticated: bool = Depends(verify_session)):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.*, b.meet_link, b.booked_date, b.booked_time
            FROM submissions s
            LEFT JOIN bookings b ON s.email = b.client_email AND b.status != 'cancelled'
            ORDER BY s.created_at DESC
        """)
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/stats")
def get_stats(authenticated: bool = Depends(verify_session)):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM submissions")
        total_leads = cursor.fetchone()[0]
        if total_leads == 0:
            conn.close()
            return {"total_leads": 0, "industry_stats": {}, "investment_stats": {}, "source_stats": {}, "age_stats": {}}
        cursor.execute("SELECT industry, COUNT(*) FROM submissions GROUP BY industry")
        industry_stats = dict(cursor.fetchall())
        cursor.execute("SELECT monthly_investment FROM submissions")
        investments = cursor.fetchall()
        investment_stats = {}
        for inv_row in investments:
            for part in [p.strip() for p in inv_row[0].split(",")]:
                if part:
                    investment_stats[part] = investment_stats.get(part, 0) + 1
        cursor.execute("SELECT hear_about_us, COUNT(*) FROM submissions GROUP BY hear_about_us")
        source_stats = dict(cursor.fetchall())
        cursor.execute("SELECT business_age FROM submissions")
        ages = cursor.fetchall()
        age_stats = {}
        for age_row in ages:
            for part in [p.strip() for p in age_row[0].split(",")]:
                if part:
                    age_stats[part] = age_stats.get(part, 0) + 1
        conn.close()
        return {"total_leads": total_leads, "industry_stats": industry_stats, "investment_stats": investment_stats, "source_stats": source_stats, "age_stats": age_stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

# ================================================================
# NEW: Scheduling / Availability Endpoints
# ================================================================

@app.get("/api/schedule/config")
def get_schedule_config():
    """Public: Get current scheduling config (form active, slot duration)."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM schedule_config WHERE id = 1")
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else {"form_active": 1, "slot_duration": 30, "custom_slot_minutes": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/schedule/config")
def update_schedule_config(config: ScheduleConfigUpdate, authenticated: bool = Depends(verify_session)):
    """Admin: Update scheduling config."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE schedule_config
            SET form_active=?, slot_duration=?, custom_slot_minutes=?,
                break_start=?, break_end=?, break_enabled=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=1
        """, (
            1 if config.form_active else 0,
            config.slot_duration,
            config.custom_slot_minutes,
            config.break_start or "13:00",
            config.break_end or "14:00",
            1 if config.break_enabled else 0
        ))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Config updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schedule/availability")
def get_availability():
    """Public: Get admin availability settings per weekday."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM availability_settings ORDER BY day_of_week")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/schedule/availability")
def update_availability(update: AvailabilityUpdate, authenticated: bool = Depends(verify_session)):
    """Admin: Replace all availability slots."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM availability_settings")
        for slot in update.slots:
            cursor.execute("""
                INSERT INTO availability_settings (day_of_week, start_time, end_time, slot_duration, is_active)
                VALUES (?, ?, ?, 30, ?)
            """, (slot.day_of_week, slot.start_time, slot.end_time, 1 if slot.is_active else 0))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Availability updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schedule/slots/{date_str}")
def get_slots_for_date(date_str: str):
    """
    Public: Return available time slots for a given date (YYYY-MM-DD).
    Slots already booked or falling in breaks/blocks are marked unavailable.
    """
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Get config
        cursor.execute("SELECT * FROM schedule_config WHERE id = 1")
        config = dict(cursor.fetchone())
        if not config["form_active"]:
            conn.close()
            return {"slots": [], "form_active": False}

        slot_minutes = config["custom_slot_minutes"] if config["slot_duration"] == 0 and config["custom_slot_minutes"] else config["slot_duration"]

        # Python weekday: Mon=0 ... Sun=6; our DB uses Mon=1 ... Sun=7 — using Python 0-indexed
        day_of_week = target_date.weekday()  # 0=Mon, 6=Sun

        cursor.execute("SELECT * FROM availability_settings WHERE day_of_week = ? AND is_active = 1", (day_of_week,))
        avail = cursor.fetchone()
        if not avail:
            conn.close()
            return {"slots": [], "form_active": True, "date": date_str}

        # Check if date is blocked
        cursor.execute("SELECT id FROM blocked_dates WHERE blocked_date = ?", (date_str,))
        if cursor.fetchone():
            conn.close()
            return {"slots": [], "form_active": True, "date": date_str, "blocked": True}

        avail = dict(avail)

        # Get booked slots for this date
        cursor.execute("SELECT booked_time FROM bookings WHERE booked_date = ? AND status != 'cancelled'", (date_str,))
        booked_times = {row["booked_time"] for row in cursor.fetchall()}

        # Load date-specific custom breaks
        cursor.execute("SELECT start_time, end_time, reason FROM date_breaks WHERE break_date = ?", (date_str,))
        db_breaks = [dict(r) for r in cursor.fetchall()]
        conn.close()

        # Generate slots
        start_h, start_m = map(int, avail["start_time"].split(":"))
        end_h, end_m = map(int, avail["end_time"].split(":"))
        current = datetime(target_date.year, target_date.month, target_date.day, start_h, start_m)
        end_dt = datetime(target_date.year, target_date.month, target_date.day, end_h, end_m)
        now = datetime.now()

        slots = []
        while current + timedelta(minutes=slot_minutes) <= end_dt:
            time_str = current.strftime("%H:%M")
            is_booked = time_str in booked_times
            is_past = current <= now and target_date == date.today()

            # Check overlap with breaks
            slot_start = current
            slot_end = current + timedelta(minutes=slot_minutes)
            is_in_break = False
            break_reason = None

            # 1. Check daily recurring break
            if config.get("break_enabled"):
                try:
                    b_start_h, b_start_m = map(int, config["break_start"].split(":"))
                    b_end_h, b_end_m = map(int, config["break_end"].split(":"))
                    rec_break_start = datetime(target_date.year, target_date.month, target_date.day, b_start_h, b_start_m)
                    rec_break_end = datetime(target_date.year, target_date.month, target_date.day, b_end_h, b_end_m)
                    
                    if slot_start < rec_break_end and slot_end > rec_break_start:
                        is_in_break = True
                        break_reason = "Daily Break"
                except Exception:
                    pass

            # 2. Check date-specific custom breaks
            if not is_in_break:
                for b_row in db_breaks:
                    try:
                        db_b_start_h, db_b_start_m = map(int, b_row["start_time"].split(":"))
                        db_b_end_h, db_b_end_m = map(int, b_row["end_time"].split(":"))
                        db_break_start = datetime(target_date.year, target_date.month, target_date.day, db_b_start_h, db_b_start_m)
                        db_break_end = datetime(target_date.year, target_date.month, target_date.day, db_b_end_h, db_b_end_m)
                        
                        if slot_start < db_break_end and slot_end > db_break_start:
                            is_in_break = True
                            break_reason = b_row["reason"] or "Blocked"
                            break
                    except Exception:
                        pass

            slots.append({
                "time": time_str,
                "display": current.strftime("%I:%M %p"),
                "available": not is_booked and not is_past and not is_in_break,
                "booked": is_booked,
                "is_break": is_in_break,
                "break_reason": break_reason
            })
            current += timedelta(minutes=slot_minutes)

        return {"slots": slots, "form_active": True, "date": date_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/schedule/book")
def create_booking(booking: BookingCreate):
    """Public: Create a new booking."""
    try:
        # Check form is active
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT form_active, slot_duration, custom_slot_minutes FROM schedule_config WHERE id = 1")
        config = cursor.fetchone()
        if not config or not config["form_active"]:
            conn.close()
            raise HTTPException(status_code=403, detail="Booking form is currently inactive.")

        slot_dur = config["custom_slot_minutes"] if config["slot_duration"] == 0 and config["custom_slot_minutes"] else config["slot_duration"]
        if not slot_dur: slot_dur = 30

        # Check slot not already taken
        cursor.execute(
            "SELECT id FROM bookings WHERE booked_date = ? AND booked_time = ? AND status != 'cancelled'",
            (booking.booked_date, booking.booked_time)
        )
        if cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=409, detail="This slot is already booked. Please choose another.")

        cursor.execute("""
            INSERT INTO bookings (booked_date, booked_time, client_name, client_email, client_phone, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
        """, (booking.booked_date, booking.booked_time, booking.client_name, booking.client_email,
              booking.client_phone or "", booking.notes or ""))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        
        # Send confirmation email with ICS
        email_res = send_confirmation_email(booking.client_email, booking.client_name, booking.booked_date, booking.booked_time, slot_dur)
        
        meet_link = email_res.get("meet_link") if isinstance(email_res, dict) else None
        
        # Save meet_link to the database
        if meet_link:
            try:
                conn_save = sqlite3.connect(DB_PATH)
                cursor_save = conn_save.cursor()
                cursor_save.execute("UPDATE bookings SET meet_link = ? WHERE id = ?", (meet_link, new_id))
                conn_save.commit()
                conn_save.close()
            except Exception as e_save:
                print(f"[DB ERROR] Saving meet link failed: {e_save}")
        
        return {
            "status": "success", 
            "message": "Booking confirmed!", 
            "id": new_id, 
            "meet_link": meet_link,
            "calendar_generated": email_res.get("calendar_generated") if isinstance(email_res, dict) else False
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/schedule/book-multiple")
def create_multiple_bookings(batch: BatchBookingCreate):
    """Public: Create multiple bookings in a single transaction."""
    if not batch.bookings:
        raise HTTPException(status_code=400, detail="No bookings provided.")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT form_active FROM schedule_config WHERE id = 1")
        config = cursor.fetchone()
        if not config or not config["form_active"]:
            conn.close()
            raise HTTPException(status_code=403, detail="Booking form is currently inactive.")

        for item in batch.bookings:
            cursor.execute(
                "SELECT id FROM bookings WHERE booked_date = ? AND booked_time = ? AND status != 'cancelled'",
                (item.booked_date, item.booked_time)
            )
            if cursor.fetchone():
                conn.close()
                raise HTTPException(status_code=409, detail=f"The slot on {item.booked_date} at {item.booked_time} is already booked.")

        inserted_ids = []
        for item in batch.bookings:
            cursor.execute("""
                INSERT INTO bookings (booked_date, booked_time, client_name, client_email, client_phone, notes, status)
                VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
            """, (item.booked_date, item.booked_time, batch.client_name, batch.client_email,
                  batch.client_phone or "", batch.notes or ""))
            inserted_ids.append(cursor.lastrowid)
        
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Successfully confirmed {len(batch.bookings)} booking(s)!", "ids": inserted_ids}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schedule/bookings")
def get_all_bookings(authenticated: bool = Depends(verify_session)):
    """Admin: Get all bookings."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bookings ORDER BY booked_date DESC, booked_time ASC")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schedule/bookings/month/{year}/{month}")
def get_bookings_for_month(year: int, month: int, authenticated: bool = Depends(verify_session)):
    """Admin: Get bookings for a specific month for calendar view."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        month_str = f"{year:04d}-{month:02d}"
        cursor.execute(
            "SELECT * FROM bookings WHERE booked_date LIKE ? ORDER BY booked_date, booked_time",
            (f"{month_str}%",)
        )
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/schedule/bookings/{booking_id}/status")
def update_booking_status(booking_id: int, update: BookingStatusUpdate, authenticated: bool = Depends(verify_session)):
    """Admin: Update booking status (confirmed/cancelled/completed)."""
    valid_statuses = ["confirmed", "cancelled", "completed"]
    if update.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {valid_statuses}")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,))
        booking = cursor.fetchone()
        if not booking:
            conn.close()
            raise HTTPException(status_code=404, detail="Booking not found")
        booking = dict(booking)
        cursor.execute("UPDATE bookings SET status = ? WHERE id = ?", (update.status, booking_id))
        conn.commit()
        conn.close()

        # Send cancellation email
        if update.status == 'cancelled' and booking.get('client_email'):
            send_cancellation_email(
                booking['client_email'], booking['client_name'],
                booking['booked_date'], booking['booked_time']
            )

        return {"status": "success", "message": f"Booking status updated to '{update.status}'"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================================================================
# Blocked Dates Endpoints
# ================================================================
@app.get("/api/schedule/blocked-dates")
def get_blocked_dates():
    """Public: Get all blocked dates."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM blocked_dates ORDER BY blocked_date")
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/schedule/blocked-dates")
def add_blocked_date(req: BlockDateRequest, authenticated: bool = Depends(verify_session)):
    """Admin: Block a specific date."""
    try:
        datetime.strptime(req.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO blocked_dates (blocked_date, reason) VALUES (?, ?)", (req.date, req.reason or ""))
        conn.commit()

        # Cancel all bookings on this date and send emails
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bookings WHERE booked_date = ? AND status = 'confirmed'", (req.date,))
        bookings_to_cancel = [dict(r) for r in cursor.fetchall()]
        if bookings_to_cancel:
            cursor.execute("UPDATE bookings SET status = 'cancelled' WHERE booked_date = ? AND status = 'confirmed'", (req.date,))
            conn.commit()
            for b in bookings_to_cancel:
                if b.get('client_email'):
                    send_cancellation_email(b['client_email'], b['client_name'], b['booked_date'], b['booked_time'])

        conn.close()
        return {"status": "success", "message": f"Date {req.date} blocked. {len(bookings_to_cancel)} booking(s) cancelled."}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/schedule/blocked-dates/{date_str}")
def remove_blocked_date(date_str: str, authenticated: bool = Depends(verify_session)):
    """Admin: Unblock a specific date."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM blocked_dates WHERE blocked_date = ?", (date_str,))
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Date {date_str} unblocked."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================================================================
# Date Breaks / Blocks Endpoints
# ================================================================
@app.get("/api/schedule/date-breaks/{date_str}")
def get_date_breaks(date_str: str):
    """Public/Admin: Get all blocks/breaks for a specific date."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM date_breaks WHERE break_date = ? ORDER BY start_time", (date_str,))
        rows = cursor.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/schedule/date-breaks")
def add_date_break(req: DateBreakCreate, authenticated: bool = Depends(verify_session)):
    """Admin: Add a block/break for a specific date."""
    try:
        datetime.strptime(req.break_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO date_breaks (break_date, start_time, end_time, reason)
            VALUES (?, ?, ?, ?)
        """, (req.break_date, req.start_time, req.end_time, req.reason or ""))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {"status": "success", "message": "Custom block/break added successfully.", "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/schedule/date-breaks/{break_id}")
def delete_date_break(break_id: int, authenticated: bool = Depends(verify_session)):
    """Admin: Remove a custom block/break by ID."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM date_breaks WHERE id = ?", (break_id,))
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Block/break removed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================================================================
# Static Page Routes
# ================================================================
@app.get("/")
def read_root():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "index.html"))

@app.get("/login")
def read_login():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "login.html"))

@app.get("/dashboard")
def read_dashboard():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "dashboard.html"))

@app.get("/book")
def read_booking():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "schedule.html"))

@app.get("/admin/schedule")
def read_admin_schedule():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "admin-schedule.html"))

# Mounting Static Files
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

@app.get("/api/admin/google-credentials")
def get_google_credentials(authenticated: bool = Depends(verify_session)):
    """Admin: Get currently active client_id from credentials.json."""
    import json
    if not os.path.exists(google_calendar.CREDENTIALS_PATH):
        return {"client_id": "Not Configured"}
    try:
        with open(google_calendar.CREDENTIALS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            app_type = "installed" if "installed" in data else "web" if "web" in data else None
            if app_type:
                return {"client_id": data[app_type].get("client_id", "Not Configured")}
    except Exception as e:
        print("Error reading credentials:", e)
    return {"client_id": "Error Reading File"}

@app.post("/api/admin/google-credentials")
def post_google_credentials(payload: dict, authenticated: bool = Depends(verify_session)):
    """Admin: Upload or paste a new credentials.json configuration."""
    import json
    app_type = "installed" if "installed" in payload else "web" if "web" in payload else None
    if not app_type:
        raise HTTPException(status_code=400, detail="Invalid credentials.json format. Must contain 'installed' or 'web' root key.")
    
    creds = payload[app_type]
    if "client_id" not in creds or "client_secret" not in creds:
        raise HTTPException(status_code=400, detail="Missing 'client_id' or 'client_secret' inside credentials payload.")
    
    try:
        with open(google_calendar.CREDENTIALS_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=4)
        
        # Clear any active tokens so they must re-authenticate with the new client ID
        if os.path.exists(google_calendar.TOKEN_PATH):
            try:
                os.remove(google_calendar.TOKEN_PATH)
            except Exception:
                pass
                
        return {"status": "success", "message": "Google Developer credentials updated successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write credentials.json file: {str(e)}")

@app.get("/api/google/status")
def google_status():
    """Check if Google Calendar is connected and return the email."""
    import google_calendar
    service = google_calendar.get_calendar_service()
    if service:
        try:
            # We only have calendar.events scope, so we can't use calendars().get
            # However, events().list returns the calendar summary, which is the email!
            result = service.events().list(calendarId='primary', maxResults=1).execute()
            email = result.get('summary', 'Connected Account')
            return {"connected": True, "email": email}
        except Exception as e:
            print("Error fetching email:", e)
            return {"connected": True, "email": "Connected Account"}
    return {"connected": False, "email": None}

@app.get("/api/google/connect")
def google_connect(request: Request):
    """Initiates the OAuth flow to connect Google Calendar."""
    import google_calendar
    import os
    
    # Force a new login by removing the old token
    if os.path.exists(google_calendar.TOKEN_PATH):
        try:
            os.remove(google_calendar.TOKEN_PATH)
        except Exception:
            pass

    host_url = str(request.base_url).rstrip('/')
    auth_url = google_calendar.get_auth_url(host_url)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=auth_url, status_code=303)

@app.get("/api/google/callback")
def google_callback(request: Request, code: str):
    """Receives the OAuth code, saves token, and redirects back."""
    import google_calendar
    from fastapi.responses import RedirectResponse
    host_url = str(request.base_url).rstrip('/')
    try:
        google_calendar.save_credentials(code, host_url)
        return RedirectResponse(url="/admin/schedule", status_code=303)
    except Exception as e:
        return HTMLResponse(f"<html><body style='font-family:sans-serif; text-align:center; padding-top:50px; color:red;'><h2>❌ Authentication Failed.</h2><p>{str(e)}</p><br><a href='/admin/schedule'>Go Back</a></body></html>")
