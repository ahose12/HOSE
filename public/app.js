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


/* ============================================================
   SUPABASE
   ============================================================ */

function initSupabase() {
  const config = window.HOSE_SUPABASE || {};

  if (
    !config.url ||
    !config.publishableKey ||
    config.url.includes("PASTE_") ||
    config.publishableKey.includes("PASTE_")
  ) {
    $("authMessage").textContent =
      "Supabase is not configured. Update public/supabase-config.js.";

    return false;
  }

  try {
    sb = window.supabase.createClient(
      config.url,
      config.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    return true;

  } catch (error) {
    console.error(
      "Supabase initialization failed:",
      error
    );

    $("authMessage").textContent =
      "Could not initialize account services.";

    return false;
  }
}


async function restoreSession() {
  if (!sb) {
    return;
  }

  const { data, error } =
    await sb.auth.getSession();

  if (error) {
    console.error(
      "Session restore failed:",
      error
    );

    $("authMessage").textContent =
      error.message;

    return;
  }

  await applySession(
    data.session
  );

  sb.auth.onAuthStateChange(
    async (_event, session) => {
      await applySession(
        session
      );
    }
  );
}


async function applySession(session) {
  currentUser =
    session?.user || null;

  $("authGate").classList.toggle(
    "hidden",
    !!currentUser
  );

  $("appShell").classList.toggle(
    "hidden",
    !currentUser
  );

  if (!currentUser) {
    $("signedInEmail").textContent =
      "";

    clearPrivateUi();

    return;
  }

  $("signedInEmail").textContent =
    currentUser.email ||
    currentUser.id;

  try {
    await refreshPrivateData();

  } catch (error) {
    console.error(
      "Private data refresh failed:",
      error
    );
  }

  if (!map) {
    try {
      initMapSafe();

    } catch (error) {
      console.error(
        "Map initialization failed:",
        error
      );
    }
  }
}


async function signIn() {
  if (!sb) {
    $("authMessage").textContent =
      "Supabase is not connected.";

    return;
  }

  const email =
    $("authEmail").value.trim();

  const password =
    $("authPassword").value;

  if (!email || !password) {
    $("authMessage").textContent =
      "Enter email and password.";

    return;
  }

  $("authMessage").textContent =
    "Signing in…";

  try {
    const { error } =
      await sb.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      $("authMessage").textContent =
        error.message;

      return;
    }

    $("authMessage").textContent =
      "Signed in.";

  } catch (error) {
    console.error(
      "Sign in failed:",
      error
    );

    $("authMessage").textContent =
      error?.message ||
      "Sign in failed.";
  }
}


async function signUp() {
  if (!sb) {
    $("authMessage").textContent =
      "Supabase is not connected.";

    return;
  }

  const email =
    $("authEmail").value.trim();

  const password =
    $("authPassword").value;

  if (!email || !password) {
    $("authMessage").textContent =
      "Enter email and password.";

    return;
  }

  $("authMessage").textContent =
    "Creating account…";

  try {
    const { data, error } =
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
      $("authMessage").textContent =
        error.message;

      return;
    }

    $("authMessage").textContent =
      data.session
        ? "Account created and signed in."
        : "Account created. Check your email to confirm your account, then sign in.";

  } catch (error) {
    console.error(
      "Sign up failed:",
      error
    );

    $("authMessage").textContent =
      error?.message ||
      "Account creation failed.";
  }
}


async function signOut() {
  if (!sb) {
    return;
  }

  await sb.auth.signOut();
}


/* ============================================================
   TABS
   ============================================================ */

function setupTabs() {
  document
    .querySelectorAll(
      ".app-tab"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".app-tab"
            )
            .forEach(tab => {
              tab.classList.remove(
                "active"
              );
            });

          button.classList.add(
            "active"
          );

          const selected =
            button.dataset.tab;

          $("tab-my-intel")
            .classList
            .toggle(
              "hidden",
              selected !== "my-intel"
            );

          $("tab-area-intel")
            .classList
            .toggle(
              "hidden",
              selected !== "area-intel"
            );

          if (
            selected === "area-intel" &&
            map
          ) {
            setTimeout(
              () => {
                map.invalidateSize();
              },
              100
            );
          }
        }
      );
    });
}


/* ============================================================
   PRIVATE DATA
   ============================================================ */

async function refreshPrivateData() {
  if (!currentUser) {
    return;
  }

  await Promise.all([
    loadProperties(),
    loadCameras(),
    loadDeerProfiles()
  ]);

  renderPrivate();

  await loadRecentPhotos();
}


