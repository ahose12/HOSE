from pathlib import Path
import re, zipfile, shutil, subprocess

src = Path("/mnt/data/hose-spatial-v2/public/app.js")
text = src.read_text(encoding="utf-8")

# 1) Make Area tab reload private spatial data directly from Supabase before populating selectors.
old_setup = '''function setupTabs() {
  document.querySelectorAll(".app-tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".app-tab").forEach(tab => tab.classList.remove("active"));
      button.classList.add("active");

      const selected = button.dataset.tab;
      $("tab-my-intel").classList.toggle("hidden", selected !== "my-intel");
      $("tab-area-intel").classList.toggle("hidden", selected !== "area-intel");
      $("tab-explore-plan").classList.toggle("hidden", selected !== "explore-plan");

      if (selected === "area-intel") {
        initAreaMap();
        syncAreaSelectors();
        renderAreaMap();
        setTimeout(() => areaMap?.invalidateSize(), 100);
      }

      if (selected === "explore-plan" && map) {
        setTimeout(() => map.invalidateSize(), 100);
      }
    });
  });
}'''

new_setup = '''function setupTabs() {
  document.querySelectorAll(".app-tab").forEach(button => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".app-tab").forEach(tab => tab.classList.remove("active"));
      button.classList.add("active");

      const selected = button.dataset.tab;
      $("tab-my-intel").classList.toggle("hidden", selected !== "my-intel");
      $("tab-area-intel").classList.toggle("hidden", selected !== "area-intel");
      $("tab-explore-plan").classList.toggle("hidden", selected !== "explore-plan");

      if (selected === "area-intel") {
        initAreaMap();

        // IMPORTANT: do not trust stale browser arrays.
        // Reload this user's property/camera/stand/deer data from Supabase
        // every time Area Intelligence opens.
        await reloadAreaIntelligenceData();

        syncAreaSelectors();
        renderAreaMap();

        setTimeout(() => areaMap?.invalidateSize(), 150);
      }

      if (selected === "explore-plan" && map) {
        setTimeout(() => map.invalidateSize(), 100);
      }
    });
  });
}'''

if old_setup not in text:
    raise RuntimeError("setupTabs block not found")
text = text.replace(old_setup, new_setup, 1)

# 2) Explicitly filter private-data loaders by signed-in user.
text = text.replace(
'''    await sb
      .from("properties")
      .select("*")
      .order("created_at", {
        ascending: true
      });''',
'''    await sb
      .from("properties")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", {
        ascending: true
      });''',
1
)

text = text.replace(
'''    await sb
      .from("cameras")
      .select(
        "*, camera_features(feature_type)"
      )
      .eq("active", true)
      .order("created_at", {
        ascending: true
      });''',
'''    await sb
      .from("cameras")
      .select(
        "*, camera_features(feature_type)"
      )
      .eq("user_id", currentUser.id)
      .eq("active", true)
      .order("created_at", {
        ascending: true
      });''',
1
)

text = text.replace(
'''    await sb
      .from("deer_profiles")
      .select("*")
      .order("last_seen", {
        ascending: false
      });''',
'''    await sb
      .from("deer_profiles")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("last_seen", {
        ascending: false
      });''',
1
)

text = text.replace(
'''  const { data, error } = await sb
    .from("stands")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: true });''',
'''  const { data, error } = await sb
    .from("stands")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("active", true)
    .order("created_at", { ascending: true });''',
1
)

text = text.replace(
'''  const { data, error } = await sb
    .from("sightings")
    .select("*")
    .order("captured_at", { ascending: true, nullsFirst: false });''',
'''  const { data, error } = await sb
    .from("sightings")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("captured_at", { ascending: true, nullsFirst: false });''',
1
)

# 3) Insert a dedicated reload function immediately before Area Intelligence section.
marker = '''/* ============================================================
   PRIVATE AREA INTELLIGENCE
   ============================================================ */'''

