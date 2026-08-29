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
let currentProfile = null;
let friends = [];
let profileBrowserIndex = 0;
let profileBrowserRows = [];
let profileImageCache = new Map();
let sharedProperties = [];
let areaCameras = [];
let areaDbAssets = [];
let areaBoundaryStored = [];
let areaCameraPhotoCache = new Map();

let plannerHuntType = "private";
let plannerTargetMode = "any";
let publicHuntMap = null;
let publicHuntStreetLayer = null;
let publicHuntSatelliteLayer = null;
let publicHuntMarkerGroup = null;
let publicHuntLandMarker = null;


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
}


async function restoreSession() {
  const { data, error } = await sb.auth.getSession();

  if (error) {
    $("authMessage").textContent = error.message;
    return;
  }

  await applySession(data.session);

  sb.auth.onAuthStateChange(
    async (_event, session) => {
      await applySession(session);
    }
  );
}


async function applySession(session) {
  currentUser = session?.user || null;

  $("authGate").classList.toggle(
    "hidden",
    !!currentUser
  );

  $("appShell").classList.toggle(
    "hidden",
    !currentUser
  );
  document.body.classList.toggle("is-authenticated", !!currentUser);

  if (!currentUser) {
    $("signedInEmail").textContent = "";
    clearPrivateUi();
    return;
  }

  $("signedInEmail").textContent = currentUser.email || currentUser.id;
  await loadMyProfile();
  await refreshPrivateData();
  await refreshFriendsSharing();

  if (!map) {
    initMapSafe();
  }
}


async function signIn() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    $("authMessage").textContent =
      "Enter email and password.";
    return;
  }

  $("authMessage").textContent =
    "Signing in…";

  const { error } =
    await sb.auth.signInWithPassword({
      email,
      password
    });

  $("authMessage").textContent =
    error ? error.message : "Signed in.";
}


async function signUp() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    $("authMessage").textContent =
      "Enter email and password.";
    return;
  }

  $("authMessage").textContent =
    "Creating account…";

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
      : "Account created. Check your email to confirm your address, then sign in.";
}


async function signOut() {
  await sb.auth.signOut();
}


/* ============================================================
   TABS
   ============================================================ */

function setupTabs() {
  document
    .querySelectorAll(".app-tab")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          document
            .querySelectorAll(".app-tab")
            .forEach(tab =>
              tab.classList.remove("active")
            );

          button.classList.add("active");

          const selected =
            button.dataset.tab;

          $("tab-my-intel").classList.toggle(
            "hidden",
            selected !== "my-intel"
          );

          $("tab-upload")?.classList.toggle("hidden", selected !== "upload");
          $("tab-planner")?.classList.toggle("hidden", selected !== "planner");
          $("tab-history")?.classList.toggle("hidden", selected !== "history");
          $("tab-area-intel").classList.toggle("hidden", selected !== "area-intel");
          $("tab-friends")?.classList.toggle("hidden", selected !== "friends");
          if (selected === "friends") refreshFriendsSharing();
          if (selected === "planner") refreshPlannerOptions();
          if (selected === "history") renderHarvestHistory();

          if (selected === "area-intel") {
            // Leaflet must be initialized after the hidden tab is visible.
            setTimeout(async () => {
              initMapSafe();
              if (map) {
                map.invalidateSize(true);
                await syncAreaPropertyControls();
                renderAreaMap();
              }
            }, 120);
          }
        }
      );
    });
}


/* ============================================================
   PROFILE + FRIENDS + PRIVATE SHARING
   ============================================================ */
function cleanUsername(v) { return (v || "").trim().replace(/^@/, ""); }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function loadMyProfile() {
  if (!currentUser) return;
  let { data, error } = await sb.from("profiles").select("id,username,display_name,avatar_url").eq("id", currentUser.id).maybeSingle();
  if (error) { console.error("Profile load:", error); return; }
  if (!data) {
    const made = await sb.from("profiles").insert({ id: currentUser.id }).select("id,username,display_name,avatar_url").single();
    if (!made.error) data = made.data;
  }
  currentProfile = data || {};
  $("signedInUsername").textContent = currentProfile.username ? `@${currentProfile.username}` : "Username required";
  if ($("signedInUsernameSide")) $("signedInUsernameSide").textContent = currentProfile.username ? `@${currentProfile.username}` : "@hunter";
  if ($("settingsUsername")) $("settingsUsername").value = currentProfile.username || "";
  if ($("settingsDisplayName")) $("settingsDisplayName").value = currentProfile.display_name || "";
  if ($("settingsEmail")) $("settingsEmail").value = currentUser.email || "";
  $("usernameGate")?.classList.toggle("hidden", !!currentProfile.username);
}
async function saveProfile(fromOnboarding=false) {
  const username = cleanUsername($(fromOnboarding ? "onboardingUsername" : "settingsUsername").value);
  const displayName = $(fromOnboarding ? "onboardingDisplayName" : "settingsDisplayName").value.trim();
  const msg = $(fromOnboarding ? "usernameMessage" : "profileMessage");
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) { msg.textContent="Use 3–24 letters, numbers, or underscores."; return; }
  msg.textContent="Saving…";
  const { error } = await sb.from("profiles").upsert({id:currentUser.id, username, display_name:displayName || null},{onConflict:"id"});
  if (error) { msg.textContent = error.code === "23505" ? "That username is already taken." : error.message; return; }
  msg.textContent="Saved."; await loadMyProfile(); await refreshFriendsSharing();
}
async function searchFriend() {
  const q=cleanUsername($("friendSearch").value); const out=$("friendSearchResults");
  if (!q) { out.innerHTML="<div class='muted'>Enter a username.</div>"; return; }
  const {data,error}=await sb.from("profiles").select("id,username,display_name").ilike("username", q).neq("id",currentUser.id).limit(10);
  if(error){out.textContent=error.message;return;} if(!data?.length){out.innerHTML="<div class='muted'>No DIE user found.</div>";return;}
  out.innerHTML=data.map(x=>`<div class="share-row"><div><strong>@${esc(x.username)}</strong><div class="small muted">${esc(x.display_name||"")}</div></div><button class="secondary" onclick="sendFriendRequest('${x.id}')">Add Friend</button></div>`).join("");
}
async function sendFriendRequest(id){
  const {error}=await sb.from("friendships").insert({requester_id:currentUser.id,addressee_id:id,status:"pending"});
  $("friendSearchResults").insertAdjacentHTML("afterbegin",`<div class="small ${error?'':'muted'}">${esc(error ? (error.code==='23505'?'Request already exists.':error.message) : 'Friend request sent.')}</div>`); await refreshFriendsSharing();
}
async function respondFriend(id,status){ await sb.from("friendships").update({status,updated_at:new Date().toISOString()}).eq("id",id).eq("addressee_id",currentUser.id); await refreshFriendsSharing(); }
async function refreshFriendsSharing(){
  if(!currentUser||!$("friendsList"))return;
  const {data:rels,error}=await sb.from("friendships").select("id,requester_id,addressee_id,status,created_at").or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
  if(error){$("friendsList").textContent=error.message;return;}
  const ids=[...new Set((rels||[]).flatMap(r=>[r.requester_id,r.addressee_id]).filter(id=>id!==currentUser.id))];
  let profiles=[]; if(ids.length){ const r=await sb.from("profiles").select("id,username,display_name").in("id",ids); profiles=r.data||[]; }
  const byId=Object.fromEntries(profiles.map(p=>[p.id,p]));
  const accepted=(rels||[]).filter(r=>r.status==="accepted");
  friends=accepted.map(r=>byId[r.requester_id===currentUser.id?r.addressee_id:r.requester_id]).filter(Boolean);
  $("friendsList").innerHTML=friends.length?friends.map(f=>`<div class="share-row"><div><strong>@${esc(f.username||'user')}</strong><div class="small muted">${esc(f.display_name||'')}</div></div></div>`).join(''):"No friends yet.";
  const pending=(rels||[]).filter(r=>r.status==="pending"&&r.addressee_id===currentUser.id);
  $("friendRequests").innerHTML=pending.length?pending.map(r=>{const f=byId[r.requester_id]||{};return `<div class="share-row"><div><strong>@${esc(f.username||'user')}</strong></div><div><button onclick="respondFriend('${r.id}','accepted')">Accept</button> <button class="secondary" onclick="respondFriend('${r.id}','declined')">Decline</button></div></div>`}).join(''):"No pending requests.";
  $("shareFriend").innerHTML='<option value="">Choose friend</option>'+friends.map(f=>`<option value="${f.id}">@${esc(f.username)}</option>`).join('');
  $("shareProperty").innerHTML='<option value="">Choose property</option>'+properties.map(p=>`<option value="${p.id}">${esc(p.name||p.property_name||'Property')}</option>`).join('');

  const {data:shares}=await sb.from("property_shares").select("property_id,owner_id,permission").eq("shared_with_id",currentUser.id);
  const sharedIds=[...new Set((shares||[]).map(s=>s.property_id).filter(Boolean))];
  sharedProperties=[];
  if(sharedIds.length){
    const r=await sb.from("properties").select("*").in("id",sharedIds);
    sharedProperties=r.data||[];
  }
  if($("sharedPropertiesList")){
    $("sharedPropertiesList").innerHTML=sharedProperties.length
      ? sharedProperties.map(p=>`<button class="shared-property-row" type="button" data-open-shared-property="${p.id}"><span><strong>${esc(p.name||"Shared Property")}</strong><small>Open property map, assets & camera photos</small></span><b>Open →</b></button>`).join("")
      : "No shared properties yet.";
  }
}
async function loadShareStands(){
  const propertyId=$("shareProperty").value; $("shareStand").innerHTML='<option value="">Entire property</option>'; if(!propertyId)return;
  const {data}=await sb.from("stands").select("id,name").eq("user_id",currentUser.id).eq("property_id",propertyId).order("name");
  $("shareStand").innerHTML += (data||[]).map(s=>`<option value="${s.id}">${esc(s.name||'Stand')}</option>`).join('');
}
async function shareAccess(){
  const friend=$("shareFriend").value, property=$("shareProperty").value, stand=$("shareStand").value, msg=$("shareMessage");
  if(!friend||!property){msg.textContent="Choose a friend and property.";return;}
  const row=stand?{stand_id:stand,owner_id:currentUser.id,shared_with_id:friend,permission:"viewer"}:{property_id:property,owner_id:currentUser.id,shared_with_id:friend,permission:"viewer"};
  const {error}=await sb.from(stand?"stand_shares":"property_shares").upsert(row,{onConflict:stand?"stand_id,shared_with_id":"property_id,shared_with_id"});
  msg.textContent=error?error.message:"Access shared privately.";
}


