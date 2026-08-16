const $ = id => document.getElementById(id);
const rad = d => d * Math.PI / 180;

let cfg = {};
let publicLands = [];
let observations = [];
let outsideProfiles = [];

let map = null;
let layerGroup = null;
let searchCircle = null;
let searchMarker = null;

let sb = null;
let currentUser = null;
let properties = [];
let cameras = [];
let deerProfiles = [];

/* ------------------------------------------------------------
   SUPABASE
------------------------------------------------------------ */

function initSupabase() {
  const c = window.HOSE_SUPABASE || {};

  if (
    !c.url ||
    !c.publishableKey ||
    c.url.includes("PASTE_") ||
    c.publishableKey.includes("PASTE_")
  ) {
    $("authMessage").textContent =
      "Supabase is not configured yet. Fill in public/supabase-config.js.";
    return false;
  }

  sb = window.supabase.createClient(c.url, c.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  return true;
}

async function restoreSession() {
  if (!sb) return;

  const { data, error } = await sb.auth.getSession();

  if (error) {
    $("authMessage").textContent = error.message;
    return;
  }

  await applySession(data.session);

  sb.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

async function applySession(session) {
  currentUser = session?.user || null;

  $("signedOutPanel").classList.toggle("hidden", !!currentUser);
  $("signedInPanel").classList.toggle("hidden", !currentUser);
  $("signOutBtn").classList.toggle("hidden", !currentUser);
  $("privatePortal").classList.toggle("hidden", !currentUser);

  if (!currentUser) {
    $("authTitle").textContent = "Sign in / Create account";
    $("signedInEmail").textContent = "";
    clearPrivateUi();
    return;
  }

  $("authTitle").textContent = "Signed in";
  $("signedInEmail").textContent = currentUser.email || currentUser.id;
  $("authMessage").textContent = "";

  await refreshPrivateData();
}

async function signIn() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    $("authMessage").textContent = "Enter email and password.";
    return;
  }

  $("authMessage").textContent = "Signing in…";

  const { error } = await sb.auth.signInWithPassword({ email, password });

  $("authMessage").textContent = error ? error.message : "Signed in.";
}

async function signUp() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    $("authMessage").textContent = "Enter email and password.";
    return;
  }

  $("authMessage").textContent = "Creating account…";

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) {
    $("authMessage").textContent = error.message;
    return;
  }

  if (!data.session) {
    $("authMessage").textContent =
      "Account created. Check your email to confirm it, then return and sign in.";
  } else {
    $("authMessage").textContent = "Account created and signed in.";
  }
}

async function signOut() {
  await sb.auth.signOut();
}

/* ------------------------------------------------------------
   PRIVATE CRUD
------------------------------------------------------------ */

async function refreshPrivateData() {
  if (!currentUser) return;

  await Promise.all([
    loadProperties(),
    loadCameras(),
    loadDeerProfiles()
  ]);

  renderPrivate();
  await loadRecentPhotos();
}

async function loadProperties() {
  const { data, error } = await sb
    .from("properties")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    $("propertyMessage").textContent = error.message;
    return;
  }

  properties = data || [];
}

async function loadCameras() {
  const { data, error } = await sb
    .from("cameras")
    .select("*, camera_features(feature_type)")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    $("cameraMessage").textContent = error.message;
    return;
  }

  cameras = data || [];
}

async function loadDeerProfiles() {
  const { data, error } = await sb
    .from("deer_profiles")
    .select("*")
    .order("last_seen", { ascending: false });

  if (error) {
    console.error(error);
    deerProfiles = [];
    return;
  }

  deerProfiles = data || [];
}

async function addProperty() {
  if (!currentUser) return;

  const name = $("propertyName").value.trim();

  if (!name) {
    $("propertyMessage").textContent = "Property name is required.";
    return;
  }

  const payload = {
    user_id: currentUser.id,
    name,
    county: $("propertyCounty").value.trim() || null,
    state: $("propertyState").value.trim() || "AL",
    acreage: $("propertyAcres").value
      ? Number($("propertyAcres").value)
      : null
  };

  $("propertyMessage").textContent = "Saving…";

  const { error } = await sb.from("properties").insert(payload);

  if (error) {
    $("propertyMessage").textContent = error.message;
    return;
  }

  $("propertyName").value = "";
  $("propertyAcres").value = "";
  $("propertyCounty").value = "";

  $("propertyMessage").textContent = "Property added.";
  await refreshPrivateData();
}

