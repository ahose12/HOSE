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
let stands = [];
let sightings = [];

let areaMap = null;
let areaLayer = null;
let movementLayer = null;
let placementMode = null;


/* ============================================================
   SUPABASE
   ============================================================ */

function authMessage(message) {
  const el = $("authMessage");
  if (el) el.textContent = message || "";
}


function initSupabase() {
  try {
    const config = window.HOSE_SUPABASE || {};

    const projectUrl =
      config.url;

    const publicKey =
      config.publishableKey ||
      config.anonKey ||
      config.key;

    if (
      !projectUrl ||
      !publicKey ||
      typeof projectUrl !== "string" ||
      typeof publicKey !== "string"
    ) {
      authMessage(
        "Supabase config was not found. Check public/supabase-config.js."
      );

      console.error(
        "HOSE Supabase config missing.",
        {
          hasUrl: !!projectUrl,
          hasPublishableKey: !!config.publishableKey,
          hasAnonKey: !!config.anonKey,
          hasKey: !!config.key
        }
      );

      return false;
    }

    if (!window.supabase?.createClient) {
      authMessage(
        "Supabase library did not load. Refresh the page and try again."
      );
      console.error("window.supabase.createClient is unavailable.");
      return false;
    }

    sb = window.supabase.createClient(
      projectUrl.trim(),
      publicKey.trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    console.log("HOSE Supabase client initialized.");

    authMessage(
      "Account services ready."
    );

    return true;

  } catch (error) {
    console.error("HOSE Supabase initialization error:", error);
    authMessage(
      "Could not initialize account services: " +
      (error?.message || String(error))
    );
    return false;
  }
}


function showSignedOut() {
  currentUser = null;

  if ($("authGate")) {
    $("authGate").classList.remove("hidden");
  }

  if ($("appShell")) {
    $("appShell").classList.add("hidden");
  }

  if ($("signedInEmail")) {
    $("signedInEmail").textContent = "";
  }

  clearPrivateUi();
}


async function showSignedIn(session) {
  currentUser = session?.user || null;

  if (!currentUser) {
    showSignedOut();
    return;
  }

  if ($("authGate")) {
    $("authGate").classList.add("hidden");
  }

  if ($("appShell")) {
    $("appShell").classList.remove("hidden");
  }

  if ($("signedInEmail")) {
    $("signedInEmail").textContent =
      currentUser.email || currentUser.id;
  }

  /*
   * Do NOT make authentication depend on property/map loading.
   * The user is signed in now. Secondary data can fail independently.
   */
  try {
    await refreshPrivateData();
  } catch (error) {
    console.error(
      "HOSE signed-in data refresh error:",
      error
    );
  }
}


async function restoreSession() {
  if (!sb) {
    showSignedOut();
    return;
  }

  try {
    const { data, error } =
      await sb.auth.getSession();

    if (error) {
      console.error(
        "HOSE session restore error:",
        error
      );
      authMessage(error.message);
      showSignedOut();
    } else if (data?.session) {
      await showSignedIn(data.session);
    } else {
      showSignedOut();
    }
  } catch (error) {
    console.error(
      "HOSE session restore exception:",
      error
    );
    showSignedOut();
  }

  /*
   * Keep the auth callback lightweight.
   * Defer database/map work until after Supabase finishes the auth event.
   */
  sb.auth.onAuthStateChange(
    (_event, session) => {
      setTimeout(() => {
        if (session) {
          showSignedIn(session);
        } else {
          showSignedOut();
        }
      }, 0);
    }
  );
}


async function signIn() {
  if (!sb) {
    authMessage(
      "Account service is not initialized. Refresh the page."
    );
    return;
  }

  const email =
    $("authEmail")?.value?.trim() || "";

  const password =
    $("authPassword")?.value || "";

  if (!email || !password) {
    authMessage(
      "Enter email and password."
    );
    return;
  }

  const button =
    $("signInBtn");

  if (button) {
    button.disabled = true;
  }

  authMessage(
    "Signing in…"
  );

  try {
    const {
      data,
      error
    } =
      await sb.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      console.error(
        "HOSE sign in error:",
        error
      );
      authMessage(
        error.message
      );
      return;
    }

    authMessage(
      "Signed in."
    );

    if (data?.session) {
      await showSignedIn(
        data.session
      );
    }

  } catch (error) {
    console.error(
      "HOSE sign in exception:",
      error
    );

    authMessage(
      error?.message ||
      "Sign in failed."
    );

  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}


async function signUp() {
  if (!sb) {
    authMessage(
      "Account service is not initialized. Refresh the page."
    );
    return;
  }

  const email =
    $("authEmail")?.value?.trim() || "";

  const password =
    $("authPassword")?.value || "";

  if (!email || !password) {
    authMessage(
      "Enter email and password."
    );
    return;
  }

  const button =
    $("signUpBtn");

  if (button) {
    button.disabled = true;
  }

  authMessage(
    "Creating account…"
  );

  try {
    const {
      data,
      error
    } =
      await sb.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo:
            window.location.origin +
            window.location.pathname
        }
      });

    if (error) {
      console.error(
        "HOSE sign up error:",
        error
      );

      authMessage(
        error.message
      );
      return;
    }

    if (data?.session) {
      authMessage(
        "Account created and signed in."
      );

      await showSignedIn(
        data.session
      );

    } else {
      authMessage(
        "Account created. Check your email to confirm your address, then sign in."
      );
    }

  } catch (error) {
    console.error(
      "HOSE sign up exception:",
      error
    );

    authMessage(
      error?.message ||
      "Account creation failed."
    );

  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}


async function signOut() {
  if (!sb) {
    showSignedOut();
    return;
  }

  try {
    await sb.auth.signOut();
  } catch (error) {
    console.error(
      "HOSE sign out error:",
      error
    );
  }

  showSignedOut();
}


/* ============================================================
   TABS
   ============================================================ */

function setupTabs() {
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
}


/* ============================================================
   PRIVATE DATA
   ============================================================ */

