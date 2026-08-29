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
          $("tab-area-intel").classList.toggle("hidden", selected !== "area-intel");
          $("tab-friends")?.classList.toggle("hidden", selected !== "friends");
          if (selected === "friends") refreshFriendsSharing();
          if (selected === "planner") refreshPlannerOptions();

          if (
            selected === "area-intel" &&
            map
          ) {
            setTimeout(
              () => map.invalidateSize(),
              100
            );
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
  $("plannerProperty")?.addEventListener("change", () => {
    if ($("plannerProperty")?.value && $("plannerPublicLand")) $("plannerPublicLand").value = "";
    refreshPlannerDeer();
  });
  $("plannerPublicLand")?.addEventListener("change", () => {
    if ($("plannerPublicLand")?.value && $("plannerProperty")) {
      $("plannerProperty").value = "";
      refreshPlannerDeer();
    }
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


/* DIE dashboard navigation helpers */
document.addEventListener("click", (event) => {
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
}

function refreshPlannerDeer() {
  const deerSelect = $("plannerDeer");
  const propertyId = $("plannerProperty")?.value || "";
  if (!deerSelect) return;
  const list = (deerProfiles || []).filter(d => !propertyId || d.property_id === propertyId);
  deerSelect.innerHTML = '<option value="">Any deer</option>' + list.map(d =>
    `<option value="${d.id}">${esc(d.nickname || d.deer_code || "Buck")}</option>`
  ).join("");
}

function buildHuntPlan() {
  const propertyId = $("plannerProperty")?.value || "";
  const publicLandId = $("plannerPublicLand")?.value || "";
  if (!propertyId && !publicLandId) {
    $("plannerTitle").textContent = "Choose where you want to hunt";
    $("plannerCallout").textContent = "Choose one of your properties or select public land before building a hunt plan.";
    return;
  }

  const property = propertyId ? (properties || []).find(p => p.id === propertyId) : null;
  const publicLand = publicLandId ? (publicLands || []).find(l => l.id === publicLandId) : null;
  const deerId = propertyId ? ($("plannerDeer")?.value || "") : "";
  const deer = deerId ? (deerProfiles || []).find(d => d.id === deerId) : null;
  const time = $("plannerTime")?.value || "morning";
  const date = $("plannerDate")?.value || "your selected date";
  const locationName = property?.name || property?.property_name || publicLand?.name || "Hunt location";
  const label = deer ? (deer.nickname || deer.deer_code || "Target buck") : "Any deer";
  const sightings = deer?.sighting_count ?? deer?.sightings_count ?? 0;
  const lastSeen = deer?.last_seen ? new Date(deer.last_seen).toLocaleDateString() : "Not available";

  $("plannerTitle").textContent = `${locationName} — ${time.replace("-", " ")} hunt`;
  $("plannerSummary").textContent = property
    ? (deer ? `Plan centered on ${label} using the profile history already stored in DIE.` : "General property hunt using the movement data already stored in DIE.")
    : `Public-land hunt plan for ${locationName}. Use Area Intelligence for map context and surrounding deer observations.`;
  $("plannerTarget").textContent = property ? label : "Public-land hunt";
  $("plannerSightings").textContent = property ? String(sightings) : "—";
  $("plannerLastSeen").textContent = property ? lastSeen : "—";
  $("plannerCallout").textContent = property
    ? (deer
        ? `For ${date}, review ${label}'s most recent camera locations and choose the stand that best matches the expected ${time} movement. Area Intelligence can be used alongside this plan for map context.`
        : `For ${date}, use Area Intelligence to review camera activity and place your ${time} sit around the strongest recent movement.`)
    : `For ${date}, use Area Intelligence to review ${locationName}, nearby deer observations, access points and terrain before your ${time} hunt.`;
}