async function addCamera() {
  if (!currentUser) return;

  const propertyId = $("propertySelect").value;
  const name = $("cameraName").value.trim();

  if (!propertyId) {
    $("cameraMessage").textContent = "Choose a property first.";
    return;
  }

  if (!name) {
    $("cameraMessage").textContent = "Camera name is required.";
    return;
  }

  const cameraPayload = {
    user_id: currentUser.id,
    property_id: propertyId,
    name,
    facing: $("cameraFacing").value,
    primary_habitat: $("primaryHabitat").value,
    notes: $("cameraNotes").value.trim() || null
  };

  $("cameraMessage").textContent = "Saving…";

  const { data, error } = await sb
    .from("cameras")
    .insert(cameraPayload)
    .select()
    .single();

  if (error) {
    $("cameraMessage").textContent = error.message;
    return;
  }

  const features = Array.from(
    document.querySelectorAll(".habitat-options input:checked")
  ).map(x => x.value);

  if (features.length) {
    const featureRows = features.map(feature => ({
      user_id: currentUser.id,
      camera_id: data.id,
      feature_type: feature
    }));

    const { error: featureError } = await sb
      .from("camera_features")
      .insert(featureRows);

    if (featureError) {
      $("cameraMessage").textContent =
        "Camera saved, but features failed: " + featureError.message;
    }
  }

  $("cameraName").value = "";
  $("cameraNotes").value = "";
  document.querySelectorAll(".habitat-options input").forEach(x => {
    x.checked = false;
  });

  $("cameraMessage").textContent = "Camera added.";
  await refreshPrivateData();
}

async function renameDeer(profileId, currentName) {
  const nickname = prompt("Deer nickname:", currentName || "");

  if (nickname === null) return;

  const { error } = await sb
    .from("deer_profiles")
    .update({ nickname: nickname.trim() || null })
    .eq("id", profileId);

  if (error) {
    alert(error.message);
    return;
  }

  await loadDeerProfiles();
  renderDeerProfiles();
}

/* ------------------------------------------------------------
   PHOTO UPLOAD
------------------------------------------------------------ */

function safeFileName(name) {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
}

function renderSelectedPreviews(files) {
  const section = $("photoPreviewSection");
  const grid = $("photoPreviewGrid");

  grid.innerHTML = "";

  if (!files.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");

  Array.from(files).slice(0, 100).forEach(file => {
    const url = URL.createObjectURL(file);

    const item = document.createElement("div");
    item.className = "photo-item";
    item.innerHTML = `
      <img src="${url}" alt="">
      <div class="photo-name">${file.name}</div>
    `;

    grid.appendChild(item);
  });
}

async function uploadPhotos() {
  if (!currentUser) return;

  const propertyId = $("uploadProperty").value;
  const cameraId = $("uploadCamera").value;
  const files = Array.from($("photoUpload").files);

  if (!propertyId || !cameraId) {
    $("uploadProgress").textContent =
      "Choose both a property and camera.";
    return;
  }

  if (!files.length) {
    $("uploadProgress").textContent = "Select photos first.";
    return;
  }

  $("processUploadBtn").disabled = true;

  let success = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    $("uploadProgress").textContent =
      `Uploading ${i + 1} of ${files.length}: ${file.name}`;

    const fileId = crypto.randomUUID();
    const path =
      `${currentUser.id}/${propertyId}/${cameraId}/${fileId}-${safeFileName(file.name)}`;

    const { error: uploadError } = await sb.storage
      .from("trail-camera-photos")
      .upload(path, file, {
        contentType: file.type || "image/jpeg",
        cacheControl: "3600",
        upsert: false
      });

    if (uploadError) {
      console.error(uploadError);
      failed++;
      continue;
    }

    const capturedAt =
      file.lastModified
        ? new Date(file.lastModified).toISOString()
        : null;

    const { error: rowError } = await sb
      .from("trail_photos")
      .insert({
        user_id: currentUser.id,
        property_id: propertyId,
        camera_id: cameraId,
        storage_path: path,
        original_filename: file.name,
        captured_at: capturedAt,
        processing_status: "queued"
      });

    if (rowError) {
      console.error(rowError);

      // Best-effort cleanup if metadata insert fails.
      await sb.storage
        .from("trail-camera-photos")
        .remove([path]);

      failed++;
      continue;
    }

    success++;
  }

  $("uploadProgress").textContent =
    `Done. ${success} uploaded${failed ? `, ${failed} failed` : ""}. ` +
    `Uploaded photos are now queued for AI processing.`;

  $("processUploadBtn").disabled = false;
  $("photoUpload").value = "";
  $("uploadCount").textContent = "0 files selected";
  $("photoPreviewGrid").innerHTML = "";
  $("photoPreviewSection").classList.add("hidden");

  await loadRecentPhotos();
}

