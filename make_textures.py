from PIL import Image, ImageFilter, ImageEnhance
import numpy as np, os, math
src=Image.open('/mnt/data/wide_cinematic_space_illustration_of_the_solar_sy.png').convert('RGB')
out='/mnt/data/eartify_all_planets/public/assets/planet-textures'
os.makedirs(out,exist_ok=True)
W,H=2048,1024
# x,y,r crop centers for the generated planetary sphere illustration
spec={
 'mercury':(208,420,32), 'venus':(324,420,53), 'mars':(633,414,60),
 'jupiter':(915,403,120), 'saturn':(1196,408,78), 'uranus':(1412,419,56), 'neptune':(1586,420,78)
}
# map visible orthographic hemisphere to equirectangular, mirrored backside with softened seam
for name,(cx,cy,r) in spec.items():
    crop=src.crop((cx-r,cy-r,cx+r,cy+r)).resize((1024,1024),Image.Resampling.LANCZOS)
    arr=np.asarray(crop).astype(np.float32)
    yy,xx=np.mgrid[0:H,0:W]
    lon=(xx/W*2*np.pi)-np.pi
    lat=(0.5-yy/H)*np.pi
    # hemisphere projection: x=sin(lon)*cos(lat), y=sin(lat); visible hemisphere for |lon| <= pi/2
    sx=512 + np.sin(lon)*np.cos(lat)*510
    sy=512 - np.sin(lat)*510
    # for far hemisphere use opposite-facing source mirrored horizontally, maintaining coherent bands
    far=np.abs(lon)>np.pi/2
    lon2=np.where(far, np.where(lon>0,np.pi-lon,-np.pi-lon),lon)
    sx2=512 + np.sin(lon2)*np.cos(lat)*510
    sy2=512 - np.sin(lat)*510
    sx=np.where(far,sx2,sx); sy=np.where(far,sy2,sy)
    # sample crop
    from scipy.ndimage import map_coordinates
    channels=[]
    for c in range(3): channels.append(map_coordinates(arr[:,:,c],[sy,sx],order=1,mode='nearest'))
    tex=np.stack(channels,axis=-1)
    # fade pole/seam artifacts with gentle latitude-appropriate color extension
    tex=np.clip(tex,0,255).astype(np.uint8)
    Image.fromarray(tex).save(os.path.join(out, f'2k_{name}.jpg'),quality=94,subsampling=0,optimize=True)
# Procedural high-detail solar photosphere map (equirectangular)
rng=np.random.default_rng(20261113)
y,x=np.mgrid[0:H,0:W]
noise=np.zeros((H,W),np.float32)
for scale,amp in [(4,7),(11,10),(29,8),(75,5),(180,3),(420,2)]:
    gh=max(2,H//scale); gw=max(2,W//scale)
    small=rng.normal(0,1,(gh,gw)).astype(np.float32)
    layer=Image.fromarray(np.uint8(np.clip((small+3)*42,0,255))).resize((W,H),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(scale*.12))
    noise += (np.asarray(layer).astype(np.float32)-126)/42*amp
# bright orange-yellow granulation with subtle darker sunspot patches
base=np.zeros((H,W,3),np.float32)
gran=np.sin(x*.025 + np.sin(y*.04))*2 + np.cos(y*.035+x*.009)*2 + noise
base[:,:,0]=255+gran*1.4
base[:,:,1]=155+gran*1.05
base[:,:,2]=48+gran*.55
for cx,cy,rad in [(620,360,48),(1370,620,34),(980,170,23),(320,720,18)]:
    d=np.sqrt((x-cx)**2+(y-cy)**2)
    spot=np.exp(-((d/rad)**2)*3)
    base[:,:,0]-=spot*32; base[:,:,1]-=spot*28; base[:,:,2]-=spot*18
base=np.clip(base,0,255).astype(np.uint8)
Image.fromarray(base).save(os.path.join(out,'2k_sun.jpg'),quality=95,subsampling=0,optimize=True)
print('created',os.listdir(out))
