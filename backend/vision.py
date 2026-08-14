import io,requests,numpy as np,torch
from PIL import Image
from transformers import pipeline,CLIPModel,CLIPProcessor
class DeerVision:
 def __init__(self,t=.30):
  self.t=t;self.det=pipeline("zero-shot-object-detection",model="google/owlv2-base-patch16-ensemble");self.cm=CLIPModel.from_pretrained("openai/clip-vit-base-patch32");self.cp=CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32");self.cm.eval()
 def download(self,u):
  r=requests.get(u,timeout=25,headers={"User-Agent":"AlabamaDeerIntel/1.0"});r.raise_for_status();return Image.open(io.BytesIO(r.content)).convert("RGB")
 def detect(self,img):return [x for x in self.det(img,candidate_labels=["white-tailed deer","deer"]) if x["score"]>=self.t]
 def embedding(self,img,h):
  b=max(h,key=lambda x:x["score"])["box"];c=img.crop((b["xmin"],b["ymin"],b["xmax"],b["ymax"]));z=self.cp(images=c,return_tensors="pt");
  with torch.no_grad():e=self.cm.get_image_features(**z)[0].cpu().numpy().astype(float);e=e/(np.linalg.norm(e)+1e-12);return e.tolist()