async function loadRecentPhotos() {
  if (!currentUser) return;

  const propertyId = $("uploadProperty").value || null;

  let query = sb
    .from("trail_photos")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(24);

  if (propertyId) {
    query = query.eq("property_id", propertyId);
  }

  const { data, error } = await query;

  if (error) {
    $("recentPhotos").innerHTML =
      `<div class="muted">${error.message}</div>`;
    return;
  }

  const rows = data || [];

  if (!rows.length) {
    $("recentPhotos").innerHTML =
      '<div class="muted">No uploaded photos yet.</div>';
    return;
  }

  const cards = [];

  for (const row of rows) {
    const { data: signed, error: signedError } = await sb.storage
      .from("trail-camera-photos")
      .createSignedUrl(row.storage_path, 3600);

    if (signedError) {
      console.error(signedError);
      continue;
    }

    cards.push(`
      <div class="photo-item">
        <img src="${signed.signedUrl}" alt="">
        <div class="photo-name">${row.original_filename || "Trail photo"}</div>
        <div class="small muted">${row.processing_status}</div>
      </div>
    `);
  }

  $("recentPhotos").innerHTML =
    cards.join("") || '<div class="muted">No accessible photos.</div>';
}

/* ------------------------------------------------------------
   PRIVATE RENDER
------------------------------------------------------------ */

function renderPrivate() {
  renderPropertySelectors();
  renderCameraSelectors();
  renderCameras();
  renderDeerProfiles();
}

function renderPropertySelectors() {
  const options = properties.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join("");

  const selectedMain = $("propertySelect").value;
  const selectedUpload = $("uploadProperty").value;

  $("propertySelect").innerHTML =
    '<option value="">Choose property…</option>' + options;

  $("uploadProperty").innerHTML =
    '<option value="">Choose property…</option>' + options;

  if (properties.some(p => p.id === selectedMain)) {
    $("propertySelect").value = selectedMain;
  } else if (properties.length === 1) {
    $("propertySelect").value = properties[0].id;
  }

  if (properties.some(p => p.id === selectedUpload)) {
    $("uploadProperty").value = selectedUpload;
  } else if (properties.length === 1) {
    $("uploadProperty").value = properties[0].id;
  }
}

function camerasForProperty(propertyId) {
  if (!propertyId) return cameras;
  return cameras.filter(c => c.property_id === propertyId);
}

