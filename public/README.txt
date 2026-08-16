HOSE AUTH-GATED TABS PATCH

REPLACE IN PUBLIC HOSE:
  public/index.html
  public/app.js
  public/styles.css

KEEP:
  public/supabase-config.js

BEHAVIOR:
- Logged out users see ONLY Sign In / Create Account.
- No real-estate/public-land intelligence is visible before authentication.
- After sign in:
    Tab 1 (default): My Deer Intelligence
    Tab 2: Area Deer Intelligence

MY DEER INTELLIGENCE:
- properties
- cameras
- habitat metadata
- private trail-photo upload
- recent private photos
- deer profiles
- rename deer

AREA DEER INTELLIGENCE:
- address/ZIP/public-land search
- real-estate/listing deer observations
- public-land distance
- map

IMPORTANT:
The AI worker is still the next server-side step. Uploaded trail_photos remain
processing_status='queued' until the Supabase Edge Function / worker is added.
