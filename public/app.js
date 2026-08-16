let cfg = {};
let publicLands = [];
let observations = [];
let profiles = [];

let map;
let layerGroup;
let searchCircle;
let searchMarker;

const $ = id => document.getElementById(id);

const rad = d => d * Math.PI / 180;


/* ============================================================
   BASIC HELPERS
   ============================================================ */

function miles(
    startLat,
    startLon,
    endLat,
    endLon
) {

    const R = 3958.7613;

    const dLat = rad(
        endLat - startLat
    );

    const dLon = rad(
        endLon - startLon
    );

    const a =
        Math.sin(dLat / 2) ** 2
        +
        Math.cos(rad(startLat))
        *
        Math.cos(rad(endLat))
        *
        Math.sin(dLon / 2) ** 2;

    return (
        2
        *
        R
        *
        Math.asin(Math.sqrt(a))
    );
}


function money(value) {

    if (value == null) {
        return "Price unavailable";
    }

    return new Intl.NumberFormat(
        "en-US",
        {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0
        }
    ).format(value);
}


async function loadJson(
    path,
    fallback
) {

    try {

        const response = await fetch(
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


/* ============================================================
   GEOCODING
   ============================================================ */

async function geocode(query) {

    const url =
        "https://nominatim.openstreetmap.org/search"
        +
        "?format=jsonv2"
        +
        "&limit=1"
        +
        "&countrycodes=us"
        +
        "&q="
        +
        encodeURIComponent(query);


    const response = await fetch(
        url,
        {
            headers: {
                Accept: "application/json"
            }
        }
    );


    const data = await response.json();


    if (!data.length) {

        throw new Error(
            "Location not found."
        );

    }


    return {

        lat: Number(
            data[0].lat
        ),

        lon: Number(
            data[0].lon
        ),

        label:
            data[0].display_name
    };
}


/* ============================================================
   MAP
   ============================================================ */

function initMap() {

    map = L.map(
        "map"
    ).setView(
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
    ).addTo(map);


    layerGroup =
        L.layerGroup()
        .addTo(map);
}


/* ============================================================
   SEARCH CONTROLS
   ============================================================ */

function fillControls() {

    const radiusOptions =
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
        ];


    radiusOptions.forEach(
        radius => {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                radius;


            option.textContent =
                radius
                +
                " miles";


            if (
                radius
                ===
                (
                    cfg.default_radius_miles
                    ||
                    5
                )
            ) {

                option.selected =
                    true;

            }


            $("radius")
                .appendChild(
                    option
                );
        }
    );


    const groups = {};


    publicLands.forEach(
        land => {

            if (
                !groups[
                    land.type
                ]
            ) {

                groups[
                    land.type
                ] = [];

            }


            groups[
                land.type
            ].push(
                land
            );
        }
    );


    Object
        .keys(groups)
        .sort()
        .forEach(
            type => {

                const optGroup =
                    document.createElement(
                        "optgroup"
                    );


                optGroup.label =
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


                            optGroup.appendChild(
                                option
                            );
                        }
                    );


                $("publicLand")
                    .appendChild(
                        optGroup
                    );
            }
        );
}


/* ============================================================
   RESOLVE SEARCH POINT
   ============================================================ */

async function resolveSearch() {

    const landId =
        $("publicLand")
        .value;


    if (landId) {

        const land =
            publicLands.find(
                x =>
                    x.id
                    ===
                    landId
            );


        if (
            land
            &&
            land.lat != null
            &&
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
            land.search_label
            ||
            (
                land.name
                +
                ", Alabama"
            )
        );
    }


    const query =
        $("address")
        .value
        .trim();


    if (!query) {

        throw new Error(
            "Enter an address, ZIP, city, coordinates, or public land."
        );

    }


    const coordinateMatch =
        query.match(
            /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
        );


    if (coordinateMatch) {

        return {

            lat:
                Number(
                    coordinateMatch[1]
                ),

            lon:
                Number(
                    coordinateMatch[2]
                ),

            label:
                query
        };

    }


    return geocode(
        query
    );
}


/* ============================================================
   DEER ICON
   ============================================================ */

