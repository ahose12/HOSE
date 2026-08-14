import os,hashlib,imagehash
from datetime import datetime,timezone
from providers.csv_provider import CSVProvider
from vision import DeerVision
from db import upsert,save_embedding,export_public
from reid import match_or_create
def main():
 p=CSVProvider(os.getenv("LISTING_CSV","data/listings.csv"));v=DeerVision(float(os.getenv("DEER_DETECTION_THRESHOLD","0.30")))
 for l in p.discover():
  for i,u in enumerate(p.images(l),1):
   try:
    img=v.download(u);h=v.detect(img)
    if not h:continue
    ph=str(imagehash.phash(img));now=datetime.now(timezone.utc).isoformat();o={"id":hashlib.sha256(f"{l.get('source')}|{l.get('source_listing_id')}|{ph}".encode()).hexdigest()[:32],"source":l.get("source","CSV Feed"),"source_listing_id":l.get("source_listing_id"),"listing_url":l.get("listing_url"),"address":l.get("address"),"city":l.get("city"),"county":l.get("county"),"lat":l["lat"],"lon":l["lon"],"acres":l.get("acres"),"price":l.get("price"),"image_source_url":u,"image_index":i,"image_phash":ph,"image_storage_allowed":0,"archived_image_path":None,"detected_confidence":max(float(x["score"]) for x in h),"deer_count":len(h),"sex_classification":"unknown","antler_notes":None,"observed_at":l.get("photo_date") or None,"confirmed_at":now,"confirmed":1,"nearest_public_land":None,"harvest_status":"unknown"};e=v.embedding(img,h);did,s=match_or_create(e,o);o["deer_id"]=did;o["reid_confidence"]=s;upsert(o);save_embedding(o["id"],did,e);print("CONFIRMED",did,l.get("address"),i)
   except Exception as ex:print("WARN",l.get("address"),i,ex)
 export_public()
if __name__=="__main__":main()