async function loadProperties() {
  const { data, error } =
    await sb
      .from("properties")
      .select("*")
      .order(
        "created_at",
        {
          ascending: true
        }
      );

  if (error) {
    console.error(
      "Property load failed:",
      error
    );

    $("propertyMessage").textContent =
      error.message;

    return;
  }

  properties =
    data || [];
}


async function loadCameras() {
  const { data, error } =
    await sb
      .from("cameras")
      .select(
        "*, camera_features(feature_type)"
      )
      .eq(
        "active",
        true
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      );

  if (error) {
    console.error(
      "Camera load failed:",
      error
    );

    $("cameraMessage").textContent =
      error.message;

    return;
  }

  cameras =
    data || [];
}


async function loadDeerProfiles() {
  const { data, error } =
    await sb
      .from("deer_profiles")
      .select("*")
      .order(
        "last_seen",
        {
          ascending: false,
          nullsFirst: false
        }
      );

  if (error) {
    console.error(
      "Deer profile load failed:",
      error
    );

    deerProfiles = [];

    return;
  }

  deerProfiles =
    data || [];
}


async function addProperty() {
  if (!currentUser) {
    return;
  }

  const name =
    $("propertyName")
      .value
      .trim();

  if (!name) {
    $("propertyMessage").textContent =
      "Property name is required.";

    return;
  }

  $("propertyMessage").textContent =
    "Saving property…";

  const { error } =
    await sb
      .from("properties")
      .insert({
        user_id:
          currentUser.id,

        name,

        county:
          $("propertyCounty")
            .value
            .trim()
          || null,

        state:
          $("propertyState")
            .value
            .trim()
          || "AL",

        acreage:
          $("propertyAcres").value
            ? Number(
                $("propertyAcres").value
              )
            : null
      });

  if (error) {
    $("propertyMessage").textContent =
      error.message;

    return;
  }

  $("propertyMessage").textContent =
    "Property added.";

  $("propertyName").value =
    "";

  $("propertyAcres").value =
    "";

  $("propertyCounty").value =
    "";

  await refreshPrivateData();
}


