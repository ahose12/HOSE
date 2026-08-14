import csv
from .base import ListingProvider
class CSVProvider(ListingProvider):
 def __init__(self,path="data/listings.csv"):self.path=path
 def automation_allowed(self):return True
 def image_storage_allowed(self):return False
 def discover(self):
  with open(self.path,newline="",encoding="utf-8") as f:
   for r in csv.DictReader(f):
    r["lat"]=float(r["lat"]);r["lon"]=float(r["lon"]);r["acres"]=float(r.get("acres") or 0);r["price"]=float(r["price"]) if r.get("price") else None;yield r
 def images(self,l):return [x.strip() for x in (l.get("photo_urls") or "").split("|") if x.strip()]
