let cfg,publicLands=[],observations=[],profiles=[];
let map,layerGroup,searchCircle,searchMarker;
const $=id=>document.getElementById(id);
const rad=d=>d*Math.PI/180;

function miles(aLat,aLon,bLat,bLon){
  const R=3958.7613,dLat=rad(bLat-aLat),dLon=rad(bLon-aLon);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function money(n){
  return n==null?"Price unavailable":
    new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
}

async function j(path){return (await fetch(path,{cache:"no-store"})).json()}

async function geocode(q){
  const u="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q="+encodeURIComponent(q);
  const r=await fetch(u,{headers:{Accept:"application/json"}});
  const d=await r.json();
  if(!d.length) throw new Error("Location not found.");
  return {lat:Number(d[0].lat),lon:Number(d[0].lon),label:d[0].display_name};
}

function initMap(){
  map=L.map("map").setView([32.8,-86.8],7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,attribution:"&copy; OpenStreetMap contributors"
  }).addTo(map);
  layerGroup=L.layerGroup().addTo(map);
}

function fillControls(){
  cfg.radius_options.forEach(r=>{
    const o=document.createElement("option");
    o.value=r;o.textContent=r+" miles";
    if(r===cfg.default_radius_miles)o.selected=true;
    $("radius").appendChild(o);
  });

  const groups={};
  publicLands.forEach(p=>(groups[p.type]??=[]).push(p));
  Object.keys(groups).sort().forEach(type=>{
    const g=document.createElement("optgroup");g.label=type;
    groups[type].sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
      const o=document.createElement("option");o.value=p.id;o.textContent=p.name;g.appendChild(o);
    });
    $("publicLand").appendChild(g);
  });
}

async function resolveSearchPoint(){
  const id=$("publicLand").value;
  if(id){
    const land=publicLands.find(x=>x.id===id);
    if(land.lat!=null&&land.lon!=null){
      return {lat:Number(land.lat),lon:Number(land.lon),label:land.name,land};
    }
    const g=await geocode(land.search_label||land.name+", Alabama");
    return {...g,land};
  }

  const q=$("address").value.trim();
  if(!q)throw new Error("Enter an address/ZIP or select public land.");
  const c=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(c)return {lat:Number(c[1]),lon:Number(c[2]),label:q};
  return geocode(q.includes("AL")||/^\d{5}$/.test(q)?q:q+", Alabama");
}

function deerIcon(count){
  return L.divIcon({
    className:"",
    html:`<div style="width:40px;height:40px;border-radius:50%;background:#152019;border:2px solid #a5be86;display:flex;align-items:center;justify-content:center;font-size:23px;position:relative">🦌${count>1?`<span style="position:absolute;right:-6px;top:-7px;background:#a5be86;color:#10170f;border-radius:999px;padding:2px 5px;font-size:11px;font-weight:700">${count}</span>`:""}</div>`,
    iconSize:[40,40],iconAnchor:[20,20],popupAnchor:[0,-21]
  });
}

function publicLandText(o){
  if(o.nearest_public_land&&o.nearest_public_land_distance_miles!=null){
    return `${Number(o.nearest_public_land_distance_miles).toFixed(2)} mi to ${o.nearest_public_land}`;
  }
  if(o.nearest_public_land)return `Near ${o.nearest_public_land}`;
  return "Public-land distance not calculated yet";
}

function popup(o){
  const b=Number(o.buck_count||0),d=Number(o.doe_count||0),f=Number(o.fawn_count||0),u=Number(o.unknown_deer_count||0);
  return `<div style="min-width:220px">
    <b>🦌 ${o.deer_count||1} deer confirmed</b><br>
    ${b?`♂ ${b} probable buck${b===1?"":"s"}<br>`:""}
    ${d?`♀ ${d} probable doe${d===1?"":"s"}<br>`:""}
    ${f?`${f} probable fawn${f===1?"":"s"}<br>`:""}
    ${u?`${u} unclassified deer<br>`:""}
    <hr>
    ${o.acres!=null?`${o.acres} acres<br>`:""}
    ${money(o.price)}<br>
    <b>${publicLandText(o)}</b>
    ${o.listing_url?`<p><a href="${o.listing_url}" target="_blank" rel="noopener">View original listing</a></p>`:""}
  </div>`;
}