async function addCamera() {
  if (!currentUser) {
    return;
  }

  const propertyId =
    $("propertySelect").value;

  const name =
    $("cameraName")
      .value
      .trim();

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

  $("cameraMessage").textContent =
    "Saving camera…";

  const { data, error } =
    await sb
      .from("cameras")
      .insert({
        user_id:
          currentUser.id,

        property_id:
          propertyId,

        name,

        facing:
          $("cameraFacing").value,

        primary_habitat:
          $("primaryHabitat").value,

        notes:
          $("cameraNotes")
            .value
            .trim()
          || null
      })
      .select()
      .single();

  if (error) {
    $("cameraMessage").textContent =
      error.message;

    return;
  }

  const features =
    Array.from(
      document.querySelectorAll(
        ".habitat-options input:checked"
      )
    )
    .map(
      checkbox =>
        checkbox.value
    );

  if (features.length) {
    const featureRows =
      features.map(feature => ({
        user_id:
          currentUser.id,

        camera_id:
          data.id,

        feature_type:
          feature
      }));

    const {
      error: featureError
    } =
      await sb
        .from("camera_features")
        .insert(featureRows);

    if (featureError) {
      console.error(
        "Camera feature save failed:",
        featureError
      );
    }
  }

  $("cameraMessage").textContent =
    "Camera added.";

  $("cameraName").value =
    "";

  $("cameraNotes").value =
    "";

  document
    .querySelectorAll(
      ".habitat-options input"
    )
    .forEach(
      checkbox => {
        checkbox.checked = false;
      }
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
      .eq(
        "id",
        deerId
      );

  if (error) {
    alert(
      error.message
    );

    return;
  }

  await loadDeerProfiles();

  renderDeerProfiles();
}


/* ============================================================
   AI PROCESSING
   ============================================================ */

async function processPhotoWithAI(
  photoId
) {
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

  if (
    data &&
    data.ok === false
  ) {
    throw new Error(
      data.error ||
      "AI processing failed."
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

  grid.innerHTML =
    "";

  if (!files.length) {
    section.classList.add(
      "hidden"
    );

    return;
  }

  section.classList.remove(
    "hidden"
  );

  Array
    .from(files)
    .slice(0, 100)
    .forEach(file => {

      const url =
        URL.createObjectURL(
          file
        );

      const card =
        document.createElement(
          "div"
        );

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

      grid.appendChild(
        card
      );
    });
}


async function uploadPhotos() {
  if (!currentUser) {
    $("uploadProgress").textContent =
      "Sign in first.";

    return;
  }

  const propertyId =
    $("uploadProperty").value;

  const cameraId =
    $("uploadCamera").value;

  const files =
    Array.from(
      $("photoUpload").files
    );

  if (
    !propertyId ||
    !cameraId
  ) {
    $("uploadProgress").textContent =
      "Choose both a property and camera.";

    return;
  }

  if (!files.length) {
    $("uploadProgress").textContent =
      "Select photos first.";

    return;
  }

  $("processUploadBtn").disabled =
    true;

  let uploaded = 0;
  let analyzed = 0;
  let failed = 0;

  for (
    let i = 0;
    i < files.length;
    i++
  ) {
    const file =
      files[i];

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
                file.type ||
                "image/jpeg",

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
          .remove([
            path
          ]);

        throw rowError;
      }

      $("uploadProgress").textContent =
        `Analyzing ${i + 1} of ${files.length}: ${file.name}`;

      const aiResult =
        await processPhotoWithAI(
          photoRow.id
        );

      console.log(
        "HOSE AI RESULT:",
        aiResult
      );

      analyzed++;

      if (
        aiResult?.analysis?.deer_present
      ) {
        const analysis =
          aiResult.analysis;

        $("uploadProgress").textContent =
          `Analyzed ${file.name}: `
          +
          `${analysis.deer_count} deer, `
          +
          `${analysis.buck_count} bucks, `
          +
          `${analysis.doe_count} does, `
          +
          `${analysis.fawn_count} fawns.`;

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
          error?.message ||
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
    .add(
      "hidden"
    );

  try {
    await Promise.all([
      loadRecentPhotos(),
      loadDeerProfiles()
    ]);

    renderDeerProfiles();

  } catch (error) {
    console.error(
      "Post-analysis refresh failed:",
      error
    );
  }

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

  const {
    data,
    error
  } =
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

  const cards =
    [];

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
      console.error(
        "Signed photo URL failed:",
        signedError
      );

      continue;
    }

    const analysis =
      row.ai_analysis ||
      null;

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
            row.original_filename ||
            "Trail photo"
          }
        </div>

        <div class="small muted">
          ${row.processing_status}
        </div>

        ${analysisText}

        ${
          row.processing_error
            ? `
              <div class="small" style="color:#e7a39a">
                ${row.processing_error}
              </div>
            `
            : ""
        }

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
  const currentProperty =
    $("propertySelect").value;

  const currentUploadProperty =
    $("uploadProperty").value;

  const options =
    properties
      .map(
        property =>
          `<option value="${property.id}">${property.name}</option>`
      )
      .join("");

  $("propertySelect").innerHTML =
    '<option value="">Choose property…</option>'
    +
    options;

  $("uploadProperty").innerHTML =
    '<option value="">Choose property…</option>'
    +
    options;

  if (
    properties.some(
      property =>
        property.id === currentProperty
    )
  ) {
    $("propertySelect").value =
      currentProperty;

  } else if (
    properties.length === 1
  ) {
    $("propertySelect").value =
      properties[0].id;
  }

  if (
    properties.some(
      property =>
        property.id === currentUploadProperty
    )
  ) {
    $("uploadProperty").value =
      currentUploadProperty;

  } else if (
    properties.length === 1
  ) {
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
  const currentCamera =
    $("uploadCamera").value;

  const rows =
    camerasForProperty(
      $("uploadProperty").value
    );

  $("uploadCamera").innerHTML =
    '<option value="">Choose camera…</option>'
    +
    rows
      .map(
        camera =>
          `<option value="${camera.id}">${camera.name}</option>`
      )
      .join("");

  if (
    rows.some(
      camera =>
        camera.id === currentCamera
    )
  ) {
    $("uploadCamera").value =
      currentCamera;

  } else if (
    rows.length === 1
  ) {
    $("uploadCamera").value =
      rows[0].id;
  }
}


function renderCameras() {
  if (!cameras.length) {
    $("cameraCards").innerHTML =
      '<div class="muted">No cameras yet.</div>';

    return;
  }

  $("cameraCards").innerHTML =
    cameras
      .map(camera => {
        const features =
          (
            camera.camera_features ||
            []
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
                camera.primary_habitat ||
                "Habitat not set"
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
    deerProfiles
      .map(
        deer => `
          <div class="stack-item">

            <div class="stack-item-head">

              <div>

                <strong>
                  🦌
                  ${
                    deer.nickname ||
                    deer.deer_code ||
                    "Unnamed deer"
                  }
                </strong>

                <div class="small muted">

                  ${
                    deer.sex ||
                    "unknown"
                  }

                  ·

                  ${
                    deer.sighting_count ||
                    0
                  }

                  sightings

                </div>

                ${
                  deer.estimated_age_class
                    ? `
                      <div class="small muted">
                        Estimated age: ${deer.estimated_age_class}
                      </div>
                    `
                    : ""
                }

              </div>

              <button
                class="secondary mini"
                type="button"
                onclick="renameDeer(
                  '${deer.id}',
                  ${JSON.stringify(deer.nickname || "")}
                )"
              >
                Rename
              </button>

            </div>

            ${
              deer.antler_signature
                ? `
                  <p class="small">
                    Antlers:
                    ${deer.antler_signature}
                  </p>
                `
                : ""
            }

            ${
              deer.phenotype_notes
                ? `
                  <p class="small">
                    Traits:
                    ${deer.phenotype_notes}
                  </p>
                `
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

  if ($("propertySelect")) {
    $("propertySelect").innerHTML =
      '<option value="">Choose property…</option>';
  }

  if ($("uploadProperty")) {
    $("uploadProperty").innerHTML =
      '<option value="">Choose property…</option>';
  }

  if ($("uploadCamera")) {
    $("uploadCamera").innerHTML =
      '<option value="">Choose camera…</option>';
  }

  if ($("cameraCards")) {
    $("cameraCards").innerHTML =
      "";
  }

  if ($("deerCards")) {
    $("deerCards").innerHTML =
      "";
  }

  if ($("recentPhotos")) {
    $("recentPhotos").innerHTML =
      "";
  }
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
  const R =
    3958.7613;

  const dLat =
    rad(
      bLat - aLat
    );

  const dLon =
    rad(
      bLon - aLon
    );

  const a =
    Math.sin(
      dLat / 2
    ) ** 2
    +
    Math.cos(
      rad(aLat)
    )
    *
    Math.cos(
      rad(bLat)
    )
    *
    Math.sin(
      dLon / 2
    ) ** 2;

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
    encodeURIComponent(
      query
    );

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
    console.warn(
      "Leaflet did not load."
    );

    return;
  }

  if (map) {
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
      maxZoom:
        19,

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
  const radiusSelect =
    $("radius");

  const publicLandSelect =
    $("publicLand");

  if (
    !radiusSelect ||
    !publicLandSelect
  ) {
    return;
  }

  radiusSelect.innerHTML =
    "";

  (
    cfg.radius_options ||
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
      document.createElement(
        "option"
      );

    option.value =
      radius;

    option.textContent =
      radius + " miles";

    if (
      radius ===
      (
        cfg.default_radius_miles ||
        5
      )
    ) {
      option.selected =
        true;
    }

    radiusSelect.appendChild(
      option
    );
  });

  publicLandSelect.innerHTML =
    '<option value="">Choose public land…</option>';

  const groups = {};

  publicLands.forEach(
    land => {
      (
        groups[land.type]
        ??=
        []
      )
      .push(
        land
      );
    }
  );

  Object
    .keys(groups)
    .sort()
    .forEach(
      type => {
        const group =
          document.createElement(
            "optgroup"
          );

        group.label =
          type;

        groups[type]
          .sort(
            (a, b) =>
              a.name.localeCompare(
                b.name
              )
          )
          .forEach(
            land => {
              const option =
                document.createElement(
                  "option"
                );

              option.value =
                land.id;

              option.textContent =
                land.name;

              group.appendChild(
                option
              );
            }
          );

        publicLandSelect
          .appendChild(
            group
          );
      }
    );
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
          Number(
            land.lat
          ),

        lon:
          Number(
            land.lon
          ),

        label:
          land.name
      };
    }

    return geocode(
      land.search_label ||
      land.name +
      ", Alabama"
    );
  }

  const query =
    $("address")
      .value
      .trim();

  if (!query) {
    throw new Error(
      "Enter an address/ZIP or select public land."
    );
  }

  return geocode(
    query
  );
}


function publicLandText(
  observation
) {
  if (
    observation.nearest_public_land &&
    observation
      .nearest_public_land_distance_miles
      != null
  ) {
    return `${Number(
      observation
        .nearest_public_land_distance_miles
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

    iconSize: [
      40,
      40
    ],

    iconAnchor: [
      20,
      20
    ]
  });
}


function renderMapResults(center) {
  if (
    !map ||
    !layerGroup
  ) {
    return;
  }

  const radius =
    Number(
      $("radius").value
    );

  const minAcres =
    Number(
      $("minAcres").value ||
      0
    );

  const rows =
    observations
      .filter(
        observation =>
          observation.confirmed === true
          &&
          Number(
            observation.acres ||
            0
          ) >= minAcres
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

  rows.forEach(
    observation => {
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
      .addTo(
        layerGroup
      )
      .bindPopup(
        `
        <b>
          🦌
          ${observation.deer_count || 1}
          deer confirmed
        </b>

        <br>

        ♂
        ${observation.buck_count || 0}
        bucks

        ·

        ♀
        ${observation.doe_count || 0}
        does

        <br>

        ${publicLandText(observation)}

        ${
          observation.listing_url
            ? `
              <p>
                <a
                  href="${observation.listing_url}"
                  target="_blank"
                  rel="noopener"
                >
                  View original listing
                </a>
              </p>
            `
            : ""
        }
        `
      );
    }
  );

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
          observation.deer_count ||
          1
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
    rows
      .map(
        observation => `
          <div class="card">

            <b>
              🦌
              ${observation.deer_count || 1}
              deer confirmed
            </b>

            <p>
              ♂
              ${observation.buck_count || 0}
              bucks

              ·

              ♀
              ${observation.doe_count || 0}
              does

              ·

              ${publicLandText(observation)}
            </p>

            ${
              observation.listing_url
                ? `
                  <a
                    href="${observation.listing_url}"
                    target="_blank"
                    rel="noopener"
                  >
                    View original listing
                  </a>
                `
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
   INITIALIZATION
   AUTHENTICATION IS INTENTIONALLY FIRST
   ============================================================ */

async function init() {
  /*
   * AUTH FIRST.
   *
   * If maps, JSON data, Leaflet, or any secondary feature
   * breaks later, login should still work.
   */

  if (!initSupabase()) {
    return;
  }


  /* AUTH BUTTONS FIRST */

  $("signInBtn")
    .addEventListener(
      "click",
      signIn
    );

  $("signUpBtn")
    .addEventListener(
      "click",
      signUp
    );

  $("signOutBtn")
    .addEventListener(
      "click",
      signOut
    );


  /* RESTORE LOGIN BEFORE LOADING MAP DATA */

  try {
    await restoreSession();

  } catch (error) {
    console.error(
      "Initial authentication failed:",
      error
    );

    $("authMessage").textContent =
      error?.message ||
      "Could not restore your session.";
  }


  /*
   * EVERYTHING BELOW THIS POINT IS SECONDARY.
   *
   * A failure here should NOT kill login.
   */

  try {
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

    fillControls();

    setupTabs();


    /* PROPERTY */

    $("addPropertyBtn")
      .addEventListener(
        "click",
        addProperty
      );


    /* CAMERA */

    $("addCameraBtn")
      .addEventListener(
        "click",
        addCamera
      );


    /* PROPERTY SELECTION */

    $("propertySelect")
      .addEventListener(
        "change",
        () => {
          $("uploadProperty").value =
            $("propertySelect").value;

          renderCameraSelectors();

          loadRecentPhotos();
        }
      );


    $("uploadProperty")
      .addEventListener(
        "change",
        () => {
          renderCameraSelectors();

          loadRecentPhotos();
        }
      );


    /* PHOTO SELECTION */

    $("photoUpload")
      .addEventListener(
        "change",
        event => {
          const files =
            event.target.files;

          $("uploadCount").textContent =
            `${files.length} file${files.length === 1 ? "" : "s"} selected`;

          renderSelectedPreviews(
            files
          );
        }
      );


    /* PHOTO UPLOAD + AI */

    $("processUploadBtn")
      .addEventListener(
        "click",
        uploadPhotos
      );


    /* REFRESH */

    $("refreshPhotosBtn")
      .addEventListener(
        "click",
        loadRecentPhotos
      );


    /* AREA SEARCH */

    $("searchBtn")
      .addEventListener(
        "click",
        doSearch
      );


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

  } catch (error) {
    console.error(
      "HOSE secondary initialization error:",
      error
    );
  }
}


/* ============================================================
   GLOBALS
   ============================================================ */

window.renameDeer =
  renameDeer;


/* ============================================================
   START
   ============================================================ */

document.addEventListener(
  "DOMContentLoaded",
  init
);