function deerIcon(
    count
) {

    return L.divIcon({

        className:
            "",

        html:
            `
            <div
              style="
                width:40px;
                height:40px;
                border-radius:50%;
                background:#152019;
                border:2px solid #a5be86;
                display:flex;
                align-items:center;
                justify-content:center;
                font-size:23px;
                position:relative;
              "
            >
              🦌

              ${
                  count > 1
                  ?
                  `
                  <span
                    style="
                      position:absolute;
                      top:-7px;
                      right:-7px;
                      background:#a5be86;
                      color:#10170f;
                      min-width:19px;
                      height:19px;
                      border-radius:999px;
                      font-size:11px;
                      font-weight:bold;
                      display:flex;
                      align-items:center;
                      justify-content:center;
                      padding:0 4px;
                    "
                  >
                    ${count}
                  </span>
                  `
                  :
                  ""
              }
            </div>
            `,

        iconSize:
            [
                40,
                40
            ],

        iconAnchor:
            [
                20,
                20
            ],

        popupAnchor:
            [
                0,
                -20
            ]

    });
}


/* ============================================================
   PUBLIC LAND TEXT
   ============================================================ */

function publicLandText(
    observation
) {

    if (
        observation.nearest_public_land
        &&
        observation.nearest_public_land_distance_miles
        != null
    ) {

        return (
            Number(
                observation
                    .nearest_public_land_distance_miles
            ).toFixed(2)
            +
            " mi to "
            +
            observation.nearest_public_land
        );

    }


    if (
        observation
            .nearest_public_land
    ) {

        return (
            "Near "
            +
            observation
                .nearest_public_land
        );

    }


    return (
        "Public-land distance not calculated yet"
    );
}


/* ============================================================
   OUTSIDE OBSERVATION POPUP
   ============================================================ */