function renderResults(center){
  const radius=Number($("radius").value),minAcres=Number($("minAcres").value||0);

  const rows=observations.filter(o=>
    o.confirmed===true&&Number(o.acres||0)>=minAcres&&
    Number.isFinite(Number(o.lat))&&Number.isFinite(Number(o.lon))
  ).map(o=>({...o,distance_miles:miles(center.lat,center.lon,Number(o.lat),Number(o.lon))}))
   .filter(o=>o.distance_miles<=radius)
   .sort((a,b)=>a.distance_miles-b.distance_miles);

  layerGroup.clearLayers();
  if(searchMarker)map.removeLayer(searchMarker);
  if(searchCircle)map.removeLayer(searchCircle);

  searchMarker=L.marker([center.lat,center.lon]).addTo(map).bindPopup(center.label);
  searchCircle=L.circle([center.lat,center.lon],{radius:radius*1609.344}).addTo(map);

  rows.forEach(o=>L.marker([o.lat,o.lon],{icon:deerIcon(Number(o.deer_count||1))}).addTo(layerGroup).bindPopup(popup(o)));
  map.fitBounds(searchCircle.getBounds(),{padding:[15,15]});

  $("mObs").textContent=rows.length;
  $("mDeer").textContent=rows.reduce((s,o)=>s+Number(o.deer_count||1),0);
  $("mProfiles").textContent=new Set(rows.map(o=>o.deer_id).filter(Boolean)).size;
  $("mHarvested").textContent=rows.filter(o=>["reported","verified"].includes(o.harvest_status)).length;
  $("status").textContent=`${rows.length} confirmed deer-photo listing observations within ${radius} miles of ${center.label}.`;

  $("results").innerHTML=rows.length?rows.map(o=>`
    <article class="card">
      <div class="cardtop">
        <div>
          <h3>🦌 ${o.deer_count||1} deer confirmed</h3>
          <div class="muted">${o.address||o.city||o.county||"Listing"}${o.acres!=null?` · ${o.acres} acres`:""} · ${money(o.price)}</div>
        </div>
        <span class="badge hit">${o.distance_miles.toFixed(2)} mi away</span>
      </div>
      <p>♂ ${o.buck_count||0} probable bucks · ♀ ${o.doe_count||0} probable does · ${publicLandText(o)}</p>
      ${o.listing_url?`<a href="${o.listing_url}" target="_blank" rel="noopener">View original listing</a>`:""}
    </article>
  `).join(""):`<div class="panel">No confirmed deer-photo observations match this search yet.</div>`;
}

function renderProfiles(){
  const q=$("profileSearch").value.toLowerCase(),hf=$("harvestFilter").value;
  const rows=profiles.filter(p=>(!q||`${p.deer_id} ${p.nickname||""}`.toLowerCase().includes(q))&&(!hf||p.harvest_status===hf));
  $("profiles").innerHTML=rows.length?rows.map(p=>`<article class="profile"><h3>${p.deer_id}</h3><div class="muted">${p.nickname||"No nickname"} · ${p.sex||"unknown sex"} · ${p.area_label||"area unknown"}</div><p>${p.antler_signature||p.phenotype_notes||"No phenotype notes yet."}</p></article>`).join(""):`<div class="panel">No deer profiles yet.</div>`;
}

async function doSearch(){
  $("status").textContent="Resolving location…";
  try{renderResults(await resolveSearchPoint())}catch(e){$("status").textContent=e.message}
}

async function init(){
  [cfg,publicLands,observations,profiles]=await Promise.all([
    j("config.json"),j("public_lands.json"),j("observations.json"),j("deer_profiles.json")
  ]);
  initMap();fillControls();renderProfiles();

  $("searchBtn").addEventListener("click",doSearch);
  $("address").addEventListener("keydown",e=>{if(e.key==="Enter")doSearch()});
  $("publicLand").addEventListener("change",()=>{if($("publicLand").value)$("address").value=""});
  $("profileSearch").addEventListener("input",renderProfiles);
  $("harvestFilter").addEventListener("input",renderProfiles);

  document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    ["search","profiles","about"].forEach(t=>$("tab-"+t).classList.toggle("hidden",b.dataset.tab!==t));
    if(b.dataset.tab==="search")setTimeout(()=>map.invalidateSize(),50);
  }));
}
init();