async function refreshPrivateData() {
  if (!currentUser || !sb) {
    return;
  }

  const results =
    await Promise.allSettled([
      loadProperties(),
      loadCameras(),
      loadDeerProfiles(),
      loadStands(),
      loadSightings()
    ]);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        "HOSE private loader failed:",
        index,
        result.reason
      );
    }
  });

  try {
    renderPrivate();
  } catch (error) {
    console.error(
      "HOSE private render error:",
      error
    );
  }

  try {
    if ($("mapProperty")) {
      syncAreaSelectors();
    }
  } catch (error) {
    console.error(
      "HOSE Area selector render error:",
      error
    );
  }

  try {
    if ($("recentPhotos")) {
      await loadRecentPhotos();
    }
  } catch (error) {
    console.error(
      "HOSE recent-photo render error:",
      error
    );
  }

  try {
    if (areaMap) {
      renderAreaMap();
    }
  } catch (error) {
    console.error(
      "HOSE Area map render error:",
      error
    );
  }
}


async function loadProperties() {
  const { data, error } =
    await sb
      .from("properties")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", {
        ascending: true
      });

  if (error) {
    if ($("propertyMessage")) {
      $("propertyMessage").textContent =
        error.message;
    }
    return;
  }

  properties = data || [];
}


async function loadCameras() {
  const { data, error } =
    await sb
      .from("cameras")
      .select(
        "*, camera_features(feature_type)"
      )
      .eq("user_id", currentUser.id)
      .eq("active", true)
      .order("created_at", {
        ascending: true
      });

  if (error) {
    if ($("cameraMessage")) {
      $("cameraMessage").textContent =
        error.message;
    }
    return;
  }

  cameras = data || [];
}


async function loadDeerProfiles() {
  const { data, error } =
    await sb
      .from("deer_profiles")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("last_seen", {
        ascending: false
      });

  if (error) {
    console.error(error);
    deerProfiles = [];
    return;
  }

  deerProfiles = data || [];
}


async function loadStands() {
  const { data, error } = await sb
    .from("stands")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Stand load failed:", error);
    stands = [];
    return;
  }

  stands = data || [];
}


async function loadSightings() {
  const { data, error } = await sb
    .from("sightings")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("captured_at", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("Sightings load failed:", error);
    sightings = [];
    return;
  }

  sightings = data || [];
}


async function addProperty() {
  const name =
    $("propertyName").value.trim();

  if (!name) {
    $("propertyMessage").textContent =
      "Property name is required.";
    return;
  }

  const { error } =
    await sb
      .from("properties")
      .insert({
        user_id: currentUser.id,
        name,
        county:
          $("propertyCounty").value.trim()
          || null,
        state:
          $("propertyState").value.trim()
          || "AL",
        acreage:
          $("propertyAcres").value
            ? Number(
                $("propertyAcres").value
              )
            : null
      });

  if (error) {
    if ($("propertyMessage")) {
      $("propertyMessage").textContent =
        error.message;
    }
    return;
  }

  $("propertyMessage").textContent =
    "Property added.";

  $("propertyName").value = "";
  $("propertyAcres").value = "";
  $("propertyCounty").value = "";

  await refreshPrivateData();
}


async function addCamera() {
  const propertyId =
    $("propertySelect").value;

  const name =
    $("cameraName").value.trim();

  if (!propertyId) {
    $("cameraMessage").textContent =
      "Choose a property first.";
    return;
  }

  if (!name) {
    $("cameraMessage").textContent =
      "Camera name is required.";
    return;
  }

  const { data, error } =
    await sb
      .from("cameras")
      .insert({
        user_id: currentUser.id,
        property_id: propertyId,
        name,
        facing:
          $("cameraFacing").value,
        primary_habitat:
          $("primaryHabitat").value,
        notes:
          $("cameraNotes").value.trim()
          || null
      })
      .select()
      .single();

  if (error) {
    if ($("cameraMessage")) {
      $("cameraMessage").textContent =
        error.message;
    }
    return;
  }

  const features =
    Array.from(
      document.querySelectorAll(
        ".habitat-options input:checked"
      )
    )
    .map(checkbox =>
      checkbox.value
    );

  if (features.length) {
    const featureRows =
      features.map(feature => ({
        user_id: currentUser.id,
        camera_id: data.id,
        feature_type: feature
      }));

    const { error: featureError } =
      await sb
        .from("camera_features")
        .insert(featureRows);

    if (featureError) {
      $("cameraMessage").textContent =
        "Camera saved, but features failed: "
        + featureError.message;
    }
  }

  $("cameraMessage").textContent =
    "Camera added.";

  $("cameraName").value = "";
  $("cameraNotes").value = "";

  document
    .querySelectorAll(
      ".habitat-options input"
    )
    .forEach(checkbox =>
      checkbox.checked = false
    );

  await refreshPrivateData();
}


async function renameDeer(
  deerId,
  currentName
) {
  const nickname =
    prompt(
      "Deer nickname:",
      currentName || ""
    );

  if (nickname === null) {
    return;
  }

  const { error } =
    await sb
      .from("deer_profiles")
      .update({
        nickname:
          nickname.trim() || null
      })
      .eq("id", deerId);

  if (error) {
    alert(error.message);
    return;
  }

  await loadDeerProfiles();
  renderDeerProfiles();
}


/* ============================================================
   AI PROCESSING
   ============================================================ */

async function processPhotoWithAI(photoId) {
  const { data, error } =
    await sb.functions.invoke(
      "process-deer-photo",
      {
        body: {
          photo_id: photoId
        }
      }
    );

  if (error) {
    throw error;
  }

  if (data?.ok === false) {
    throw new Error(
      data.error || "AI processing failed."
    );
  }

  return data;
}


/* ============================================================
   PHOTO UPLOAD
   ============================================================ */

function safeFileName(name) {
  return name
    .replace(
      /[^a-zA-Z0-9._-]+/g,
      "_"
    )
    .replace(
      /_+/g,
      "_"
    )
    .slice(-120);
}


