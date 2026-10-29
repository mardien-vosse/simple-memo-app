const { Machine } = require('../src/physics.js');
function run(opts, seed, T=40){
  const M = new Machine(Object.assign({ seed }, opts));
  M.settle(3); M.setBlower(1);
  const dt=1/600, N=45;
  const bins=new Float64Array(6); let nb=0;           // 높이 6구간 (아래→위)
  let ceil=0, floor_=0, spS=0, vmax=0, wallFrac=0;
  const snaps=[]; // 1/10초 샘플 x,y
  for(let s=0;s<T*600;s++){
    M.step(dt);
    if(s%60===0 && s*dt>=6){
      const xs=new Float64Array(N), ys=new Float64Array(N);
      for(const b of M.active){ xs[b.id-1]=b.x; ys[b.id-1]=b.y;
        const h=(b.y/M.R+1)/2; bins[Math.min(5,Math.max(0,Math.floor(h*6)))]++; nb++;
        if(b.y>0.6*M.R) ceil++; if(b.y<-0.6*M.R) floor_++;
        const v=Math.hypot(b.vx,b.vy,b.vz); spS+=v; vmax=Math.max(vmax,v);
        if(Math.hypot(b.x,b.y)>M.R-1.15*M.r) wallFrac++;
      }
      snaps.push([xs,ys]);
    }
  }
  const corr=(a,b)=>{ let ma=0,mb=0; for(let i=0;i<N;i++){ma+=a[i];mb+=b[i];} ma/=N;mb/=N; let c=0,va=0,vb=0; for(let i=0;i<N;i++){c+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;} return c/Math.sqrt(va*vb); };
  const lagCorr=(lagSec,k)=>{ const lag=lagSec*10; let s=0,n=0; for(let i=0;i+lag<snaps.length;i+=3){ s+=corr(snaps[i][k],snaps[i+lag][k]); n++; } return s/n; };
  return { bins:[...bins].map(x=>(x/nb).toFixed(2)).join(' '), ceil:ceil/nb, floor:floor_/nb, wall:wallFrac/nb, speed:spS/nb, vmax,
    cx1:lagCorr(1,0), cx3:lagCorr(3,0), cy1:lagCorr(1,1), cy3:lagCorr(3,1) };
}
const grid=JSON.parse(process.argv[2]);
for(const c of grid){
  const r=run(c,11);
  console.log(JSON.stringify(c).padEnd(52), 'bins[low→high]', r.bins, '| ceil',r.ceil.toFixed(2),'floor',r.floor.toFixed(2),'wall',r.wall.toFixed(2),'v',r.speed.toFixed(2),'vmax',r.vmax.toFixed(1),'| corr x:',r.cx1.toFixed(2),r.cx3.toFixed(2),'y:',r.cy1.toFixed(2),r.cy3.toFixed(2));
}
