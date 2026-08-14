import argparse
from db import connect,export_public
ap=argparse.ArgumentParser();s=ap.add_subparsers(dest="cmd",required=True);h=s.add_parser("harvest");h.add_argument("deer_id");h.add_argument("--status",choices=["unknown","reported","verified"],required=True);h.add_argument("--date");h.add_argument("--note");h.add_argument("--verified-by");p=s.add_parser("profile");p.add_argument("deer_id");p.add_argument("--nickname");p.add_argument("--sex");p.add_argument("--antler-signature");p.add_argument("--phenotype-notes");p.add_argument("--lineage-notes");a=ap.parse_args();d=connect()
if a.cmd=="harvest":d.execute("UPDATE deer_profiles SET harvest_status=?,harvest_date=?,harvest_evidence_note=?,harvest_verified_by=? WHERE deer_id=?",(a.status,a.date,a.note,a.verified_by,a.deer_id));d.execute("UPDATE observations SET harvest_status=?,harvest_date=?,harvest_evidence_note=? WHERE deer_id=?",(a.status,a.date,a.note,a.deer_id))
else:
 f={"nickname":a.nickname,"sex":a.sex,"antler_signature":a.antler_signature,"phenotype_notes":a.phenotype_notes,"lineage_notes":a.lineage_notes};q=[(k,v) for k,v in f.items() if v is not None];d.execute("UPDATE deer_profiles SET "+",".join(k+"=?" for k,v in q)+" WHERE deer_id=?",[v for k,v in q]+[a.deer_id]) if q else None
d.commit();d.close();export_public()
