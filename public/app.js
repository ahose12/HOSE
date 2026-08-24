const $ = id => document.getElementById(id);
const rad = d => d * Math.PI / 180;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function parseTags(value) {
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map(tag => String(tag).trim())
        .filter(Boolean)
    )];
  }

  return [...new Set(
    String(value || "")
      .split(",")
      .map(tag => tag.trim())
      .filter(Boolean)
  )];
}


function hasProfileTag(deer, tag) {
  return parseTags(deer?.profile_tags)
    .some(
      existing =>
        existing.toLowerCase() ===
        String(tag).toLowerCase()
    );
}


function toLocalDateTimeInput(value) {
  const date =
    value
      ? new Date(value)
      : new Date();

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const shifted =
    new Date(
      date.getTime() -
      date.getTimezoneOffset() * 60000
    );

  return shifted
    .toISOString()
    .slice(0, 16);
}


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

let pendingPhotoMetadata = new Map();
let targetForecastCache = new Map();
let deerProfilePhotoUrls = new Map();


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

        ensureTargetHuntPlanUi();
        renderTargetBuckSelector();

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
  await loadDeerProfilePhotos();
}


async function loadDeerProfilePhotos() {
  deerProfilePhotoUrls.clear();

  const profileRows =
    deerProfiles.filter(
      deer =>
        deer.representative_photo_id
    );

  await Promise.all(
    profileRows.map(
      async deer => {
        try {
          const {
            data: photo
          } =
            await sb
              .from("trail_photos")
              .select("storage_path")
              .eq(
                "id",
                deer.representative_photo_id
              )
              .eq(
                "user_id",
                currentUser.id
              )
              .maybeSingle();

          if (!photo?.storage_path) {
            return;
          }

          const {
            data: signed
          } =
            await sb.storage
              .from("trail-camera-photos")
              .createSignedUrl(
                photo.storage_path,
                3600
              );

          if (signed?.signedUrl) {
            deerProfilePhotoUrls.set(
              deer.id,
              signed.signedUrl
            );
          }
        } catch (error) {
          console.warn(
            "Could not load deer profile image:",
            error
          );
        }
      }
    )
  );
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


async function sha256File(file) {
  const buffer =
    await file.arrayBuffer();

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );

  return Array.from(
    new Uint8Array(digest)
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


function knownDeerOptions(propertyId) {
  return deerProfiles
    .filter(
      deer =>
        deer.property_id === propertyId
    )
    .map(
      deer => `
        <option value="${deer.id}">
          ${escapeHtml(deer.nickname || deer.deer_code || "Unnamed deer")}
        </option>
      `
    )
    .join("");
}


function renderSelectedPreviews(files) {
  const section =
    $("photoPreviewSection");

  const grid =
    $("photoPreviewGrid");

  grid.innerHTML = "";
  pendingPhotoMetadata.clear();

  if (!files.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");

  Array.from(files)
    .slice(0, 100)
    .forEach((file, index) => {
      const url =
        URL.createObjectURL(file);

      const captureValue =
        file.lastModified
          ? toLocalDateTimeInput(
              new Date(file.lastModified)
            )
          : "";

      pendingPhotoMetadata.set(
        index,
        {
          captured_at:
            captureValue,

          human_characteristics:
            "",

          human_notes:
            "",

          photo_tags:
            []
        }
      );

      const card =
        document.createElement("div");

      card.className =
        "photo-item metadata-photo-card";

      card.innerHTML = `
        <img
          src="${url}"
          alt=""
        >

        <div class="photo-name">
          ${escapeHtml(file.name)}
        </div>

        <div class="pre-ai-badge">
          Review before AI
        </div>

        <label class="metadata-field">
          Known deer
          <select id="metaKnownDeer-${index}">
            <option value="">Unknown — let HOSE try to match it</option>
            ${knownDeerOptions($("uploadProperty")?.value || "")}
          </select>
        </label>

        <label class="metadata-field reference-choice">
          <input
            id="metaPreferReference-${index}"
            type="checkbox"
          >
          Use this as the profile/reference photo if assigned or confirmed
        </label>

        <label class="metadata-field">
          Capture date / time
          <input
            id="metaCapturedAt-${index}"
            type="datetime-local"
            value="${captureValue}"
          >
        </label>

        <label class="metadata-field">
          Buck / deer characteristics you noticed
          <textarea
            id="metaCharacteristics-${index}"
            rows="3"
            placeholder="Example: split right G2, curled left brow, scar on shoulder..."
          ></textarea>
        </label>

        <label class="metadata-field">
          Hunter notes
          <textarea
            id="metaNotes-${index}"
            rows="2"
            placeholder="Anything you want HOSE to know before AI analyzes this image..."
          ></textarea>
        </label>

        <label class="metadata-field">
          Photo tags
          <input
            id="metaTags-${index}"
            placeholder="scrape, daylight, field edge"
          >
        </label>
      `;

      grid.appendChild(card);
    });

  if ($("processUploadBtn")) {
    $("processUploadBtn").textContent =
      "Upload & Analyze Reviewed Photos";
  }
}


function getPendingPhotoMetadata(index, file) {
  const capturedInput =
    $(`metaCapturedAt-${index}`);

  const characteristicsInput =
    $(`metaCharacteristics-${index}`);

  const notesInput =
    $(`metaNotes-${index}`);

  const tagsInput =
    $(`metaTags-${index}`);

  const capturedValue =
    capturedInput?.value
    ||
    (
      file.lastModified
        ? toLocalDateTimeInput(
            new Date(file.lastModified)
          )
        : ""
    );

  return {
    captured_at:
      capturedValue
        ? new Date(capturedValue).toISOString()
        : null,

    human_characteristics:
      characteristicsInput?.value?.trim()
      || null,

    human_notes:
      notesInput?.value?.trim()
      || null,

    photo_tags:
      parseTags(
        tagsInput?.value
      ),

    assigned_deer_profile_id:
      $(`metaKnownDeer-${index}`)?.value
      || null,

    prefer_as_reference:
      Boolean(
        $(`metaPreferReference-${index}`)?.checked
      ),

    metadata_reviewed:
      true
  };
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

      const metadata =
        getPendingPhotoMetadata(
          i,
          file
        );

      $("uploadProgress").textContent =
        `Checking ${i + 1} of ${files.length} for duplicates: ${file.name}`;

      const fileHash =
        await sha256File(file);

      const {
        data: duplicatePhoto,
        error: duplicateLookupError
      } =
        await sb
          .from("trail_photos")
          .select("id, original_filename, processing_status")
          .eq("user_id", currentUser.id)
          .eq("file_hash", fileHash)
          .maybeSingle();

      if (duplicateLookupError) {
        throw duplicateLookupError;
      }

      if (duplicatePhoto) {
        $("uploadProgress").textContent =
          `Skipped exact duplicate: ${file.name}. HOSE already has this image.`;

        continue;
      }

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
              metadata.captured_at,

            human_characteristics:
              metadata.human_characteristics,

            human_notes:
              metadata.human_notes,

            photo_tags:
              metadata.photo_tags,

            metadata_reviewed:
              metadata.metadata_reviewed,

            assigned_deer_profile_id:
              metadata.assigned_deer_profile_id,

            prefer_as_reference:
              metadata.prefer_as_reference,

            file_hash:
              fileHash,

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

      if (
        aiResult?.identity?.status ===
        "needs_confirmation"
      ) {
        await showDeerMatchConfirmation(
          aiResult
        );
      }

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


let activeDeerProfileIndex = 0;
let deerProfileSortMode = "biggest_score";

function deerScoreValue(deer) {
  const value = deer.user_estimated_score ?? deer.ai_score_estimate;
  const number = Number(value);
  return Number.isFinite(number) ? number : -1;
}

function deerAgeValue(deer) {
  const value = deer.estimated_age ?? deer.estimated_age_class ?? "";
  const match = String(value).match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? Number(match[0]) : -1;
}

function deerFirstSeenValue(deer) {
  const value = deer.first_seen ?? deer.created_at;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function deerLastSeenValue(deer) {
  const value = deer.last_seen ?? deer.updated_at;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function sortedDeerProfiles() {
  const rows = [...deerProfiles];

  rows.sort((a, b) => {
    switch (deerProfileSortMode) {
      case "oldest_age":
        return deerAgeValue(b) - deerAgeValue(a);

      case "latest_seen":
        return deerLastSeenValue(b) - deerLastSeenValue(a);

      case "oldest_photo":
        return deerFirstSeenValue(a) - deerFirstSeenValue(b);

      case "biggest_score":
      default:
        return deerScoreValue(b) - deerScoreValue(a);
    }
  });

  return rows;
}

function moveDeerProfile(direction) {
  const rows = sortedDeerProfiles();

  if (!rows.length) {
    return;
  }

  activeDeerProfileIndex =
    (activeDeerProfileIndex + direction + rows.length)
    % rows.length;

  renderDeerProfiles();
}

function setDeerProfileSort(mode) {
  deerProfileSortMode = mode;
  activeDeerProfileIndex = 0;
  renderDeerProfiles();
}

function renderDeerProfiles() {
  const container = $("deerCards");

  if (!container) {
    return;
  }

  if (!deerProfiles.length) {
    container.innerHTML = `
      <section class="deer-focus-empty">
        <div class="eyebrow">Deer Intelligence</div>
        <h2>No deer profiles yet</h2>
        <p class="muted">
          Upload a trail-camera photo to begin building deer intelligence.
        </p>
      </section>
    `;

    renderTargetBuckSelector();
    return;
  }

  const rows = sortedDeerProfiles();

  if (activeDeerProfileIndex >= rows.length) {
    activeDeerProfileIndex = 0;
  }

  const deer = rows[activeDeerProfileIndex];
  const tags = parseTags(deer.profile_tags);
  const score = deerScoreValue(deer);
  const age = deerAgeValue(deer);
  const firstSeen = deer.first_seen ?? deer.created_at;
  const lastSeen = deer.last_seen ?? deer.updated_at;
  const photoUrl = deerProfilePhotoUrls.get(deer.id);

  const fingerprint = deer.identity_fingerprint || {};
  const evidenceCount = Number(fingerprint.evidence_photo_count || 0);
  const angles = fingerprint.all_view_angles || [];

  const identityConfidence =
    deer.identity_confidence != null
      ? `${Math.round(Number(deer.identity_confidence) * 100)}%`
      : evidenceCount
        ? `${evidenceCount} confirmed`
        : "Building";

  const scoreRange =
    deer.ai_score_range_low != null &&
    deer.ai_score_range_high != null
      ? `${Number(deer.ai_score_range_low).toFixed(0)}–${Number(deer.ai_score_range_high).toFixed(0)}" range`
      : "No range yet";

  container.innerHTML = `
    <section class="deer-focus-shell">

      <div class="deer-focus-toolbar">
        <div>
          <div class="eyebrow">Deer Intelligence</div>
          <h2>Deer Profile</h2>
        </div>

        <label class="deer-focus-sort">
          <span>Sort deer by</span>

          <select onchange="setDeerProfileSort(this.value)">
            <option value="biggest_score" ${deerProfileSortMode === "biggest_score" ? "selected" : ""}>
              Biggest score
            </option>

            <option value="oldest_age" ${deerProfileSortMode === "oldest_age" ? "selected" : ""}>
              Oldest deer
            </option>

            <option value="latest_seen" ${deerProfileSortMode === "latest_seen" ? "selected" : ""}>
              Latest seen
            </option>

            <option value="oldest_photo" ${deerProfileSortMode === "oldest_photo" ? "selected" : ""}>
              Oldest picture date
            </option>
          </select>
        </label>
      </div>

      <article class="deer-focus-card">

        <button
          class="deer-focus-arrow deer-focus-arrow-left"
          type="button"
          onclick="moveDeerProfile(-1)"
          aria-label="Previous deer"
        >
          &#8249;
        </button>

        <div class="deer-focus-image-column">

          <div class="deer-focus-image-wrap">
            ${
              photoUrl
                ? `<img src="${photoUrl}" alt="Profile photo for ${escapeHtml(deer.nickname || deer.deer_code || "deer")}">`
                : `<div class="deer-focus-image-empty">🦌</div>`
            }
          </div>

          <div class="deer-focus-position">
            ${activeDeerProfileIndex + 1} of ${rows.length}
          </div>

        </div>

        <button
          class="deer-focus-arrow deer-focus-arrow-right"
          type="button"
          onclick="moveDeerProfile(1)"
          aria-label="Next deer"
        >
          &#8250;
        </button>

        <div class="deer-focus-details">

          <div class="deer-focus-name-row">

            <div>
              <h1>
                ${escapeHtml(deer.nickname || deer.deer_code || "Unnamed Deer")}
              </h1>

              <div class="deer-focus-tags">
                ${
                  tags.length
                    ? tags.map(tag => `<span class="meta-chip deer-tag ${tag.toLowerCase() === "target" ? "target-tag" : ""}">${escapeHtml(tag)}</span>`).join("")
                    : `<span class="small muted">No tags yet</span>`
                }
              </div>
            </div>

            <button
              class="secondary mini"
              type="button"
              onclick="openDeerProfileEditor('${deer.id}')"
            >
              Edit
            </button>

          </div>

          <div class="deer-focus-score">
            <span>HOSE Score</span>

            <strong>
              ${score >= 0 ? `~${score.toFixed(1)}"` + '"' : "—"}
            </strong>

            <small>${scoreRange}</small>

            ${
              deer.ai_score_confidence != null
                ? `<small>${Math.round(Number(deer.ai_score_confidence) * 100)}% score confidence</small>`
                : ""
            }

            ${
              deer.calibration_applied
                ? `<small class="calibration-applied">HOSE calibration applied</small>`
                : ""
            }
          </div>

          <div class="deer-focus-grid">

            <div>
              <span>Estimated Age</span>
              <strong>${age >= 0 ? `${age} yr` : "—"}</strong>
            </div>

            <div>
              <span>Identity</span>
              <strong>${identityConfidence}</strong>
            </div>

            <div>
              <span>Sightings</span>
              <strong>${Number(deer.sighting_count || 0)}</strong>
            </div>

            <div>
              <span>Useful Angles</span>
              <strong>${angles.length}</strong>
            </div>

          </div>

          <div class="deer-focus-history">

            <div>
              <span>First seen</span>
              <strong>${firstSeen ? new Date(firstSeen).toLocaleDateString() : "Unknown"}</strong>
            </div>

            <div>
              <span>Last seen</span>
              <strong>${lastSeen ? new Date(lastSeen).toLocaleString() : "Unknown"}</strong>
            </div>

          </div>

          ${
            deer.confirmed_characteristics
              ? `<p class="small"><strong>Confirmed characteristics:</strong> ${escapeHtml(deer.confirmed_characteristics)}</p>`
              : ""
          }

          ${
            deer.hunter_notes
              ? `<p class="small"><strong>Hunter notes:</strong> ${escapeHtml(deer.hunter_notes)}</p>`
              : ""
          }

          <div class="deer-focus-actions">

            <button
              class="primary"
              type="button"
              onclick="openIdentityEvidence('${deer.id}')"
            >
              Identity Evidence
            </button>

            <button
              class="secondary"
              type="button"
              onclick="openScoreFeedback('${deer.id}')"
            >
              Score Feedback
            </button>

            <button
              class="secondary"
              type="button"
              onclick="openMergeDeer('${deer.id}')"
            >
              Merge Deer
            </button>

            <button
              class="secondary"
              type="button"
              onclick="toggleTargetTag('${deer.id}')"
            >
              ${hasProfileTag(deer, "Target") ? "✓ Target" : "Mark Target"}
            </button>

          </div>

        </div>

      </article>

    </section>
  `;

  renderTargetBuckSelector();
}


function ensureMergeDeerUi() {
  if ($("mergeDeerModal")) {
    return;
  }

  const modal =
    document.createElement("div");

  modal.id =
    "mergeDeerModal";

  modal.className =
    "hose-modal hidden";

  modal.innerHTML = `
    <div class="hose-modal-backdrop"></div>

    <article class="hose-modal-card">
      <div class="card-heading">
        <div>
          <div class="eyebrow">Identity Correction</div>
          <h3>Merge Deer Profiles</h3>
        </div>

        <button
          id="closeMergeDeerBtn"
          type="button"
          class="secondary mini"
        >
          Close
        </button>
      </div>

      <p class="small muted">
        Use this when two HOSE profiles are actually the same deer. The selected destination profile is kept; sightings, identity evidence, tags and useful metadata are moved into it.
      </p>

      <input
        id="mergeSourceDeerId"
        type="hidden"
      >

      <label>
        Merge this deer into
        <select id="mergeDestinationDeer"></select>
      </label>

      <label class="reference-choice">
        <input
          id="mergeUseSourcePhoto"
          type="checkbox"
        >
        Use the source deer's profile photo after merge
      </label>

      <div class="button-row">
        <button
          id="confirmMergeDeerBtn"
          type="button"
          class="primary"
        >
          Merge Profiles
        </button>
      </div>

      <div
        id="mergeDeerMessage"
        class="small muted"
      ></div>
    </article>
  `;

  document.body.appendChild(
    modal
  );

  $("closeMergeDeerBtn")
    .addEventListener(
      "click",
      () =>
        modal.classList.add("hidden")
    );

  modal
    .querySelector(".hose-modal-backdrop")
    .addEventListener(
      "click",
      () =>
        modal.classList.add("hidden")
    );

  $("confirmMergeDeerBtn")
    .addEventListener(
      "click",
      mergeDeerProfiles
    );
}


function openMergeDeer(sourceDeerId) {
  ensureMergeDeerUi();

  const source =
    deerProfiles.find(
      deer =>
        deer.id === sourceDeerId
    );

  if (!source) {
    return;
  }

  const candidates =
    deerProfiles.filter(
      deer =>
        deer.id !== sourceDeerId
        &&
        deer.property_id === source.property_id
    );

  $("mergeSourceDeerId").value =
    sourceDeerId;

  $("mergeDestinationDeer").innerHTML =
    '<option value="">Choose the profile to keep…</option>'
    +
    candidates
      .map(
        deer =>
          `<option value="${deer.id}">${escapeHtml(deer.nickname || deer.deer_code || "Unnamed deer")}</option>`
      )
      .join("");

  $("mergeUseSourcePhoto").checked =
    false;

  $("mergeDeerMessage").textContent =
    `Source: ${source.nickname || source.deer_code || "Unnamed deer"}.`;

  $("mergeDeerModal")
    .classList
    .remove("hidden");
}


async function mergeDeerProfiles() {
  const sourceId =
    $("mergeSourceDeerId").value;

  const destinationId =
    $("mergeDestinationDeer").value;

  if (
    !sourceId ||
    !destinationId
  ) {
    $("mergeDeerMessage").textContent =
      "Choose the deer profile you want to keep.";
    return;
  }

  $("mergeDeerMessage").textContent =
    "Merging profiles…";

  try {
    const {
      data,
      error
    } =
      await sb.functions.invoke(
        "process-deer-photo",
        {
          body: {
            action:
              "merge_deer_profiles",

            source_deer_profile_id:
              sourceId,

            destination_deer_profile_id:
              destinationId,

            use_source_reference_photo:
              $("mergeUseSourcePhoto").checked
          }
        }
      );

    if (error) {
      throw error;
    }

    if (data?.ok === false) {
      throw new Error(
        data.error ||
        "Could not merge deer profiles."
      );
    }

    await Promise.all([
      loadDeerProfiles(),
      loadSightings()
    ]);

    renderDeerProfiles();

    $("mergeDeerMessage").textContent =
      "Profiles merged successfully.";

    setTimeout(
      () =>
        $("mergeDeerModal")
          .classList
          .add("hidden"),
      450
    );

  } catch (error) {
    $("mergeDeerMessage").textContent =
      error?.message
      ||
      String(error);
  }
}


function ensureDeerProfileEditor() {
  if ($("deerProfileEditor")) {
    return;
  }

  const modal =
    document.createElement("div");

  modal.id =
    "deerProfileEditor";

  modal.className =
    "hose-modal hidden";

  modal.innerHTML = `
    <div class="hose-modal-backdrop" data-close-profile-editor="1"></div>

    <article class="hose-modal-card">
      <div class="card-heading">
        <div>
          <div class="eyebrow">Hunter Review</div>
          <h3>Edit Deer Profile</h3>
        </div>

        <button
          id="closeDeerProfileEditorBtn"
          type="button"
          class="secondary mini"
        >
          Close
        </button>
      </div>

      <input
        id="editDeerId"
        type="hidden"
      >

      <div class="form-grid">
        <label>
          Nickname
          <input
            id="editDeerNickname"
            placeholder="Split G2"
          >
        </label>

        <label>
          Estimated age class
          <select id="editDeerAge">
            <option value="">Unknown / leave AI estimate</option>
            <option value="1.5">1.5</option>
            <option value="2.5">2.5</option>
            <option value="3.5">3.5</option>
            <option value="4.5">4.5</option>
            <option value="5.5+">5.5+</option>
          </select>
        </label>
      </div>

      <label>
        Hunter-estimated Boone & Crockett gross score
        <input
          id="editDeerScore"
          type="number"
          min="0"
          step=".25"
          placeholder="Example: 142.5"
        >
      </label>

      <label>
        Confirmed / hunter-observed characteristics
        <textarea
          id="editDeerCharacteristics"
          rows="4"
          placeholder="Split right G2; inside sticker; left brow curls inward; scar on left shoulder..."
        ></textarea>
      </label>

      <label>
        Hunter notes
        <textarea
          id="editDeerNotes"
          rows="4"
          placeholder="Season history, behavior, pass/shooter notes, etc."
        ></textarea>
      </label>

      <label>
        Tags — comma separated
        <input
          id="editDeerTags"
          placeholder="Target, Shooter, Mature, Resident"
        >
      </label>

      <div class="quick-tags">
        <button type="button" class="secondary mini" data-quick-tag="Target">Target</button>
        <button type="button" class="secondary mini" data-quick-tag="Shooter">Shooter</button>
        <button type="button" class="secondary mini" data-quick-tag="Watch">Watch</button>
        <button type="button" class="secondary mini" data-quick-tag="Pass">Pass</button>
        <button type="button" class="secondary mini" data-quick-tag="Mature">Mature</button>
        <button type="button" class="secondary mini" data-quick-tag="Resident">Resident</button>
        <button type="button" class="secondary mini" data-quick-tag="Transient">Transient</button>
        <button type="button" class="secondary mini" data-quick-tag="Harvested">Harvested</button>
      </div>

      <div class="profile-editor-note small muted">
        AI traits remain visible separately. Your edits are stored as hunter-confirmed context rather than silently overwriting the AI record.
      </div>

      <div class="button-row">
        <button
          id="saveDeerProfileBtn"
          type="button"
          class="primary"
        >
          Save Profile
        </button>
      </div>

      <div
        id="deerProfileEditorMessage"
        class="small muted"
      ></div>
    </article>
  `;

  document.body.appendChild(
    modal
  );

  $("closeDeerProfileEditorBtn")
    .addEventListener(
      "click",
      closeDeerProfileEditor
    );

  modal
    .querySelectorAll(
      '[data-close-profile-editor="1"]'
    )
    .forEach(
      el =>
        el.addEventListener(
          "click",
          closeDeerProfileEditor
        )
    );

  modal
    .querySelectorAll(
      "[data-quick-tag]"
    )
    .forEach(
      button =>
        button.addEventListener(
          "click",
          () => {
            const current =
              parseTags(
                $("editDeerTags").value
              );

            const tag =
              button.dataset.quickTag;

            if (
              !current.some(
                existing =>
                  existing.toLowerCase() ===
                  tag.toLowerCase()
              )
            ) {
              current.push(tag);
            }

            $("editDeerTags").value =
              current.join(", ");
          }
        )
    );

  $("saveDeerProfileBtn")
    .addEventListener(
      "click",
      saveDeerProfileEdits
    );
}


function openDeerProfileEditor(deerId) {
  ensureDeerProfileEditor();

  const deer =
    deerProfiles.find(
      row =>
        row.id === deerId
    );

  if (!deer) {
    return;
  }

  $("editDeerId").value =
    deer.id;

  $("editDeerNickname").value =
    deer.nickname || "";

  $("editDeerAge").value =
    deer.estimated_age_class || "";

  $("editDeerScore").value =
    deer.user_estimated_score ?? "";

  $("editDeerCharacteristics").value =
    deer.confirmed_characteristics || "";

  $("editDeerNotes").value =
    deer.hunter_notes || "";

  $("editDeerTags").value =
    parseTags(
      deer.profile_tags
    ).join(", ");

  $("deerProfileEditorMessage").textContent =
    "";

  $("deerProfileEditor")
    .classList
    .remove("hidden");
}


function closeDeerProfileEditor() {
  $("deerProfileEditor")
    ?.classList
    .add("hidden");
}


async function saveDeerProfileEdits() {
  const deerId =
    $("editDeerId").value;

  if (!deerId) {
    return;
  }

  $("deerProfileEditorMessage").textContent =
    "Saving…";

  const scoreValue =
    $("editDeerScore").value;

  const updates = {
    nickname:
      $("editDeerNickname").value.trim()
      || null,

    estimated_age_class:
      $("editDeerAge").value
      || null,

    user_estimated_score:
      scoreValue
        ? Number(scoreValue)
        : null,

    confirmed_characteristics:
      $("editDeerCharacteristics").value.trim()
      || null,

    hunter_notes:
      $("editDeerNotes").value.trim()
      || null,

    profile_tags:
      parseTags(
        $("editDeerTags").value
      ),

    last_hunter_reviewed_at:
      new Date().toISOString()
  };

  const {
    error
  } =
    await sb
      .from("deer_profiles")
      .update(updates)
      .eq(
        "id",
        deerId
      )
      .eq(
        "user_id",
        currentUser.id
      );

  if (error) {
    $("deerProfileEditorMessage").textContent =
      error.message;

    return;
  }

  await loadDeerProfiles();
  renderDeerProfiles();

  $("deerProfileEditorMessage").textContent =
    "Profile saved.";

  setTimeout(
    closeDeerProfileEditor,
    350
  );
}


async function toggleTargetTag(deerId) {
  const deer =
    deerProfiles.find(
      row =>
        row.id === deerId
    );

  if (!deer) {
    return;
  }

  let tags =
    parseTags(
      deer.profile_tags
    );

  const alreadyTarget =
    tags.some(
      tag =>
        tag.toLowerCase() ===
        "target"
    );

  if (alreadyTarget) {
    tags =
      tags.filter(
        tag =>
          tag.toLowerCase() !==
          "target"
      );
  } else {
    tags.push(
      "Target"
    );
  }

  const {
    error
  } =
    await sb
      .from("deer_profiles")
      .update({
        profile_tags:
          tags,

        last_hunter_reviewed_at:
          new Date().toISOString()
      })
      .eq(
        "id",
        deerId
      )
      .eq(
        "user_id",
        currentUser.id
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


function ensureDeerMatchConfirmationUi() {
  if ($("deerMatchConfirmation")) {
    return;
  }

  const modal =
    document.createElement("div");

  modal.id =
    "deerMatchConfirmation";

  modal.className =
    "hose-modal hidden";

  modal.innerHTML = `
    <div class="hose-modal-backdrop"></div>
    <article class="hose-modal-card match-confirm-card">
      <div class="eyebrow">HOSE Identity Review</div>
      <h3>Possible Existing Deer</h3>

      <div id="matchConfirmBody"></div>

      <label class="reference-choice">
        <input id="matchUseReference" type="checkbox">
        Use this new image as this deer's profile photo
      </label>

      <div class="match-confirm-actions">
        <button id="matchYesBtn" type="button" class="primary">
          Yes — same deer
        </button>

        <button id="matchChooseBtn" type="button" class="secondary">
          Choose another deer
        </button>

        <button id="matchNewBtn" type="button" class="secondary">
          This is a new deer
        </button>
      </div>

      <div id="matchAlternateWrap" class="hidden">
        <label>
          Existing deer
          <select id="matchAlternateProfile"></select>
        </label>
        <button id="matchAlternateSaveBtn" type="button" class="primary">
          Assign selected deer
        </button>
      </div>

      <div id="matchConfirmMessage" class="small muted"></div>
    </article>
  `;

  document.body.appendChild(modal);
}


function profileOptionRows(propertyId) {
  return deerProfiles
    .filter(
      deer =>
        !propertyId ||
        deer.property_id === propertyId
    )
    .map(
      deer =>
        `<option value="${deer.id}">${escapeHtml(deer.nickname || deer.deer_code || "Unnamed deer")}</option>`
    )
    .join("");
}


function showDeerMatchConfirmation(aiResult) {
  ensureDeerMatchConfirmationUi();

  const identity =
    aiResult.identity;

  const candidate =
    deerProfiles.find(
      deer =>
        deer.id ===
        identity.candidate_deer_profile_id
    );

  const photoUrl =
    candidate
      ? deerProfilePhotoUrls.get(candidate.id)
      : null;

  const score =
    Math.round(
      Number(identity.match_score || identity.confidence || 0)
      * 100
    );

  $("matchConfirmBody").innerHTML = `
    <div class="match-side-by-side">
      <div>
        <div class="small muted">Possible match</div>
        ${
          photoUrl
            ? `<img class="match-reference-image" src="${photoUrl}" alt="">`
            : `<div class="match-reference-image deer-profile-image-empty">🦌</div>`
        }
      </div>

      <div>
        <strong>${escapeHtml(candidate?.nickname || candidate?.deer_code || "Existing deer")}</strong>
        <div class="match-score">Match score: ${score}%</div>
        <p class="small">${escapeHtml(identity.reason || "")}</p>
        ${
          identity.shared_traits?.length
            ? `<p class="small"><strong>Shared:</strong> ${escapeHtml(identity.shared_traits.join(", "))}</p>`
            : ""
        }
        ${
          identity.conflicting_traits?.length
            ? `<p class="small"><strong>Differences:</strong> ${escapeHtml(identity.conflicting_traits.join(", "))}</p>`
            : ""
        }
      </div>
    </div>
  `;

  $("matchAlternateProfile").innerHTML =
    profileOptionRows(
      candidate?.property_id
    );

  $("matchAlternateWrap").classList.add("hidden");
  $("matchConfirmMessage").textContent = "";
  $("matchUseReference").checked = false;
  $("deerMatchConfirmation").classList.remove("hidden");

  return new Promise(
    resolve => {
      const finish =
        async (
          decision,
          deerProfileId = null
        ) => {
          $("matchConfirmMessage").textContent =
            "Saving your decision…";

          try {
            const {
              data,
              error
            } =
              await sb.functions.invoke(
                "process-deer-photo",
                {
                  body: {
                    action:
                      "resolve_match",

                    photo_id:
                      aiResult.photo_id,

                    deer_match_id:
                      identity.deer_match_id,

                    decision,

                    deer_profile_id:
                      deerProfileId,

                    use_as_reference:
                      $("matchUseReference").checked
                  }
                }
              );

            if (error) {
              throw error;
            }

            if (data?.ok === false) {
              throw new Error(
                data.error ||
                "Could not save match decision."
              );
            }

            $("deerMatchConfirmation").classList.add("hidden");
            await loadDeerProfiles();
            renderDeerProfiles();
            resolve(data);

          } catch (error) {
            $("matchConfirmMessage").textContent =
              error?.message ||
              String(error);
          }
        };

      $("matchYesBtn").onclick =
        () =>
          finish(
            "confirm",
            identity.candidate_deer_profile_id
          );

      $("matchNewBtn").onclick =
        () =>
          finish(
            "new"
          );

      $("matchChooseBtn").onclick =
        () => {
          $("matchAlternateWrap")
            .classList
            .remove("hidden");
        };

      $("matchAlternateSaveBtn").onclick =
        () => {
          const selected =
            $("matchAlternateProfile").value;

          if (!selected) {
            $("matchConfirmMessage").textContent =
              "Choose an existing deer.";
            return;
          }

          finish(
            "confirm",
            selected
          );
        };
    }
  );
}


function ensureIdentityEvidenceUi() {
  if ($("identityEvidenceModal")) {
    return;
  }

  const modal =
    document.createElement("div");

  modal.id =
    "identityEvidenceModal";

  modal.className =
    "hose-modal hidden";

  modal.innerHTML = `
    <div class="hose-modal-backdrop"></div>

    <article class="hose-modal-card identity-evidence-modal-card">
      <div class="card-heading">
        <div>
          <div class="eyebrow">Multi-angle Identity</div>
          <h3 id="identityEvidenceTitle">Identity Evidence</h3>
        </div>

        <button
          id="closeIdentityEvidenceBtn"
          type="button"
          class="secondary mini"
        >
          Close
        </button>
      </div>

      <div
        id="identityEvidenceSummary"
        class="identity-evidence-summary"
      ></div>

      <div
        id="identityEvidenceGrid"
        class="identity-evidence-grid"
      ></div>

      <div
        id="identityEvidenceMessage"
        class="small muted"
      ></div>
    </article>
  `;

  document.body.appendChild(
    modal
  );

  $("closeIdentityEvidenceBtn")
    .addEventListener(
      "click",
      () =>
        modal.classList.add("hidden")
    );

  modal
    .querySelector(".hose-modal-backdrop")
    .addEventListener(
      "click",
      () =>
        modal.classList.add("hidden")
    );
}


async function openIdentityEvidence(deerId) {
  ensureIdentityEvidenceUi();

  const deer =
    deerProfiles.find(
      row =>
        row.id === deerId
    );

  if (!deer) {
    return;
  }

  $("identityEvidenceTitle").textContent =
    `${deer.nickname || deer.deer_code || "Deer"} — Identity Evidence`;

  $("identityEvidenceGrid").innerHTML =
    "";

  $("identityEvidenceMessage").textContent =
    "Loading confirmed evidence photos…";

  $("identityEvidenceModal")
    .classList
    .remove("hidden");

  const {
    data: rows,
    error
  } =
    await sb
      .from("deer_identity_evidence")
      .select("*")
      .eq("user_id", currentUser.id)
      .eq("deer_profile_id", deerId)
      .order("captured_at", {
        ascending: false,
        nullsFirst: false
      })
      .limit(30);

  if (error) {
    $("identityEvidenceMessage").textContent =
      error.message;
    return;
  }

  const evidence =
    rows || [];

  const fingerprint =
    deer.identity_fingerprint
    || {};

  $("identityEvidenceSummary").innerHTML = `
    <div class="metric">
      <b>${evidence.length}</b>
      <span>confirmed views</span>
    </div>

    <div class="metric">
      <b>${(fingerprint.all_view_angles || []).length}</b>
      <span>angles represented</span>
    </div>

    <div class="metric">
      <b>${deer.ai_score_estimate != null ? `${Number(deer.ai_score_estimate).toFixed(1)}"` : "—"}</b>
      <span>multi-photo score estimate</span>
    </div>
  `;

  const cards =
    [];

  for (
    const row
    of evidence
  ) {
    const {
      data: photo
    } =
      await sb
        .from("trail_photos")
        .select("storage_path")
        .eq("id", row.photo_id)
        .eq("user_id", currentUser.id)
        .maybeSingle();

    let signedUrl =
      null;

    if (photo?.storage_path) {
      const {
        data: signed
      } =
        await sb.storage
          .from("trail-camera-photos")
          .createSignedUrl(
            photo.storage_path,
            3600
          );

      signedUrl =
        signed?.signedUrl
        || null;
    }

    cards.push(`
      <div class="identity-evidence-card">
        ${
          signedUrl
            ? `<img src="${signedUrl}" alt="">`
            : `<div class="deer-profile-image deer-profile-image-empty">🦌</div>`
        }

        <strong>${escapeHtml((row.view_angle || "unknown").replaceAll("_", " "))}</strong>

        <div class="small muted">
          ${row.captured_at ? new Date(row.captured_at).toLocaleString() : "Unknown capture time"}
        </div>

        ${
          row.score_estimable &&
          row.gross_score_inches != null
            ? `
              <div class="evidence-score">
                ~${Number(row.gross_score_inches).toFixed(1)}"
                ${
                  row.score_range_low_inches != null &&
                  row.score_range_high_inches != null
                    ? ` (${Number(row.score_range_low_inches).toFixed(0)}–${Number(row.score_range_high_inches).toFixed(0)}")`
                    : ""
                }
              </div>
            `
            : `<div class="small muted">Rack not scoreable from this view</div>`
        }

        <div class="small">
          ${escapeHtml((row.antler_traits || []).slice(0, 4).join(" · "))}
        </div>

        <button
          type="button"
          class="secondary mini"
          onclick="setProfileReferencePhoto('${deerId}', '${row.photo_id}')"
        >
          Use as Profile Photo
        </button>
      </div>
    `);
  }

  $("identityEvidenceGrid").innerHTML =
    cards.join("")
    ||
    '<div class="muted">No confirmed identity evidence yet.</div>';

  $("identityEvidenceMessage").textContent =
    "HOSE keeps traits, score samples and sighting metadata from every confirmed view. Redundant raw photos may be removed after 48 hours, while the best useful angle photos and protected images stay.";
}


async function setProfileReferencePhoto(
  deerId,
  photoId
) {
  const {
    error
  } =
    await sb
      .from("deer_profiles")
      .update({
        representative_photo_id:
          photoId
      })
      .eq("id", deerId)
      .eq("user_id", currentUser.id);

  if (error) {
    $("identityEvidenceMessage").textContent =
      error.message;
    return;
  }

  await loadDeerProfiles();
  renderDeerProfiles();

  $("identityEvidenceMessage").textContent =
    "Profile photo updated.";
}



function ensureScoreFeedbackUi() {
  if ($("scoreFeedbackModal")) {
    return;
  }

  const modal =
    document.createElement("div");

  modal.id =
    "scoreFeedbackModal";

  modal.className =
    "hose-modal hidden";

  modal.innerHTML = `
    <div class="hose-modal-backdrop"></div>

    <article class="hose-modal-card">
      <div class="card-heading">
        <div>
          <div class="eyebrow">Scoring Calibration</div>
          <h3>Score Feedback</h3>
        </div>

        <button
          id="closeScoreFeedbackBtn"
          type="button"
          class="secondary mini"
        >
          Close
        </button>
      </div>

      <input
        id="scoreFeedbackDeerId"
        type="hidden"
      >

      <div id="scoreFeedbackCurrent" class="profile-score-box"></div>

      <label>
        How was HOSE's estimate?
        <select id="scoreFeedbackRating">
          <option value="">Choose feedback…</option>
          <option value="accurate">Pretty accurate</option>
          <option value="slightly_high">Slightly too high</option>
          <option value="much_too_high">Much too high</option>
          <option value="slightly_low">Slightly too low</option>
          <option value="much_too_low">Much too low</option>
          <option value="not_scoreable">Should not have been scored</option>
        </select>
      </label>

      <label>
        Correction type
        <select id="scoreFeedbackType">
          <option value="hunter_estimate">Hunter estimate</option>
          <option value="verified_measurement">Verified / measured score</option>
        </select>
      </label>

      <label>
        Your corrected estimate / known gross score
        <input
          id="scoreFeedbackCorrected"
          type="number"
          min="0"
          step=".25"
          placeholder="Example: 20 or 142.5"
        >
      </label>

      <label>
        Notes
        <textarea
          id="scoreFeedbackNotes"
          rows="3"
          placeholder="Example: spike buck, only ~10 inch spikes; AI badly overestimated tine/beam length."
        ></textarea>
      </label>

      <div class="button-row">
        <button
          id="saveScoreFeedbackBtn"
          type="button"
          class="primary"
        >
          Save Feedback
        </button>
      </div>

      <div
        id="scoreFeedbackMessage"
        class="small muted"
      ></div>
    </article>
  `;

  document.body.appendChild(
    modal
  );

  $("closeScoreFeedbackBtn")
    .addEventListener(
      "click",
      () =>
        modal.classList.add("hidden")
    );

  modal
    .querySelector(".hose-modal-backdrop")
    .addEventListener(
      "click",
      () =>
        modal.classList.add("hidden")
    );

  $("saveScoreFeedbackBtn")
    .addEventListener(
      "click",
      saveScoreFeedback
    );
}


function openScoreFeedback(deerId) {
  ensureScoreFeedbackUi();

  const deer =
    deerProfiles.find(
      row =>
        row.id === deerId
    );

  if (!deer) {
    return;
  }

  $("scoreFeedbackDeerId").value =
    deer.id;

  $("scoreFeedbackRating").value =
    "";

  $("scoreFeedbackType").value =
    "hunter_estimate";

  $("scoreFeedbackCorrected").value =
    deer.user_estimated_score
    ?? "";

  $("scoreFeedbackNotes").value =
    "";

  $("scoreFeedbackCurrent").innerHTML = `
    <div>
      <div class="small muted">Current HOSE estimate</div>
      <strong>
        ${
          deer.ai_score_estimate != null
            ? `${Number(deer.ai_score_estimate).toFixed(1)}"`
            : "No score"
        }
      </strong>
      ${
        deer.ai_score_range_low != null &&
        deer.ai_score_range_high != null
          ? `<span>${Number(deer.ai_score_range_low).toFixed(0)}–${Number(deer.ai_score_range_high).toFixed(0)}"</span>`
          : ""
      }
    </div>
  `;

  $("scoreFeedbackMessage").textContent =
    "";

  $("scoreFeedbackModal")
    .classList
    .remove("hidden");
}


async function saveScoreFeedback() {
  const deerId =
    $("scoreFeedbackDeerId").value;

  const rating =
    $("scoreFeedbackRating").value;

  if (!deerId || !rating) {
    $("scoreFeedbackMessage").textContent =
      "Choose a feedback rating.";
    return;
  }

  const correctedValue =
    $("scoreFeedbackCorrected").value;

  const correctedScore =
    correctedValue
      ? Number(correctedValue)
      : null;

  $("scoreFeedbackMessage").textContent =
    "Saving feedback…";

  const {
    error
  } =
    await sb
      .from("deer_score_feedback")
      .insert({
        user_id:
          currentUser.id,

        deer_profile_id:
          deerId,

        ai_score_estimate:
          deerProfiles.find(
            row =>
              row.id === deerId
          )?.ai_score_estimate
          ?? null,

        feedback_rating:
          rating,

        corrected_score:
          correctedScore,

        correction_type:
          $("scoreFeedbackType").value,

        antler_points_visible:
          deerProfiles.find(
            row =>
              row.id === deerId
          )?.identity_fingerprint
            ?.seasons
            ? null
            : null,

        size_class:
          (() => {
            const deer =
              deerProfiles.find(
                row =>
                  row.id === deerId
              );

            const score =
              Number(
                deer?.ai_score_estimate
                || 0
              );

            if (score < 35) {
              return "spike_small";
            }

            if (score < 70) {
              return "small";
            }

            if (score < 110) {
              return "medium";
            }

            if (score < 140) {
              return "large";
            }

            return "very_large";
          })(),

        signed_error:
          correctedScore != null
          &&
          deerProfiles.find(
            row =>
              row.id === deerId
          )?.ai_score_estimate != null
            ? Number(
                deerProfiles.find(
                  row =>
                    row.id === deerId
                ).ai_score_estimate
              )
              -
              correctedScore
            : null,

        absolute_error:
          correctedScore != null
          &&
          deerProfiles.find(
            row =>
              row.id === deerId
          )?.ai_score_estimate != null
            ? Math.abs(
                Number(
                  deerProfiles.find(
                    row =>
                      row.id === deerId
                  ).ai_score_estimate
                )
                -
                correctedScore
              )
            : null,

        notes:
          $("scoreFeedbackNotes").value.trim()
          || null
      });

  if (error) {
    $("scoreFeedbackMessage").textContent =
      error.message;
    return;
  }

  if (correctedScore != null) {
    await sb
      .from("deer_profiles")
      .update({
        user_estimated_score:
          correctedScore
      })
      .eq("id", deerId)
      .eq("user_id", currentUser.id);
  }

  await loadDeerProfiles();
  renderDeerProfiles();

  $("scoreFeedbackMessage").textContent =
    "Feedback saved.";

  setTimeout(
    () =>
      $("scoreFeedbackModal")
        .classList
        .add("hidden"),
    400
  );
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
   TARGET HUNT PLAN
   ============================================================ */

function ensureTargetHuntPlanUi() {
  if (
    $("targetHuntPlanCard") ||
    !$("areaMap")
  ) {
    return;
  }

  const card =
    document.createElement("article");

  card.id =
    "targetHuntPlanCard";

  card.className =
    "intel-card target-hunt-card";

  card.innerHTML = `
    <div class="card-heading">
      <div>
        <div class="eyebrow">Target Intelligence</div>
        <h3>Target Hunt Plan</h3>
        <p class="small muted">
          Rank mapped stands and upcoming daylight windows using this target buck's sightings, camera history, wind, and forecast weather.
        </p>
      </div>

      <span class="target-pill">
        Target
      </span>
    </div>

    <div class="target-plan-controls">
      <label>
        Target buck
        <select id="targetBuckSelect">
          <option value="">Choose a Target-tagged buck…</option>
        </select>
      </label>

      <button
        id="buildTargetPlanBtn"
        type="button"
        class="primary map-action"
      >
        Build Hunt Plan
      </button>
    </div>

    <div
      id="targetPlanMessage"
      class="small muted"
    >
      Tag a buck as Target in My Deer Profiles, map at least one stand, then build a plan.
    </div>

    <div
      id="targetPlanResults"
      class="target-plan-results"
    ></div>
  `;

  $("areaMap")
    .insertAdjacentElement(
      "afterend",
      card
    );

  $("buildTargetPlanBtn")
    .addEventListener(
      "click",
      buildTargetHuntPlan
    );
}


function renderTargetBuckSelector() {
  if (!$("targetBuckSelect")) {
    return;
  }

  const propertyId =
    $("mapProperty")?.value
    || "";

  const targets =
    deerProfiles
      .filter(
        deer =>
          hasProfileTag(
            deer,
            "Target"
          )
      )
      .filter(
        deer =>
          !propertyId ||
          deer.property_id === propertyId
      );

  const previous =
    $("targetBuckSelect").value;

  $("targetBuckSelect").innerHTML =
    '<option value="">Choose a Target-tagged buck…</option>'
    +
    targets
      .map(
        deer =>
          `<option value="${deer.id}">${escapeHtml(deer.nickname || deer.deer_code || "Unnamed deer")}</option>`
      )
      .join("");

  if (
    targets.some(
      deer =>
        deer.id === previous
    )
  ) {
    $("targetBuckSelect").value =
      previous;
  } else if (
    targets.length === 1
  ) {
    $("targetBuckSelect").value =
      targets[0].id;
  }

  if ($("targetPlanMessage")) {
    if (!targets.length) {
      $("targetPlanMessage").textContent =
        "No Target-tagged bucks are saved for this property yet.";
    } else {
      $("targetPlanMessage").textContent =
        `${targets.length} Target buck${targets.length === 1 ? "" : "s"} available for hunt planning.`;
    }
  }
}


function normalizeDegrees(value) {
  return (
    (
      Number(value) % 360
    ) + 360
  ) % 360;
}


function angularDifference(a, b) {
  const diff =
    Math.abs(
      normalizeDegrees(a) -
      normalizeDegrees(b)
    );

  return Math.min(
    diff,
    360 - diff
  );
}


function bearingDegrees(
  fromLat,
  fromLon,
  toLat,
  toLon
) {
  const phi1 =
    rad(fromLat);

  const phi2 =
    rad(toLat);

  const lambda =
    rad(toLon - fromLon);

  const y =
    Math.sin(lambda)
    *
    Math.cos(phi2);

  const x =
    Math.cos(phi1)
    *
    Math.sin(phi2)
    -
    Math.sin(phi1)
    *
    Math.cos(phi2)
    *
    Math.cos(lambda);

  return normalizeDegrees(
    Math.atan2(
      y,
      x
    )
    *
    180
    /
    Math.PI
  );
}


function targetSightingsFor(deerId) {
  return sightings
    .filter(
      row =>
        row.deer_profile_id === deerId
    )
    .filter(
      row =>
        row.captured_at
    )
    .sort(
      (a, b) =>
        new Date(a.captured_at) -
        new Date(b.captured_at)
    );
}


function targetCameraHotspot(deerId) {
  const rows =
    targetSightingsFor(
      deerId
    );

  const cameraCounts =
    new Map();

  rows.forEach(
    sighting => {
      if (!sighting.camera_id) {
        return;
      }

      cameraCounts.set(
        sighting.camera_id,
        (
          cameraCounts.get(
            sighting.camera_id
          )
          || 0
        ) + 1
      );
    }
  );

  const ranked =
    [...cameraCounts.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
      );

  for (
    const [
      cameraId,
      count
    ]
    of ranked
  ) {
    const camera =
      cameras.find(
        row =>
          row.id === cameraId
      );

    if (
      camera &&
      Number.isFinite(
        Number(camera.lat)
      ) &&
      Number.isFinite(
        Number(camera.lon)
      )
    ) {
      return {
        camera,
        count
      };
    }
  }

  return null;
}


function historicalHourScore(
  targetRows,
  hour
) {
  if (!targetRows.length) {
    return 0.35;
  }

  const hours =
    targetRows
      .map(
        row =>
          new Date(
            row.captured_at
          ).getHours()
      )
      .filter(
        value =>
          Number.isFinite(value)
      );

  if (!hours.length) {
    return 0.35;
  }

  let matches = 0;

  hours.forEach(
    seenHour => {
      const diff =
        Math.min(
          Math.abs(
            seenHour - hour
          ),
          24 -
          Math.abs(
            seenHour - hour
          )
        );

      if (diff === 0) {
        matches += 1;
      } else if (diff === 1) {
        matches += .7;
      } else if (diff === 2) {
        matches += .35;
      }
    }
  );

  return Math.min(
    1,
    matches /
    Math.max(
      1,
      hours.length * .6
    )
  );
}


async function getTargetForecast(
  lat,
  lon
) {
  const cacheKey =
    `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

  const cached =
    targetForecastCache.get(
      cacheKey
    );

  if (
    cached &&
    Date.now() -
      cached.loadedAt
      <
      30 * 60 * 1000
  ) {
    return cached.data;
  }

  const url =
    "https://api.open-meteo.com/v1/forecast"
    +
    `?latitude=${encodeURIComponent(lat)}`
    +
    `&longitude=${encodeURIComponent(lon)}`
    +
    "&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code"
    +
    "&daily=sunrise,sunset"
    +
    "&temperature_unit=fahrenheit"
    +
    "&wind_speed_unit=mph"
    +
    "&timezone=auto"
    +
    "&forecast_days=7";

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Weather forecast is temporarily unavailable."
    );
  }

  const data =
    await response.json();

  targetForecastCache.set(
    cacheKey,
    {
      loadedAt:
        Date.now(),

      data
    }
  );

  return data;
}


function daylightWindowFor(
  forecast,
  timestamp
) {
  const dateKey =
    String(timestamp)
      .slice(0, 10);

  const dailyDates =
    forecast.daily?.time
    || [];

  const index =
    dailyDates.indexOf(
      dateKey
    );

  if (index < 0) {
    return true;
  }

  const sunrise =
    new Date(
      forecast.daily.sunrise[index]
    );

  const sunset =
    new Date(
      forecast.daily.sunset[index]
    );

  const time =
    new Date(timestamp);

  return (
    time >= sunrise &&
    time <= sunset
  );
}


function weatherCodeLabel(code) {
  const value =
    Number(code);

  if (value === 0) return "clear";
  if ([1,2,3].includes(value)) return "partly cloudy";
  if ([45,48].includes(value)) return "fog";
  if ([51,53,55,56,57].includes(value)) return "drizzle";
  if ([61,63,65,66,67,80,81,82].includes(value)) return "rain";
  if ([71,73,75,77,85,86].includes(value)) return "snow";
  if ([95,96,99].includes(value)) return "thunderstorms";
  return "mixed conditions";
}


function scoreStandForecastWindow({
  stand,
  hotspot,
  targetRows,
  forecastTime,
  temperature,
  precipitation,
  windSpeed,
  windDirection
}) {
  const hotspotLat =
    Number(hotspot.camera.lat);

  const hotspotLon =
    Number(hotspot.camera.lon);

  const standLat =
    Number(stand.lat);

  const standLon =
    Number(stand.lon);

  const distance =
    miles(
      standLat,
      standLon,
      hotspotLat,
      hotspotLon
    );

  const distanceScore =
    Math.max(
      0,
      30 -
      distance * 30
    );

  const hour =
    new Date(
      forecastTime
    ).getHours();

  const activityScore =
    historicalHourScore(
      targetRows,
      hour
    )
    * 25;

  /*
   * Forecast wind direction is the direction wind COMES FROM.
   * Human scent generally travels toward +180° from that direction.
   */
  const scentDirection =
    normalizeDegrees(
      Number(windDirection)
      +
      180
    );

  const standToHotspot =
    bearingDegrees(
      standLat,
      standLon,
      hotspotLat,
      hotspotLon
    );

  const scentAngle =
    angularDifference(
      scentDirection,
      standToHotspot
    );

  let windScore = 0;

  if (scentAngle >= 120) {
    windScore = 30;
  } else if (scentAngle >= 90) {
    windScore = 24;
  } else if (scentAngle >= 60) {
    windScore = 15;
  } else if (scentAngle >= 35) {
    windScore = 7;
  }

  const precip =
    Number(
      precipitation
      || 0
    );

  const weatherScore =
    Math.max(
      0,
      10 -
      precip * .1
    );

  const windSpeedNumber =
    Number(
      windSpeed
      || 0
    );

  const windSpeedScore =
    windSpeedNumber >= 3 &&
    windSpeedNumber <= 15
      ? 5
      : windSpeedNumber < 25
        ? 2
        : 0;

  const total =
    Math.round(
      Math.min(
        100,
        distanceScore
        +
        activityScore
        +
        windScore
        +
        weatherScore
        +
        windSpeedScore
      )
    );

  return {
    total,
    distance,
    distanceScore,
    activityScore,
    windScore,
    weatherScore,
    windSpeedScore,
    scentAngle,
    temperature:
      Number(temperature),

    precipitation:
      precip,

    windSpeed:
      windSpeedNumber,

    windDirection:
      Number(windDirection)
  };
}


async function buildTargetHuntPlan() {
  ensureTargetHuntPlanUi();

  const propertyId =
    $("mapProperty")?.value
    || "";

  const deerId =
    $("targetBuckSelect")?.value
    || "";

  const property =
    properties.find(
      row =>
        row.id === propertyId
    );

  const deer =
    deerProfiles.find(
      row =>
        row.id === deerId
    );

  if (!propertyId) {
    $("targetPlanMessage").textContent =
      "Choose a property first.";
    return;
  }

  if (!deer) {
    $("targetPlanMessage").textContent =
      "Choose a Target-tagged buck first.";
    return;
  }

  const propertyLat =
    Number(property?.lat);

  const propertyLon =
    Number(property?.lon);

  if (
    !Number.isFinite(propertyLat) ||
    !Number.isFinite(propertyLon)
  ) {
    $("targetPlanMessage").textContent =
      "Set the property's map location before building a hunt plan.";
    return;
  }

  const mappedStands =
    stands.filter(
      stand =>
        stand.property_id === propertyId
        &&
        Number.isFinite(
          Number(stand.lat)
        )
        &&
        Number.isFinite(
          Number(stand.lon)
        )
    );

  if (!mappedStands.length) {
    $("targetPlanMessage").textContent =
      "Map at least one stand before building a Target Hunt Plan.";
    return;
  }

  const targetRows =
    targetSightingsFor(
      deerId
    );

  const hotspot =
    targetCameraHotspot(
      deerId
    );

  if (!hotspot) {
    $("targetPlanMessage").textContent =
      "This target does not yet have sightings tied to a mapped camera. HOSE needs at least one mapped target sighting before ranking stands.";
    return;
  }

  $("targetPlanMessage").textContent =
    "Loading wind/weather and ranking hunt windows…";

  $("targetPlanResults").innerHTML =
    "";

  try {
    const forecast =
      await getTargetForecast(
        propertyLat,
        propertyLon
      );

    const times =
      forecast.hourly?.time
      || [];

    const temperatures =
      forecast.hourly?.temperature_2m
      || [];

    const precipitation =
      forecast.hourly?.precipitation_probability
      || [];

    const windSpeeds =
      forecast.hourly?.wind_speed_10m
      || [];

    const windDirections =
      forecast.hourly?.wind_direction_10m
      || [];

    const weatherCodes =
      forecast.hourly?.weather_code
      || [];

    const now =
      Date.now();

    const candidates =
      [];

    times.forEach(
      (time, index) => {
        const timestamp =
          new Date(time);

        if (
          timestamp.getTime() <= now
          ||
          timestamp.getTime() >
            now +
            7 * 24 * 60 * 60 * 1000
        ) {
          return;
        }

        if (
          !daylightWindowFor(
            forecast,
            time
          )
        ) {
          return;
        }

        mappedStands.forEach(
          stand => {
            const score =
              scoreStandForecastWindow({
                stand,
                hotspot,
                targetRows,
                forecastTime:
                  time,

                temperature:
                  temperatures[index],

                precipitation:
                  precipitation[index],

                windSpeed:
                  windSpeeds[index],

                windDirection:
                  windDirections[index]
              });

            candidates.push({
              stand,
              time,
              weatherCode:
                weatherCodes[index],
              ...score
            });
          }
        );
      }
    );

    candidates.sort(
      (a, b) =>
        b.total - a.total
    );

    const selected =
      [];

    const usedWindows =
      new Set();

    for (
      const candidate
      of candidates
    ) {
      const date =
        new Date(
          candidate.time
        );

      const key =
        `${candidate.stand.id}-${date.toISOString().slice(0, 13)}`;

      if (
        usedWindows.has(key)
      ) {
        continue;
      }

      selected.push(
        candidate
      );

      usedWindows.add(
        key
      );

      if (
        selected.length >= 5
      ) {
        break;
      }
    }

    if (!selected.length) {
      $("targetPlanMessage").textContent =
        "No upcoming daylight forecast windows were available.";
      return;
    }

    const hotspotName =
      hotspot.camera.name;

    $("targetPlanMessage").textContent =
      `Planning around ${deer.nickname || deer.deer_code || "Target buck"} using ${targetRows.length} target sighting${targetRows.length === 1 ? "" : "s"} and hotspot camera ${hotspotName}.`;

    $("targetPlanResults").innerHTML =
      selected.map(
        (candidate, index) => {
          const date =
            new Date(
              candidate.time
            );

          const windQuality =
            candidate.windScore >= 24
              ? "Strong wind setup"
              : candidate.windScore >= 15
                ? "Usable wind setup"
                : "Wind needs caution";

          const activityQuality =
            candidate.activityScore >= 18
              ? "Matches historical activity time"
              : candidate.activityScore >= 10
                ? "Some historical timing support"
                : "Limited historical timing support";

          return `
            <div class="target-plan-option ${index === 0 ? "top-plan" : ""}">
              <div class="target-plan-rank">
                #${index + 1}
              </div>

              <div>
                <strong>
                  ${escapeHtml(candidate.stand.name)}
                  ·
                  ${date.toLocaleDateString([], {weekday:"short", month:"short", day:"numeric"})}
                  ${date.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}
                </strong>

                <div class="target-score">
                  Hunt score: ${candidate.total}/100
                </div>

                <div class="small muted">
                  ${windQuality} · ${activityQuality}
                </div>

                <div class="target-plan-metrics">
                  <span>${candidate.distance.toFixed(2)} mi from ${escapeHtml(hotspotName)}</span>
                  <span>${candidate.windSpeed.toFixed(0)} mph wind @ ${candidate.windDirection.toFixed(0)}°</span>
                  <span>${candidate.temperature.toFixed(0)}°F</span>
                  <span>${candidate.precipitation.toFixed(0)}% precip.</span>
                  <span>${weatherCodeLabel(candidate.weatherCode)}</span>
                </div>

                <div class="small target-plan-why">
                  HOSE ranks this window from mapped stand geometry, scent direction relative to the target's most-used mapped camera, historical sighting time, and forecast conditions.
                </div>
              </div>
            </div>
          `;
        }
      )
      .join("")
      +
      `
        <div class="small muted target-disclaimer">
          Hunt score is a decision-support heuristic, not the probability of seeing or harvesting this deer. Forecast source: Open-Meteo. Always use current local conditions, safe access, property rules, and applicable hunting regulations.
        </div>
      `;

  } catch (error) {
    console.error(
      "HOSE Target Hunt Plan error:",
      error
    );

    $("targetPlanMessage").textContent =
      error?.message
      ||
      "Could not build the Target Hunt Plan.";
  }
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

  /*
   * Selecting a saved property must never take ownership of map navigation.
   * Selector syncing only updates controls and metadata.
   */
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

  /*
   * Redrawing property/camera/stand markers must not move the map.
   * The hunter keeps control of the current center and zoom.
   */

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
          () => {
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

            syncAreaSelectors();
            renderAreaMap();
            renderTargetBuckSelector();

            requestAnimationFrame(
              () => {
                areaMap?.invalidateSize({
                  pan: false
                });
              }
            );
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

window.openDeerProfileEditor =
  openDeerProfileEditor;

window.toggleTargetTag =
  toggleTargetTag;

window.openIdentityEvidence =
  openIdentityEvidence;

window.setProfileReferencePhoto =
  setProfileReferencePhoto;

window.openMergeDeer =
  openMergeDeer;

window.openScoreFeedback =
  openScoreFeedback;

window.moveDeerProfile =
  moveDeerProfile;

window.setDeerProfileSort =
  setDeerProfileSort;


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