async function openSharedProperty(propertyId){
  document.querySelector('.app-tab[data-tab="area-intel"]')?.click();
  setTimeout(async()=>{
    await refreshFriendsSharing();
    await syncAreaPropertyControls(propertyId);
    if($("areaPropertySelect")) $("areaPropertySelect").value=propertyId;
    await loadAreaProperty();
  },220);
}

/* ============================================================
   PRIVATE DATA
   ============================================================ */

async function refreshPrivateData() {
  await Promise.all([
    loadProperties(),
    loadCameras(),
    loadDeerProfiles()
  ]);

  renderPrivate();
  await renderProfileShowcase();
  await loadRecentPhotos();
}


async function loadProperties() {
  const { data, error } =
    await sb
      .from("properties")
      .select("*")
      .order("created_at", {
        ascending: true
      });

  if (error) {
    $("propertyMessage").textContent =
      error.message;
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
      .eq("active", true)
      .order("created_at", {
        ascending: true
      });

  if (error) {
    $("cameraMessage").textContent =
      error.message;
    return;
  }

  cameras = data || [];
}


async function loadDeerProfiles() {
  const { data, error } =
    await sb
      .from("deer_profiles")
      .select("*")
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
    $("propertyMessage").textContent =
      error.message;
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
  await renderProfileShowcase();
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
        "DIE AI RESULT",
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
  setTimeout(() => syncAreaPropertyControls(), 0);
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




/* ============================================================
   PROFESSIONAL DEER PROFILE BROWSER
   ============================================================ */

function profileDisplayName(deer) {
  return deer?.nickname || deer?.deer_code || "Unnamed buck";
}

function getProfileScore(deer) {
  const t = deer?.ai_traits || {};
  const raw = t.hose_score ?? t.estimated_score ?? t.gross_score ?? t.score_estimate ?? t.boone_crockett_score ?? deer?.estimated_score ?? null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getProfileScoreRange(deer) {
  const t = deer?.ai_traits || {};
  return t.score_range || t.estimated_score_range || deer?.score_range || "";
}

function sortedProfiles() {
  const mode = $("profileSort")?.value || "recent";
  const rows = [...deerProfiles].filter(d => !d.sex || String(d.sex).toLowerCase() === "buck");
  rows.sort((a,b) => {
    if (mode === "sightings") return Number(b.sighting_count||0) - Number(a.sighting_count||0);
    if (mode === "score") return (getProfileScore(b) ?? -1) - (getProfileScore(a) ?? -1);
    return new Date(b.last_seen || b.created_at || 0) - new Date(a.last_seen || a.created_at || 0);
  });
  return rows;
}

function percentValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  let n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n <= 1) n *= 100;
  return `${Math.round(n)}%`;
}

function formatProfileDate(value) {
  if (!value) return "No date recorded";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `Last seen ${d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`;
}

async function signedProfilePhoto(deer) {
  if (!deer?.representative_photo_id) return null;
  if (profileImageCache.has(deer.representative_photo_id)) return profileImageCache.get(deer.representative_photo_id);

  const { data: photo, error } = await sb
    .from("trail_photos")
    .select("id,storage_path")
    .eq("id", deer.representative_photo_id)
    .maybeSingle();

  if (error || !photo?.storage_path) return null;
  const { data: signed, error: signError } = await sb.storage
    .from("trail-camera-photos")
    .createSignedUrl(photo.storage_path, 3600);

  if (signError || !signed?.signedUrl) return null;
  profileImageCache.set(deer.representative_photo_id, signed.signedUrl);
  return signed.signedUrl;
}

async function renderProfileShowcase() {
  if (!$("profileShowcase")) return;
  profileBrowserRows = sortedProfiles();

  const empty = $("profileEmptyState");
  const img = $("profileHeroImage");
  const details = $("profileDetails");
  const counter = $("profileCounter");

  if (!profileBrowserRows.length) {
    profileBrowserIndex = 0;
    empty?.classList.remove("hidden");
    img?.classList.add("hidden");
    details?.classList.add("hidden");
    $("profileLeftSummary")?.classList.add("hidden");
    counter?.classList.add("hidden");
    populateCompareSelectors();
    return;
  }

  profileBrowserIndex = Math.min(profileBrowserIndex, profileBrowserRows.length - 1);
  const deer = profileBrowserRows[profileBrowserIndex];
  currentProfile = deer;

  empty?.classList.add("hidden");
  details?.classList.remove("hidden");
  counter?.classList.remove("hidden");
  counter.textContent = `${profileBrowserIndex + 1} of ${profileBrowserRows.length}`;

  $("profileName").textContent = profileDisplayName(deer);
  const tags = Array.isArray(deer.tags) ? deer.tags : [];
  $("profileTags").textContent = tags.length ? tags.join(" · ") : "No tags yet";

  const score = getProfileScore(deer);
  $("profileScore").textContent = score === null ? "—" : `~${score.toFixed(1)}"`;
  const range = getProfileScoreRange(deer);
  $("profileScoreRange").textContent = range ? `Range: ${range}` : "Score estimate appears when available";
  $("profileAge").textContent = deer.estimated_age_class ? `${deer.estimated_age_class} yr` : "—";
  $("profileSightings").textContent = Number(deer.sighting_count || 0).toLocaleString();
  $("profileLastSeen").textContent = formatProfileDate(deer.last_seen);
  $("profileConfidence").textContent = percentValue(deer.identity_confidence);
  if ($("profileNameLeft")) $("profileNameLeft").textContent = profileDisplayName(deer);
  if ($("profileTagsLeft")) $("profileTagsLeft").textContent = tags.length ? tags.join(" · ") : "No tags yet";
  if ($("profileScoreLeft")) $("profileScoreLeft").textContent = score === null ? "—" : `~${score.toFixed(1)}"`;
  if ($("profileScoreRangeLeft")) $("profileScoreRangeLeft").textContent = range ? `Range: ${range}` : "Score estimate appears when available";
  if ($("profileAgeLeft")) $("profileAgeLeft").textContent = deer.estimated_age_class ? `${deer.estimated_age_class} yr` : "—";
  if ($("profileConfidenceLeft")) $("profileConfidenceLeft").textContent = percentValue(deer.identity_confidence);
  $("profileLeftSummary")?.classList.remove("hidden");
  const ring = $("profileConfidenceRing");
  if (ring) {
    const raw = Number(deer.identity_confidence);
    const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw)) : 0;
    ring.style.setProperty("--confidence", `${pct * 3.6}deg`);
  }

  img.classList.add("hidden");
  img.removeAttribute("src");
  const url = await signedProfilePhoto(deer);
  if (currentProfile?.id !== deer.id) return;
  if (url) {
    img.src = url;
    img.classList.remove("hidden");
  } else {
    empty?.classList.remove("hidden");
    empty.querySelector("strong").textContent = profileDisplayName(deer);
    empty.querySelector("span").textContent = "No representative photo is available for this profile yet.";
  }

  populateCompareSelectors();
}

function moveProfile(direction) {
  if (!profileBrowserRows.length) return;
  profileBrowserIndex = (profileBrowserIndex + direction + profileBrowserRows.length) % profileBrowserRows.length;
  renderProfileShowcase();
}

function populateCompareSelectors() {
  const a = $("compareProfileA"), b = $("compareProfileB");
  if (!a || !b) return;
  const options = profileBrowserRows.map((d,i)=>`<option value="${d.id}">${esc(profileDisplayName(d))}</option>`).join("");
  a.innerHTML = options || '<option value="">No profiles</option>';
  b.innerHTML = options || '<option value="">No profiles</option>';
  if (profileBrowserRows.length) {
    a.value = profileBrowserRows[profileBrowserIndex]?.id || profileBrowserRows[0].id;
    b.value = profileBrowserRows[Math.min(profileBrowserIndex + 1, profileBrowserRows.length - 1)]?.id || profileBrowserRows[0].id;
  }
  renderProfileComparison();
}