function renderSelectedPreviews(files) {
  const section =
    $("photoPreviewSection");

  const grid =
    $("photoPreviewGrid");

  grid.innerHTML = "";

  if (!files.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");

  Array.from(files)
    .slice(0, 100)
    .forEach(file => {
      const url =
        URL.createObjectURL(file);

      const card =
        document.createElement("div");

      card.className =
        "photo-item";

      card.innerHTML = `
        <img
          src="${url}"
          alt=""
        >

        <div class="photo-name">
          ${file.name}
        </div>
      `;

      grid.appendChild(card);
    });
}


async function uploadPhotos() {
  const propertyId =
    $("uploadProperty").value;

  const cameraId =
    $("uploadCamera").value;

  const files =
    Array.from(
      $("photoUpload").files
    );

  if (!propertyId || !cameraId) {
    $("uploadProgress").textContent =
      "Choose both a property and camera.";
    return;
  }

  if (!files.length) {
    $("uploadProgress").textContent =
      "Select photos first.";
    return;
  }

  $("processUploadBtn").disabled = true;

  let uploaded = 0;
  let analyzed = 0;
  let failed = 0;

  for (
    let i = 0;
    i < files.length;
    i++
  ) {
    const file = files[i];

    try {
      $("uploadProgress").textContent =
        `Uploading ${i + 1} of ${files.length}: ${file.name}`;

      const fileId =
        crypto.randomUUID();

      const path =
        `${currentUser.id}/${propertyId}/${cameraId}/${fileId}-${safeFileName(file.name)}`;

      const {
        error: uploadError
      } =
        await sb.storage
          .from(
            "trail-camera-photos"
          )
          .upload(
            path,
            file,
            {
              contentType:
                file.type
                || "image/jpeg",

              cacheControl:
                "3600",

              upsert:
                false
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      uploaded++;

      const {
        data: photoRow,
        error: rowError
      } =
        await sb
          .from("trail_photos")
          .insert({
            user_id:
              currentUser.id,

            property_id:
              propertyId,

            camera_id:
              cameraId,

            storage_path:
              path,

            original_filename:
              file.name,

            captured_at:
              file.lastModified
                ? new Date(
                    file.lastModified
                  ).toISOString()
                : null,

            processing_status:
              "queued"
          })
          .select()
          .single();

      if (rowError) {
        await sb.storage
          .from(
            "trail-camera-photos"
          )
          .remove([path]);

        throw rowError;
      }

      $("uploadProgress").textContent =
        `Analyzing ${i + 1} of ${files.length}: ${file.name}`;

      const aiResult =
        await processPhotoWithAI(
          photoRow.id
        );

      console.log(
        "HOSE AI RESULT",
        aiResult
      );

      analyzed++;

      if (
        aiResult?.analysis?.deer_present
      ) {
        const a =
          aiResult.analysis;

        $("uploadProgress").textContent =
          `Analyzed ${file.name}: `
          +
          `${a.deer_count} deer, `
          +
          `${a.buck_count} bucks, `
          +
          `${a.doe_count} does, `
          +
          `${a.fawn_count} fawns.`;
      } else {
        $("uploadProgress").textContent =
          `Analyzed ${file.name}: no deer detected.`;
      }

    } catch (error) {
      console.error(
        "Upload / analysis failed:",
        error
      );

      failed++;

      $("uploadProgress").textContent =
        `Problem with ${file.name}: `
        +
        (
          error?.message
          ||
          String(error)
        );
    }
  }

  $("processUploadBtn").disabled =
    false;

  $("photoUpload").value =
    "";

  $("uploadCount").textContent =
    "0 files selected";

  $("photoPreviewGrid").innerHTML =
    "";

  $("photoPreviewSection")
    .classList
    .add("hidden");

  await Promise.all([
    loadRecentPhotos(),
    loadDeerProfiles()
  ]);

  renderDeerProfiles();

  $("uploadProgress").textContent =
    `Finished. ${uploaded} uploaded, `
    +
    `${analyzed} analyzed`
    +
    (
      failed
        ? `, ${failed} failed.`
        : "."
    );
}


async function loadRecentPhotos() {
  if (!currentUser) {
    return;
  }

  let query =
    sb
      .from("trail_photos")
      .select("*")
      .order(
        "uploaded_at",
        {
          ascending: false
        }
      )
      .limit(24);

  const propertyId =
    $("uploadProperty").value;

  if (propertyId) {
    query =
      query.eq(
        "property_id",
        propertyId
      );
  }

  const { data, error } =
    await query;

  if (error) {
    $("recentPhotos").innerHTML =
      `<div class="muted">${error.message}</div>`;
    return;
  }

  const rows =
    data || [];

  if (!rows.length) {
    $("recentPhotos").innerHTML =
      '<div class="muted">No uploaded photos yet.</div>';
    return;
  }

  const cards = [];

  for (const row of rows) {
    const {
      data: signed,
      error: signedError
    } =
      await sb.storage
        .from(
          "trail-camera-photos"
        )
        .createSignedUrl(
          row.storage_path,
          3600
        );

    if (
      signedError ||
      !signed?.signedUrl
    ) {
      continue;
    }

    const analysis =
      row.ai_analysis || null;

    const analysisText =
      analysis
        ? `
          <div class="small">
            ${
              analysis.deer_present
                ? `🦌 ${analysis.deer_count} deer · ♂ ${analysis.buck_count} · ♀ ${analysis.doe_count}`
                : "No deer detected"
            }
          </div>
        `
        : "";

    cards.push(`
      <div class="photo-item">

        <img
          src="${signed.signedUrl}"
          alt=""
        >

        <div class="photo-name">
          ${
            row.original_filename
            || "Trail photo"
          }
        </div>

        <div class="small muted">
          ${row.processing_status}
        </div>

        ${analysisText}

      </div>
    `);
  }

  $("recentPhotos").innerHTML =
    cards.join("")
    ||
    '<div class="muted">No accessible photos.</div>';
}


/* ============================================================
   PRIVATE UI
   ============================================================ */

function renderPrivate() {
  renderPropertySelectors();
  renderCameraSelectors();
  renderCameras();
  renderDeerProfiles();
}


function renderPropertySelectors() {
  const options =
    properties.map(
      property =>
        `<option value="${property.id}">${property.name}</option>`
    )
    .join("");

  $("propertySelect").innerHTML =
    '<option value="">Choose property…</option>'
    + options;

  $("uploadProperty").innerHTML =
    '<option value="">Choose property…</option>'
    + options;

  if (properties.length === 1) {
    $("propertySelect").value =
      properties[0].id;

    $("uploadProperty").value =
      properties[0].id;
  }
}


function camerasForProperty(
  propertyId
) {
  if (!propertyId) {
    return cameras;
  }

  return cameras.filter(
    camera =>
      camera.property_id === propertyId
  );
}


function renderCameraSelectors() {
  const rows =
    camerasForProperty(
      $("uploadProperty").value
    );

  $("uploadCamera").innerHTML =
    '<option value="">Choose camera…</option>'
    +
    rows.map(
      camera =>
        `<option value="${camera.id}">${camera.name}</option>`
    )
    .join("");
}


function renderCameras() {
  if (!cameras.length) {
    $("cameraCards").innerHTML =
      '<div class="muted">No cameras yet.</div>';
    return;
  }

  $("cameraCards").innerHTML =
    cameras.map(camera => {
      const features =
        (
          camera.camera_features
          || []
        )
        .map(
          feature =>
            `<span class="meta-chip">${feature.feature_type}</span>`
        )
        .join("");

      return `
        <div class="stack-item">

          <strong>
            📷 ${camera.name}
          </strong>

          <div class="small muted">
            ${
              camera.primary_habitat
              || "Habitat not set"
            }

            ${
              camera.facing
                ? ` · Facing ${camera.facing}`
                : ""
            }
          </div>

          <div class="meta-row">
            ${features}
          </div>

        </div>
      `;
    })
    .join("");
}


function renderDeerProfiles() {
  if (!deerProfiles.length) {
    $("deerCards").innerHTML =
      '<div class="muted">No AI-created deer profiles yet.</div>';
    return;
  }

  $("deerCards").innerHTML =
    deerProfiles.map(
      deer => `
        <div class="stack-item">

          <div class="stack-item-head">

            <div>

              <strong>
                🦌
                ${
                  deer.nickname
                  ||
                  deer.deer_code
                  ||
                  "Unnamed deer"
                }
              </strong>

              <div class="small muted">
                ${
                  deer.sex
                  || "unknown"
                }
                ·
                ${
                  deer.sighting_count
                  || 0
                }
                sightings
              </div>

              ${
                deer.estimated_age_class
                  ? `<div class="small muted">Estimated age: ${deer.estimated_age_class}</div>`
                  : ""
              }

            </div>

            <button
              class="secondary mini"
              type="button"
              onclick="renameDeer('${deer.id}', ${JSON.stringify(deer.nickname || "")})"
            >
              Rename
            </button>

          </div>

          ${
            deer.antler_signature
              ? `<p class="small">Antlers: ${deer.antler_signature}</p>`
              : ""
          }

          ${
            deer.phenotype_notes
              ? `<p class="small">Traits: ${deer.phenotype_notes}</p>`
              : ""
          }

        </div>
      `
    )
    .join("");
}


function clearPrivateUi() {
  properties = [];
  cameras = [];
  deerProfiles = [];
}


async function reloadAreaIntelligenceData() {
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


/* ============================================================
   PRIVATE AREA INTELLIGENCE
   ============================================================ */

function initAreaMap() {
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
}

function syncAreaSelectors() {
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

  const selectedProperty =
    properties.find(p => p.id === propertyId);

  const propertyLocated =
    selectedProperty &&
    Number.isFinite(Number(selectedProperty.lat)) &&
    Number.isFinite(Number(selectedProperty.lon));

  if ($("propertyLocationStatus")) {
    if (!selectedProperty) {
      $("propertyLocationStatus").textContent =
        "Choose a property, then set its approximate center on the map.";
    } else if (!propertyLocated) {
      $("propertyLocationStatus").textContent =
        `${selectedProperty.name} has not been located yet. Click Set Property Location, then click the farm on the map.`;
    } else {
      $("propertyLocationStatus").textContent =
        `📍 ${selectedProperty.name} location saved. Cameras and stands can now be placed relative to this farm.`;
    }
  }

  if ($("placementMessage")) {
    if (!propertyId) {
      $("placementMessage").textContent =
        "Choose a property first.";
    } else if (!propertyLocated) {
      $("placementMessage").textContent =
        "Set this property's location before placing cameras or stands.";
    } else if (!cams.length) {
      $("placementMessage").textContent =
        "Property located. No cameras are saved for this property yet.";
    } else {
      $("placementMessage").textContent =
        `${cams.length} camera${cams.length === 1 ? "" : "s"} loaded. Choose one and click Place Camera.`;
    }
  }

  if (
    areaMap &&
    propertyLocated
  ) {
    const hasMappedCamera =
      cams.some(
        c =>
          Number.isFinite(Number(c.lat)) &&
          Number.isFinite(Number(c.lon))
      );

    const hasMappedStand =
      propertyStands.some(
        s =>
          Number.isFinite(Number(s.lat)) &&
          Number.isFinite(Number(s.lon))
      );

    if (!hasMappedCamera && !hasMappedStand) {
      areaMap.setView(
        [
          Number(selectedProperty.lat),
          Number(selectedProperty.lon)
        ],
        17
      );
    }
  }
}

function propertyMapIcon() {
  return L.divIcon({
    className: "",
    html: '<div style="width:42px;height:42px;border-radius:50%;background:#20301f;border:3px solid #f1f5f0;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 10px rgba(0,0,0,.55)">📍</div>',
    iconSize: [42,42],
    iconAnchor: [21,21]
  });
}


function cameraMapIcon() {
  return L.divIcon({
    className: "",
    html: '<div style="width:38px;height:38px;border-radius:50%;background:#142018;border:2px solid #a5be86;display:flex;align-items:center;justify-content:center;font-size:21px">📷</div>',
    iconSize: [38,38],
    iconAnchor: [19,19]
  });
}

function standMapIcon() {
  return L.divIcon({
    className: "",
    html: '<div style="width:38px;height:38px;border-radius:50%;background:#201b14;border:2px solid #d9c47a;display:flex;align-items:center;justify-content:center;font-size:21px">🌲</div>',
    iconSize: [38,38],
    iconAnchor: [19,19]
  });
}

function cameraStats(cameraId) {
  const rows = sightings.filter(s => s.camera_id === cameraId);
  return {
    sightings: rows.length,
    deer: rows.reduce((n,s) => n + Number(s.deer_count || 0), 0),
    bucks: rows.reduce((n,s) => n + Number(s.buck_count || 0), 0),
    does: rows.reduce((n,s) => n + Number(s.doe_count || 0), 0),
    profiles: new Set(rows.map(s => s.deer_profile_id).filter(Boolean)).size
  };
}

function renderAreaMap() {
  if (!areaMap || !areaLayer || !$("mapProperty")) return;

  areaLayer.clearLayers();
  movementLayer.clearLayers();

  const propertyId = $("mapProperty").value;
  if (!propertyId) return;

  const cams = cameras.filter(c => c.property_id === propertyId);
  const propertyStands = stands.filter(s => s.property_id === propertyId);
  const selectedProperty = properties.find(p => p.id === propertyId);
  const bounds = [];

  if (
    selectedProperty &&
    Number.isFinite(Number(selectedProperty.lat)) &&
    Number.isFinite(Number(selectedProperty.lon))
  ) {
    const propertyLat = Number(selectedProperty.lat);
    const propertyLon = Number(selectedProperty.lon);

    L.marker(
      [propertyLat, propertyLon],
      {
        icon: propertyMapIcon(),
        draggable: false,
        zIndexOffset: -100
      }
    )
      .addTo(areaLayer)
      .bindPopup(
        `<b>📍 ${selectedProperty.name}</b><br>Approximate property center`
      );

    bounds.push([propertyLat, propertyLon]);
  }

  cams.filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))).forEach(c => {
    const stats = cameraStats(c.id);
    const marker = L.marker([Number(c.lat), Number(c.lon)], {
      icon: cameraMapIcon(),
      draggable: true
    }).addTo(areaLayer);

    marker.bindPopup(`
      <b>📷 ${c.name}</b><br>
      ${c.primary_habitat || "Habitat not set"}${c.facing ? ` · Facing ${c.facing}` : ""}<br><br>
      ${stats.sightings} sighting records<br>
      🦌 ${stats.deer} deer · ♂ ${stats.bucks} bucks · ♀ ${stats.does} does<br>
      ${stats.profiles} identified deer profiles
    `);

    marker.on("dragend", async e => {
      const p = e.target.getLatLng();
      await saveCameraLocation(c.id, p.lat, p.lng);
    });

    bounds.push([Number(c.lat), Number(c.lon)]);
  });

  propertyStands.filter(s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))).forEach(s => {
    const marker = L.marker([Number(s.lat), Number(s.lon)], {
      icon: standMapIcon(),
      draggable: true
    }).addTo(areaLayer);

    marker.bindPopup(`<b>🌲 ${s.name}</b><br>${s.primary_habitat || "Habitat not set"}`);
    marker.on("dragend", async e => {
      const p = e.target.getLatLng();
      await saveStandLocation(s.id, p.lat, p.lng);
    });

    bounds.push([Number(s.lat), Number(s.lon)]);
  });

  if (bounds.length === 1 && selectedProperty) {
    areaMap.setView(bounds[0], 17);
  } else if (bounds.length > 1) {
    areaMap.fitBounds(bounds, { padding: [40,40], maxZoom: 17 });
  }

  const propertySightings = sightings.filter(s => s.property_id === propertyId);
  $("areaCameraCount").textContent = cams.filter(c => c.lat != null && c.lon != null).length;
  $("areaStandCount").textContent = propertyStands.filter(s => s.lat != null && s.lon != null).length;
  $("areaSightingCount").textContent = propertySightings.length;
  $("areaBuckCount").textContent = propertySightings.reduce((n,s) => n + Number(s.buck_count || 0), 0);

  renderCameraActivity();
  renderMovementLine();
}

