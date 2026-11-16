import {jsPDF} from 'jspdf';
import L from 'leaflet';
import area from '@turf/area';
import {REQUIRED,OPTIONAL,missing,prettyDate,shortId,cleanFile} from './model.js';

const TILE='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function croquis(visit){
 const container=document.createElement('div');Object.assign(container.style,{position:'fixed',left:'-10000px',top:'0',width:'900px',height:'500px',zIndex:'-1'});document.body.appendChild(container);
 let map;
 try{
  map=L.map(container,{zoomControl:false,attributionControl:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false});
  const tiles=L.tileLayer(TILE,{crossOrigin:'anonymous',maxZoom:19});tiles.addTo(map);
  const bounds=L.latLngBounds([]);for(const p of visit.parcels){try{bounds.extend(L.geoJSON(p.geometry).getBounds());}catch{}}
  for(const photo of visit.photos)if(photo.inReport!==false&&Number.isFinite(photo.lat)&&Number.isFinite(photo.lng))bounds.extend([photo.lat,photo.lng]);
  if(bounds.isValid())map.fitBounds(bounds.pad(.20),{maxZoom:17,animate:false});else map.setView([23.6,-102.5],5);
  map.invalidateSize(false);await sleep(350);
  const deadline=Date.now()+7000;while(tiles.isLoading()&&Date.now()<deadline)await sleep(150);
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=500;const ctx=canvas.getContext('2d');ctx.fillStyle='#d9e2d5';ctx.fillRect(0,0,900,500);
  const rect=container.getBoundingClientRect();let drawn=0;
  for(const img of container.querySelectorAll('.leaflet-tile-loaded')){if(img.complete&&img.naturalWidth){const r=img.getBoundingClientRect();try{ctx.drawImage(img,r.left-rect.left,r.top-rect.top,r.width,r.height);drawn++;}catch{}}}
  // Verify that the tile server allows capture before drawing vector overlays.
  if(drawn){try{canvas.toDataURL('image/jpeg');}catch{ctx.fillStyle='#e5ece3';ctx.fillRect(0,0,900,500);drawn=0;}}
  for(const p of visit.parcels){const poly=p.geometry.type==='Polygon'?[p.geometry.coordinates]:p.geometry.coordinates;ctx.beginPath();for(const group of poly)for(const ring of group){ring.forEach((xy,i)=>{const pt=map.latLngToContainerPoint([xy[1],xy[0]]);i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y);});ctx.closePath();}ctx.fillStyle='rgba(66,186,113,.23)';ctx.fill('evenodd');ctx.strokeStyle='#6dff9a';ctx.lineWidth=4;ctx.stroke();}
  visit.photos.forEach((p,i)=>{if(p.inReport===false||!Number.isFinite(p.lat)||!Number.isFinite(p.lng))return;const pt=map.latLngToContainerPoint([p.lat,p.lng]);ctx.beginPath();ctx.arc(pt.x,pt.y,13,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#145a3c';ctx.stroke();ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillStyle='#145a3c';ctx.fillText(String(i+1),pt.x,pt.y+5);});
  ctx.fillStyle='rgba(255,255,255,.90)';ctx.fillRect(830,12,55,60);ctx.fillStyle='#173f2d';ctx.font='bold 21px sans-serif';ctx.textAlign='center';ctx.fillText('N',857,35);ctx.beginPath();ctx.moveTo(857,42);ctx.lineTo(847,62);ctx.lineTo(857,56);ctx.lineTo(867,62);ctx.closePath();ctx.fill();
  const p1=map.containerPointToLatLng([30,465]),p2=map.containerPointToLatLng([150,465]),meters=map.distance(p1,p2);const power=Math.pow(10,Math.floor(Math.log10(meters||1)));const nice=[1,2,5,10].map(x=>x*power).filter(x=>x<=meters).at(-1)||power;const width=120*nice/meters;
  ctx.fillStyle='rgba(255,255,255,.93)';ctx.fillRect(15,434,190,52);ctx.fillStyle='#263d2d';ctx.textAlign='left';ctx.font='13px sans-serif';ctx.fillText(nice>=1000?`${(nice/1000).toFixed(nice>=10000?0:1)} km`:`${Math.round(nice)} m`,30,452);ctx.fillRect(30,459,width,4);ctx.fillRect(30,456,2,10);ctx.fillRect(30+width-2,456,2,10);
  ctx.font='10px sans-serif';ctx.textAlign='right';ctx.fillStyle='#fff';ctx.fillText(drawn?'Imagen: Esri, Maxar, Earthstar Geographics y comunidad GIS':'Croquis esquemático · imagen satelital no disponible',890,493);
  return {data:canvas.toDataURL('image/jpeg',.88),satellite:drawn>0,hasGeometry:bounds.isValid()};
 }finally{if(map)map.remove();container.remove();}
}
export async function createReport(visit){
 const pdf=new jsPDF({unit:'mm',format:'letter',compress:true});const pageW=pdf.internal.pageSize.getWidth(),pageH=pdf.internal.pageSize.getHeight(),left=17,right=pageW-17,width=right-left;let y=18,page=1;
 const green=[29,84,58], dark=[33,51,40], muted=[109,125,113];
 function text(t,x,yy,opts={}){pdf.text(String(t),x,yy,opts);}
 function header(){pdf.setFillColor(...green);pdf.roundedRect(left,y,11,11,2,2,'F');pdf.setTextColor(255);pdf.setFont('helvetica','bold');pdf.setFontSize(14);text('G',left+3.3,y+7.8);pdf.setTextColor(...green);pdf.setFontSize(16);text('GeoFoto',left+15,y+5.5);pdf.setFont('helvetica','normal');pdf.setTextColor(...muted);pdf.setFontSize(8);text('SUPERVISIÓN EN CAMPO',left+15,y+10);pdf.setDrawColor(225,232,224);pdf.line(left,y+15,right,y+15);y+=22;}
 function foot(){pdf.setFont('helvetica','normal');pdf.setTextColor(...muted);pdf.setFontSize(7);text('GeoFoto  ·  Datos capturados en campo',left,pageH-10);text(String(page),right,pageH-10,{align:'right'});}
 function next(){foot();pdf.addPage();page++;y=16;}
 function need(h){if(y+h>pageH-17)next();}
 function title(t){need(17);y+=4;pdf.setFont('helvetica','bold');pdf.setFontSize(12);pdf.setTextColor(...green);text(t,left,y);y+=7;}
 function paragraph(label,value){const body=value===undefined||value===null||String(value).trim()===''?'Sin capturar':String(value);pdf.setFont('helvetica','normal');pdf.setFontSize(9);const lines=pdf.splitTextToSize(body,width-4);need(8);pdf.setTextColor(...muted);pdf.setFont('helvetica','bold');text(label.toUpperCase(),left,y);y+=5;pdf.setTextColor(...dark);pdf.setFont('helvetica','normal');for(const line of lines){need(5);text(line,left,y);y+=4.8;}y+=3;}
 header();pdf.setFont('helvetica','bold');pdf.setFontSize(18);pdf.setTextColor(...dark);text('Reporte de supervisión',left,y);y+=7;pdf.setTextColor(...muted);pdf.setFont('helvetica','normal');pdf.setFontSize(9);text(`Visita ${shortId(visit.id)}  ·  ${prettyDate(visit.data.fecha)}`,left,y);y+=8;
 const absent=missing(visit);if(absent.length){pdf.setFillColor(255,246,230);pdf.roundedRect(left,y,width,11,2,2,'F');pdf.setTextColor(146,95,30);pdf.setFontSize(8);pdf.setFont('helvetica','bold');text(`BORRADOR · ${absent.length} dato(s) obligatorio(s) sin capturar`,left+4,y+7);y+=16;}else{pdf.setFillColor(235,246,235);pdf.roundedRect(left,y,width,10,2,2,'F');pdf.setTextColor(...green);pdf.setFontSize(8);text('Campos obligatorios capturados',left+4,y+6.5);y+=15;}
 title('1. Datos del crédito y de la visita');for(const key of ['acreditado','tipoCredito','monto','fecha','ubicacion','intermediario','numeroCredito']){const found=[...REQUIRED,...OPTIONAL].find(([k])=>k===key);if(!found)continue;let val=visit.data[key];if(key==='monto'&&val!==undefined&&val!=='')val='$'+Number(val).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})+' MXN';if(key==='fecha'&&val)val=prettyDate(val);if(REQUIRED.some(([k])=>k===key)||val)paragraph(found[1],val);}
 title('2. Inversión y actividad');for(const key of ['plan','realizada','estadoInversion','cultivo','etapa','seguro','rendimiento','beneficioCosto']){let f=[...REQUIRED,...OPTIONAL].find(([k])=>k===key);if(f&&(REQUIRED.some(([k])=>k===key)||visit.data[key]))paragraph(f[1],visit.data[key]);}
 title('3. Situación de la empresa');for(const key of ['operacion','riesgos','irregularidades','impacto','responsable','observaciones']){const f=REQUIRED.find(([k])=>k===key);paragraph(f[1],visit.data[key]);}
 title('4. Parcelas y croquis');if(visit.parcels.length){visit.parcels.forEach((p,i)=>paragraph(`Parcela ${i+1}`,`${p.name || 'Sin nombre'} · ${(area({type:'Feature',geometry:p.geometry,properties:{}})/10000).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})} ha (superficie esférica aproximada)`));}else paragraph('Parcelas','Sin polígonos capturados');
 const map=await croquis(visit);need(117);pdf.addImage(map.data,'JPEG',left,y,width,102);y+=106;pdf.setFontSize(8);pdf.setFont('helvetica','normal');pdf.setTextColor(...muted);text(map.hasGeometry?`Borde verde: parcelas · números: fotografías seleccionadas. ${map.satellite?'':'Imagen satelital no disponible.'}`:'Sin geometrías ni fotografías ubicadas.',left,y);y+=7;
 const selected=visit.photos.map((p,i)=>({...p,number:i+1})).filter(p=>p.inReport!==false);need(selected.length?110:24);title('5. Evidencia fotográfica');if(!selected.length)paragraph('Fotografías','No se seleccionaron fotografías para el reporte.');
 for(const p of selected){need(90);pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.setTextColor(...green);text(`Fotografía ${p.number}`,left,y);y+=5;try{const props=pdf.getImageProperties(p.image);const ratio=Math.min(width/props.width,75/props.height);const w=props.width*ratio,h=props.height*ratio;pdf.addImage(p.image,props.fileType==='PNG'?'PNG':'JPEG',left,y,w,h,undefined,'FAST');y+=h+5;}catch{paragraph('Imagen','No se pudo incorporar la imagen.');}paragraph('Descripción',p.description||'Sin descripción');paragraph('Fecha de captura',p.capturedAt?prettyDate(p.capturedAt):'No disponible');const loc=Number.isFinite(p.lat)&&Number.isFinite(p.lng)?`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ${p.locationSource||'origen no identificado'}${Number.isFinite(p.accuracy)?` · precisión reportada ±${Math.round(p.accuracy)} m`:''}${p.locationTime?` · ubicación: ${prettyDate(p.locationTime)}`:''}`:'Sin ubicación';paragraph('Ubicación',loc);}
 foot();pdf.save(`GeoFoto_${cleanFile(visit.data.acreditado)}_${visit.data.fecha||'sin_fecha'}.pdf`);
}