reload_fn = r'''async function reloadAreaIntelligenceData() {
  if (!currentUser || !sb) {
    return;
  }

  if ($("placementMessage")) {
    $("placementMessage").textContent =
      "Loading your property, cameras, stands, and deer from Supabase…";
  }

  await Promise.all([
    loadProperties(),
    loadCameras(),
    loadDeerProfiles(),
    loadStands(),
    loadSightings()
  ]);

  if (!properties.length) {
    $("placementMessage").textContent =
      "No properties were returned for this account. Create a property in My Deer Intelligence first.";
    return;
  }

  $("placementMessage").textContent =
    `${properties.length} propert${properties.length === 1 ? "y" : "ies"} loaded from Supabase. Choose a property to map cameras and stands.`;
}


'''

if marker not in text:
    raise RuntimeError("Area marker missing")
text = text.replace(marker, reload_fn + marker, 1)

# 4) Replace Area map init with satellite as default + streets switcher.
pattern = re.compile(
r'''function initAreaMap\(\) \{.*?areaMap\.on\("click", handleAreaMapClick\);\n\}''',
re.S
)

new_map = r'''function initAreaMap() {
  if (areaMap || typeof L === "undefined" || !$("areaMap")) return;

  areaMap = L.map("areaMap", {
    zoomControl: true,
    preferCanvas: true
  }).setView([34.65, -86.55], 9);

  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Sources: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
    }
  );

  const streetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors"
    }
  );

  // Satellite is the DEFAULT layer.
  satelliteLayer.addTo(areaMap);

  L.control.layers(
    {
      "Satellite / Aerial": satelliteLayer,
      "Street Map": streetLayer
    },
    {},
    {
      position: "topright",
      collapsed: false
    }
  ).addTo(areaMap);

  areaLayer = L.layerGroup().addTo(areaMap);
  movementLayer = L.layerGroup().addTo(areaMap);

  areaMap.on("click", handleAreaMapClick);

  setTimeout(() => areaMap.invalidateSize(), 100);
}'''

text, n = pattern.subn(new_map, text, count=1)
if n != 1:
    raise RuntimeError(f"initAreaMap replace failed: {n}")

# 5) Replace selector syncing to preserve selected property and populate camera reliably.
pattern = re.compile(
r'''function syncAreaSelectors\(\) \{.*?\n\}''',
re.S
)

new_sync = r'''function syncAreaSelectors() {
  if (!$("mapProperty")) return;

  const savedProperty =
    $("mapProperty").value ||
    localStorage.getItem("hose_area_property_id") ||
    "";

  $("mapProperty").innerHTML =
    '<option value="">Choose property…</option>' +
    properties
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join("");

  if (properties.some(p => p.id === savedProperty)) {
    $("mapProperty").value = savedProperty;
  } else if (properties.length === 1) {
    $("mapProperty").value = properties[0].id;
  }

  const propertyId = $("mapProperty").value;

  if (propertyId) {
    localStorage.setItem("hose_area_property_id", propertyId);
  }

  const cams =
    propertyId
      ? cameras.filter(c => c.property_id === propertyId)
      : [];

  const propertyStands =
    propertyId
      ? stands.filter(s => s.property_id === propertyId)
      : [];

  const deer =
    propertyId
      ? deerProfiles.filter(d => d.property_id === propertyId)
      : [];

  const oldCamera = $("mapCamera").value;
  const oldStand = $("mapStand").value;
  const oldDeer = $("mapDeer").value;

  $("mapCamera").innerHTML =
    '<option value="">Choose camera…</option>' +
    cams
      .map(c => `<option value="${c.id}">${c.name}</option>`)
      .join("");

  $("mapStand").innerHTML =
    '<option value="">Choose stand…</option>' +
    propertyStands
      .map(s => `<option value="${s.id}">${s.name}</option>`)
      .join("");

  $("mapDeer").innerHTML =
    '<option value="">All deer / no movement line</option>' +
    deer
      .map(d => `<option value="${d.id}">${d.nickname || d.deer_code || "Unnamed deer"}</option>`)
      .join("");

  if (cams.some(c => c.id === oldCamera)) {
    $("mapCamera").value = oldCamera;
  }

  if (propertyStands.some(s => s.id === oldStand)) {
    $("mapStand").value = oldStand;
  }

  if (deer.some(d => d.id === oldDeer)) {
    $("mapDeer").value = oldDeer;
  }

  if ($("placementMessage")) {
    if (!propertyId) {
      $("placementMessage").textContent =
        "Choose a property. The satellite map will stay visible.";
    } else if (!cams.length) {
      $("placementMessage").textContent =
        "Property loaded, but it has no cameras yet. Create a camera in My Deer Intelligence.";
    } else {
      $("placementMessage").textContent =
        `${cams.length} camera${cams.length === 1 ? "" : "s"} loaded for this property. Choose one and click Place Camera.`;
    }
  }
}'''