async function savePropertyLocation(id, lat, lon) {
  const {
    data,
    error
  } =
    await sb
      .from("properties")
      .update({
        lat,
        lon
      })
      .eq("id", id)
      .eq("user_id", currentUser.id)
      .select()
      .single();

  if (error) {
    $("placementMessage").textContent =
      "Could not save property location: " + error.message;
    return;
  }

  await loadProperties();

  if ($("mapProperty")) {
    $("mapProperty").value = id;
  }

  syncAreaSelectors();

  $("placementMessage").textContent =
    `📍 ${data.name || "Property"} location saved. Now place your cameras and stands.`;

  renderAreaMap();
}


function beginPropertyPlacement() {
  const propertyId =
    $("mapProperty").value;

  if (!propertyId) {
    $("placementMessage").textContent =
      "Choose a property first.";
    return;
  }

  const property =
    properties.find(
      p => p.id === propertyId
    );

  placementMode = {
    type: "property",
    id: propertyId
  };

  $("areaMap").style.cursor =
    "crosshair";

  $("placementMessage").textContent =
    `📍 LOCATING ${property?.name || "PROPERTY"} — click roughly the center of the farm/property on the map.`;
}


async function saveCameraLocation(id, lat, lon) {
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
}

async function saveStandLocation(id, lat, lon) {
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
}

