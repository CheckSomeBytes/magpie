const { deflateSync } = require('zlib');
const fs = require('fs');
const { zipSync, strToU8 } = require(process.argv[2]);
const out = process.argv[3];
const W = 1600, H = 1000;
const crcT = Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
const raw = Buffer.alloc((W*3+1)*H);
for (let y=0;y<H;y++){ raw[y*(W*3+1)]=0; for(let x=0;x<W;x++){ const i=y*(W*3+1)+1+x*3;
  let r=240,g=242,b=245;
  if (y<56){r=36;g=40;b=48;}                       // title bar
  else if (x<260){r=226;g=230;b=236;}              // sidebar
  if (x>320&&x<1500&&y>120&&y<180){r=255;g=255;b=255;} // search box
  if (((x>>4)+(y>>4))%2===0 && x>340&&x<900&&y>260&&y<620){r=76;g=141;b=255;} // checker "image"
  if (x>960&&x<1480&&y>260&&y<300){r=48;g=164;b=108;} // green bar
  if (x>960&&x<1300&&y>330&&y<350){r=120;g=120;b=130;} // text line
  if (x>960&&x<1400&&y>370&&y<390){r=120;g=120;b=130;}
  raw[i]=r;raw[i+1]=g;raw[i+2]=b; } }
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const now=new Date().toISOString();
const manifest={format:'magpie',version:1,app:{name:'Magpie',version:'0.1.0'},created:now,modified:now,os:{platform:'linux',release:'test'},image:{widthPx:W,heightPx:H},source:'import',displays:[],thumb:null};
const st=(stroke,w)=>({stroke,strokeWidth:w});
const doc={version:1,crop:null,annotations:[
 {id:'a1',type:'arrow',x:300,y:800,rotation:0,style:st('#e5484d',6),data:{points:[0,0,300,-250]}},
 {id:'r1',type:'rect',x:950,y:250,rotation:0,style:st('#e5484d',4),data:{width:540,height:60}},
 {id:'s1',type:'step',x:940,y:240,rotation:0,style:{stroke:'#fff',fill:'#e5484d',strokeWidth:2},data:{number:1,radius:18}},
 {id:'s2',type:'step',x:330,y:110,rotation:0,style:{stroke:'#fff',fill:'#e5484d',strokeWidth:2},data:{number:2,radius:18}},
 {id:'b1',type:'blur',x:950,y:320,rotation:0,style:st('#000',0),data:{width:470,height:80,mode:'pixelate',amount:12}},
 {id:'t1',type:'text',x:640,y:700,rotation:0,style:{stroke:'#e5484d',strokeWidth:0,fontSize:32},data:{text:'Hello from Magpie',width:400}},
 {id:'h1',type:'highlighter',x:330,y:150,rotation:0,style:{stroke:'#ffe14d',strokeWidth:22,opacity:0.45},data:{points:[0,0,400,0]}},
 {id:'e1',type:'ellipse',x:620,y:440,rotation:0,style:st('#0090ff',4),data:{radiusX:300,radiusY:200}},
]};
fs.writeFileSync(out, zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'original.png':[png,{level:0}],'annotations.json':strToU8(JSON.stringify(doc))}));
console.log('wrote', out, png.length, 'bytes png');