function observationPopup(
    observation
) {

    const bucks =
        Number(
            observation.buck_count
            ||
            0
        );


    const does =
        Number(
            observation.doe_count
            ||
            0
        );


    const fawns =
        Number(
            observation.fawn_count
            ||
            0
        );


    return `
        <div style="min-width:220px">

          <strong>
            🦌
            ${
                observation.deer_count
                ||
                1
            }
            deer confirmed
          </strong>

          <br><br>

          ♂ ${bucks} probable bucks

          <br>

          ♀ ${does} probable does

          <br>

          ${fawns} probable fawns

          <br><br>

          ${
              observation.acres != null
              ?
              observation.acres
              +
              " acres"
              +
              "<br>"
              :
              ""
          }

          ${money(
              observation.price
          )}

          <br><br>

          <strong>
            ${
                publicLandText(
                    observation
                )
            }
          </strong>

          ${
              observation.listing_url
              ?
              `
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
              :
              ""
          }

        </div>
    `;
}


/* ============================================================
   RENDER MAP RESULTS
   ============================================================ */

function renderResults(
    center
) {

    const radius =
        Number(
            $("radius")
            .value
        );


    const minimumAcres =
        Number(
            $("minAcres")
            .value
            ||
            0
        );


    const rows =
        observations

        .filter(
            observation =>
                observation.confirmed
                ===
                true
                &&
                Number(
                    observation.acres
                    ||
                    0
                )
                >=
                minimumAcres
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
                <=
                radius
        )

        .sort(
            (a, b) =>
                a.distance_miles
                -
                b.distance_miles
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
        .addTo(map)
        .bindPopup(
            center.label
        );


    searchCircle =
        L.circle(
            [
                center.lat,
                center.lon
            ],
            {
                radius:
                    radius
                    *
                    1609.344
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
                        deerIcon(
                            Number(
                                observation.deer_count
                                ||
                                1
                            )
                        )
                }
            )
            .addTo(
                layerGroup
            )
            .bindPopup(
                observationPopup(
                    observation
                )
            );

        }
    );


    map.fitBounds(
        searchCircle
            .getBounds(),
        {
            padding:
                [
                    15,
                    15
                ]
        }
    );


    $("mObs")
        .textContent =
            rows.length;


    $("mDeer")
        .textContent =
            rows.reduce(
                (
                    total,
                    observation
                ) =>
                    total
                    +
                    Number(
                        observation.deer_count
                        ||
                        1
                    ),
                0
            );


    $("mProfiles")
        .textContent =
            new Set(
                rows
                .map(
                    observation =>
                        observation.deer_id
                )
                .filter(Boolean)
            ).size;


    $("mHarvested")
        .textContent =
            rows.filter(
                observation =>
                    [
                        "reported",
                        "verified"
                    ].includes(
                        observation.harvest_status
                    )
            ).length;


    $("status")
        .textContent =
            rows.length
            +
            " confirmed outside observations within "
            +
            radius
            +
            " miles of "
            +
            center.label
            +
            ".";


    if (!rows.length) {

        $("results")
            .innerHTML =
                `
                <div class="panel">
                  No confirmed outside deer observations
                  match this search yet.
                </div>
                `;

        return;

    }


    $("results")
        .innerHTML =
            rows.map(
                observation => `

                <article class="card">

                  <div class="cardtop">

                    <div>

                      <h3>
                        🦌
                        ${
                            observation.deer_count
                            ||
                            1
                        }
                        deer confirmed
                      </h3>

                      <div class="muted">

                        ${
                            observation.address
                            ||
                            observation.city
                            ||
                            observation.county
                            ||
                            "Listing"
                        }

                        ${
                            observation.acres != null
                            ?
                            " · "
                            +
                            observation.acres
                            +
                            " acres"
                            :
                            ""
                        }

                        ·
                        ${
                            money(
                                observation.price
                            )
                        }

                      </div>

                    </div>

                    <span class="badge hit">

                      ${
                          observation
                          .distance_miles
                          .toFixed(2)
                      }
                      mi away

                    </span>

                  </div>


                  <p>

                    ♂
                    ${
                        observation.buck_count
                        ||
                        0
                    }
                    probable bucks

                    ·

                    ♀
                    ${
                        observation.doe_count
                        ||
                        0
                    }
                    probable does

                    ·

                    ${
                        publicLandText(
                            observation
                        )
                    }

                  </p>


                  ${
                      observation.listing_url
                      ?
                      `
                      <a
                        href="${observation.listing_url}"
                        target="_blank"
                        rel="noopener"
                      >
                        View original listing
                      </a>
                      `
                      :
                      ""
                  }

                </article>
                `
            ).join("");
}


/* ============================================================
   SEARCH BUTTON
   ============================================================ */

async function doSearch() {

    $("status")
        .textContent =
            "Resolving location…";


    try {

        const center =
            await resolveSearch();


        renderResults(
            center
        );

    } catch (error) {

        $("status")
            .textContent =
                error.message;

    }
}


/* ============================================================
   SAMPLE TRAIL CAMERA DATA
   ============================================================ */

const trailData = {

    cameras: [

        {

            id:
                "camera-north-ridge",

            name:
                "North Ridge Cam",

            facing:
                "SW",

            primary_habitat:
                "Transition / Edge",

            features: [
                "Heavy trail",
                "Scrape"
            ],

            sightings:
                34,

            bucks:
                5,

            daylight:
                29
        },


        {

            id:
                "camera-creek",

            name:
                "Creek Crossing",

            facing:
                "NW",

            primary_habitat:
                "Creek / Drain",

            features: [
                "Water / creek",
                "Heavy trail"
            ],

            sightings:
                19,

            bucks:
                3,

            daylight:
                42
        }

    ],


    stands: [

        {

            name:
                "Creek Stand",

            habitat:
                "Creek / hardwood transition",

            winds: [
                "NW",
                "W"
            ],

            score:
                78
        }

    ],


    deer: [

        {

            deer_id:
                "AL-JACKSON-BUCK-0017",

            nickname:
                "Split G2",

            sightings:
                23,

            top_habitat:
                "Transition / Edge",

            top_camera:
                "North Ridge Cam",

            antler_signature:
                "Split right G2 with asymmetric right side.",

            harvest_status:
                "unknown"
        }

    ],


    analytics: {

        photos_analyzed:
            4283,

        deer_sightings:
            164,

        identified_bucks:
            11,

        top_habitat:
            "Transition / Edge",

        top_camera:
            "North Ridge Cam",

        top_time:
            "5:10–6:35 PM",

        top_wind:
            "NW"
    },


    recommendation: {

        label:
            "Strong opportunity",

        stand:
            "Creek Stand",

        target:
            "Split G2",

        timing:
            "Next cool NW/W evening",

        score:
            78,

        reasons: [

            "5 of 7 recent sightings occurred on NW/W winds.",

            "4 recent observations occurred during daylight.",

            "Movement increased during falling temperatures.",

            "Creek Stand is closest to the current movement corridor."

        ]
    }

};


/* ============================================================
   RENDER TRAIL CAMERA INTELLIGENCE
   ============================================================ */

function renderTrail() {

    const analytics =
        trailData.analytics;


    $("tcPhotos")
        .textContent =
            analytics.photos_analyzed;


    $("tcSightings")
        .textContent =
            analytics.deer_sightings;


    $("tcBucks")
        .textContent =
            analytics.identified_bucks;


    $("tcCameras")
        .textContent =
            trailData.cameras.length;


    $("topHabitat")
        .textContent =
            analytics.top_habitat;


    $("topCamera")
        .textContent =
            analytics.top_camera;


    $("topTime")
        .textContent =
            analytics.top_time;


    $("topWind")
        .textContent =
            analytics.top_wind;


    /* CAMERA DROPDOWN */

    const cameraSelect =
        $("uploadCamera");


    cameraSelect.innerHTML =
        `
        <option value="">
          Choose camera…
        </option>
        `;


    trailData.cameras.forEach(
        camera => {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                camera.id;


            option.textContent =
                camera.name;


            cameraSelect
                .appendChild(
                    option
                );

        }
    );


    /* CAMERA CARDS */

    $("cameraCards")
        .innerHTML =
            trailData.cameras
            .map(
                camera => `

                <div class="stack-item">

                  <div class="stack-item-head">

                    <div>

                      <strong>
                        📷
                        ${camera.name}
                      </strong>

                      <div class="small muted">

                        ${camera.primary_habitat}

                        · Facing

                        ${camera.facing}

                      </div>

                    </div>


                    <span class="meta-chip">

                      ${camera.sightings}
                      sightings

                    </span>

                  </div>


                  <div class="meta-row">

                    ${
                        camera.features
                        .map(
                            feature =>
                                `
                                <span class="meta-chip">
                                  ${feature}
                                </span>
                                `
                        )
                        .join("")
                    }


                    <span class="meta-chip">

                      ${camera.bucks}
                      bucks

                    </span>


                    <span class="meta-chip">

                      ${camera.daylight}%
                      daylight

                    </span>

                  </div>

                </div>
                `
            )
            .join("");


    /* DEER CARDS */

    $("deerCards")
        .innerHTML =
            trailData.deer
            .map(
                deer => `

                <div class="stack-item">

                  <strong>
                    🦌
                    ${
                        deer.nickname
                        ||
                        deer.deer_id
                    }
                  </strong>


                  <div class="small muted">
                    ${deer.deer_id}
                  </div>


                  <div class="meta-row">

                    <span class="meta-chip">

                      ${deer.sightings}
                      sightings

                    </span>


                    <span class="meta-chip">

                      ${deer.top_habitat}

                    </span>


                    <span class="meta-chip">

                      ${deer.top_camera}

                    </span>

                  </div>


                  <p class="small">

                    ${deer.antler_signature}

                  </p>

                </div>
                `
            )
            .join("");


    /* STANDS */

    $("standCards")
        .innerHTML =
            trailData.stands
            .map(
                stand => `

                <div class="stack-item">

                  <strong>
                    🌲
                    ${stand.name}
                  </strong>


                  <div class="small muted">

                    ${stand.habitat}

                  </div>


                  <div class="meta-row">

                    ${
                        stand.winds
                        .map(
                            wind =>
                                `
                                <span class="meta-chip">
                                  ${wind} wind
                                </span>
                                `
                        )
                        .join("")
                    }


                    <span class="meta-chip">

                      ${stand.score}/100

                    </span>

                  </div>

                </div>
                `
            )
            .join("");


    /* RECOMMENDATION */

    const recommendation =
        trailData.recommendation;


    $("opportunityLabel")
        .textContent =
            recommendation.label;


    $("huntRecommendation")
        .className =
            "recommendation-live";


    $("huntRecommendation")
        .innerHTML =
            `

            <h4>
              ${recommendation.stand}
            </h4>


            <p>

              Target:

              <strong>
                ${recommendation.target}
              </strong>

              <br>

              Timing:

              <strong>
                ${recommendation.timing}
              </strong>

              <br>

              Relative opportunity:

              <strong>
                ${recommendation.score}/100
              </strong>

            </p>


            <ul>

              ${
                  recommendation.reasons
                  .map(
                      reason =>
                          `<li>${reason}</li>`
                  )
                  .join("")
              }

            </ul>


            <p class="small muted">

              Relative pattern score based on observed
              movement and conditions. It is not a
              guaranteed harvest probability.

            </p>
            `;

}


/* ============================================================
   PHOTO PREVIEW
   ============================================================ */

function renderPhotoPreviews(
    files
) {

    const previewSection =
        $("photoPreviewSection");


    const previewGrid =
        $("photoPreviewGrid");


    previewGrid.innerHTML =
        "";


    if (!files.length) {

        previewSection.style.display =
            "none";

        return;

    }


    previewSection.style.display =
        "block";


    Array
        .from(files)
        .slice(
            0,
            100
        )
        .forEach(
            file => {

                const reader =
                    new FileReader();


                reader.onload =
                    event => {

                        const card =
                            document.createElement(
                                "div"
                            );


                        card.style.cssText =
                            `
                            border:1px solid #334138;
                            background:#111a14;
                            border-radius:10px;
                            padding:5px;
                            overflow:hidden;
                            `;


                        card.innerHTML =
                            `
                            <img
                              src="${event.target.result}"
                              alt=""
                              style="
                                width:100%;
                                height:100px;
                                object-fit:cover;
                                border-radius:7px;
                                display:block;
                              "
                            >

                            <div
                              style="
                                font-size:10px;
                                color:#a9b6ac;
                                overflow:hidden;
                                text-overflow:ellipsis;
                                white-space:nowrap;
                                padding:5px 2px 2px;
                              "
                              title="${file.name}"
                            >
                              ${file.name}
                            </div>
                            `;


                        previewGrid
                            .appendChild(
                                card
                            );

                    };


                reader.readAsDataURL(
                    file
                );

            }
        );

}


/* ============================================================
   TRAIL CAMERA INTERACTIONS
   ============================================================ */

function setupTrail() {


    /* FILE SELECT */

    $("photoUpload")
        .addEventListener(
            "change",
            event => {

                const files =
                    event.target.files;


                $("uploadCount")
                    .textContent =
                        files.length
                        +
                        (
                            files.length
                            ===
                            1
                            ?
                            " file selected"
                            :
                            " files selected"
                        );


                renderPhotoPreviews(
                    files
                );


                $("uploadMessage")
                    .textContent =
                        files.length
                        ?
                        "Photos selected successfully. Review the thumbnails below."
                        :
                        "Select trail-camera photos to begin.";

            }
        );


    /* QUEUE BUTTON */

    $("processUploadBtn")
        .addEventListener(
            "click",
            () => {

                const files =
                    $("photoUpload")
                    .files;


                const camera =
                    $("uploadCamera")
                    .value;


                if (!files.length) {

                    $("uploadMessage")
                        .textContent =
                            "Select photos first.";

                    return;

                }


                if (!camera) {

                    $("uploadMessage")
                        .textContent =
                            "Choose which camera these photos came from.";

                    return;

                }


                $("uploadMessage")
                    .textContent =
                        files.length
                        +
                        " photos are ready for private upload and AI analysis. "
                        +
                        "The browser preview is working; secure backend upload is the next connection.";

            }
        );


    /* ADD CAMERA */

    $("saveCameraBtn")
        .addEventListener(
            "click",
            () => {

                const name =
                    $("cameraName")
                    .value
                    .trim();


                if (!name) {

                    return;

                }


                const features =
                    Array.from(
                        document.querySelectorAll(
                            ".habitat-options input:checked"
                        )
                    )
                    .map(
                        input =>
                            input.value
                    );


                trailData
                    .cameras
                    .push(
                        {

                            id:
                                "camera-"
                                +
                                Date.now(),

                            name:
                                name,

                            facing:
                                $("cameraFacing")
                                .value,

                            primary_habitat:
                                $("primaryHabitat")
                                .value,

                            features:
                                features,

                            sightings:
                                0,

                            bucks:
                                0,

                            daylight:
                                0
                        }
                    );


                $("cameraName")
                    .value =
                        "";


                $("cameraNotes")
                    .value =
                        "";


                document
                    .querySelectorAll(
                        ".habitat-options input"
                    )
                    .forEach(
                        checkbox =>
                            checkbox.checked
                            =
                            false
                    );


                renderTrail();

            }
        );


    /* ADD STAND */

    $("addStandBtn")
        .addEventListener(
            "click",
            () => {

                const name =
                    prompt(
                        "Stand name:"
                    );


                if (!name) {

                    return;

                }


                trailData
                    .stands
                    .push(
                        {

                            name:
                                name,

                            habitat:
                                "Not configured",

                            winds:
                                [],

                            score:
                                0
                        }
                    );


                renderTrail();

            }
        );

}


/* ============================================================
   INITIALIZATION
   ============================================================ */

async function init() {

    [
        cfg,
        publicLands,
        observations,
        profiles
    ]
    =
    await Promise.all(
        [

            loadJson(
                "config.json",
                {
                    default_radius_miles:
                        5,

                    radius_options:
                        [
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

        ]
    );


    initMap();


    fillControls();


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
                    event.key
                    ===
                    "Enter"
                ) {

                    doSearch();

                }

            }
        );


    $("publicLand")
        .addEventListener(
            "change",
            () => {

                if (
                    $("publicLand")
                    .value
                ) {

                    $("address")
                        .value =
                            "";

                }

            }
        );


    renderTrail();


    setupTrail();

}


init();
