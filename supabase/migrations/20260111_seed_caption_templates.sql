-- Seed 72 caption templates across 8 tones for Enhanced Templates feature
-- Run this in Supabase SQL Editor to populate templates

-- STEP 1: Update the tone constraint to allow all 8 tones
ALTER TABLE social_caption_templates DROP CONSTRAINT IF EXISTS social_caption_templates_tone_check;
ALTER TABLE social_caption_templates ADD CONSTRAINT social_caption_templates_tone_check 
  CHECK (tone IN ('casual', 'professional', 'urgency', 'playful', 'value', 'trending', 'inspirational', 'minimalist'));

-- First, clear existing templates (optional - comment out to keep existing)
-- DELETE FROM social_caption_templates;

-- CASUAL TONE (15 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('casual', 'Check out this {category} 🔥 {product_name} - perfect for any occasion!

Shop now: {link}', true),
('casual', '{product_name} just dropped! 💫 Add this {category} to your collection today.

🛒 {link}', true),
('casual', 'Your new favorite {category} is here! ✨ {product_name}

Link in bio or shop direct: {link}', true),
('casual', 'Obsessed with this {product_name}! 😍 A must-have {category} for your wardrobe.

{link}', true),
('casual', 'New in! 🛍️ {product_name} - the {category} you didn''t know you needed.

Get yours: {link}', true),
('casual', 'POV: You just found your next favorite {category} 👀 {product_name}

{link}', true),
('casual', 'That feeling when you find the perfect {category}... 💕 Meet {product_name}!

{link}', true),
('casual', 'Adding this {product_name} to cart immediately! 🛒 Anyone else?

Shop: {link}', true),
('casual', 'Main character energy with this {category} ✨ {product_name}

{link}', true),
('casual', 'Raise your hand if you need this {product_name} in your life! 🙋‍♀️

{link}', true),
('casual', 'This {category} hits different 🔥 {product_name} is IT!

Link in bio: {link}', true),
('casual', 'Stop scrolling! You need to see this {product_name} 👀✨

{link}', true),
('casual', 'Adding some ✨ to your feed with {product_name}!

Shop this {category}: {link}', true),
('casual', 'Ok but how cute is this {category}?! 😍 {product_name}

{link}', true),
('casual', 'Just dropped and already obsessed! {product_name} 💫

Get it: {link}', true);

-- URGENCY TONE (12 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('urgency', '🚨 Don''t miss out! {product_name} is selling fast!

Grab yours now: {link}', true),
('urgency', '⚡ Limited stock alert! This {category} won''t last long - {product_name}

Shop now: {link}', true),
('urgency', '🔥 Hot item! {product_name} - get it before it''s gone!

{link}', true),
('urgency', '⏰ Last chance! {product_name} is almost sold out!

Order now: {link}', true),
('urgency', '🚨 SELLING FAST 🚨 {product_name} - limited quantities!

Don''t wait: {link}', true),
('urgency', '⚡ Going, going... almost gone! {product_name}

Secure yours: {link}', true),
('urgency', 'Only a few left! 😱 {product_name} - act fast!

{link}', true),
('urgency', '🔥 This {category} is flying off the shelves! {product_name}

Hurry: {link}', true),
('urgency', '⏳ Time''s running out! Get {product_name} while you can!

{link}', true),
('urgency', '🏃‍♀️ RUN don''t walk! {product_name} is almost sold out!

{link}', true),
('urgency', '⚠️ Low stock warning! {product_name} - get it now!

{link}', true),
('urgency', 'This won''t be restocked! 😬 {product_name}

Shop now: {link}', true);

-- PROFESSIONAL TONE (10 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('professional', 'Introducing {product_name} - quality {category} for the discerning shopper.

Explore: {link}', true),
('professional', 'Elevate your style with {product_name}. Premium {category} now available.

Shop: {link}', true),
('professional', '{product_name} - where style meets quality. Discover our {category} collection.

{link}', true),
('professional', 'Discover {product_name}. Crafted for those who appreciate fine {category}.

{link}', true),
('professional', 'The {product_name} - a sophisticated addition to any collection.

View: {link}', true),
('professional', 'Quality meets design. Presenting {product_name}.

Explore: {link}', true),
('professional', 'For the modern trendsetter: {product_name}.

Shop the collection: {link}', true),
('professional', 'Timeless style, modern appeal. {product_name}.

{link}', true),
('professional', 'Curated for you: {product_name} - premium {category}.

Discover: {link}', true),
('professional', 'Excellence in every detail. {product_name}.

{link}', true);

-- PLAYFUL TONE (8 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('playful', 'Treat yourself! 🎉 {product_name} is calling your name!

{link}', true),
('playful', 'You + {product_name} = a match made in heaven 💕

{link}', true),
('playful', 'Plot twist: You need this {category} 😂 {product_name}

{link}', true),
('playful', 'Tag someone who needs this {product_name}! 👇

{link}', true),
('playful', 'Adding this to my cart faster than... well, everything 😅 {product_name}

{link}', true),
('playful', 'Me: I don''t need it.
Also me: *adds to cart* 🛒 {product_name}

{link}', true),
('playful', 'Serotonin boost incoming! 🌈 {product_name}

Shop: {link}', true),
('playful', 'Current mood: obsessed with this {category} 💅 {product_name}

{link}', true);

-- VALUE TONE (8 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('value', 'Quality {category} at an unbeatable price! 💰 {product_name}

Shop: {link}', true),
('value', 'Why pay more? Get {product_name} at the best price!

{link}', true),
('value', 'Budget-friendly AND stylish? Yes please! 🙌 {product_name}

{link}', true),
('value', 'Great style doesn''t have to break the bank 💸 {product_name}

{link}', true),
('value', 'Affordable luxury is real 💎 {product_name}

Shop now: {link}', true),
('value', 'Your wallet will thank you 😉 {product_name} - amazing value!

{link}', true),
('value', 'Premium look, smart price 💰 {product_name}

{link}', true),
('value', 'The best deal you''ll find today! {product_name}

{link}', true);

-- TRENDING TONE (8 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('trending', 'Trending NOW 📈 {product_name} - everyone''s talking about it!

{link}', true),
('trending', 'The {category} everyone is wearing right now! {product_name}

{link}', true),
('trending', 'As seen on your feed: {product_name} 📱

Get the look: {link}', true),
('trending', 'This season''s must-have! {product_name} 🌟

{link}', true),
('trending', 'Influencer-approved ✓ {product_name}

Shop: {link}', true),
('trending', 'What''s trending? {product_name}! Join the hype!

{link}', true),
('trending', 'Everyone needs this {category} this season! {product_name}

{link}', true),
('trending', '2026''s hottest {category} 🔥 {product_name}

{link}', true);

-- INSPIRATIONAL TONE (6 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('inspirational', 'Be bold. Be you. Be wearing {product_name} 💪

{link}', true),
('inspirational', 'Confidence looks good on you 👑 {product_name}

{link}', true),
('inspirational', 'Express yourself with {product_name} ✨

You deserve it: {link}', true),
('inspirational', 'Dress for the life you want 🌟 {product_name}

{link}', true),
('inspirational', 'Your style, your rules 💫 {product_name}

{link}', true),
('inspirational', 'Level up your look with {product_name} 🚀

{link}', true);

-- MINIMALIST TONE (5 templates)
INSERT INTO social_caption_templates (tone, template, is_active) VALUES
('minimalist', '{product_name}.

{link}', true),
('minimalist', 'Simple. Clean. {product_name}.

{link}', true),
('minimalist', '{category}. Perfected.

{product_name} → {link}', true),
('minimalist', 'Less is more. {product_name}

{link}', true),
('minimalist', 'Effortless style: {product_name}

{link}', true);

-- Summary: 72 templates total
-- casual: 15
-- urgency: 12
-- professional: 10
-- playful: 8
-- value: 8
-- trending: 8
-- inspirational: 6
-- minimalist: 5
