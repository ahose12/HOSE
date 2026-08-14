import json
from db import connect
TH=.91
def match_or_create(e,o):
 d=connect();best=None
 for r in d.execute("SELECT deer_id,embedding_json FROM deer_embeddings WHERE deer_id IS NOT NULL"):
  q=json.loads(r["embedding_json"]);s=sum(a*b for a,b in zip(e,q));best=(r["deer_id"],s) if best is None or s>best[1] else best
 if best and best[1]>=TH:did,score=best
 else:
  area=''.join(c for c in (o.get("county") or "AL").upper() if c.isalnum())[:12] or "AL";n=d.execute("SELECT COUNT(*) FROM deer_profiles WHERE deer_id LIKE ?",(f"AL-{area}-%",)).fetchone()[0]+1;did=f"AL-{area}-UNKN-{n:04d}";score=1.0;d.execute("INSERT INTO deer_profiles(deer_id,sex,area_label,first_seen,last_seen,sighting_count,identity_confidence) VALUES(?,?,?,?,?,?,?)",(did,"unknown",o.get("nearest_public_land") or o.get("county"),o.get("observed_at") or o.get("confirmed_at"),o.get("observed_at") or o.get("confirmed_at"),0,score))
 d.execute("UPDATE deer_profiles SET sighting_count=sighting_count+1,last_seen=?,identity_confidence=? WHERE deer_id=?",(o.get("observed_at") or o.get("confirmed_at"),score,did));d.commit();d.close();return did,score
