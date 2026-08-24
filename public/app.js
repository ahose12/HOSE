from pathlib import Path
import re, zipfile, shutil, subprocess

src = Path("/mnt/data/HOSE_property_satellite_persistence_fix/app.js")
text = src.read_text(encoding="utf-8")

# Replace initSupabase through signOut with hardened auth-first implementation.
start = text.index("function initSupabase() {")
end_marker = "/* ============================================================\n   TABS\n   ============================================================ */"
end = text.index(end_marker)

auth_block = r'''function authMessage(message) {
  const el = $("authMessage");
  if (el) el.textContent = message || "";
}


function initSupabase() {
  try {
    const config = window.HOSE_SUPABASE || {};

    if (
      !config.url ||
      !config.publishableKey ||
      typeof config.url !== "string" ||
      typeof config.publishableKey !== "string"
    ) {
      authMessage(
        "Supabase is not configured. Check public/supabase-config.js."
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
      config.url.trim(),
      config.publishableKey.trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    console.log("HOSE Supabase client initialized.");
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


'''

text = text[:start] + auth_block + text[end:]

# Harden private refresh so it cannot break signed-in state due to a single element or table.
old_refresh = '''async function refreshPrivateData() {
  await Promise.all([
    loadProperties(),
    loadCameras(),
    loadDeerProfiles(),
    loadStands(),
    loadSightings()
  ]);

  renderPrivate();
  syncAreaSelectors();
  await loadRecentPhotos();
  if (areaMap) renderAreaMap();
}'''

new_refresh = '''async function refreshPrivateData() {
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
}'''

if old_refresh not in text:
    raise RuntimeError("refreshPrivateData block not found")
text = text.replace(old_refresh, new_refresh, 1)

# Make error UI setters safe if secondary HTML isn't present.
for target in ["propertyMessage", "cameraMessage"]:
    text = text.replace(
        f'''    $("{target}").textContent =
      error.message;''',
        f'''    if ($("{target}")) {{
      $("{target}").textContent =
        error.message;
    }}''',
    )

# Replace the bottom init function completely with auth-first + nonblocking secondary initialization.
init_start = text.index("async function init() {")
init_end = text.index("\nwindow.renameDeer", init_start)

new_init = r'''async function init() {
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
'''

text = text[:init_start] + new_init + text[init_end:]

outdir = Path("/mnt/data/HOSE_auth_safe_property_satellite_fix")
if outdir.exists():
    shutil.rmtree(outdir)
outdir.mkdir()

app_out = outdir / "app.js"
app_out.write_text(text, encoding="utf-8")

readme = """HOSE AUTH-SAFE + PROPERTY/SATELLITE FIX

REPLACE ONLY:
public/app.js

INDEX.HTML:
Use:
<script src="app.js?v=20260824-auth-safe1"></script>

REMOVE any old:
<script src="area-map-fix.js?..."></script>

DO NOT CHANGE:
- supabase-config.js
- process-deer-photo Edge Function
- SQL
- OpenAI secret
- styles.css

WHAT THIS VERSION DOES:
1. Supabase initializes first.
2. Sign In/Create Account event handlers are attached before any map/data loading.
3. Auth errors show directly under the login form.
4. Enter in the password field triggers Sign In.
5. Auth state changes do not run database calls inside the Supabase callback.
6. Property/map/photo failures cannot hide or disable authentication.
7. Keeps the Area Intelligence property reload + camera filtering + satellite map + persistent pins.

TEST AUTH FIRST:
- Hard refresh the site.
- Enter existing email/password.
- Click Sign In.
- If it fails, the exact Supabase error should appear beneath the buttons.

ONLY AFTER AUTH WORKS:
- Go to Area Intelligence.
- Confirm property appears.
- Select property.
- Confirm camera appears.
- Place camera on satellite map.
"""

(outdir / "README-FIRST.txt").write_text(readme, encoding="utf-8")

check = subprocess.run(
    ["node", "--check", str(app_out)],
    capture_output=True,
    text=True
)
if check.returncode != 0:
    raise RuntimeError(check.stderr)

zip_path = Path("/mnt/data/HOSE_auth_safe_property_satellite_fix.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(app_out, "app.js")
    z.write(outdir / "README-FIRST.txt", "README-FIRST.txt")

print("JavaScript syntax: OK")
print(zip_path)