async function handleAreaMapClick(e) {
  if (!placementMode) return;

  const mode =
    placementMode;

  placementMode =
    null;

  if ($("areaMap")) {
    $("areaMap").style.cursor =
      "";
  }

  if (mode.type === "property") {
    await savePropertyLocation(
      mode.id,
      e.latlng.lat,
      e.latlng.lng
    );
  } else if (mode.type === "camera") {
    await saveCameraLocation(
      mode.id,
      e.latlng.lat,
      e.latlng.lng
    );
  } else if (mode.type === "stand") {
    await saveStandLocation(
      mode.id,
      e.latlng.lat,
      e.latlng.lng
    );
  }
}

function beginCameraPlacement() {
  const propertyId =
    $("mapProperty").value;

  const property =
    properties.find(
      p => p.id === propertyId
    );

  const propertyLocated =
    property &&
    Number.isFinite(Number(property.lat)) &&
    Number.isFinite(Number(property.lon));

  if (!propertyLocated) {
    $("placementMessage").textContent =
      "Set the property location first.";
    return;
  }

  const id =
    $("mapCamera").value;

  if (!id) {
    $("placementMessage").textContent =
      "Choose a camera first.";
    return;
  }

  placementMode = {
    type: "camera",
    id
  };

  const row =
    cameras.find(c => c.id === id);

  $("areaMap").style.cursor =
    "crosshair";

  $("placementMessage").textContent =
    `📷 PLACING ${row?.name || "CAMERA"} — click its exact location on the satellite image.`;
}