# Careful: regex finds first syncAreaSelectors and should stop at its closing brace, no nested braces? It has nested template maps only.
text, n = pattern.subn(new_sync, text, count=1)
if n != 1:
    raise RuntimeError(f"syncAreaSelectors replace failed {n}")

# 6) Make property change reload cameras from Supabase and never destroy map.
old_listener = '''    $("mapProperty").addEventListener("change", () => {
      syncAreaSelectors();
      renderAreaMap();
    });'''

new_listener = '''    $("mapProperty").addEventListener("change", async () => {
      const propertyId = $("mapProperty").value;

      if (propertyId) {
        localStorage.setItem("hose_area_property_id", propertyId);
      } else {
        localStorage.removeItem("hose_area_property_id");
      }

      // Refresh directly from Supabase so cameras created on the first tab
      // always appear here.
      await reloadAreaIntelligenceData();

      // reloadAreaIntelligenceData rebuilds arrays; keep the user's property selected.
      if (propertyId && properties.some(p => p.id === propertyId)) {
        $("mapProperty").value = propertyId;
      }

      syncAreaSelectors();
      renderAreaMap();

      setTimeout(() => areaMap?.invalidateSize(), 100);
    });'''

if old_listener not in text:
    raise RuntimeError("mapProperty listener missing")
text = text.replace(old_listener, new_listener, 1)

# 7) Make camera/stand saves scoped to user and reload from server after successful write.
old_cam_save = '''async function saveCameraLocation(id, lat, lon) {
  const { error } = await sb.from("cameras").update({ lat, lon }).eq("id", id);
  if (error) {
    $("placementMessage").textContent = error.message;
    return;
  }

  const row = cameras.find(c => c.id === id);
  if (row) { row.lat = lat; row.lon = lon; }
  $("placementMessage").textContent = "Camera location saved. HOSE can now tie its sightings to this exact area.";
  renderAreaMap();
}'''

new_cam_save = '''async function saveCameraLocation(id, lat, lon) {
  const { data, error } = await sb
    .from("cameras")
    .update({ lat, lon })
    .eq("id", id)
    .eq("user_id", currentUser.id)
    .select()
    .single();

  if (error) {
    $("placementMessage").textContent =
      "Could not save camera location: " + error.message;
    return;
  }

  await loadCameras();
  syncAreaSelectors();

  $("placementMessage").textContent =
    `📷 ${data.name || "Camera"} location saved to Supabase.`;

  renderAreaMap();
}'''

if old_cam_save not in text:
    raise RuntimeError("camera save block missing")
text = text.replace(old_cam_save, new_cam_save, 1)

old_stand_save = '''async function saveStandLocation(id, lat, lon) {
  const { error } = await sb.from("stands").update({ lat, lon }).eq("id", id);
  if (error) {
    $("placementMessage").textContent = error.message;
    return;
  }

  const row = stands.find(s => s.id === id);
  if (row) { row.lat = lat; row.lon = lon; }
  $("placementMessage").textContent = "Stand location saved.";
  renderAreaMap();
}'''

new_stand_save = '''async function saveStandLocation(id, lat, lon) {
  const { data, error } = await sb
    .from("stands")
    .update({ lat, lon })
    .eq("id", id)
    .eq("user_id", currentUser.id)
    .select()
    .single();

  if (error) {
    $("placementMessage").textContent =
      "Could not save stand location: " + error.message;
    return;
  }

  await loadStands();
  syncAreaSelectors();

  $("placementMessage").textContent =
    `🌲 ${data.name || "Stand"} location saved to Supabase.`;

  renderAreaMap();
}'''

