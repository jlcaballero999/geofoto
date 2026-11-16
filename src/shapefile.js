import JSZip from 'jszip';
import area from '@turf/area';

const WGS84='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';
const encoder=new TextEncoder();
const nval=(x)=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
function boundsOf(points){let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(const p of points){xmin=Math.min(xmin,p[0]);ymin=Math.min(ymin,p[1]);xmax=Math.max(xmax,p[0]);ymax=Math.max(ymax,p[1]);}return [xmin,ymin,xmax,ymax];}
function shapefile(type,records){
 let all=[];
 for(const rec of records){
  if(type===1) all.push(rec.geometry.coordinates.slice(0,2));
  else for(const ring of ringsFor(rec.geometry)) for(const p of ring)all.push(p);
 }
 let bbox=all.length?boundsOf(all):[0,0,0,0];
 const contents=records.map(rec=>{
  if(type===1){const b=new ArrayBuffer(20),v=new DataView(b);v.setInt32(0,1,true);v.setFloat64(4,rec.geometry.coordinates[0],true);v.setFloat64(12,rec.geometry.coordinates[1],true);return new Uint8Array(b);}
  const rings=ringsFor(rec.geometry);const points=rings.flat();const b=new ArrayBuffer(44+4*rings.length+16*points.length),v=new DataView(b);v.setInt32(0,5,true);
  boundsOf(points).forEach((x,i)=>v.setFloat64(4+i*8,x,true));
  v.setInt32(36,rings.length,true);v.setInt32(40,points.length,true);let offset=0;rings.forEach((ring,i)=>{v.setInt32(44+i*4,offset,true);offset+=ring.length;});let pos=44+rings.length*4;for(const [x,y] of points){v.setFloat64(pos,x,true);v.setFloat64(pos+8,y,true);pos+=16;}return new Uint8Array(b);
 });
 const shpLength=100+contents.reduce((s,c)=>s+8+c.length,0),shxLength=100+contents.length*8;
 const shp=new Uint8Array(shpLength),shx=new Uint8Array(shxLength);
 function header(arr,length){const v=new DataView(arr.buffer);v.setInt32(0,9994,false);v.setInt32(24,length/2,false);v.setInt32(28,1000,true);v.setInt32(32,type,true);bbox.forEach((x,i)=>v.setFloat64(36+i*8,x,true));}
 header(shp,shpLength);header(shx,shxLength);let pos=100;
 contents.forEach((c,i)=>{const dv=new DataView(shp.buffer);dv.setInt32(pos,i+1,false);dv.setInt32(pos+4,c.length/2,false);shp.set(c,pos+8);const ix=new DataView(shx.buffer);ix.setInt32(100+i*8,pos/2,false);ix.setInt32(104+i*8,c.length/2,false);pos+=8+c.length;});
 return {shp,shx};
}
function ringsFor(g){
 const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
 return polys.flatMap(poly=>poly.map((original,i)=>{
  let r=original.map(p=>[Number(p[0]),Number(p[1])]);if(r.length && (r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1]))r=[...r,r[0]];
  let signed=0;for(let k=0;k<r.length-1;k++)signed+=r[k][0]*r[k+1][1]-r[k+1][0]*r[k][1];
  // Shapefile: outer ring clockwise, holes counterclockwise.
  if((i===0&&signed>0)||(i>0&&signed<0))r=r.slice().reverse();return r;
 }));
}
function dbf(fields,records){
 const headerLen=32+fields.length*32+1,recordLen=1+fields.reduce((s,f)=>s+f.len,0);
 const arr=new Uint8Array(headerLen+recordLen*records.length+1),v=new DataView(arr.buffer),now=new Date();
 v.setUint8(0,3);v.setUint8(1,now.getFullYear()-1900);v.setUint8(2,now.getMonth()+1);v.setUint8(3,now.getDate());v.setUint32(4,records.length,true);v.setUint16(8,headerLen,true);v.setUint16(10,recordLen,true);
 fields.forEach((f,i)=>{let o=32+i*32;arr.set(encoder.encode(f.name).slice(0,10),o);arr[o+11]=f.type.charCodeAt(0);arr[o+16]=f.len;arr[o+17]=f.dec||0;});arr[headerLen-1]=13;
 records.forEach((record,i)=>{let p=headerLen+i*recordLen;arr[p++]=32;for(const f of fields){let bytes;if(f.type==='N'){const num=nval(record[f.name]);const str=num===null?'':num.toFixed(f.dec||0);bytes=encoder.encode(str.padStart(f.len,' '));if(bytes.length>f.len)bytes=encoder.encode('*'.repeat(f.len));}else{const value=String(record[f.name]??'');let safe='';for(const ch of value){if(encoder.encode(safe+ch).length>f.len)break;safe+=ch;}bytes=encoder.encode(safe);}
  arr.fill(32,p,p+f.len);arr.set(bytes.slice(0,f.len),p);p+=f.len;}});arr[arr.length-1]=26;return arr;
}
function addLayer(zip,name,type,features,fields){const files=shapefile(type,features);zip.file(name+'.shp',files.shp);zip.file(name+'.shx',files.shx);zip.file(name+'.dbf',dbf(fields,features.map(f=>f.properties)));zip.file(name+'.prj',WGS84);zip.file(name+'.cpg','UTF-8');}
const C=(name,len)=>({name,len,type:'C'}),N=(name,len,dec=0)=>({name,len,type:'N',dec});
export async function polygonZip(visit){
 const p=visit.parcels.map((parcel,i)=>({geometry:parcel.geometry,properties:{VISITA:visit.id,PARC_ID:parcel.id,NOMBRE:parcel.name||`Parcela ${i+1}`,ACREDIT:visit.data.acreditado||'',CREDITO:visit.data.numeroCredito||'',FECHA:visit.data.fecha||'',SUP_HA:area({type:'Feature',properties:{},geometry:parcel.geometry})/10000}}));
 const zip=new JSZip();addLayer(zip,'parcelas',5,p,[C('VISITA',36),C('PARC_ID',36),C('NOMBRE',80),C('ACREDIT',80),C('CREDITO',30),C('FECHA',10),N('SUP_HA',18,2)]);return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
export async function photoZip(visit){
 const f=visit.photos.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)).map(p=>{const num=visit.photos.indexOf(p)+1;const ext=p.image.startsWith('data:image/png')?'png':'jpg';const path=`imagenes/foto_${String(num).padStart(3,'0')}_${p.id.slice(0,8)}.${ext}`;return {geometry:{type:'Point',coordinates:[p.lng,p.lat]},image:p.image,properties:{VISITA:visit.id,FOTO_ID:p.id,NUMERO:num,ARCHIVO:path,FECHA:p.capturedAt||'',GPS_HORA:p.locationTime||'',LAT:p.lat,LON:p.lng,PREC_M:p.accuracy,FUENTE:p.locationSource||'',PARC_ID:p.parcelId||'',DESCRIP:p.description||''}};});
 const zip=new JSZip();addLayer(zip,'fotos',1,f,[C('VISITA',36),C('FOTO_ID',36),N('NUMERO',6),C('ARCHIVO',100),C('FECHA',25),C('GPS_HORA',25),N('LAT',19,8),N('LON',20,8),N('PREC_M',12,2),C('FUENTE',15),C('PARC_ID',36),C('DESCRIP',120)]);
 for(const photo of f){const base64=photo.image.split(',')[1];if(base64)zip.file(photo.properties.ARCHIVO,base64,{base64:true});}
 return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