function profileCompareCard(deer) {
  if (!deer) return '<div class="compare-card muted">Choose a buck</div>';
  const score = getProfileScore(deer);
  return `<div class="compare-card">
    <strong>${esc(profileDisplayName(deer))}</strong>
    <div><span>DIE score</span><b>${score === null ? "—" : `~${score.toFixed(1)}"`}</b></div>
    <div><span>Estimated age</span><b>${esc(deer.estimated_age_class || "—")}</b></div>
    <div><span>Sightings</span><b>${Number(deer.sighting_count||0)}</b></div>
    <div><span>Confidence</span><b>${percentValue(deer.identity_confidence)}</b></div>
  </div>`;
}

function renderProfileComparison() {
  const out = $("compareResults");
  if (!out) return;
  const a = profileBrowserRows.find(d=>d.id === $("compareProfileA")?.value);
  const b = profileBrowserRows.find(d=>d.id === $("compareProfileB")?.value);
  out.innerHTML = profileCompareCard(a) + profileCompareCard(b);
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


let areaSatelliteLayer = null;
let areaStreetLayer = null;
let areaAssetGroup = null;
let areaBoundaryGroup = null;
let areaParcelGroup = null;
let areaParcelRequestId = 0;
let areaSelectedAssetType = null;
let areaBoundaryMode = false;
let areaBoundaryPoints = [];
let areaStands = [];

function areaStoreKey(propertyId) { return `die-area-map-${currentUser?.id || "user"}-${propertyId}`; }
function getAreaStore(propertyId) {
  try { return JSON.parse(localStorage.getItem(areaStoreKey(propertyId))) || {assets:[], boundary:[]}; }
  catch { return {assets:[], boundary:[]}; }
}
function saveAreaStore(propertyId, value) { localStorage.setItem(areaStoreKey(propertyId), JSON.stringify(value)); }

function initMapSafe() {
  if (typeof L === "undefined") {
    console.error("Leaflet did not load.");
    const msg = $("areaPlaceMessage");
    if (msg) msg.textContent = "Map library did not load. Refresh the page and try again.";
    return;
  }

  const container = $("map");
  if (!container) return;

  // Do not create Leaflet while Area Intelligence is display:none.
  const areaTab = $("tab-area-intel");
  if (areaTab?.classList.contains("hidden")) return;

  if (map) {
    map.invalidateSize(true);
    return;
  }

  map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true
  }).setView([34.72, -86.65], 16);

  areaSatelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
    }
  );

  areaStreetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }
  );

  areaSatelliteLayer.addTo(map);
  layerGroup = L.layerGroup().addTo(map);
  areaAssetGroup = L.layerGroup().addTo(map);
  areaBoundaryGroup = L.layerGroup().addTo(map);
  areaParcelGroup = L.layerGroup();

  map.on("moveend", () => {
    if ($("areaParcelLayer")?.checked) loadTaxParcelsForCurrentView();
  });

  // One map click handler controls both boundary drawing and asset placement.
  map.on("click", handleAreaMapClick);

  // Make sure the map is actually interactive once the tab has painted.
  setTimeout(() => {
    map.invalidateSize(true);
    container.style.cursor = "crosshair";
  }, 180);
}


const ALABAMA_PARCEL_SERVICES = {
  madison: {
    label: "Madison County tax parcels",
    type: "tile",
    url: "https://maps.huntsvilleal.gov/server/rest/services/Tiled/MadisonCountyParcels/MapServer/tile/{z}/{y}/{x}",
    minZoom: 6,
    maxZoom: 20
  },
  limestone: {
    label: "Limestone County tax parcels",
    url: "https://gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Parcels/FeatureServer/0",
    fields: "ParcelNo,PID,CALC_ACRE,StatedArea"
  },
  jackson: {
    label: "Jackson County tax parcels",
    url: "https://services3.arcgis.com/7ScJ8q0HhcQyXcHe/ArcGIS/rest/services/Jackson_County_GIS/FeatureServer/5",
    fields: "*"
  }
};

function normalizeCountyName(value){
  return String(value||"")
    .toLowerCase()
    .replace(/county/g,"")
    .replace(/[^a-z]/g,"")
    .trim();
}

function currentAreaProperty(){
  const id=$("areaPropertySelect")?.value;
  return [...properties,...sharedProperties].find(p=>p.id===id)||null;
}

function parcelServiceForProperty(property){
  const county=normalizeCountyName(property?.county);
  return ALABAMA_PARCEL_SERVICES[county] || null;
}

function parcelLabel(props={}){
  const parcel=props.ParcelNo||props.PARCELNO||props.PARCEL_ID||props.PPIN||props.REID||props.PID||props.PARCEL||props.PARCELID||props.ParcelID||"Parcel";
  const acres=props.CALC_ACRE??props.StatedArea??props.ACRES??props.ACREAGE??props.Acres??props.Acreage;
  const acresText=(acres!==undefined && acres!==null && acres!=="") ? `<br><small>${esc(String(acres))} acres</small>` : "";
  return `<strong>${esc(String(parcel))}</strong>${acresText}<br><small>Tax-map boundary · reference only</small>`;
}

async function loadTaxParcelsForCurrentView(){
  if(!map || !areaParcelGroup || !$("areaParcelLayer")?.checked) return;
  const property=currentAreaProperty();
  const status=$("areaParcelStatus");
  if(!property){
    areaParcelGroup.clearLayers();
    if(status) status.textContent="Choose a property to load parcel borders.";
    return;
  }
  const service=parcelServiceForProperty(property);
  if(!service){
    areaParcelGroup.clearLayers();
    if(status) status.textContent=`Tax parcel overlay is not connected for ${property.county||"this county"} yet.`;
    return;
  }

  const requestId=++areaParcelRequestId;
  if(status) status.textContent=`Loading ${service.label}…`;

  areaParcelGroup.clearLayers();
  if(!map.hasLayer(areaParcelGroup)) areaParcelGroup.addTo(map);

  // Madison County publishes a cached Web Mercator parcel layer. Loading it as
  // map tiles avoids browser CORS/GeoJSON failures from direct FeatureServer queries.
  if(service.type==="tile"){
    const tile=L.tileLayer(service.url,{
      minZoom:service.minZoom||0,
      maxZoom:service.maxZoom||20,
      maxNativeZoom:service.maxZoom||20,
      opacity:.9,
      attribution:"Madison County / City of Huntsville GIS"
    });
    tile.on("load",()=>{
      if(requestId!==areaParcelRequestId) return;
      if(status) status.textContent=`${service.label} shown. Zoom in for individual property lines. Reference only — not a survey.`;
    });
    tile.on("tileerror",(e)=>{
      console.warn("Parcel tile failed",e);
      if(requestId!==areaParcelRequestId) return;
      if(status) status.textContent=`Some ${service.label} tiles could not load. Pan or zoom and DIE will retry automatically.`;
    });
    tile.addTo(areaParcelGroup);
    if(map.getZoom()<14) map.setZoom(14);
    return;
  }

  const b=map.getBounds();
  const envelope=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(",");
  const params=new URLSearchParams({
    where:"1=1",
    geometry:envelope,
    geometryType:"esriGeometryEnvelope",
    inSR:"4326",
    spatialRel:"esriSpatialRelIntersects",
    outFields:service.fields||"*",
    returnGeometry:"true",
    outSR:"4326",
    f:"geojson"
  });

  try{
    const res=await fetch(`${service.url}/query?${params.toString()}`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo=await res.json();
    if(requestId!==areaParcelRequestId) return;
    const features=Array.isArray(geo?.features)?geo.features:[];
    L.geoJSON(geo,{
      style:{color:"#ffd089",weight:1.25,opacity:.9,fillOpacity:0},
      onEachFeature:(feature,layer)=>layer.bindPopup(parcelLabel(feature.properties||{}),{maxWidth:260})
    }).addTo(areaParcelGroup);
    if(status) status.textContent=features.length
      ? `${features.length} tax parcels shown from ${service.label}. Reference only — not a survey.`
      : `No tax parcels returned in this view from ${service.label}.`;
  }catch(err){
    console.error("Parcel overlay failed",err);
    areaParcelGroup.clearLayers();
    if(status) status.textContent=`Could not load ${service.label}. The county GIS service may be temporarily unavailable.`;
  }
}

function toggleTaxParcelLayer(enabled){
  if(!map || !areaParcelGroup) return;
  if(enabled){
    if(!map.hasLayer(areaParcelGroup)) areaParcelGroup.addTo(map);
    loadTaxParcelsForCurrentView();
  }else{
    areaParcelRequestId++;
    areaParcelGroup.clearLayers();
    if(map.hasLayer(areaParcelGroup)) map.removeLayer(areaParcelGroup);
    const status=$("areaParcelStatus");
    if(status) status.textContent="Parcel borders hidden.";
  }
}

function assetMeta(type){
  return ({camera:["📷","#4d91ff"],stand:["♜","#71c837"],feeder:["▾","#ff7900"],scrape:["♨","#ef4444"],foodplot:["♧","#71c837"],water:["◆","#9b6cff"],shootinghouse:["⌂","#22c7c7"],trail:["⌁","#d89a4a"],other:["＋","#aaa"]})[type] || ["＋","#aaa"];
}
function areaMarkerIcon(type){ const [icon,color]=assetMeta(type); return L.divIcon({className:"",iconSize:[36,36],iconAnchor:[18,34],html:`<div class="die-map-marker" style="color:${color}"><span>${icon}</span></div>`}); }

async function syncAreaPropertyControls(preferredId=null){
  const sel=$("areaPropertySelect"); if(!sel)return;
  const current=preferredId||sel.value;
  const ownOptions=properties.map(p=>`<option value="${p.id}">${esc(p.name||"Property")}</option>`).join("");
  const sharedOptions=sharedProperties.length
    ? `<optgroup label="Shared with me">${sharedProperties.map(p=>`<option value="${p.id}">${esc(p.name||"Shared Property")}</option>`).join("")}</optgroup>`
    : "";
  sel.innerHTML='<option value="">Choose property…</option>'+ownOptions+sharedOptions;
  const all=[...properties,...sharedProperties];
  if(current && all.some(p=>p.id===current)) sel.value=current;
  else if(properties.length) sel.value=properties[0].id;
  else if(sharedProperties.length) sel.value=sharedProperties[0].id;
  await loadAreaProperty();
}

async function loadAreaProperty(){
  const propertyId=$("areaPropertySelect")?.value;
  if(!propertyId){
    areaStands=[]; areaCameras=[]; areaDbAssets=[]; areaBoundaryStored=[]; areaCameraPhotoCache.clear();
    $("areaPlaceMessage").textContent="Select a property to begin."; renderAreaMap(); return;
  }

  const [standsRes,camsRes,assetsRes,mapRes]=await Promise.all([
    sb.from("stands").select("*").eq("property_id",propertyId).order("name"),
    sb.from("cameras").select("*").eq("property_id",propertyId).order("name"),
    sb.from("property_assets").select("*").eq("property_id",propertyId).order("created_at"),
    sb.from("property_maps").select("boundary").eq("property_id",propertyId).maybeSingle()
  ]);

  areaStands=standsRes.data||[];
  areaCameras=camsRes.data||[];
  areaDbAssets=(assetsRes.data||[]).map(a=>({
    id:a.id, refId:null, type:a.asset_type, name:a.name, lat:+a.lat, lon:+a.lon
  }));
  areaBoundaryStored=Array.isArray(mapRes.data?.boundary)?mapRes.data.boundary:[];
  await loadAreaCameraPhotos(propertyId);
  renderAreaMap();
}

async function loadAreaCameraPhotos(propertyId){
  areaCameraPhotoCache.clear();
  const {data:photos}=await sb.from("trail_photos")
    .select("id,camera_id,storage_path,captured_at,original_filename")
    .eq("property_id",propertyId)
    .not("camera_id","is",null)
    .order("captured_at",{ascending:false})
    .limit(80);

  const grouped={};
  for(const photo of photos||[]){
    if(!grouped[photo.camera_id]) grouped[photo.camera_id]=[];
    if(grouped[photo.camera_id].length<3) grouped[photo.camera_id].push(photo);
  }

  for(const [cameraId,rows] of Object.entries(grouped)){
    const previews=[];
    for(const row of rows){
      const {data:signed}=await sb.storage.from("trail-camera-photos").createSignedUrl(row.storage_path,600);
      if(signed?.signedUrl) previews.push({url:signed.signedUrl,captured_at:row.captured_at});
    }
    areaCameraPhotoCache.set(cameraId,previews);
  }
}

function renderAreaMap(){
  if(!map || !areaAssetGroup || !areaBoundaryGroup)return;
  areaAssetGroup.clearLayers(); areaBoundaryGroup.clearLayers();
  const propertyId=$("areaPropertySelect")?.value;
  const property=[...properties,...sharedProperties].find(p=>p.id===propertyId);
  const isOwner=properties.some(p=>p.id===propertyId);

  const assets=[...areaDbAssets];
  areaCameras.forEach(c=>{
    if(c.lat!=null&&c.lon!=null) assets.push({id:`camera-${c.id}`,refId:c.id,type:"camera",name:c.name,lat:+c.lat,lon:+c.lon});
  });
  areaStands.forEach(st=>{
    if(st.lat!=null&&st.lon!=null) assets.push({id:`stand-${st.id}`,refId:st.id,type:"stand",name:st.name,lat:+st.lat,lon:+st.lon});
  });

  assets.forEach(a=>{
    const marker=L.marker([a.lat,a.lon],{icon:areaMarkerIcon(a.type)});
    if(a.type==="camera" && a.refId){
      const photos=areaCameraPhotoCache.get(a.refId)||[];
      const thumbs=photos.length
        ? `<div class="camera-hover-grid">${photos.map(p=>`<img src="${p.url}" alt="Recent camera photo">`).join("")}</div>`
        : `<div class="camera-hover-empty">No uploaded photos yet.</div>`;
      const hover=`<div class="camera-hover-card"><strong>📷 ${esc(a.name||"Camera")}</strong>${thumbs}<small>${photos.length ? "Latest uploaded photos" : "Upload photos to this camera to preview them here."}</small></div>`;
      marker.bindTooltip(hover,{direction:"top",offset:[0,-28],sticky:true,className:"die-camera-tooltip",opacity:1});
      marker.bindPopup(hover,{maxWidth:360});
    } else {
      marker.bindPopup(`<strong>${esc(a.name||a.type)}</strong><br>${esc(a.type)}`);
    }
    marker.addTo(areaAssetGroup);
  });

  if(areaBoundaryStored?.length>=3){
    L.polygon(areaBoundaryStored,{color:"#ff7900",weight:3,fillColor:"#ff7900",fillOpacity:.05}).addTo(areaBoundaryGroup);
  }

  const bounds=[];
  assets.forEach(a=>bounds.push([a.lat,a.lon]));
  (areaBoundaryStored||[]).forEach(x=>bounds.push(x));
  if(bounds.length) map.fitBounds(bounds,{padding:[45,45],maxZoom:18});
  else if(property?.lat!=null && property?.lon!=null) map.setView([+property.lat,+property.lon],17);

  $("areaCameraCount").textContent=areaCameras.length;
  $("areaStandCount").textContent=areaStands.length;
  $("areaFeederCount").textContent=assets.filter(a=>a.type==="feeder").length;
  $("areaScrapeCount").textContent=assets.filter(a=>a.type==="scrape").length;
  $("areaOtherCount").textContent=assets.filter(a=>!["camera","stand","feeder","scrape"].includes(a.type)).length;
  $("areaAssetTitle").textContent=(property?.name||"Select a property")+(isOwner?"":" · Shared");
  $("areaAssetList").innerHTML=assets.length?assets.map(a=>`<span class="area-asset-chip">${assetMeta(a.type)[0]} ${esc(a.name||a.type)}</span>`).join(""):'<span class="muted">No mapped assets yet.</span>';

  const addPanel=document.querySelector(".asset-picker");
  const boundaryBtn=$("areaBoundaryBtn");
  if(addPanel) addPanel.classList.toggle("shared-readonly",!!propertyId && !isOwner);
  if(boundaryBtn) boundaryBtn.disabled=!!propertyId && !isOwner;
  $("areaPlaceMessage").textContent=!propertyId
    ?"Select a property to begin."
    :isOwner
      ?"Choose an asset above, then click the map to place it."
      :"Shared property: view-only. Hover over a camera to preview its latest photos.";

  if ($("areaParcelLayer")?.checked) {
    setTimeout(loadTaxParcelsForCurrentView, 50);
  }
  refreshAreaV15Details?.();
}

async function handleAreaMapClick(e){
  const propertyId=$("areaPropertySelect")?.value; if(!propertyId)return;
  const isOwner=properties.some(p=>p.id===propertyId);
  if(!isOwner){
    $("areaPlaceMessage").textContent="This property was shared with you as view-only.";
    return;
  }
  if(areaBoundaryMode){
    areaBoundaryPoints.push([e.latlng.lat,e.latlng.lng]);
    areaBoundaryGroup.clearLayers();
    areaBoundaryPoints.forEach(pt => L.circleMarker(pt,{radius:5,color:'#ff7900',fillColor:'#ff7900',fillOpacity:1,weight:2}).addTo(areaBoundaryGroup));
    if(areaBoundaryPoints.length>1) L.polyline(areaBoundaryPoints,{color:'#ff7900',weight:3,dashArray:'7 7'}).addTo(areaBoundaryGroup);
    $("areaPlaceMessage").textContent=`Boundary point ${areaBoundaryPoints.length} added. Keep clicking corners, then press Finish Boundary.`;
    return;
  }
  if(!areaSelectedAssetType)return;
  const type=areaSelectedAssetType;
  let defaultName=type.charAt(0).toUpperCase()+type.slice(1);
  if(type==="camera"){ const unplaced=areaCameras.filter(c=>c.lat==null||c.lon==null); if(unplaced.length) defaultName=unplaced[0].name; }
  if(type==="stand"){ const unplaced=areaStands.filter(st=>st.lat==null||st.lon==null); if(unplaced.length) defaultName=unplaced[0].name; }
  const name=prompt(`Name this ${type}:`,defaultName); if(name===null)return;
  const cleanName=name.trim()||defaultName;

  if(type==="camera"){
    const cam=areaCameras.find(c=>c.name?.toLowerCase()===cleanName.toLowerCase());
    if(cam){
      const {error}=await sb.from("cameras").update({lat:e.latlng.lat,lon:e.latlng.lng}).eq("id",cam.id).eq("user_id",currentUser.id);
      if(error){$("areaPlaceMessage").textContent=error.message;return;}
    } else {
      const {error}=await sb.from("property_assets").insert({property_id:propertyId,owner_id:currentUser.id,asset_type:type,name:cleanName,lat:e.latlng.lat,lon:e.latlng.lng});
      if(error){$("areaPlaceMessage").textContent=error.message;return;}
    }
  } else if(type==="stand"){
    const st=areaStands.find(s=>s.name?.toLowerCase()===cleanName.toLowerCase());
    if(st){
      const {error}=await sb.from("stands").update({lat:e.latlng.lat,lon:e.latlng.lng}).eq("id",st.id).eq("user_id",currentUser.id);
      if(error){$("areaPlaceMessage").textContent=error.message;return;}
    } else {
      const {error}=await sb.from("property_assets").insert({property_id:propertyId,owner_id:currentUser.id,asset_type:type,name:cleanName,lat:e.latlng.lat,lon:e.latlng.lng});
      if(error){$("areaPlaceMessage").textContent=error.message;return;}
    }
  } else {
    const {error}=await sb.from("property_assets").insert({property_id:propertyId,owner_id:currentUser.id,asset_type:type,name:cleanName,lat:e.latlng.lat,lon:e.latlng.lng});
    if(error){$("areaPlaceMessage").textContent=error.message;return;}
  }

  areaSelectedAssetType=null;
  document.querySelectorAll("[data-asset-type]").forEach(b=>b.classList.remove("active"));
  if(map) map.getContainer().style.cursor="grab";
  await loadAreaProperty();
  $("areaPlaceMessage").textContent=`${cleanName} placed and saved.`;
}

async function toggleAreaBoundary(){
  initMapSafe();
  const propertyId=$("areaPropertySelect")?.value;
  if(!propertyId){$("areaPlaceMessage").textContent="Choose a property first.";return;}
  if(!properties.some(p=>p.id===propertyId)){$("areaPlaceMessage").textContent="Shared properties are view-only.";return;}
  if(!map){$("areaPlaceMessage").textContent="Open Area Intelligence and wait for the map to load.";return;}

  areaSelectedAssetType = null;
  document.querySelectorAll("[data-asset-type]").forEach(b=>b.classList.remove("active"));

  if(!areaBoundaryMode){
    areaBoundaryMode=true;
    areaBoundaryPoints=[];
    areaBoundaryGroup.clearLayers();
    $("areaBoundaryBtn").classList.add("boundary-help");
    $("areaBoundaryBtn").textContent="✓ Finish Boundary";
    $("areaPlaceMessage").textContent="BOUNDARY MODE: click each corner of your property. Then click Finish Boundary.";
    map.getContainer().style.cursor='crosshair';
  } else {
    if(areaBoundaryPoints.length < 3){
      $("areaPlaceMessage").textContent="Add at least 3 boundary points before finishing.";
      return;
    }
    areaBoundaryMode=false;
    $("areaBoundaryBtn").classList.remove("boundary-help");
    $("areaBoundaryBtn").textContent="◇ Redraw Property Boundary";
    const boundary=[...areaBoundaryPoints];
    const {error}=await sb.from("property_maps").upsert({
      property_id:propertyId,
      owner_id:currentUser.id,
      boundary
    },{onConflict:"property_id"});
    if(error){
      $("areaPlaceMessage").textContent=error.message;
      return;
    }
    areaBoundaryStored=boundary;
    areaBoundaryPoints=[];
    map.getContainer().style.cursor='grab';
    renderAreaMap();
    $("areaPlaceMessage").textContent="Property boundary saved to your DIE account.";
  }
}


async function areaAddProperty(){
  const name=prompt("Property name:"); if(!name?.trim())return;
  const {error}=await sb.from("properties").insert({user_id:currentUser.id,name:name.trim(),state:"AL"});
  if(error){alert(error.message);return;} await refreshPrivateData(); await syncAreaPropertyControls();
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

  dieHarvestHistory = await loadHarvestHistoryData();
  fillControls();
  setupTabs();
  initHarvestHistoryControls();
  renderOfficialHarvestRows();
  wireAreaV15Ui();

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

  $("addPropertyBtn")
    .addEventListener(
      "click",
      addProperty
    );

  $("addCameraBtn")
    .addEventListener(
      "click",
      addCamera
    );

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

  $("processUploadBtn")
    .addEventListener(
      "click",
      uploadPhotos
    );

  $("refreshPhotosBtn")
    .addEventListener(
      "click",
      loadRecentPhotos
    );

  $("areaPropertySelect")?.addEventListener("change", loadAreaProperty);
  $("areaBoundaryBtn")?.addEventListener("click", toggleAreaBoundary);
  $("areaAddPropertyBtn")?.addEventListener("click", areaAddProperty);
  $("areaMyPropertiesBtn")?.addEventListener("click", () => document.querySelector('[data-tab="my-intel"]')?.click());
  document.querySelectorAll("[data-asset-type]").forEach(btn=>btn.addEventListener("click",()=>{
    initMapSafe();
    if (!$('areaPropertySelect')?.value) {
      $('areaPlaceMessage').textContent = 'Choose a property first.';
      return;
    }
    areaBoundaryMode = false;
    areaBoundaryPoints = [];
    areaSelectedAssetType=btn.dataset.assetType;
    document.querySelectorAll("[data-asset-type]").forEach(b=>b.classList.toggle("active",b===btn));
    $("areaBoundaryBtn")?.classList.remove("boundary-help");
    if ($("areaBoundaryBtn")) $("areaBoundaryBtn").textContent="◇ Draw Property Boundary";
    $("areaPlaceMessage").textContent=`PLACEMENT MODE: click anywhere on the map to place a ${btn.dataset.assetType}.`;
    if (map) map.getContainer().style.cursor='crosshair';
  }));
  $("areaSatelliteBtn")?.addEventListener("click",()=>{
    initMapSafe();
    if(!map || !areaSatelliteLayer) return;
    if(areaStreetLayer && map.hasLayer(areaStreetLayer)) map.removeLayer(areaStreetLayer);
    if(!map.hasLayer(areaSatelliteLayer)) areaSatelliteLayer.addTo(map);
    $("areaSatelliteBtn").classList.add("active");
    $("areaStreetBtn")?.classList.remove("active");
    $("areaPlaceMessage").textContent = "Satellite view on. Choose an asset or draw the property boundary.";
  });
  $("areaStreetBtn")?.addEventListener("click",()=>{
    initMapSafe();
    if(!map || !areaStreetLayer) return;
    if(areaSatelliteLayer && map.hasLayer(areaSatelliteLayer)) map.removeLayer(areaSatelliteLayer);
    if(!map.hasLayer(areaStreetLayer)) areaStreetLayer.addTo(map);
    $("areaStreetBtn").classList.add("active");
    $("areaSatelliteBtn")?.classList.remove("active");
    $("areaPlaceMessage").textContent = "Map view on. Choose an asset or draw the property boundary.";
  });
  $("areaBoundaryLayer")?.addEventListener("change",e=>{if(!map)return;if(e.target.checked)areaBoundaryGroup.addTo(map);else map.removeLayer(areaBoundaryGroup);});
  $("areaAssetLayer")?.addEventListener("change",e=>{if(!map)return;if(e.target.checked)areaAssetGroup.addTo(map);else map.removeLayer(areaAssetGroup);});
  $("areaParcelLayer")?.addEventListener("change",e=>{initMapSafe();toggleTaxParcelLayer(e.target.checked);});

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

  $("saveUsernameBtn")?.addEventListener("click",()=>saveProfile(true));
  $("saveProfileBtn")?.addEventListener("click",()=>saveProfile(false));
  $("friendSearchBtn")?.addEventListener("click",searchFriend);
  $("shareProperty")?.addEventListener("change",loadShareStands);
  $("shareAccessBtn")?.addEventListener("click",shareAccess);
  $("huntTypePrivate")?.addEventListener("click", () => setPlannerHuntType("private"));
  $("huntTypePublic")?.addEventListener("click", () => setPlannerHuntType("public"));
  $("plannerAnyDeerBtn")?.addEventListener("click", () => setPlannerTargetMode("any"));
  $("plannerTargetBuckBtn")?.addEventListener("click", () => setPlannerTargetMode("buck"));
  $("plannerProperty")?.addEventListener("change", refreshPlannerDeer);
  $("plannerPublicLand")?.addEventListener("change", updatePublicLandMap);
  $("plannerHotelRadius")?.addEventListener("change", updatePublicLandMap);
  $("publicMapStreetBtn")?.addEventListener("click", () => {
    initPublicHuntMap();
    if (!publicHuntMap || !publicHuntStreetLayer) return;
    if (publicHuntSatelliteLayer && publicHuntMap.hasLayer(publicHuntSatelliteLayer)) publicHuntMap.removeLayer(publicHuntSatelliteLayer);
    if (!publicHuntMap.hasLayer(publicHuntStreetLayer)) publicHuntStreetLayer.addTo(publicHuntMap);
    $("publicMapStreetBtn")?.classList.add("active");
    $("publicMapSatelliteBtn")?.classList.remove("active");
  });
  $("publicMapSatelliteBtn")?.addEventListener("click", () => {
    initPublicHuntMap();
    if (!publicHuntMap || !publicHuntSatelliteLayer) return;
    if (publicHuntStreetLayer && publicHuntMap.hasLayer(publicHuntStreetLayer)) publicHuntMap.removeLayer(publicHuntStreetLayer);
    if (!publicHuntMap.hasLayer(publicHuntSatelliteLayer)) publicHuntSatelliteLayer.addTo(publicHuntMap);
    $("publicMapSatelliteBtn")?.classList.add("active");
    $("publicMapStreetBtn")?.classList.remove("active");
  });
  $("buildHuntPlanBtn")?.addEventListener("click", buildHuntPlan);

  $("profilePrevBtn")?.addEventListener("click",()=>moveProfile(-1));
  $("profileNextBtn")?.addEventListener("click",()=>moveProfile(1));
  $("profileSort")?.addEventListener("change",()=>{ profileBrowserIndex=0; renderProfileShowcase(); });
  $("editCurrentProfileBtn")?.addEventListener("click",()=>{ if(currentProfile) renameDeer(currentProfile.id,currentProfile.nickname||""); });
  $("compareProfilesBtn")?.addEventListener("click",()=>{ $("profileComparePanel")?.classList.remove("hidden"); populateCompareSelectors(); });
  $("closeCompareBtn")?.addEventListener("click",()=>$("profileComparePanel")?.classList.add("hidden"));
  $("compareProfileA")?.addEventListener("change",renderProfileComparison);
  $("compareProfileB")?.addEventListener("change",renderProfileComparison);

  if (
    initSupabase()
  ) {
    await restoreSession();
  }
}


window.renameDeer =
  renameDeer;


document.addEventListener(
  "DOMContentLoaded",
  init
);

window.sendFriendRequest=sendFriendRequest; window.respondFriend=respondFriend;



/* ============================================================
   HARVEST HISTORY + WEATHER INTELLIGENCE
   ============================================================ */
const DIE_ALABAMA_COUNTIES = [
  "Autauga","Baldwin","Barbour","Bibb","Blount","Bullock","Butler","Calhoun","Chambers","Cherokee",
  "Chilton","Choctaw","Clarke","Clay","Cleburne","Coffee","Colbert","Conecuh","Coosa","Covington",
  "Crenshaw","Cullman","Dale","Dallas","DeKalb","Elmore","Escambia","Etowah","Fayette","Franklin",
  "Geneva","Greene","Hale","Henry","Houston","Jackson","Jefferson","Lamar","Lauderdale","Lawrence",
  "Lee","Limestone","Lowndes","Macon","Madison","Marengo","Marion","Marshall","Mobile","Monroe",
  "Montgomery","Morgan","Perry","Pickens","Pike","Randolph","Russell","Shelby","St. Clair","Sumter",
  "Talladega","Tallapoosa","Tuscaloosa","Walker","Washington","Wilcox","Winston"
];

let dieHarvestHistory = [];
let dieHarvestOfficial = [];
let dieCountyHarvest2425 = [];

function initHarvestHistoryControls(){
  const county = $("historyCounty");
  if(county && !county.dataset.ready){
    county.innerHTML = DIE_ALABAMA_COUNTIES.map(c => `<option value="${esc(c)}"${c==="Jackson"?" selected":""}>${esc(c)} County</option>`).join("");
    county.dataset.ready = "1";
  }
  $("historyRefreshBtn")?.addEventListener("click", renderHarvestHistory);
  $("historyCounty")?.addEventListener("change", ()=>{renderHarvestHistory();renderOfficialHarvestRows();});
  $("historySeason")?.addEventListener("change", renderHarvestHistory);
  $("historyLand")?.addEventListener("change", renderHarvestHistory);
}

async function loadHarvestHistoryData(){
  try{
    const res = await fetch(`alabama_harvest_history.json?v=14`, {cache:"no-store"});
    if(!res.ok) return [];
    const data = await res.json();
    dieHarvestOfficial = Array.isArray(data?.official_summaries) ? data.official_summaries : [];
    dieCountyHarvest2425 = Array.isArray(data?.county_estimates) ? data.county_estimates : [];
    renderOfficialHarvestRows();
    return Array.isArray(data?.game_check_daily?.records) ? data.game_check_daily.records : [];
  }catch(err){
    console.warn("Harvest history dataset could not be loaded", err);
    dieHarvestOfficial = [];
    dieCountyHarvest2425 = [];
    renderOfficialHarvestRows();
    return [];
  }
}

function renderOfficialHarvestRows(){
  const el=$("historyOfficialRows");
  if(!el) return;
  const county=$("historyCounty")?.value||"Jackson";
  const r=dieCountyHarvest2425.find(x=>String(x.county).toLowerCase()===county.toLowerCase());
  if(!r){
    el.innerHTML=`<div class="history-empty">No verified 2024-25 county estimate loaded for ${esc(county)} County.</div>`;
    return;
  }
  const total=Number(r.total_estimate||0);
  el.innerHTML=`
    <div class="history-row"><span>2024-25</span><span>${esc(county)} County estimated bucks</span><strong>${Number(r.bucks_estimate||0).toLocaleString()}</strong></div>
    <div class="history-row"><span>2024-25</span><span>${esc(county)} County estimated does</span><strong>${Number(r.does_estimate||0).toLocaleString()}</strong></div>
    <div class="history-row"><span>2024-25</span><span>${esc(county)} County estimated total deer</span><strong>${total.toLocaleString()}</strong></div>
    <div class="history-row"><span>Effort</span><span>Estimated deer hunting days</span><strong>${Number(r.hunter_days_estimate||0).toLocaleString()}</strong></div>
    <div class="history-row"><span>Rate</span><span>Estimated bucks per 1,000 hunter-days</span><strong>${Number(r.bucks_per_1000_hunter_days||0).toFixed(2)}</strong></div>
    <div class="history-row"><span>Rate</span><span>Estimated deer per 1,000 hunter-days</span><strong>${Number(r.deer_per_1000_hunter_days||0).toFixed(2)}</strong></div>`;
}

function fmtHistoryDate(v){
  if(!v) return "—";
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
}

function renderHarvestChart(records){
  const chart = $("historyHarvestChart");
  if(!chart) return;
  if(!records.length){
    chart.innerHTML = `<div class="history-empty" style="width:100%">No daily Game Check records are loaded for this selection yet.</div>`;
    return;
  }
  const daily = new Map();
  records.forEach(r=>{
    const key=r.date||"";
    if(!key) return;
    const cur=daily.get(key)||{total:0,bucks:0};
    cur.total += Number(r.total||r.deer||0);
    cur.bucks += Number(r.bucks||r.antlered||0);
    daily.set(key,cur);
  });
  const rows=[...daily.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const max=Math.max(1,...rows.map(([,v])=>v.bucks||v.total));
  chart.innerHTML=rows.map(([date,v])=>{
    const value=v.bucks||v.total;
    const h=Math.max(3,Math.round((value/max)*155));
    return `<div class="harvest-bar-wrap" title="${esc(date)}: ${value} reported ${v.bucks?"bucks":"deer"}"><b>${value}</b><div class="harvest-bar" style="height:${h}px"></div><small>${fmtHistoryDate(date)}</small></div>`;
  }).join("");
}

function renderWeatherHistory(records){
  const el=$("historyWeatherRows");
  if(!el) return;
  const withWeather=records.filter(r=>r.weather && (r.bucks||r.total||r.deer));
  if(!withWeather.length){
    el.innerHTML=`<div class="history-empty">Historical weather correlation will populate once daily harvest records are paired with weather observations.</div>`;
    return;
  }
  const top=[...withWeather].sort((a,b)=>Number(b.bucks||b.total||0)-Number(a.bucks||a.total||0)).slice(0,5);
  el.innerHTML=top.map(r=>{
    const w=r.weather||{};
    const temp=w.temp_f!=null?`${Math.round(w.temp_f)}°F`:"—";
    const wind=w.wind_mph!=null?`${Math.round(w.wind_mph)} mph`:"—";
    const pressure=w.pressure_inhg!=null?`${Number(w.pressure_inhg).toFixed(2)} inHg`:"—";
    return `<div class="history-row"><span>${fmtHistoryDate(r.date)}</span><span>${temp} • ${esc(w.wind_dir||"Wind")} ${wind} • ${pressure}</span><strong>${Number(r.bucks||r.total||0)} harvests</strong></div>`;
  }).join("");
}

function renderHarvestHistory(){
  initHarvestHistoryControls();
  const county=$("historyCounty")?.value||"Jackson";
  const season=$("historySeason")?.value||"all";
  const land=$("historyLand")?.value||"all";

  const survey2425=dieCountyHarvest2425.find(x=>String(x.county||"").toLowerCase()===county.toLowerCase());

  const filtered=dieHarvestHistory.filter(r=>{
    const countyOk=String(r.county||"").toLowerCase()===county.toLowerCase();
    const seasonOk=season==="all" || String(r.season||"")===season;
    const landOk=land==="all" || String(r.land||"").toLowerCase()===land;
    return countyOk && seasonOk && landOk;
  });

  const total=filtered.reduce((s,r)=>s+Number(r.total||r.deer||0),0);
  const bucks=filtered.reduce((s,r)=>s+Number(r.bucks||r.antlered||0),0);

  const daily=new Map();
  filtered.forEach(r=>{
    if(!r.date) return;
    daily.set(r.date,(daily.get(r.date)||0)+Number(r.bucks||r.total||r.deer||0));
  });
  const peak=[...daily.entries()].sort((a,b)=>b[1]-a[1])[0];

  if($("historyChartTitle")) $("historyChartTitle").textContent=`${county} County reported harvest by day`;
  if($("historyTotal")) $("historyTotal").textContent=filtered.length ? total.toLocaleString() : (survey2425 ? Number(survey2425.total_estimate).toLocaleString() : "—");
  if($("historyBucks")) $("historyBucks").textContent=filtered.length ? bucks.toLocaleString() : (survey2425 ? Number(survey2425.bucks_estimate).toLocaleString() : "—");
  if($("historyPeakDay")) $("historyPeakDay").textContent=peak ? fmtHistoryDate(peak[0]) : "—";
  if($("historyPeakCount")) $("historyPeakCount").textContent=peak ? `${peak[1]} reported harvests` : "Needs daily records";
  if($("historyWeatherMatch")) $("historyWeatherMatch").textContent=filtered.some(r=>r.weather) ? "Ready" : "—";
  if($("historyTotalSub")) $("historyTotalSub").textContent=filtered.length ? `${filtered.length} daily Game Check records` : (survey2425 ? "Official 2024-25 survey estimate" : "Selected history");

  const status=$("historyDataStatus");
  if(status){
    status.textContent=filtered.length
      ? `Showing verified date-level ${county} County Game Check records.`
      : `${county} County: official 2024-25 harvest and hunter-day estimates are loaded. ADCNR Game Check does record harvest date + county, but its legacy public daily-report pages now redirect after the 2026 system migration. DIE has not retrieved a legitimate daily export, so daily weather correlation remains disabled rather than inventing records.`;
  }

  renderOfficialHarvestRows();
  renderHarvestChart(filtered);
  renderWeatherHistory(filtered);
}



/* ============================================================
   AREA INTELLIGENCE V15 — MAP-FIRST UI
   ============================================================ */
function refreshAreaV15Details(){
  const property=currentAreaProperty?.();
  if(!property) return;

  if($("areaV15Name")) $("areaV15Name").value=property.name||"";
  if($("areaV15Acres")) $("areaV15Acres").value=property.acreage??property.acres??"";
  if($("areaV15Location")) $("areaV15Location").value=[property.county,property.state||"AL"].filter(Boolean).join(", ");
  if($("areaV15Notes")) $("areaV15Notes").value=property.notes||"";

  const allAssets=[...(areaDbAssets||[])];
  const feederCount=allAssets.filter(a=>a.type==="feeder").length;
  const scrapeCount=allAssets.filter(a=>a.type==="scrape").length;
  const otherCount=allAssets.filter(a=>!["feeder","scrape"].includes(a.type)).length;

  if($("areaV15StatAcres")) $("areaV15StatAcres").textContent=property.acreage??property.acres??"—";
  if($("areaV15StatCameras")) $("areaV15StatCameras").textContent=areaCameras?.length||0;
  if($("areaV15StatStands")) $("areaV15StatStands").textContent=areaStands?.length||0;
  if($("areaV15StatFeeders")) $("areaV15StatFeeders").textContent=feederCount;
  if($("areaV15StatScrapes")) $("areaV15StatScrapes").textContent=scrapeCount;
  if($("areaV15StatOther")) $("areaV15StatOther").textContent=otherCount;
}

async function saveAreaV15Property(){
  const property=currentAreaProperty?.();
  if(!property){
    $("areaPlaceMessage").textContent="Create or choose a property first.";
    return;
  }
  if(!properties.some(p=>p.id===property.id)){
    $("areaPlaceMessage").textContent="Shared properties are view-only.";
    return;
  }

  // If the user is actively drawing, the existing boundary function commits the polygon.
  if(areaBoundaryMode){
    await toggleAreaBoundary();
  }

  const name=$("areaV15Name")?.value?.trim()||property.name;
  const acreage=$("areaV15Acres")?.value ? Number($("areaV15Acres").value) : null;
  const location=$("areaV15Location")?.value?.trim()||"";
  const county=location.split(",")[0]?.trim()||property.county||null;
  const notes=$("areaV15Notes")?.value?.trim()||null;

  const patch={name,county,state:"AL",acreage};
  // Only add notes when the live schema supports it; retry without notes if necessary.
  if(notes!==null) patch.notes=notes;

  let {error}=await sb.from("properties").update(patch).eq("id",property.id).eq("user_id",currentUser.id);
  if(error && Object.prototype.hasOwnProperty.call(patch,"notes")){
    delete patch.notes;
    ({error}=await sb.from("properties").update(patch).eq("id",property.id).eq("user_id",currentUser.id));
  }

  if(error){
    $("areaPlaceMessage").textContent=error.message;
    return;
  }

  Object.assign(property,patch);
  $("areaPlaceMessage").textContent="Property saved. Boundary and map assets are already saved as you place them.";
  refreshAreaV15Details();
}

function wireAreaV15Ui(){
  $("areaSaveBtn")?.addEventListener("click",saveAreaV15Property);

  $("areaCancelBtn")?.addEventListener("click",async()=>{
    areaBoundaryMode=false;
    areaBoundaryPoints=[];
    areaSelectedAssetType=null;
    await loadAreaProperty?.();
    refreshAreaV15Details();
  });

  $("areaSelectParcelBtn")?.addEventListener("click",()=>{
    if($("areaParcelLayer")) $("areaParcelLayer").checked=true;
    toggleTaxParcelLayer?.(true);
    $("areaPlaceMessage").textContent="Parcel borders are on. Use the parcel border as a guide, then Draw Polygon around the parcel to save it as your property.";
  });

  $("areaFreehandBtn")?.addEventListener("click",()=>{
    $("areaPlaceMessage").textContent="Freehand boundary uses the same saved polygon workflow. Click points around the property, then Finish Boundary.";
    if(!areaBoundaryMode) toggleAreaBoundary?.();
  });

  $("areaDeleteBtn")?.addEventListener("click",async()=>{
    const property=currentAreaProperty?.();
    if(!property || !properties.some(p=>p.id===property.id)) return;
    if(!confirm("Delete the saved property boundary? Assets will remain.")) return;
    const {error}=await sb.from("property_maps").delete().eq("property_id",property.id).eq("owner_id",currentUser.id);
    if(error){$("areaPlaceMessage").textContent=error.message;return;}
    areaBoundaryStored=[];
    areaBoundaryGroup?.clearLayers();
    $("areaPlaceMessage").textContent="Property boundary deleted.";
  });

  $("areaClearBtn")?.addEventListener("click",()=>{
    areaSelectedAssetType=null;
    areaBoundaryPoints=[];
    if(areaBoundaryMode){
      areaBoundaryGroup?.clearLayers();
      $("areaPlaceMessage").textContent="Current unsaved boundary points cleared.";
    }else{
      $("areaPlaceMessage").textContent="Choose Draw Polygon to redraw the property, or choose an asset to place it.";
    }
  });

  $("areaUndoBtn")?.addEventListener("click",()=>{
    if(!areaBoundaryMode || !areaBoundaryPoints.length) return;
    areaBoundaryPoints.pop();
    areaBoundaryGroup?.clearLayers();
    areaBoundaryPoints.forEach(pt=>L.circleMarker(pt,{radius:5,color:"#ff7900",fillColor:"#ff7900",fillOpacity:1,weight:2}).addTo(areaBoundaryGroup));
    if(areaBoundaryPoints.length>1) L.polyline(areaBoundaryPoints,{color:"#ff7900",weight:3,dashArray:"7 7"}).addTo(areaBoundaryGroup);
  });

  $("areaRedoBtn")?.addEventListener("click",()=>{
    $("areaPlaceMessage").textContent="Redo becomes available after DIE stores an edit-history stack.";
  });

  $("areaMoveBtn")?.addEventListener("click",()=>{
    $("areaPlaceMessage").textContent="Boundary move/edit handles are planned; redraw the polygon to reposition it right now.";
  });

  $("areaEditBtn")?.addEventListener("click",()=>{
    if(!areaBoundaryMode) toggleAreaBoundary?.();
  });

  $("areaPropertySelect")?.addEventListener("change",()=>setTimeout(refreshAreaV15Details,120));
}

/* DIE dashboard navigation helpers */
document.addEventListener("click", (event) => {
  const shared = event.target.closest("[data-open-shared-property]");
  if(shared){
    openSharedProperty(shared.dataset.openSharedProperty);
    return;
  }

  const jump = event.target.closest("[data-tab-jump]");
  if (jump) {
    const target = jump.dataset.tabJump;
    document.querySelector(`.app-tab[data-tab="${target}"]`)?.click();
  }

  const workspace = event.target.closest("[data-workspace]");
  if (workspace) {
    const drawer = document.getElementById("workspaceDrawer");
    if (drawer) {
      drawer.open = true;
      setTimeout(() => drawer.scrollIntoView({behavior:"smooth", block:"start"}), 20);
    }
  }

  if (event.target.closest("#addDataTopBtn")) {
    document.querySelector('.app-tab[data-tab="upload"]')?.click();
  }

  if (event.target.closest("#editCurrentProfileBtnLeft")) {
    document.getElementById("editCurrentProfileBtn")?.click();
  }

  const tabWithScroll = event.target.closest(".app-tab[data-scroll]");
  if (tabWithScroll) {
    setTimeout(() => document.getElementById("accountSettingsCard")?.scrollIntoView({behavior:"smooth",block:"center"}), 40);
  }

  const sideAction = event.target.closest(".side-action");
  if (sideAction?.dataset.action === "activity") {
    document.querySelector('.app-tab[data-tab="my-intel"]')?.click();
    const drawer = document.getElementById("workspaceDrawer");
    if (drawer) { drawer.open = true; setTimeout(() => drawer.scrollIntoView({behavior:"smooth",block:"start"}),30); }
  }
});


/* ============================================================
   HUNT PLANNER
   ============================================================ */
function setPlannerHuntType(type) {
  plannerHuntType = type === "public" ? "public" : "private";
  $("huntTypePrivate")?.classList.toggle("active", plannerHuntType === "private");
  $("huntTypePublic")?.classList.toggle("active", plannerHuntType === "public");
  $("plannerPrivateFields")?.classList.toggle("hidden", plannerHuntType !== "private");
  $("plannerPublicFields")?.classList.toggle("hidden", plannerHuntType !== "public");
  $("publicHuntMapSection")?.classList.toggle("hidden", plannerHuntType !== "public");

  if ($("plannerControlsTitle")) {
    $("plannerControlsTitle").textContent = plannerHuntType === "private" ? "Private Property Hunt" : "Public Land Hunt";
  }
  if ($("plannerTitle")) {
    $("plannerTitle").textContent = plannerHuntType === "private" ? "Choose a private property to start" : "Choose public land to start";
  }
  if ($("plannerSummary")) {
    $("plannerSummary").textContent = plannerHuntType === "private"
      ? "DIE will use your property layout, deer profiles and sightings to organize the hunt."
      : "Choose public land to see it on the map, review nearby hotels, and organize the hunt.";
  }
  if ($("plannerCallout")) {
    $("plannerCallout").textContent = plannerHuntType === "private"
      ? "Choose your property, decide whether you are targeting a buck, then build the plan."
      : "Choose public land, decide whether you are targeting a buck, then build the plan. Nearby hotels will appear below.";
  }

  refreshPlannerDeer();
  if (plannerHuntType === "public") {
    setTimeout(() => {
      initPublicHuntMap();
      publicHuntMap?.invalidateSize();
      updatePublicLandMap();
    }, 40);
  }
}

function setPlannerTargetMode(mode) {
  plannerTargetMode = mode === "buck" ? "buck" : "any";
  $("plannerAnyDeerBtn")?.classList.toggle("active", plannerTargetMode === "any");
  $("plannerTargetBuckBtn")?.classList.toggle("active", plannerTargetMode === "buck");
  $("plannerDeerWrap")?.classList.toggle("hidden", plannerTargetMode !== "buck");
  if (plannerTargetMode !== "buck" && $("plannerDeer")) $("plannerDeer").value = "";
}

function refreshPlannerOptions() {
  const propertySelect = $("plannerProperty");
  const publicLandSelect = $("plannerPublicLand");
  const deerSelect = $("plannerDeer");
  if (!propertySelect || !deerSelect) return;

  const currentProperty = propertySelect.value;
  propertySelect.innerHTML = '<option value="">Choose one of your properties…</option>' +
    (properties || []).map(p => `<option value="${p.id}">${esc(p.name || p.property_name || "Property")}</option>`).join("");
  if (currentProperty) propertySelect.value = currentProperty;

  if (publicLandSelect) {
    const currentLand = publicLandSelect.value;
    const groups = {};
    (publicLands || []).forEach(land => ((groups[land.type || "Public Land"] ??= []).push(land)));
    publicLandSelect.innerHTML = '<option value="">Choose public land…</option>';
    Object.keys(groups).sort().forEach(type => {
      const group = document.createElement("optgroup");
      group.label = type;
      groups[type].sort((a,b) => (a.name || "").localeCompare(b.name || "")).forEach(land => {
        const option = document.createElement("option");
        option.value = land.id;
        option.textContent = land.name;
        group.appendChild(option);
      });
      publicLandSelect.appendChild(group);
    });
    if (currentLand) publicLandSelect.value = currentLand;
  }

  refreshPlannerDeer();
  if ($("plannerDate") && !$("plannerDate").value) {
    $("plannerDate").value = new Date().toISOString().slice(0,10);
  }
  setPlannerHuntType(plannerHuntType);
  setPlannerTargetMode(plannerTargetMode);
}

function refreshPlannerDeer() {
  const deerSelect = $("plannerDeer");
  if (!deerSelect) return;

  const propertyId = plannerHuntType === "private" ? ($("plannerProperty")?.value || "") : "";
  let list = deerProfiles || [];
  if (propertyId) list = list.filter(d => d.property_id === propertyId);

  deerSelect.innerHTML = '<option value="">Choose target buck…</option>' + list.map(d =>
    `<option value="${d.id}">${esc(d.nickname || d.deer_code || "Buck")}</option>`
  ).join("");
}

function initPublicHuntMap() {
  const container = $("publicHuntMap");
  if (!container || typeof L === "undefined") return;
  if (publicHuntMap) return;

  publicHuntMap = L.map(container, { zoomControl: true, attributionControl: true }).setView([32.8, -86.8], 7);
  publicHuntStreetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  });
  publicHuntSatelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  });
  publicHuntStreetLayer.addTo(publicHuntMap);
  publicHuntMarkerGroup = L.layerGroup().addTo(publicHuntMap);
}

function getLandLatLon(land) {
  const lat = Number(land?.lat ?? land?.latitude ?? land?.center_lat ?? land?.centerLat);
  const lon = Number(land?.lon ?? land?.lng ?? land?.longitude ?? land?.center_lon ?? land?.centerLng);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
}

async function geocodePublicLand(land) {
  const direct = getLandLatLon(land);
  if (direct) return direct;
  const query = encodeURIComponent(`${land?.name || "public hunting land"}, Alabama`);
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${query}`, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error("Could not locate this public hunting area on the map.");
  const rows = await response.json();
  const row = rows?.[0];
  if (!row) throw new Error("No map location was found for this public hunting area.");
  return { lat: Number(row.lat), lon: Number(row.lon) };
}

