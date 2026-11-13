from PIL import Image, ImageFilter
import numpy as np, os
out='/mnt/data/eartify_all_planets/public/assets/planet-textures'; os.makedirs(out,exist_ok=True)
W,H=2048,1024; rng=np.random.default_rng(91724)
y,x=np.mgrid[0:H,0:W]; u=x/W; v=y/H; lat=np.abs(v-.5)*2
# smooth multiscale noise
noise=np.zeros((H,W),np.float32)
for scale,amp in [(5,1.0),(13,.7),(31,.45),(73,.28),(165,.16),(360,.09)]:
 gh=max(2,H//scale); gw=max(2,W//scale)
 a=rng.normal(0,1,(gh,gw)).astype(np.float32)
 im=Image.fromarray(np.uint8(np.clip((a+3)*42.5,0,255))).resize((W,H),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(scale*.08))
 noise+=(np.asarray(im).astype(np.float32)-127.5)/42.5*amp

def save(name,rgb):
 rgb=np.clip(rgb,0,255).astype(np.uint8); Image.fromarray(rgb).save(os.path.join(out,name),quality=95,subsampling=0,optimize=True)
# Mercury: ash-gray, dense overlapping impact craters and ejecta rays
n=noise*8 + np.sin(u*211+np.sin(v*93))*3
base=np.zeros((H,W,3),np.float32)
base[:,:,:]=[119,117,111]
base+=n[:,:,None]*np.array([1,.98,.94])[None,None,:]
for i in range(125):
 cx=rng.random(); cy=.08+rng.random()*.84; r=.004+rng.random()*.022
 dx=np.minimum(np.abs(u-cx),1-np.abs(u-cx)); dy=(v-cy)*.82; d=np.sqrt(dx*dx+dy*dy)
 rim=np.exp(-((d-r)/(.0015+r*.08))**2); floor=np.exp(-(d/(r*.72))**4)
 rays=np.exp(-((d-r*1.65)/(r*.12))**2)*np.maximum(0,np.cos(np.arctan2(dy,dx)*7+i))
 base+=rim[:,:,None]*np.array([34,33,30])-floor[:,:,None]*np.array([29,28,26])+rays[:,:,None]*np.array([9,9,8])
save('2k_mercury.jpg',base)
# Venus: dense golden sulfuric cloud decks with swirling atmospheric bands
flow=np.sin(v*95 + np.sin(u*17)*3 + np.sin(u*41+v*12)*1.5)+.42*np.sin(v*177+u*21)+noise*.55
venus=np.zeros((H,W,3),np.float32); q=flow*13
venus[:,:,0]=207+q*1.0; venus[:,:,1]=171+q*.9; venus[:,:,2]=112+q*.72
swirl=np.sin(u*23+np.sin(v*38+u*8)*2)*np.cos(v*52-u*11)
venus+=swirl[:,:,None]*np.array([8,7,5])[None,None,:]
save('2k_venus_surface.jpg',venus); save('2k_venus.jpg',venus)
# Mars: rusty deserts, dark basaltic provinces, crater fields and polar frost
mars=np.zeros((H,W,3),np.float32); m=noise*12 + np.sin(u*38+np.sin(v*21)*2)*5
mars[:,:,0]=157+m*1.15; mars[:,:,1]=75+m*.68; mars[:,:,2]=48+m*.48
regions=np.sin(u*19+np.sin(v*14)*2)*np.cos(v*31+u*8)
dark=np.clip((regions-.35)*35,0,24)
mars[:,:,0]-=dark; mars[:,:,1]-=dark*.75; mars[:,:,2]-=dark*.5
caps=np.clip((lat-.91)*250,0,1); mars=mars*(1-caps[:,:,None]*.82)+np.array([218,211,195])[None,None,:]*(caps[:,:,None]*.82)
for i in range(70):
 cx=rng.random(); cy=.12+rng.random()*.76; r=.003+rng.random()*.014
 dx=np.minimum(np.abs(u-cx),1-np.abs(u-cx)); dy=v-cy; d=np.sqrt(dx*dx+dy*dy)
 mars+=np.exp(-((d-r)/.0015)**2)[:,:,None]*np.array([24,17,12])-np.exp(-(d/(r*.7))**4)[:,:,None]*np.array([24,15,10])
save('2k_mars.jpg',mars)
# Jupiter: complex cream/rust zonal bands, turbulent vortices and Great Red Spot
j=np.zeros((H,W,3),np.float32); latband=v*2-1
warp=latband + .012*np.sin(u*12+latband*15)+.006*np.sin(u*31-latband*27)+noise*.003
bands=np.sin(warp*92)+.43*np.sin(warp*181+.5)+.18*np.sin(warp*330)
val=bands*13+noise*5
j[:,:,0]=190+val*1.15; j[:,:,1]=151+val*.92; j[:,:,2]=112+val*.72
# dark and pale belts
for center,width,col in [(.27,.025,(112,75,53)),(.39,.018,(224,205,170)),(.53,.027,(133,88,61)),(.68,.02,(229,210,174)),(.79,.018,(150,101,70))]:
 band=np.exp(-((v-center)/width)**2); j=j*(1-band[:,:,None]*.45)+np.array(col)[None,None,:]*(band[:,:,None]*.45)
# Great Red Spot
cx,cy=.72,.57; dx=np.minimum(np.abs(u-cx),1-np.abs(u-cx)); d=np.sqrt((dx/.045)**2+((v-cy)/.022)**2); spot=np.exp(-d*d*2)
j=j*(1-spot[:,:,None]*.7)+np.array([180,91,58])[None,None,:]*(spot[:,:,None]*.7)
save('2k_jupiter.jpg',j)
# Saturn: softer golden bands with fine atmospheric haze
s=np.zeros((H,W,3),np.float32); warp= v + .007*np.sin(u*14+v*19)+noise*.002
bands=np.sin(warp*116)+.3*np.sin(warp*240+u*4)
val=bands*9+noise*4
s[:,:,0]=202+val*1.1; s[:,:,1]=181+val*.95; s[:,:,2]=139+val*.78
for center,width,col in [(.32,.025,(165,135,101)),(.48,.018,(232,217,184)),(.65,.03,(177,148,111))]:
 band=np.exp(-((v-center)/width)**2); s=s*(1-band[:,:,None]*.35)+np.array(col)[None,None,:]*(band[:,:,None]*.35)
save('2k_saturn.jpg',s)
# Uranus: icy cyan methane atmosphere, faint cloud streaks
ucloud=np.sin(v*70+np.sin(u*8)*2)+.35*np.sin(v*145+u*11)+noise*.45
ur=np.zeros((H,W,3),np.float32); ur[:,:,0]=100+ucloud*5; ur[:,:,1]=185+ucloud*7; ur[:,:,2]=199+ucloud*8
ur+=np.sin(v*24+u*2)[:,:,None]*np.array([3,5,6])[None,None,:]
save('2k_uranus.jpg',ur)
# Neptune: saturated ultramarine, fast cloud bands, dark vortices and bright streaks
nc=np.sin(v*92+np.sin(u*19)*2.2+noise*.8)+.35*np.sin(v*177+u*7)
ne=np.zeros((H,W,3),np.float32); ne[:,:,0]=28+nc*5; ne[:,:,1]=65+nc*10; ne[:,:,2]=158+nc*17
storm=np.exp(-(((u-.66)/.055)**2+((v-.43)/.028)**2)*2); ne=ne*(1-storm[:,:,None]*.55)+np.array([100,157,207])[None,None,:]*(storm[:,:,None]*.55)
save('2k_neptune.jpg',ne)
# Sun: granular photosphere, mottled convection, subtle sunspots
sn=noise*8 + np.sin(x*.025+np.sin(y*.04))*2 + np.cos(y*.035+x*.009)*2
sun=np.zeros((H,W,3),np.float32); sun[:,:,0]=255+sn*1.3; sun[:,:,1]=159+sn*1.05; sun[:,:,2]=51+sn*.62
for cx,cy,rad in [(620,360,48),(1370,620,34),(980,170,23),(320,720,18)]:
 d=np.sqrt((x-cx)**2+(y-cy)**2); spot=np.exp(-((d/rad)**2)*3); sun[:,:,0]-=spot*32; sun[:,:,1]-=spot*28; sun[:,:,2]-=spot*18
save('2k_sun.jpg',sun)
print('Generated realistic local maps:', sorted(os.listdir(out)))