function renderCameraSelectors() {
  const propertyId = $("uploadProperty").value;
  const rows = camerasForProperty(propertyId);

  $("uploadCamera").innerHTML =
    '<option value="">Choose camera…</option>' +
    rows.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

function renderCameras() {
  if (!cameras.length) {
    $("cameraCards").innerHTML =
      '<div class="muted">No cameras yet.</div>';
    return;
  }

  $("cameraCards").innerHTML = cameras.map(c => {
    const features = (c.camera_features || [])
      .map(f => `<span class="meta-chip">${f.feature_type}</span>`)
      .join("");

    return `
      <div class="stack-item">
        <div class="stack-item-head">
          <div>
            <strong>📷 ${c.name}</strong>
            <div class="small muted">
              ${c.primary_habitat || "Habitat not set"}
              ${c.facing ? ` · Facing ${c.facing}` : ""}
            </div>
          </div>
        </div>
        <div class="meta-row">${features}</div>
      </div>
    `;
  }).join("");
}

function renderDeerProfiles() {
  if (!deerProfiles.length) {
    $("deerCards").innerHTML =
      '<div class="muted">No AI-created deer profiles yet.</div>';
    return;
  }

  $("deerCards").innerHTML = deerProfiles.map(d => `
    <div class="stack-item">
      <div class="stack-item-head">
        <div>
          <strong>🦌 ${d.nickname || d.deer_code || "Unnamed deer"}</strong>
          <div class="small muted">
            ${d.sex || "unknown"} · ${d.sighting_count || 0} sightings
          </div>
        </div>
        <button
          class="secondary mini"
          type="button"
          onclick="renameDeer('${d.id}', ${JSON.stringify(d.nickname || "")})"
        >
          Rename
        </button>
      </div>

      ${
        d.antler_signature
          ? `<p class="small">${d.antler_signature}</p>`
          : ""
      }
    </div>
  `).join("");
}

function clearPrivateUi() {
  properties = [];
  cameras = [];
  deerProfiles = [];

  $("propertySelect").innerHTML =
    '<option value="">Choose property…</option>';

  $("uploadProperty").innerHTML =
    '<option value="">Choose property…</option>';

  $("uploadCamera").innerHTML =
    '<option value="">Choose camera…</option>';

  $("cameraCards").innerHTML = "";
  $("deerCards").innerHTML = "";
  $("recentPhotos").innerHTML = "";
}

/* ------------------------------------------------------------
   OUTSIDE MAP
------------------------------------------------------------ */

async function loadJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    return fallback;
  }
}

function miles(aLat, aLon, bLat, bLon) {
  const R = 3958.7613;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) *
    Math.cos(rad(bLat)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

async function geocode(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" +
    encodeURIComponent(q);

  const r = await fetch(url);
  const d = await r.json();

  if (!d.length) throw new Error("Location not found.");

  return {
    lat: Number(d[0].lat),
    lon: Number(d[0].lon),
    label: d[0].display_name
  };
}

function initMapSafe() {
  if (typeof L === "undefined") {
    $("status").textContent = "Map library failed to load.";
    return;
  }

  map = L.map("map").setView([32.8, -86.8], 7);

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);

  layerGroup = L.layerGroup().addTo(map);
}

function fillControls() {
  (cfg.radius_options || [1, 3, 5, 10, 15, 25, 50]).forEach(radius => {
    const o = document.createElement("option");
    o.value = radius;
    o.textContent = radius + " miles";

    if (radius === (cfg.default_radius_miles || 5)) {
      o.selected = true;
    }

    $("radius").appendChild(o);
  });

  const groups = {};

  publicLands.forEach(p => {
    (groups[p.type] ??= []).push(p);
  });

  Object.keys(groups).sort().forEach(type => {
    const group = document.createElement("optgroup");
    group.label = type;

    groups[type]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(p => {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.name;
        group.appendChild(o);
      });

    $("publicLand").appendChild(group);
  });
}

async function resolveSearchPoint() {
  const landId = $("publicLand").value;

  if (landId) {
    const land = publicLands.find(x => x.id === landId);

    if (land.lat != null && land.lon != null) {
      return {
        lat: Number(land.lat),
        lon: Number(land.lon),
        label: land.name
      };
    }

    return geocode(land.search_label || land.name + ", Alabama");
  }

  const q = $("address").value.trim();
  if (!q) throw new Error("Enter an address/ZIP or select public land.");

  return geocode(q);
}

function publicLandText(o) {
  if (
    o.nearest_public_land &&
    o.nearest_public_land_distance_miles != null
  ) {
    return `${Number(o.nearest_public_land_distance_miles).toFixed(2)} mi to ${o.nearest_public_land}`;
  }

  return o.nearest_public_land
    ? `Near ${o.nearest_public_land}`
    : "Public-land distance not calculated yet";
}