function beginStandPlacement() {
  const propertyId =
    $("mapProperty").value;

  const property =
    properties.find(
      p => p.id === propertyId
    );

  const propertyLocated =
    property &&
    Number.isFinite(Number(property.lat)) &&
    Number.isFinite(Number(property.lon));

  if (!propertyLocated) {
    $("placementMessage").textContent =
      "Set the property location first.";
    return;
  }

  const id =
    $("mapStand").value;

  if (!id) {
    $("placementMessage").textContent =
      "Choose a stand first.";
    return;
  }

  placementMode = {
    type: "stand",
    id
  };

  const row =
    stands.find(s => s.id === id);

  $("areaMap").style.cursor =
    "crosshair";

  $("placementMessage").textContent =
    `🌲 PLACING ${row?.name || "STAND"} — click its exact location on the satellite image.`;
}

async function addMappedStand() {
  const propertyId = $("mapProperty").value;
  const name = $("standName").value.trim();

  if (!propertyId || !name) {
    $("placementMessage").textContent = "Choose a property and enter a stand name.";
    return;
  }

  const { data, error } = await sb.from("stands").insert({
    user_id: currentUser.id,
    property_id: propertyId,
    name,
    primary_habitat: $("standHabitat").value,
    active: true
  }).select().single();

  if (error) {
    $("placementMessage").textContent = error.message;
    return;
  }

  $("standName").value = "";
  await loadStands();
  syncAreaSelectors();
  $("mapStand").value = data.id;
  $("placementMessage").textContent = `${data.name} created. Click Place Stand, then click its location.`;
}

function renderCameraActivity() {
  const propertyId = $("mapProperty").value;
  const rows = cameras.filter(c => c.property_id === propertyId);

  $("cameraActivityCards").innerHTML = rows.map(c => {
    const s = cameraStats(c.id);
    return `<div class="stack-item">
      <strong>📷 ${c.name}</strong>
      <div class="small muted">${c.primary_habitat || "Habitat not set"} · ${c.lat != null ? "Mapped" : "Not mapped"}</div>
      <div class="meta-row">
        <span class="meta-chip">${s.sightings} sightings</span>
        <span class="meta-chip">${s.deer} deer</span>
        <span class="meta-chip">${s.bucks} bucks</span>
        <span class="meta-chip">${s.profiles} identified deer</span>
      </div>
    </div>`;
  }).join("") || '<div class="muted">No cameras for this property.</div>';
}

function renderMovementLine() {
  if (!movementLayer || !$("mapDeer")) return;
  movementLayer.clearLayers();

  const deerId = $("mapDeer").value;
  const propertyId = $("mapProperty").value;

  if (!deerId) {
    $("spatialTitle").textContent = "Property Pattern";
    $("spatialSummary").innerHTML = '<div class="muted">Choose an identified deer to visualize its mapped camera history.</div>';
    return;
  }

  const deer = deerProfiles.find(d => d.id === deerId);
  const rows = sightings
    .filter(s => s.property_id === propertyId && s.deer_profile_id === deerId)
    .sort((a,b) => new Date(a.captured_at || 0) - new Date(b.captured_at || 0));

  const points = rows.map(s => {
    const camera = cameras.find(c => c.id === s.camera_id);
    if (!camera || camera.lat == null || camera.lon == null) return null;
    return { camera, sighting: s, lat: Number(camera.lat), lon: Number(camera.lon) };
  }).filter(Boolean);

  $("spatialTitle").textContent = `${deer?.nickname || deer?.deer_code || "Deer"} Spatial Pattern`;

  if (!points.length) {
    $("spatialSummary").innerHTML = '<div class="muted">This deer has no sightings tied to mapped cameras yet.</div>';
    return;
  }

  const latLngs = points.map(p => [p.lat, p.lon]);
  if (latLngs.length >= 2) {
    L.polyline(latLngs, { weight: 4, opacity: .75, dashArray: "7 7" }).addTo(movementLayer);
  }

  points.forEach((p,i) => {
    L.circleMarker([p.lat,p.lon], { radius: 7, weight: 2, fillOpacity: .8 })
      .addTo(movementLayer)
      .bindPopup(`<b>${i+1}. ${p.camera.name}</b><br>${p.sighting.captured_at ? new Date(p.sighting.captured_at).toLocaleString() : "Time unavailable"}`);
  });

  const counts = {};
  points.forEach(p => counts[p.camera.name] = (counts[p.camera.name] || 0) + 1);
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];

  $("spatialSummary").innerHTML = `
    <div class="stack-item"><strong>${points.length} mapped sightings</strong><div class="small muted">Across ${Object.keys(counts).length} mapped cameras.</div></div>
    <div class="stack-item"><strong>Most used mapped camera</strong><div>${top ? `${top[0]} · ${top[1]} sightings` : "Not enough data"}</div></div>
    <div class="stack-item"><strong>Next layer</strong><div class="small muted">We can now combine these exact locations with wind, weather, stand position, access, and habitat.</div></div>`;
}


/* ============================================================
   AREA INTELLIGENCE
   ============================================================ */

async function loadJson(
  path,
  fallback
) {
  try {
    const response =
      await fetch(
        path,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error();
    }

    return await response.json();

  } catch {
    return fallback;
  }
}


function miles(
  aLat,
  aLon,
  bLat,
  bLon
) {
  const R = 3958.7613;

  const dLat =
    rad(
      bLat - aLat
    );

  const dLon =
    rad(
      bLon - aLon
    );

  const a =
    Math.sin(dLat / 2) ** 2
    +
    Math.cos(rad(aLat))
    *
    Math.cos(rad(bLat))
    *
    Math.sin(dLon / 2) ** 2;

  return 2
    *
    R
    *
    Math.asin(
      Math.sqrt(a)
    );
}


async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q="
    +
    encodeURIComponent(query);

  const response =
    await fetch(url);

  const data =
    await response.json();

  if (!data.length) {
    throw new Error(
      "Location not found."
    );
  }

  return {
    lat:
      Number(
        data[0].lat
      ),

    lon:
      Number(
        data[0].lon
      ),

    label:
      data[0].display_name
  };
}


function initMapSafe() {
  if (
    typeof L === "undefined"
  ) {
    return;
  }

  map =
    L.map("map")
      .setView(
        [
          32.8,
          -86.8
        ],
        7
      );

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        "&copy; OpenStreetMap contributors"
    }
  )
  .addTo(map);

  layerGroup =
    L.layerGroup()
      .addTo(map);
}


