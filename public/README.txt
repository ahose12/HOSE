HOSE SUPABASE AUTH + REAL UPLOAD PATCH

PUBLIC HOSE:
REPLACE:
  public/index.html
  public/app.js
  public/styles.css

ADD:
  public/supabase-config.js

STEP 1 - FILL CONFIG
Open public/supabase-config.js and paste:
- Supabase Project URL
- Publishable key (or legacy anon key)

Do NOT use a service_role / secret key.

STEP 2 - SUPABASE AUTH URL
In Supabase:
Authentication -> URL Configuration

Site URL:
https://ahose12.github.io/HOSE/

Add Redirect URL:
https://ahose12.github.io/HOSE/

STEP 3 - DEPLOY
Commit files and run your GitHub Pages workflow.

WHAT WORKS AFTER THIS PATCH
- Create account
- Confirm email (if enabled)
- Sign in / sign out
- Create private property
- Create private camera
- Add camera habitat features
- Select photos
- Upload actual photos to private trail-camera-photos bucket
- Create trail_photos database row with processing_status=queued
- Refresh page and view private uploaded photos using signed URLs
- Load deer_profiles from database
- Rename deer profiles once AI creates them

NEXT STEP
Add the server-side Supabase Edge Function / worker that:
1. claims queued trail_photos
2. obtains the private image
3. detects deer
4. invokes OpenAI for buck/doe/fawn + phenotype analysis
5. creates sightings
6. creates or matches deer_profiles
7. marks photo complete
