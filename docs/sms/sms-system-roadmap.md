# Karry Kraze SMS System Roadmap

## 🎯 Goal
Build a fully custom SMS marketing and automation system using:
- Supabase (database + edge functions)
- Twilio (SMS delivery)
- Website frontend (HTML + JS)

The system should:
- Collect phone numbers with proper SMS consent
- Store and manage SMS subscribers
- Send automated and campaign-based SMS messages
- Support segmentation (repeat buyers, product viewers, etc.)
- Handle opt-in and opt-out states properly

---

## 🧱 Current Stack
- Frontend: HTML + Tailwind + JS
- Backend: Supabase (Postgres, Auth, Edge Functions)
- Payments: Stripe
- Database already includes:
  - products
  - orders
  - users (if applicable)

---

## 🚀 Phase 1: SMS Opt-In Collection

### Features
- Popup or form offering coupon (e.g. 10% off)
- Collect:
  - phone number
  - optional email
- Checkbox for SMS consent (required)

### Requirements
- Store consent properly (timestamp, source)
- Only allow SMS if explicitly opted in

---

## 🗄️ Phase 2: Database Design

### Tables Needed

#### customer_contacts
- id
- phone (E.164 format)
- email
- sms_opt_in (boolean)
- sms_opt_in_at (timestamp)
- sms_opt_out_at (timestamp)
- source (e.g. "popup_coupon")
- created_at

#### consent_logs
- id
- phone
- consent_text
- source
- page_url
- ip
- user_agent
- created_at

#### sms_messages
- id
- phone
- message_body
- status (sent, delivered, failed)
- provider (twilio)
- provider_message_id
- created_at

---

## ⚙️ Phase 3: Twilio Integration

### Requirements
- Use Twilio API to send SMS
- Secure API key usage (env variables)
- Build Supabase Edge Function:
  - Accept phone + message
  - Send SMS via Twilio
  - Log message in database

---

## 🔄 Phase 4: Automation Flows

### Initial Flows
1. Coupon Delivery (instant)
2. Reminder SMS (2–4 hours later)

### Future Flows
- Abandoned cart
- Product view follow-up
- Order updates
- VIP / repeat customer campaigns

---

## 🧠 Phase 5: Segmentation

Build queries for:
- repeat buyers
- product viewers
- high spenders
- inactive users

---

## ⚠️ Compliance Requirements

- Must store proof of consent
- Every message must include:
  - brand name
  - opt-out instructions ("Reply STOP to unsubscribe")
- Handle opt-out events from Twilio webhook

---

## 🔮 Future Enhancements

- SMS dashboard UI
- Campaign builder
- Scheduling system
- Analytics (revenue per SMS)

---

## 🧩 Philosophy

We are building a **developer-first SMS system**, not relying on platforms like Klaviyo.

Goals:
- Full control
- Lower cost
- Deep customization