function fillControls() {
  (
    cfg.radius_options
    ||
    [
      1,
      3,
      5,
      10,
      15,
      25,
      50
    ]
  )
  .forEach(radius => {
    const option =
      document.createElement("option");

    option.value =
      radius;

    option.textContent =
      radius + " miles";

    if (
      radius ===
      (
        cfg.default_radius_miles
        || 5
      )
    ) {
      option.selected = true;
    }

    $("radius")
      .appendChild(option);
  });

  const groups = {};

  publicLands.forEach(land => {
    (
      groups[land.type]
      ??=
      []
    ).push(land);
  });

  Object
    .keys(groups)
    .sort()
    .forEach(type => {
      const group =
        document.createElement(
          "optgroup"
        );

      group.label = type;

      groups[type]
        .sort(
          (a, b) =>
            a.name.localeCompare(
              b.name
            )
        )
        .forEach(land => {
          const option =
            document.createElement(
              "option"
            );

          option.value =
            land.id;

          option.textContent =
            land.name;

          group.appendChild(option);
        });

      $("publicLand")
        .appendChild(group);
    });
}


async function resolveSearchPoint() {
  const landId =
    $("publicLand").value;

  if (landId) {
    const land =
      publicLands.find(
        item =>
          item.id === landId
      );

    if (
      land.lat != null &&
      land.lon != null
    ) {
      return {
        lat:
          Number(land.lat),

        lon:
          Number(land.lon),

        label:
          land.name
      };
    }

    return geocode(
      land.search_label
      ||
      land.name + ", Alabama"
    );
  }

  const query =
    $("address").value.trim();

  if (!query) {
    throw new Error(
      "Enter an address/ZIP or select public land."
    );
  }

  return geocode(query);
}


function publicLandText(
  observation
) {
  if (
    observation.nearest_public_land
    &&
    observation.nearest_public_land_distance_miles
      != null
  ) {
    return `${Number(
      observation.nearest_public_land_distance_miles
    ).toFixed(2)} mi to ${observation.nearest_public_land}`;
  }

  return observation.nearest_public_land
    ? `Near ${observation.nearest_public_land}`
    : "Public-land distance not calculated yet";
}


function deerIcon() {
  return L.divIcon({
    className: "",

    html:
      '<div style="width:40px;height:40px;border-radius:50%;background:#152019;border:2px solid #a5be86;display:flex;align-items:center;justify-content:center;font-size:23px">🦌</div>',

    iconSize:
      [40, 40],

    iconAnchor:
      [20, 20]
  });
}


function renderMapResults(
  center
) {
  if (!map || !layerGroup) {
    return;
  }

  const radius =
    Number(
      $("radius").value
    );

  const minAcres =
    Number(
      $("minAcres").value
      || 0
    );

  const rows =
    observations
      .filter(
        observation =>
          observation.confirmed
          === true
          &&
          Number(
            observation.acres
            || 0
          )
          >= minAcres
          &&
          Number.isFinite(
            Number(
              observation.lat
            )
          )
          &&
          Number.isFinite(
            Number(
              observation.lon
            )
          )
      )
      .map(
        observation => ({
          ...observation,

          distance_miles:
            miles(
              center.lat,
              center.lon,
              Number(
                observation.lat
              ),
              Number(
                observation.lon
              )
            )
        })
      )
      .filter(
        observation =>
          observation.distance_miles
          <= radius
      );

  layerGroup.clearLayers();

  if (searchMarker) {
    map.removeLayer(
      searchMarker
    );
  }

  if (searchCircle) {
    map.removeLayer(
      searchCircle
    );
  }

  searchMarker =
    L.marker(
      [
        center.lat,
        center.lon
      ]
    )
    .addTo(map);

  searchCircle =
    L.circle(
      [
        center.lat,
        center.lon
      ],
      {
        radius:
          radius * 1609.344
      }
    )
    .addTo(map);

  rows.forEach(observation => {
    L.marker(
      [
        observation.lat,
        observation.lon
      ],
      {
        icon:
          deerIcon()
      }
    )
    .addTo(layerGroup)
    .bindPopup(
      `
      <b>🦌 ${observation.deer_count || 1} deer confirmed</b><br>
      ♂ ${observation.buck_count || 0} bucks ·
      ♀ ${observation.doe_count || 0} does<br>
      ${publicLandText(observation)}

      ${
        observation.listing_url
          ? `<p><a href="${observation.listing_url}" target="_blank" rel="noopener">View original listing</a></p>`
          : ""
      }
      `
    );
  });

  map.fitBounds(
    searchCircle.getBounds()
  );

  $("mObs").textContent =
    rows.length;

  $("mDeer").textContent =
    rows.reduce(
      (
        total,
        observation
      ) =>
        total
        +
        Number(
          observation.deer_count
          || 1
        ),
      0
    );

  $("mProfiles").textContent =
    new Set(
      rows
        .map(
          observation =>
            observation.deer_id
        )
        .filter(Boolean)
    ).size;

  $("mHarvested").textContent =
    rows.filter(
      observation =>
        [
          "reported",
          "verified"
        ]
        .includes(
          observation.harvest_status
        )
    ).length;

  $("status").textContent =
    `${rows.length} confirmed observations within ${radius} miles of ${center.label}.`;

  $("results").innerHTML =
    rows.map(
      observation => `
        <div class="card">

          <b>
            🦌
            ${observation.deer_count || 1}
            deer confirmed
          </b>

          <p>
            ♂ ${observation.buck_count || 0} bucks ·
            ♀ ${observation.doe_count || 0} does ·
            ${publicLandText(observation)}
          </p>

          ${
            observation.listing_url
              ? `<a href="${observation.listing_url}" target="_blank" rel="noopener">View original listing</a>`
              : ""
          }

        </div>
      `
    )
    .join("")
    ||
    '<div class="panel">No confirmed outside observations match this search.</div>';
}


async function doSearch() {
  $("status").textContent =
    "Resolving location…";

  try {
    renderMapResults(
      await resolveSearchPoint()
    );
  } catch (error) {
    $("status").textContent =
      error.message;
  }
}


/* ============================================================
   INIT
   ============================================================ */

