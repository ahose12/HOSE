# Alabama Deer Intelligence — GitLab Pages Starter

This build supports:
- private address / ZIP / city / coordinate search
- configurable radius (1–50 miles)
- configurable minimum acreage
- dropdown containing Alabama deer-hunting public lands seeded from current official sources
- confirmed deer-photo observations only
- historical SQLite database
- persistent deer IDs and visual re-identification
- phenotype/antler/lineage notes
- reported/verified harvest status

Public-land dropdown entries in this build: **53**.

## Important: public-land distance
The dropdown catalog is authoritative as a name/type list, but this package deliberately does not fabricate polygon geometry. GitLab Pages geocodes a selected land name to a center point as a fallback. For production, import official ADCNR/USFS/USFWS/USACE polygons and calculate distance from boundaries with PostGIS.

## Important: listing acquisition
The package does not bypass Zillow or other anti-bot controls. Replace `backend/providers/csv_provider.py` with a licensed or otherwise permitted listing feed adapter.

## History
True positives live in `data/deer_intelligence.sqlite`. The worker exports `public/observations.json` and `public/deer_profiles.json`. A GitLab project token can optionally commit the updated history back to the repo; production should use PostgreSQL/PostGIS or Supabase.

## Unique deer
The model uses OWLv2 to detect deer and CLIP embeddings to create conservative visual re-ID candidates. Human review is recommended before treating two sightings as the same animal. Image analysis can support phenotype/antler-lineage hypotheses, but not DNA/genetic certainty.

## Harvested deer
Example:
```bash
python backend/manage_deer.py harvest AL-JACKSON-UNKN-0001 --status verified --date 2026-12-20 --note "Matched harvest photo and hunter report" --verified-by admin
```

## Deploy
1. Create GitLab repo and upload contents.
2. Enable Pages.
3. Replace sample listing CSV with a permitted feed.
4. Create a scheduled pipeline.
5. Optionally add masked `GITLAB_PUSH_TOKEN` for repo-backed proof-of-concept persistence.
6. Open the Pages URL.