if old_stand_save not in text:
    raise RuntimeError("stand save block missing")
text = text.replace(old_stand_save, new_stand_save, 1)

# 8) Make placement visually obvious.
text = text.replace(
'''  placementMode = { type: "camera", id };
  const row = cameras.find(c => c.id === id);
  $("placementMessage").textContent = `Click the real location of ${row?.name || "the camera"} on the map.`;''',
'''  placementMode = { type: "camera", id };
  const row = cameras.find(c => c.id === id);

  $("areaMap").style.cursor = "crosshair";

  $("placementMessage").textContent =
    `📷 PLACING ${row?.name || "CAMERA"} — click its exact location on the satellite image.`;''',
1
)

text = text.replace(
'''  placementMode = { type: "stand", id };
  const row = stands.find(s => s.id === id);
  $("placementMessage").textContent = `Click the real location of ${row?.name || "the stand"} on the map.`;''',
'''  placementMode = { type: "stand", id };
  const row = stands.find(s => s.id === id);

  $("areaMap").style.cursor = "crosshair";

  $("placementMessage").textContent =
    `🌲 PLACING ${row?.name || "STAND"} — click its exact location on the satellite image.`;''',
1
)

text = text.replace(
'''  placementMode = null;
}''',
'''  placementMode = null;

  if ($("areaMap")) {
    $("areaMap").style.cursor = "";
  }
}''',
1
)

# Build output.
outdir = Path("/mnt/data/HOSE_property_satellite_persistence_fix")
if outdir.exists():
    shutil.rmtree(outdir)
outdir.mkdir()

app_out = outdir / "app.js"
app_out.write_text(text, encoding="utf-8")

readme = """HOSE PROPERTY + SATELLITE + PERSISTENCE FIX

This update replaces ONLY public/app.js.

IMPORTANT:
- DELETE public/area-map-fix.js if it still exists.
- REMOVE the area-map-fix.js <script> line from index.html if you added it earlier.
- DO NOT change the process-deer-photo Edge Function.
- DO NOT change Supabase SQL for this update.
- KEEP supabase-config.js.

STEPS
1. Replace public/app.js with this app.js.
2. In index.html, make the app line:
   <script src="app.js?v=20260824-property-fix1"></script>
3. Confirm there is NO area-map-fix.js script below it.
4. Commit/deploy.

WHAT IS DIFFERENT
- Area Intelligence reloads properties directly from Supabase every time you open the tab.
- Queries are explicitly filtered to the signed-in user's user_id.
- The last selected Area property is remembered.
- Selecting a property reloads cameras from Supabase before rebuilding the Camera dropdown.
- Satellite / aerial imagery is the default Area map.
- Street Map is optional in the layer switcher.
- Place Camera changes the map cursor to a crosshair.
- Clicking the imagery writes camera lat/lon to Supabase.
- Camera location is then reloaded from Supabase, proving it persisted.
- Same behavior for stands.
- Choosing a property does not remove the map.

FIRST TEST
1. Sign in.
2. My Deer Intelligence: verify your existing property and camera are visible.
3. Area Intelligence.
4. Property dropdown should contain the same property.
5. Select it.
6. Camera dropdown should contain the same camera.
7. Click Place Camera.
8. Click exact camera location on satellite imagery.
9. Switch tabs and return.
10. Refresh and return.
The pin should remain.
"""

(outdir / "README-FIRST.txt").write_text(readme, encoding="utf-8")

check = subprocess.run(["node", "--check", str(app_out)], capture_output=True, text=True)
if check.returncode != 0:
    raise RuntimeError(check.stderr)

zip_path = Path("/mnt/data/HOSE_property_satellite_persistence_fix.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(app_out, "app.js")
    z.write(outdir / "README-FIRST.txt", "README-FIRST.txt")

print("JavaScript syntax: OK")
print(f"Created: {zip_path}")
