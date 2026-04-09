# XamBuddy — Pricing & Payments Design

## Overview

XamBuddy uses a freemium model where users can access easy-difficulty questions for free across all exams. Pro plans unlock medium and hard questions on a per-exam basis. All users (free and paid) must sign up and log in.

---

## Plans

### Free Plan
- Available to all registered users
- Access to **easy** difficulty questions only (MCQ, short, long)
- All exams browsable
- Activity/progress stats stored **locally on device only** (localStorage on web, AsyncStorage on mobile)
- Data lost on reinstall or device switch

### Pro Plan (per-exam)
- Paid, purchased independently for each exam (e.g., 10th CBSE, 12th CBSE, NEET, JEE)
- Access to **all difficulties** (easy, medium, hard) for purchased exams
- Activity history stored **on server** (Supabase), synced across devices
- Cross-device progress tracking

---

## Content Gating

Enforcement happens at three levels:

| Level | What it does |
|---|---|
| **Backend API (authoritative)** | `/api/retrieve` checks user's subscription for the requested exam. Free users only get `difficulty = 'easy'`. Pro users get all. |
| **Supabase RLS** | Users can only read/write their own profiles, subscriptions, and activity. |
| **Frontend (cosmetic)** | Hides medium/hard options for free users. Shows "Upgrade to Pro" prompts. |

Even if someone calls the API directly, they cannot access medium/hard questions without a valid Pro subscription for that exam.

---

## Payment Platforms

| Platform | Payment System | Fee |
|---|---|---|
| **iOS (App Store)** | Apple In-App Purchase (IAP) — mandatory | 15% (Small Business Program) or 30% |
| **Android (Play Store)** | Google Play Billing — mandatory | 15% (under $1M) or 30% |
| **Web (browser)** | Razorpay or any gateway | ~2% |

Apple and Google mandate their own payment systems for digital content sold within mobile apps. Razorpay can only be used for web purchases.

### RevenueCat (recommended abstraction layer)

Rather than integrating Apple IAP and Google Play Billing separately, we use **RevenueCat** as a unified layer:

- Single SDK for both iOS and Android (`react-native-purchases`)
- Web SDK available (or use Razorpay for web-only with lower fees)
- Handles receipt validation, subscription management, renewals
- Webhooks to sync subscription state to our backend
- Free tier: up to $2,500/month in tracked revenue
- Dashboard for cross-platform subscriber analytics

### Payment Flow

```
Mobile (iOS/Android):
  User taps "Get Pro" → RevenueCat SDK → Apple IAP / Google Play Billing
  → RevenueCat webhook → Backend → Insert into `subscriptions` table

Web:
  User clicks "Get Pro" → POST /api/payments/create-order → Razorpay order created
  → Razorpay checkout modal → User pays
  → POST /api/payments/verify → Backend verifies signature → Insert into `subscriptions` table
```

---

## Database Schema

### Existing table: `questions`
No changes needed. Content gating is handled at the API level, not the schema level.

### New table: `user_profiles`
Auto-created via trigger when a user signs up.

```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  current_exam TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### New table: `exams`
Catalog of available exams with pricing.

```sql
CREATE TABLE exams (
  id TEXT PRIMARY KEY,              -- e.g. '10th_cbse', 'neet', 'jee'
  display_name TEXT NOT NULL,       -- e.g. '10th CBSE Board'
  pro_price_inr INTEGER NOT NULL,   -- price in paise (29900 = Rs 299)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### New table: `subscriptions`
Per-exam Pro purchases. One row per user per exam.

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES exams(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  payment_platform TEXT CHECK (payment_platform IN ('razorpay', 'apple', 'google')),
  platform_payment_id TEXT,         -- razorpay_payment_id or Apple/Google transaction ID
  platform_order_id TEXT,
  starts_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,           -- NULL = lifetime
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, exam_id)
);
```

### New table: `user_activity`
Server-side activity tracking for Pro users.

```sql
CREATE TABLE user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  exam TEXT NOT NULL,
  selected_answer TEXT,
  is_correct BOOLEAN,
  time_spent_seconds INTEGER,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_activity_user_exam ON user_activity(user_id, exam);
```

### Trigger: auto-create profile on signup

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'student'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## RLS Policies

All new tables have Row Level Security enabled.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `user_profiles` | Own row (`auth.uid() = id`) | Auto (trigger) | Own row (display_name, current_exam only) | — |
| `exams` | All authenticated | Admin only | Admin only | — |
| `subscriptions` | Own rows | Server-side only (service role) | Server-side only | — |
| `user_activity` | Own rows | Own rows | — | — |
| `questions` | All authenticated | Admin only | Admin only | Admin only |

---

## Auth

- **Providers:** Email/password + Google OAuth (via Supabase Auth)
- **All users must register** — no anonymous access
- **Roles:** `student` (default) and `admin` (set manually via SQL)
- **Admin assignment:** `UPDATE user_profiles SET role = 'admin' WHERE id = '<uuid>'` — never exposed via API

---

## Backend API Endpoints

### Existing (modified)
- `GET /api/retrieve` — Add content gating: check subscription, filter difficulty for free users

### New
- `POST /api/payments/create-order` — Create Razorpay order for web payments
- `POST /api/payments/verify` — Verify Razorpay payment, activate subscription
- `POST /api/webhooks/revenuecat` — RevenueCat webhook for mobile payment events
- `GET /api/user/subscriptions` — Get user's active subscriptions

---

## Frontend Pages

| Page | Purpose |
|---|---|
| Login / Signup | Email+password and Google OAuth |
| Student Home | Exam selector, dashboard for selected exam |
| Practice | Question interface with answer tracking |
| Pricing | Exam plans, free vs pro comparison, purchase flow |
| Profile | User info, active subscriptions, activity stats |
| Admin Panel | Existing admin features (role-gated) |

---

## Activity Tracking Strategy

```
if user has Pro for this exam:
    save to Supabase `user_activity` table (server-side, synced)
else:
    save to localStorage / AsyncStorage (device-only, lost on reinstall)
```

---

## Implementation Phases

1. **Database + Auth** — Tables, RLS, triggers, Google OAuth provider
2. **Backend API** — Content gating, payment endpoints
3. **Frontend Auth** — AuthContext, Login/Signup, role-based routing
4. **Student Experience** — Home, Practice, Profile
5. **Monetization** — Pricing page, Razorpay (web), RevenueCat (mobile)
6. **Mobile** — React Native integration with same backend