async function init() {
  /*
   * AUTH IS FIRST AND INDEPENDENT.
   * Nothing related to maps, properties, photos, or JSON may prevent
   * Sign In / Create Account from being wired.
   */

  if (!initSupabase()) {
    return;
  }

  if ($("signInBtn")) {
    $("signInBtn")
      .addEventListener(
        "click",
        signIn
      );
  }

  if ($("signUpBtn")) {
    $("signUpBtn")
      .addEventListener(
        "click",
        signUp
      );
  }

  if ($("signOutBtn")) {
    $("signOutBtn")
      .addEventListener(
        "click",
        signOut
      );
  }

  /*
   * Enter also signs in from the password box.
   */
  if ($("authPassword")) {
    $("authPassword")
      .addEventListener(
        "keydown",
        event => {
          if (event.key === "Enter") {
            signIn();
          }
        }
      );
  }

  /*
   * Restore session, but do not allow restoration/data-loading problems
   * to stop the rest of the app from initializing.
   */
  try {
    await restoreSession();
  } catch (error) {
    console.error(
      "HOSE restoreSession failed:",
      error
    );
  }


  /*
   * SECONDARY UI INITIALIZATION.
   * This entire block can fail and authentication will still work.
   */
  try {
    setupTabs();

    [
      cfg,
      publicLands,
      observations,
      outsideProfiles
    ] =
    await Promise.all([
      loadJson(
        "config.json",
        {
          default_radius_miles: 5,
          radius_options: [
            1,
            3,
            5,
            10,
            15,
            25,
            50
          ]
        }
      ),

      loadJson(
        "public_lands.json",
        []
      ),

      loadJson(
        "observations.json",
        []
      ),

      loadJson(
        "deer_profiles.json",
        []
      )
    ]);


    try {
      fillControls();
    } catch (error) {
      console.error(
        "HOSE Explore controls error:",
        error
      );
    }


    if ($("addPropertyBtn")) {
      $("addPropertyBtn")
        .addEventListener(
          "click",
          addProperty
        );
    }


    if ($("addCameraBtn")) {
      $("addCameraBtn")
        .addEventListener(
          "click",
          addCamera
        );
    }


    if ($("refreshPhotosBtn")) {
      $("refreshPhotosBtn")
        .addEventListener(
          "click",
          loadRecentPhotos
        );
    }


    if (
      $("propertySelect") &&
      $("uploadProperty")
    ) {
      $("propertySelect")
        .addEventListener(
          "change",
          () => {
            $("uploadProperty").value =
              $("propertySelect").value;

            renderCameraSelectors();

            if ($("recentPhotos")) {
              loadRecentPhotos();
            }
          }
        );
    }


    if ($("uploadProperty")) {
      $("uploadProperty")
        .addEventListener(
          "change",
          () => {
            renderCameraSelectors();

            if ($("recentPhotos")) {
              loadRecentPhotos();
            }
          }
        );
    }


    if ($("photoUpload")) {
      $("photoUpload")
        .addEventListener(
          "change",
          event => {
            const files =
              event.target.files;

            if ($("uploadCount")) {
              $("uploadCount").textContent =
                `${files.length} file${files.length === 1 ? "" : "s"} selected`;
            }

            renderSelectedPreviews(
              files
            );
          }
        );
    }


    if ($("processUploadBtn")) {
      $("processUploadBtn")
        .addEventListener(
          "click",
          uploadPhotos
        );
    }


    if ($("mapProperty")) {
      $("mapProperty")
        .addEventListener(
          "change",
          async () => {
            const propertyId =
              $("mapProperty").value;

            if (propertyId) {
              localStorage.setItem(
                "hose_area_property_id",
                propertyId
              );
            } else {
              localStorage.removeItem(
                "hose_area_property_id"
              );
            }

            try {
              await reloadAreaIntelligenceData();

              if (
                propertyId &&
                properties.some(
                  p =>
                    p.id === propertyId
                )
              ) {
                $("mapProperty").value =
                  propertyId;
              }

              syncAreaSelectors();
              renderAreaMap();

              setTimeout(
                () =>
                  areaMap?.invalidateSize(),
                100
              );

            } catch (error) {
              console.error(
                "HOSE Area property change error:",
                error
              );

              if ($("placementMessage")) {
                $("placementMessage").textContent =
                  error?.message ||
                  "Could not load Area Intelligence.";
              }
            }
          }
        );
    }


    if ($("mapDeer")) {
      $("mapDeer")
        .addEventListener(
          "change",
          renderMovementLine
        );
    }


    if ($("setPropertyLocationBtn")) {
      $("setPropertyLocationBtn")
        .addEventListener(
          "click",
          beginPropertyPlacement
        );
    }


    if ($("placeCameraBtn")) {
      $("placeCameraBtn")
        .addEventListener(
          "click",
          beginCameraPlacement
        );
    }


    if ($("placeStandBtn")) {
      $("placeStandBtn")
        .addEventListener(
          "click",
          beginStandPlacement
        );
    }


    if ($("addStandBtn")) {
      $("addStandBtn")
        .addEventListener(
          "click",
          addMappedStand
        );
    }


    if ($("searchBtn")) {
      $("searchBtn")
        .addEventListener(
          "click",
          doSearch
        );
    }


    if ($("address")) {
      $("address")
        .addEventListener(
          "keydown",
          event => {
            if (
              event.key === "Enter"
            ) {
              doSearch();
            }
          }
        );
    }

  } catch (error) {
    console.error(
      "HOSE secondary initialization error:",
      error
    );
  }
}

window.renameDeer =
  renameDeer;


window.addEventListener(
  "error",
  event => {
    console.error(
      "HOSE browser error:",
      event.error || event.message
    );

    const message =
      document.getElementById("authMessage");

    const gate =
      document.getElementById("authGate");

    if (
      message &&
      gate &&
      !gate.classList.contains("hidden")
    ) {
      message.textContent =
        "Website error: "
        +
        (
          event.error?.message
          ||
          event.message
          ||
          "Unknown JavaScript error"
        );
    }
  }
);


window.addEventListener(
  "unhandledrejection",
  event => {
    console.error(
      "HOSE unhandled promise error:",
      event.reason
    );

    const message =
      document.getElementById("authMessage");

    const gate =
      document.getElementById("authGate");

    if (
      message &&
      gate &&
      !gate.classList.contains("hidden")
    ) {
      message.textContent =
        "Website error: "
        +
        (
          event.reason?.message
          ||
          String(event.reason)
        );
    }
  }
);


document.addEventListener(
  "DOMContentLoaded",
  init
);