function deerIcon() {
  return L.divIcon({
    className: "",
    html:
      '<div style="width:40px;height:40px;border-radius:50%;background:#152019;border:2px solid #a5be86;display:flex;align-items:center;justify-content:center;font-size:23px">🦌</div>',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
}

function renderMapResults(center) {
  if (!map || !layerGroup) return;

  const radius = Number($("radius").value);
  const minAcres = Number($("minAcres").value || 0);

  const rows = observations
    .filter(o =>
      o.confirmed === true &&
      Number(o.acres || 0) >= minAcres &&
      Number.isFinite(Number(o.lat)) &&
      Number.isFinite(Number(o.lon))
    )
    .map(o => ({
      ...o,
      distance_miles: miles(
        center.lat,
        center.lon,
        Number(o.lat),
        Number(o.lon)
      )
    }))
    .filter(o => o.distance_miles <= radius);

  layerGroup.clearLayers();

  if (searchMarker) map.removeLayer(searchMarker);
  if (searchCircle) map.removeLayer(searchCircle);

  searchMarker = L.marker([center.lat, center.lon]).addTo(map);
  searchCircle = L.circle(
    [center.lat, center.lon],
    { radius: radius * 1609.344 }
  ).addTo(map);

  rows.forEach(o => {
    L.marker([o.lat, o.lon], { icon: deerIcon() })
      .addTo(layerGroup)
      .bindPopup(`
        <b>🦌 ${o.deer_count || 1} deer confirmed</b><br>
        ♂ ${o.buck_count || 0} bucks · ♀ ${o.doe_count || 0} does<br>
        ${publicLandText(o)}
        ${
          o.listing_url
            ? `<p><a href="${o.listing_url}" target="_blank" rel="noopener">View original listing</a></p>`
            : ""
        }
      `);
  });

  map.fitBounds(searchCircle.getBounds());

  $("mObs").textContent = rows.length;
  $("mDeer").textContent = rows.reduce(
    (n, o) => n + Number(o.deer_count || 1),
    0
  );
  $("mProfiles").textContent =
    new Set(rows.map(o => o.deer_id).filter(Boolean)).size;
  $("mHarvested").textContent =
    rows.filter(o => ["reported", "verified"].includes(o.harvest_status)).length;

  $("status").textContent =
    `${rows.length} confirmed observations within ${radius} miles of ${center.label}.`;

  $("results").innerHTML =
    rows.map(o => `
      <div class="card">
        <b>🦌 ${o.deer_count || 1} deer confirmed</b>
        <p>
          ♂ ${o.buck_count || 0} bucks ·
          ♀ ${o.doe_count || 0} does ·
          ${publicLandText(o)}
        </p>
        ${
          o.listing_url
            ? `<a href="${o.listing_url}" target="_blank" rel="noopener">View original listing</a>`
            : ""
        }
      </div>
    `).join("")
    ||
    '<div class="panel">No confirmed outside observations match this search.</div>';
}

async function doSearch() {
  $("status").textContent = "Resolving location…";

  try {
    renderMapResults(await resolveSearchPoint());
  } catch (e) {
    $("status").textContent = e.message;
  }
}

/* ------------------------------------------------------------
   INIT
------------------------------------------------------------ */

async function init() {
  [cfg, publicLands, observations, outsideProfiles] = await Promise.all([
    loadJson("config.json", {
      default_radius_miles: 5,
      radius_options: [1, 3, 5, 10, 15, 25, 50]
    }),
    loadJson("public_lands.json", []),
    loadJson("observations.json", []),
    loadJson("deer_profiles.json", [])
  ]);

  fillControls();
  initMapSafe();

  $("searchBtn").addEventListener("click", doSearch);

  $("address").addEventListener("keydown", e => {
    if (e.key === "Enter") doSearch();
  });

  $("signInBtn").addEventListener("click", signIn);
  $("signUpBtn").addEventListener("click", signUp);
  $("signOutBtn").addEventListener("click", signOut);

  $("addPropertyBtn").addEventListener("click", addProperty);
  $("addCameraBtn").addEventListener("click", addCamera);

  $("propertySelect").addEventListener("change", () => {
    $("uploadProperty").value = $("propertySelect").value;
    renderCameraSelectors();
    loadRecentPhotos();
  });

  $("uploadProperty").addEventListener("change", () => {
    renderCameraSelectors();
    loadRecentPhotos();
  });

  $("photoUpload").addEventListener("change", e => {
    const files = e.target.files;

    $("uploadCount").textContent =
      `${files.length} file${files.length === 1 ? "" : "s"} selected`;

    renderSelectedPreviews(files);
  });

  $("processUploadBtn").addEventListener("click", uploadPhotos);
  $("refreshPhotosBtn").addEventListener("click", loadRecentPhotos);

  if (initSupabase()) {
    await restoreSession();
  }
}

window.renameDeer = renameDeer;

document.addEventListener("DOMContentLoaded", init);