async function fetchNearbyHotels(lat, lon, radiusMeters = 40233.6) {
  const query = `[out:json][timeout:20];(node[\"tourism\"=\"hotel\"](around:${radiusMeters},${lat},${lon});way[\"tourism\"=\"hotel\"](around:${radiusMeters},${lat},${lon});relation[\"tourism\"=\"hotel\"](around:${radiusMeters},${lat},${lon});node[\"tourism\"=\"motel\"](around:${radiusMeters},${lat},${lon});way[\"tourism\"=\"motel\"](around:${radiusMeters},${lat},${lon}););out center tags 30;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "data=" + encodeURIComponent(query)
  });
  if (!response.ok) throw new Error("Nearby hotel search is temporarily unavailable.");
  const payload = await response.json();
  return (payload?.elements || []).map(item => ({
    id: `${item.type}-${item.id}`,
    name: item.tags?.name || item.tags?.brand || "Hotel",
    lat: Number(item.lat ?? item.center?.lat),
    lon: Number(item.lon ?? item.center?.lon),
    address: [item.tags?.["addr:housenumber"], item.tags?.["addr:street"], item.tags?.["addr:city"]].filter(Boolean).join(" "),
    phone: item.tags?.phone || item.tags?.["contact:phone"] || "",
    website: item.tags?.website || item.tags?.["contact:website"] || ""
  })).filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lon));
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const dLat = rad(lat2-lat1);
  const dLon = rad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function renderHotels(hotels, center, radiusMiles) {
  if (!$("hotelResults") || !$("hotelCount")) return;
  const sorted = hotels.map(h => ({...h, miles: distanceMiles(center.lat, center.lon, h.lat, h.lon)})).sort((a,b)=>a.miles-b.miles).slice(0,12);
  $("hotelCount").textContent = String(sorted.length);
  if (!sorted.length) {
    $("hotelResults").innerHTML = `<p class="muted">No hotel or motel markers were returned within ${radiusMiles} miles. Try extending the range.</p>`;
    return;
  }
  $("hotelResults").innerHTML = sorted.map(h => `
    <button class="hotel-result" type="button" data-hotel-lat="${h.lat}" data-hotel-lon="${h.lon}">
      <span><strong>${esc(h.name)}</strong><small>${h.address ? esc(h.address) + " · " : ""}${h.miles.toFixed(1)} mi away</small></span>
      <span>→</span>
    </button>`).join("");
  $("hotelResults").querySelectorAll(".hotel-result").forEach(btn => btn.addEventListener("click", () => {
    const lat = Number(btn.dataset.hotelLat); const lon = Number(btn.dataset.hotelLon);
    if (publicHuntMap && Number.isFinite(lat) && Number.isFinite(lon)) publicHuntMap.setView([lat,lon], 14);
  }));
}

async function updatePublicLandMap() {
  if (plannerHuntType !== "public") return;
  initPublicHuntMap();
  const landId = $("plannerPublicLand")?.value || "";
  const land = landId ? (publicLands || []).find(l => String(l.id) === String(landId)) : null;
  if (!land) {
    if ($("publicHuntMapStatus")) $("publicHuntMapStatus").textContent = "Choose a public hunting area to load the map and nearby lodging.";
    if ($("hotelResults")) $("hotelResults").innerHTML = '<p class="muted">Select public land to search for hotels nearby.</p>';
    if ($("hotelCount")) $("hotelCount").textContent = "0";
    return;
  }

  const radiusMiles = Math.max(5, Number($("plannerHotelRadius")?.value || 25));
  const radiusMeters = radiusMiles * 1609.344;

  $("publicHuntMapTitle").textContent = `${land.name} + Nearby Hotels`;
  $("publicHuntMapStatus").textContent = "Locating the hunting area…";
  $("hotelResults").innerHTML = '<p class="muted">Searching for nearby hotels…</p>';
  $("hotelCount").textContent = "…";

  try {
    const center = await geocodePublicLand(land);
    publicHuntMarkerGroup?.clearLayers();
    publicHuntMap?.setView([center.lat, center.lon], 11);
    publicHuntLandMarker = L.circleMarker([center.lat, center.lon], {
      radius: 9, color: "#ff7a00", weight: 3, fillColor: "#ff7a00", fillOpacity: .25
    }).bindPopup(`<strong>${esc(land.name)}</strong><br>Selected public hunting area`).addTo(publicHuntMarkerGroup);

    $("publicHuntMapStatus").textContent = `Showing the selected public hunting area and lodging within ${radiusMiles} miles.`;

    let hotels = [];
    try { hotels = await fetchNearbyHotels(center.lat, center.lon, radiusMeters); }
    catch (hotelError) {
      console.warn(hotelError);
      $("hotelResults").innerHTML = '<p class="muted">Hotel search could not load right now. The public-land map is still available.</p>';
      $("hotelCount").textContent = "0";
      return;
    }

    hotels.forEach(h => {
      L.marker([h.lat, h.lon], { title: h.name })
        .bindPopup(`<strong>${esc(h.name)}</strong>${h.address ? `<br>${esc(h.address)}` : ""}`)
        .addTo(publicHuntMarkerGroup);
    });

    if (hotels.length && publicHuntMap) {
      const points = [[center.lat, center.lon], ...hotels.map(h => [h.lat, h.lon])];
      publicHuntMap.fitBounds(points, { padding: [35, 35], maxZoom: 12 });
    }

    renderHotels(hotels, center, radiusMiles);
  } catch (error) {
    console.error(error);
    $("publicHuntMapStatus").textContent = error?.message || "Could not load this public hunting area.";
    $("hotelResults").innerHTML = '<p class="muted">Nearby lodging will appear here when the selected area can be located.</p>';
    $("hotelCount").textContent = "0";
  }
}

function buildHuntPlan() {
  const propertyId = plannerHuntType === "private" ? ($("plannerProperty")?.value || "") : "";
  const publicLandId = plannerHuntType === "public" ? ($("plannerPublicLand")?.value || "") : "";
  if (plannerHuntType === "private" && !propertyId) {
    $("plannerTitle").textContent = "Choose a private property";
    $("plannerCallout").textContent = "Choose one of your properties before building the hunt plan.";
    return;
  }
  if (plannerHuntType === "public" && !publicLandId) {
    $("plannerTitle").textContent = "Choose public land";
    $("plannerCallout").textContent = "Choose an Alabama public hunting area before building the hunt plan.";
    return;
  }

  const property = propertyId ? (properties || []).find(p => String(p.id) === String(propertyId)) : null;
  const publicLand = publicLandId ? (publicLands || []).find(l => String(l.id) === String(publicLandId)) : null;
  const deerId = plannerTargetMode === "buck" ? ($("plannerDeer")?.value || "") : "";
  const deer = deerId ? (deerProfiles || []).find(d => String(d.id) === String(deerId)) : null;
  if (plannerTargetMode === "buck" && !deer) {
    $("plannerTitle").textContent = "Choose your target buck";
    $("plannerCallout").textContent = "You selected a target-buck hunt. Choose the buck you want DIE to center the plan around.";
    return;
  }

  const time = $("plannerTime")?.value || "morning";
  const date = $("plannerDate")?.value || "your selected date";
  const locationName = property?.name || property?.property_name || publicLand?.name || "Hunt location";
  const label = deer ? (deer.nickname || deer.deer_code || "Target buck") : "General movement";
  const sightings = deer?.sighting_count ?? deer?.sightings_count ?? 0;
  const lastSeen = deer?.last_seen ? new Date(deer.last_seen).toLocaleDateString() : "Not available";

  $("plannerTitle").textContent = `${locationName} — ${time.replace("-", " ")} hunt`;
  $("plannerSummary").textContent = plannerHuntType === "private"
    ? (deer ? `Private-property plan centered on ${label}, using its stored sightings and the layout you built in Area Intelligence.` : "Private-property plan centered on overall deer movement and the layout you built in Area Intelligence.")
    : (deer ? `Public-land plan centered on ${label}. Use the map below for the hunt location and nearby lodging logistics.` : `Public-land plan for ${locationName}. Use the map below for the hunting area and nearby lodging logistics.`);
  $("plannerTarget").textContent = deer ? label : "Any deer";
  $("plannerSightings").textContent = deer ? String(sightings) : "—";
  $("plannerLastSeen").textContent = deer ? lastSeen : "—";
  $("plannerCallout").textContent = plannerHuntType === "private"
    ? (deer
        ? `For ${date}, use Area Intelligence to compare ${label}'s recent camera locations against your stands, feeders, scrapes and access routes before the ${time} sit.`
        : `For ${date}, use Area Intelligence to choose the ${time} setup that best matches recent camera activity, stands, feeders, scrapes and access routes.`)
    : (deer
        ? `For ${date}, center the ${time} plan on ${label}. Review the selected public-land map below and use the lodging panel to organize the trip.`
        : `For ${date}, review access and terrain around ${locationName} for the ${time} hunt. Nearby hotels are shown below to help organize the trip.`);
}
