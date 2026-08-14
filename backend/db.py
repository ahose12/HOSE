import sqlite3,json,os,uuid
from pathlib import Path
DB=Path(os.getenv("DEER_DB","data/deer_intelligence.sqlite"))
def connect():
 DB.parent.mkdir(parents=True,exist_ok=True);d=sqlite3.connect(DB);d.row_factory=sqlite3.Row;d.executescript(Path("backend/schema.sql").read_text());return d
def upsert(r):
 d=connect();cols=list(r);d.execute(f"INSERT OR IGNORE INTO observations ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})",[r[c] for c in cols]);d.commit();d.close()
def save_embedding(oid,did,e):
 d=connect();d.execute("INSERT OR REPLACE INTO deer_embeddings VALUES(?,?,?)",(oid,did,json.dumps(e)));d.commit();d.close()
def export_public():
 d=connect();o=[dict(x) for x in d.execute("SELECT * FROM observations WHERE confirmed=1 ORDER BY confirmed_at DESC")];p=[dict(x) for x in d.execute("SELECT * FROM deer_profiles ORDER BY last_seen DESC")];
 for x in o:x["confirmed"]=bool(x["confirmed"]);x["image_storage_allowed"]=bool(x["image_storage_allowed"]);x["deer_image_url"]=x.get("archived_image_path") if x["image_storage_allowed"] else None
 Path("public/observations.json").write_text(json.dumps(o,indent=2));Path("public/deer_profiles.json").write_text(json.dumps(p,indent=2));d.close()
