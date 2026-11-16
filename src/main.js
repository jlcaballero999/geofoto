import './style.css';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import L from 'leaflet';
import * as exifr from 'exifr';
import shp from 'shpjs';
import {kml} from '@tmcw/togeojson';
import JSZip from 'jszip';
import area from '@turf/area';
import kinks from '@turf/kinks';
import booleanValid from '@turf/boolean-valid';
import {getVisits,putVisit,deleteVisit,uid} from './storage.js';
import {REQUIRED,OPTIONAL,missing,newVisit,prettyDate,shortId,cleanFile} from './model.js';
import {polygonZip,photoZip,downloadBlob} from './shapefile.js';
import {createReport} from './report.js';
window.L=L;
const $=s=>document.querySelector(s);const view=$('#view');const crumb=$('#crumb');
const h=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ic=(name)=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const escAttr=h;
let visits=[],currentId=null,currentView='visits',map=null,drawn=null,photoMarkers=null,photoToLocate=null,cameraStream=null,installPrompt=null;
const photoMarkerById=new Map();
let saveQueue=Promise.resolve();
const current=()=>visits.find(v=>v.id===currentId);
const geoArea=g=>area({type:'Feature',properties:{},geometry:g})/10000;
const fmtArea=g=>geoArea(g).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
function toast(message,error=false){const el=document.createElement('div');el.className='toast'+(error?' error':'');el.textContent=message;$('#toast-root').appendChild(el);setTimeout(()=>el.remove(),5200);}
function setSaveStatus(text,error=false){const el=$('#save-status');el.innerHTML=`<span></span> ${h(text)}`;el.classList.toggle('error',error);}
function persist(v=current()){
 if(!v)return Promise.resolve();v.updatedAt=new Date().toISOString();const snap=structuredClone(v);setSaveStatus('Guardando…');
 saveQueue=saveQueue.catch(()=>{}).then(()=>putVisit(snap)).then(()=>setSaveStatus('Guardado local')).catch(e=>{setSaveStatus('Error al guardar',true);toast('No se pudo guardar en el dispositivo. Revisa el espacio disponible.',true);console.error(e);throw e;});
 return saveQueue;
}
function panelTitle(n,title,subtitle){return `<div class="panel-title"><span class="panel-number">${n}</span><div><h2>${title}</h2><p>${subtitle}</p></div></div>`;}
function pageHead(eyebrow,title,desc,action=''){return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;}
function field(key,label,{placeholder='',type='text',wide=false,optional=false,textarea=false}={}){const value=current()?.data[key]??'';return `<div class="field ${wide?'full':''}"><label for="f-${key}">${label}${optional?' <span style="font-weight:400;color:#a0afa3">· opcional</span>':' <span class="required">*</span>'}</label>${textarea?`<textarea id="f-${key}" data-field="${key}" placeholder="${escAttr(placeholder)}">${h(value)}</textarea>`:`<input id="f-${key}" data-field="${key}" type="${type}" ${type==='number'?'min="0" step="0.01" inputmode="decimal"':''} value="${escAttr(value)}" placeholder="${escAttr(placeholder)}">`}</div>`;}
function updateProgress(){const v=current();if(!v)return;const count=REQUIRED.length-missing(v).length,percent=Math.round(100*count/REQUIRED.length);document.querySelectorAll('[data-progress-count]').forEach(e=>e.textContent=`${count} de ${REQUIRED.length} campos completos`);document.querySelectorAll('[data-progress-percent]').forEach(e=>e.textContent=`${percent}%`);document.querySelectorAll('[data-progress-fill]').forEach(e=>e.style.width=percent+'%');const strip=$('#visit-strip');strip.innerHTML=`<strong>${h(v.data.acreditado||'Nueva visita')}</strong><span class="strip-sep">/</span>${h(prettyDate(v.data.fecha))}<span class="strip-sep">/</span>${v.parcels.length} parcela(s) · ${v.photos.length} foto(s)`;}
function setView(name){if(name!=='visits'&&name!=='backup'&&!current()){toast('Crea o selecciona una visita primero.');return;}if(name!=='map')photoToLocate=null;if(map){map.remove();map=null;drawn=null;photoMarkers=null;photoMarkerById.clear();}currentView=name;render();window.scrollTo({top:0,behavior:'instant'});}
function render(){
 document.querySelectorAll('.nav-item[data-view]').forEach(e=>{e.classList.toggle('active',e.dataset.view===currentView);if(e.classList.contains('needs-visit'))e.disabled=!current();});
 const names={visits:'Mis visitas',data:'Datos de visita',map:'Mapa y fotografías',report:'Revisión y reporte',backup:'Respaldo de datos'};crumb.textContent=names[currentView];$('#visit-strip').classList.toggle('hidden',!current()||['visits','backup'].includes(currentView));
 if(current()&&!['visits','backup'].includes(currentView))updateProgress();
 if(currentView==='visits')renderVisits();else if(currentView==='data')renderData();else if(currentView==='map')renderMap();else if(currentView==='report')renderReport();else renderBackup();
}
function renderVisits(){
 const cards=visits.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(v=>{const n=missing(v).length;return `<button class="visit-card" data-action="open-visit" data-id="${escAttr(v.id)}"><div class="card-top"><span class="pill ${n?'warn':'good'}">${n?'En captura':'Datos completos'}</span>${ic('chevron')}</div><h3>${h(v.data.acreditado||'Visita sin acreditado')}</h3><p>${h(v.data.ubicacion||'Ubicación pendiente')}</p><div class="visit-meta"><span>${h(prettyDate(v.data.fecha))}</span><span>${v.parcels.length} parcela(s)</span><span>${v.photos.length} foto(s)</span></div></button>`;}).join('');
 view.innerHTML=pageHead('TU ESPACIO DE CAMPO','Mis visitas','Consulta las visitas guardadas en este dispositivo.',`<button class="btn btn-primary" data-action="new-visit">${ic('plus')} Nueva visita</button>`)+`<div class="section-title"><h2>Visitas registradas</h2><span>${visits.length} en este dispositivo</span></div>${cards?`<div class="visits-grid">${cards}</div>`:`<div class="empty"><div class="empty-icon">${ic('file')}</div><h3>Aún no hay visitas registradas</h3><p>Comienza una nueva visita. Podrás guardar avances y completarlos cuando lo necesites.</p></div>`}<p class="footer-note">Los datos y fotografías se almacenan en este navegador. Crea respaldos periódicamente desde el menú lateral.</p><p class="footer-note"><strong>Instalar:</strong> en Android abre el menú de Chrome y elige «Instalar aplicación» o «Añadir a pantalla de inicio». En iPhone, abre en Safari, toca «Compartir» y elige «Agregar a pantalla de inicio».</p>`;
}
function renderData(){const v=current(),count=REQUIRED.length-missing(v).length,percent=Math.round(100*count/REQUIRED.length);
 view.innerHTML=pageHead('VISITA ACTUAL / 01','Datos de supervisión','Completa la información disponible. Puedes volver a editarla en cualquier momento.',`<button class="btn btn-outline btn-small" data-action="delete-visit">${ic('trash')} Eliminar visita</button>`)+`<div class="content-grid"><div class="form-stack">
 <section class="panel">${panelTitle('01','Crédito y ubicación','Identifica al acreditado y la visita.')}<div class="fields">
 ${field('acreditado','Acreditado',{placeholder:'Nombre completo o razón social'})}${field('tipoCredito','Tipo de crédito',{placeholder:'Ej. avío, refaccionario...'})}${field('monto','Monto del crédito · MXN',{type:'number',placeholder:'0.00'})}${field('fecha','Fecha de la visita',{type:'date'})}${field('ubicacion','Ubicación',{wide:true,placeholder:'Localidad, municipio y estado'})}${field('intermediario','Intermediario financiero',{optional:true,placeholder:'Nombre de la institución'})}${field('numeroCredito','Número de crédito',{optional:true,placeholder:'Identificador del crédito'})}</div></section>
 <section class="panel">${panelTitle('02','Datos de la inversión','Describe lo contratado, lo realizado y su estado.')}<div class="fields">
 ${field('plan','Plan de inversión contratado',{wide:true,textarea:true,placeholder:'Describe el plan de inversión...'})}${field('realizada','Inversión realizada',{wide:true,textarea:true,placeholder:'Describe las inversiones realizadas...'})}${field('estadoInversion','Estado de la inversión',{wide:true,textarea:true,placeholder:'Avance o situación actual de la inversión...'})}${field('cultivo','Cultivo o actividad',{optional:true})}${field('etapa','Etapa productiva',{optional:true})}${field('seguro','Seguro agrícola',{optional:true})}${field('rendimiento','Rendimiento estimado',{optional:true,placeholder:'Valor y unidad, por ejemplo t/ha'})}${field('beneficioCosto','Relación beneficio/costo',{optional:true,placeholder:'Ej. 1.25'})}</div></section>
 <section class="panel">${panelTitle('03','Situación y hallazgos','Describe la operación y las observaciones de la visita.')}<div class="fields">
 ${field('operacion','Situación operativa de la empresa',{wide:true,textarea:true,placeholder:'Indica si se encuentra en operación y describe su situación...'})}${field('riesgos','Riesgos para la capacidad de pago',{wide:true,textarea:true,placeholder:'Describe los riesgos o indica si no se identificaron...'})}${field('irregularidades','Irregularidades identificadas',{wide:true,textarea:true,placeholder:'Describe las irregularidades o indica que no se identificaron...'})}${field('impacto','Impacto de las irregularidades',{wide:true,textarea:true,placeholder:'Describe el impacto o indica que no aplica...'})}${field('responsable','Responsable de la visita y reporte',{wide:true,placeholder:'Nombre completo'})}${field('observaciones','Observaciones',{wide:true,textarea:true,placeholder:'Conclusiones y observaciones generales...'})}</div></section>
 <div class="inline-actions"><button class="btn btn-primary" data-view="map">Continuar a mapa y fotografías ${ic('arrow')}</button><span class="hint">Los cambios se guardan automáticamente.</span></div></div>
 <aside class="panel sticky-panel"><div class="progress-top"><h3>Avance de captura</h3><span class="progress-number" data-progress-percent>${percent}%</span></div><div class="progress-bar"><div class="progress-fill" data-progress-fill style="width:${percent}%"></div></div><div class="progress-text" data-progress-count>${count} de ${REQUIRED.length} campos completos</div><div class="side-help"><strong>Tu visita puede quedar en borrador.</strong><br>Los campos marcados con * son obligatorios; el reporte indicará los que faltan.</div><div class="side-help">Para campos que no apliquen, registra «No aplica» o «No se identificaron».</div></aside></div>`;
}
function renderMap(){
 const v=current();
 view.innerHTML=pageHead('','Mapa y fotografías','Dibuja las parcelas y registra la evidencia de la visita.')+`
 <div class="workspace-toolbar" aria-label="Herramientas de mapa y fotografía">
  <div class="toolbar-group">
   <button class="btn btn-outline" data-action="import-parcels">${ic('upload')} Importar polígono</button>
   <button class="btn btn-outline" data-action="locate">${ic('target')} Mi ubicación</button>
  </div>
  <div class="toolbar-group">
   <button class="btn btn-outline" data-action="upload-photos">${ic('photo')} Agregar fotos</button>
   <button class="btn btn-primary" data-action="camera">${ic('camera')} Tomar foto</button>
  </div>
  <input class="file-input" id="parcel-file" type="file" accept=".zip,.kml,.geojson,.json,application/zip,application/geo+json">
  <input class="file-input" id="photo-file" type="file" accept="image/*" multiple>
 </div>
 <div id="manual-banner" class="map-message ${photoToLocate?'':'hidden'}" role="status">Toca en el mapa el lugar donde se tomó la fotografía. <button class="btn btn-small btn-ghost" data-action="cancel-place">Cancelar</button></div>
 <div class="workspace-layout">
  <section class="workspace-map" aria-label="Mapa satelital de la visita">
   <div id="map" class="map-canvas" aria-label="Mapa de parcelas y fotografías"></div>
   <div class="map-tip">Usa los controles del mapa para dibujar, editar o eliminar parcelas. Los números indican fotografías. Imagen satelital: Esri.</div>
  </section>
  <aside class="workspace-sidebar" aria-label="Parcelas y evidencia de la visita">
   <section class="workspace-section" aria-labelledby="parcels-title">
    <div class="workspace-heading"><h2 id="parcels-title">Parcelas</h2><span id="parcel-count" class="item-count">${v.parcels.length}</span></div>
    <div id="parcel-list">${parcelList()}</div>
    <button class="btn btn-outline btn-small export-parcels" id="map-export-parcels" data-action="export-parcels" ${v.parcels.length?'':'disabled'}>${ic('download')} Descargar polígonos</button>
    <p class="workspace-hint">Importa SHP en ZIP con .prj, KML o GeoJSON. Superficie aproximada en hectáreas.</p>
   </section>
   <section class="workspace-section evidence-section" aria-labelledby="photos-title">
    <div class="workspace-heading"><h2 id="photos-title">Fotografías</h2><span id="photo-count" class="item-count">${v.photos.length}</span></div>
    <div id="photo-list">${photoCards()}</div>
    <p class="workspace-hint">Las coordenadas EXIF se conservan cuando están disponibles. También puedes ubicar cada foto manualmente.</p>
   </section>
  </aside>
 </div>
 <div class="workspace-footer"><button class="btn btn-primary" data-view="report">Revisar y generar reporte ${ic('arrow')}</button></div>`;
 requestAnimationFrame(initMap);
}
function parcelList(){const v=current();return v.parcels.length?v.parcels.map((p,i)=>`<div class="parcel-row"><div><strong>${h(p.name||`Parcela ${i+1}`)}</strong><small>${fmtArea(p.geometry)} ha</small></div><div class="inline-actions"><button data-action="zoom-parcel" data-id="${escAttr(p.id)}" title="Ver en el mapa" aria-label="Ver ${escAttr(p.name||`parcela ${i+1}`)} en el mapa">${ic('target')}</button><button data-action="rename-parcel" data-id="${escAttr(p.id)}" title="Cambiar nombre" aria-label="Cambiar nombre de ${escAttr(p.name||`parcela ${i+1}`)}">${ic('file')}</button><button data-action="delete-parcel" data-id="${escAttr(p.id)}" title="Eliminar parcela" aria-label="Eliminar ${escAttr(p.name||`parcela ${i+1}`)}">${ic('trash')}</button></div></div>`).join(''):'<p class="workspace-empty">Aún no hay parcelas. Dibuja una en el mapa o impórtala.</p>';}
function photoCards(){
 const v=current();if(!v.photos.length)return '<p class="workspace-empty">Aún no hay fotografías. Puedes tomarlas o agregar imágenes existentes.</p>';
 return v.photos.map((p,i)=>{
  const located=Number.isFinite(p.lat)&&Number.isFinite(p.lng);
  const status=located?(Number.isFinite(p.accuracy)&&p.accuracy>50?'Precisión > 50 m':'Ubicada'):'Sin ubicación';
  const location=located?`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ${h(p.locationSource||'origen desconocido')}${Number.isFinite(p.accuracy)?` · ±${Math.round(p.accuracy)} m`:''}<br>Ubicación: ${h(p.locationTime?prettyDate(p.locationTime):'fecha no disponible')}`:'Puedes ubicarla en el mapa.';
  return `<article class="photo-row" data-photo-card="${escAttr(p.id)}">
   <div class="photo-summary"><img class="photo-thumb" src="${escAttr(p.image)}" alt="Fotografía ${i+1}"><div><strong>Foto ${i+1}</strong><span class="photo-status ${located&&!(Number.isFinite(p.accuracy)&&p.accuracy>50)?'':'is-warning'}">${status}</span><small>Captura: ${h(p.capturedAt?prettyDate(p.capturedAt):'no disponible')}</small></div></div>
   <div class="photo-detail">${location}</div>
   <textarea data-photo-description="${escAttr(p.id)}" aria-label="Descripción de la foto ${i+1}" placeholder="Descripción de la fotografía">${h(p.description||'')}</textarea>
   <select data-photo-parcel="${escAttr(p.id)}" aria-label="Parcela asociada a la foto ${i+1}"><option value="">Sin parcela asociada</option>${v.parcels.map((parcel,j)=>`<option value="${escAttr(parcel.id)}" ${p.parcelId===parcel.id?'selected':''}>${h(parcel.name||`Parcela ${j+1}`)}</option>`).join('')}</select>
   <label class="checkbox-label"><input type="checkbox" data-photo-report="${escAttr(p.id)}" ${p.inReport===false?'':'checked'}> Incluir en el PDF</label>
   <div class="photo-actions">${located?`<button class="btn btn-small btn-ghost" data-action="zoom-photo" data-id="${escAttr(p.id)}">Ver en mapa</button>`:''}<button class="btn btn-small btn-ghost" data-action="place-photo" data-id="${escAttr(p.id)}">${located?'Cambiar ubicación':'Ubicar en mapa'}</button><button class="btn btn-small btn-ghost danger-text" data-action="delete-photo" data-id="${escAttr(p.id)}">Eliminar</button></div>
  </article>`;
 }).join('');
}
function refreshPhotos(){
 const list=$('#photo-list');if(!list||!current())return;
 const oldScroll=$('.workspace-sidebar')?.scrollTop||0;
 const active=document.activeElement;const focused=active?.dataset?.photoDescription;
 const start=focused?active.selectionStart:null,end=focused?active.selectionEnd:null;
 list.innerHTML=photoCards();
 if(focused){const next=list.querySelector(`[data-photo-description="${CSS.escape(focused)}"]`);if(next){next.focus({preventScroll:true});next.setSelectionRange(start,end);}}
 const panel=$('.workspace-sidebar');if(panel)panel.scrollTop=oldScroll;
 const count=$('#photo-count');if(count)count.textContent=current().photos.length;
 refreshPhotoMarkers();updateProgress();
}
function refreshPhotoMarkers(){
 if(!map||!photoMarkers||!current())return;
 photoMarkers.clearLayers();photoMarkerById.clear();
 current().photos.forEach((p,i)=>{
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng))return;
  const marker=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:`<span class="map-pin-number">${i+1}</span>`,iconSize:[25,25],iconAnchor:[12,12]})}).bindPopup(`<strong>Fotografía ${i+1}</strong><br>${h(p.description||'Sin descripción')}<br>${h(p.locationSource||'Ubicación registrada')}`);
  marker.addTo(photoMarkers);photoMarkerById.set(p.id,marker);
 });
}
function renderReport(){const v=current(),miss=missing(v),selected=v.photos.filter(p=>p.inReport!==false).length,located=v.photos.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)).length;
 view.innerHTML=pageHead('VISITA ACTUAL / 04','Revisión y reporte','Comprueba la información y descarga los archivos de tu visita.')+`<div class="review-grid"><section class="panel"><div class="panel-title"><span class="panel-number">✓</span><div><h2>Campos de supervisión</h2><p>${miss.length?`Faltan ${miss.length} campos. Puedes generar un reporte en borrador.`:'Todos los campos obligatorios están completos.'}</p></div></div><ul class="review-list">${REQUIRED.map(([k,label])=>{const m=miss.some(([x])=>x===k);return `<li><span class="${m?'missing-dot':'check-dot'}">${m?'○':'✓'}</span><span>${h(label)}${m?' · pendiente':''}</span></li>`;}).join('')}</ul><button class="btn btn-outline" style="margin-top:18px" data-view="data">Editar datos</button></section><div class="form-stack"><section class="panel"><div class="panel-title"><span class="panel-number">↗</span><div><h2>Resumen de la visita</h2><p>Una vista rápida de lo que has reunido.</p></div></div><div class="summary-stat"><span>Parcelas</span><strong>${v.parcels.length}</strong></div><div class="summary-stat"><span>Superficie registrada (suma)</span><strong>${v.parcels.reduce((s,p)=>s+geoArea(p.geometry),0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})} ha</strong></div><div class="summary-stat"><span>Fotografías</span><strong>${v.photos.length}</strong></div><div class="summary-stat"><span>Con ubicación</span><strong>${located}</strong></div><div class="summary-stat"><span>Seleccionadas para PDF</span><strong>${selected}</strong></div><div class="report-actions"><button class="btn btn-primary" data-action="pdf">${ic('download')} Generar reporte PDF</button></div><p class="hint">El PDF incluirá croquis, datos y las fotos seleccionadas. Si faltan campos, se marcará como borrador.</p></section><section class="panel"><div class="panel-title"><span class="panel-number">◇</span><div><h2>Archivos geográficos</h2><p>Capas separadas en coordenadas WGS 84.</p></div></div><div class="inline-actions"><button class="btn btn-outline" data-action="export-parcels" ${v.parcels.length?'':'disabled'}>${ic('download')} Parcelas · ZIP</button><button class="btn btn-outline" data-action="export-photos" ${located?'':'disabled'}>${ic('download')} Fotos · ZIP</button></div><p class="footer-note">Los ZIP contienen SHP, SHX, DBF, PRJ y CPG; el de fotografías incluye las imágenes. La compatibilidad específica con MAP SIIOF debe comprobarse con sus requisitos de carga.</p></section></div></div>`;
}
function renderBackup(){view.innerHTML=pageHead('TUS DATOS','Respaldo y restauración','Conserva una copia de tus visitas y recupéralas cuando lo necesites.')+`<div class="backup-actions"><section class="panel"><div class="panel-title"><span class="panel-number">01</span><div><h2>Crear respaldo</h2><p>${visits.length} visita(s) en este navegador</p></div></div><p>Descarga un ZIP con los datos, polígonos y fotografías de todas las visitas guardadas en este dispositivo.</p><button class="btn btn-primary" data-action="backup" ${visits.length?'':'disabled'}>${ic('download')} Descargar respaldo</button></section><section class="panel"><div class="panel-title"><span class="panel-number">02</span><div><h2>Restaurar respaldo</h2><p>Importa una copia de GeoFoto.</p></div></div><p>Las visitas se restauran como copias nuevas, sin reemplazar las que ya existen en este navegador.</p><button class="btn btn-outline" data-action="restore">${ic('upload')} Seleccionar respaldo</button><input id="backup-file" type="file" class="file-input" accept=".zip,application/zip"></section></div><div class="callout warn" style="max-width:850px;margin-top:16px">El respaldo contiene toda la información y fotografías de las visitas. Guárdalo en un lugar al que solo tengan acceso las personas autorizadas.</div><p class="footer-note">Borrar los datos del navegador, cambiar de dispositivo o desinstalar la aplicación puede eliminar la información local. El respaldo permite recuperarla.</p>`;}
const TILE='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
function configureDraw(){
 L.drawLocal.draw.toolbar.buttons.polygon='Dibujar una parcela';L.drawLocal.draw.toolbar.actions.title='Cancelar dibujo';L.drawLocal.draw.toolbar.actions.text='Cancelar';L.drawLocal.draw.toolbar.finish.title='Terminar dibujo';L.drawLocal.draw.toolbar.finish.text='Terminar';L.drawLocal.draw.toolbar.undo.title='Eliminar último punto';L.drawLocal.draw.toolbar.undo.text='Deshacer';L.drawLocal.draw.handlers.polygon.tooltip.start='Toca el mapa para comenzar.';L.drawLocal.draw.handlers.polygon.tooltip.cont='Toca para añadir vértices.';L.drawLocal.draw.handlers.polygon.tooltip.end='Toca el primer punto para cerrar.';
 L.drawLocal.edit.toolbar.buttons.edit='Editar parcelas';L.drawLocal.edit.toolbar.buttons.editDisabled='No hay parcelas para editar';L.drawLocal.edit.toolbar.buttons.remove='Eliminar parcelas';L.drawLocal.edit.toolbar.buttons.removeDisabled='No hay parcelas para eliminar';L.drawLocal.edit.toolbar.actions.save.text='Guardar';L.drawLocal.edit.toolbar.actions.cancel.text='Cancelar';L.drawLocal.edit.toolbar.actions.clearAll.text='Eliminar todo';
}
function validGeometry(geometry){try{if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))return false;let count=0;const walk=c=>{if(typeof c[0]==='number'){if(c.length<2||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90)throw new Error('coords');count++;}else c.forEach(walk);};walk(geometry.coordinates);const f={type:'Feature',properties:{},geometry};return count>=4&&geoArea(geometry)>0&&booleanValid(f)&&kinks(f).features.length===0;}catch{return false;}}
function initMap(){const v=current();if(!v||currentView!=='map'||!$('#map'))return;configureDraw();map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([23.6,-102.5],5);L.tileLayer(TILE,{attribution:'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',maxZoom:19,crossOrigin:'anonymous'}).addTo(map);drawn=new L.FeatureGroup().addTo(map);
 for(const p of v.parcels){try{const layer=L.geoJSON({type:'Feature',geometry:p.geometry,properties:{}},{style:{color:'#7cf09f',weight:3,fillColor:'#3cba70',fillOpacity:.22}}).getLayers()[0];layer._parcelId=p.id;drawn.addLayer(layer);}catch(e){console.warn(e);}}
 photoMarkers=L.featureGroup().addTo(map);refreshPhotoMarkers();
 map.addControl(new L.Control.Draw({position:'topleft',draw:{polygon:{allowIntersection:false,showArea:false,shapeOptions:{color:'#7cf09f',weight:3,fillOpacity:.22}},polyline:false,rectangle:false,circle:false,circlemarker:false,marker:false},edit:{featureGroup:drawn,edit:{},remove:true}}));
 const bounds=L.latLngBounds([]);try{if(drawn.getLayers().length)bounds.extend(drawn.getBounds());if(photoMarkers.getLayers().length)bounds.extend(photoMarkers.getBounds());if(bounds.isValid())map.fitBounds(bounds.pad(.22),{maxZoom:17});}catch{}
 map.on(L.Draw.Event.CREATED,e=>{const layer=e.layer,g=layer.toGeoJSON().geometry;if(!validGeometry(g)){toast('El polígono no es válido. Revisa cruces o vértices.',true);return;}const p={id:uid(),name:`Parcela ${v.parcels.length+1}`,geometry:g};v.parcels.push(p);layer._parcelId=p.id;drawn.addLayer(layer);persist(v).catch(()=>{});refreshParcelList();toast('Parcela agregada.');});
 map.on(L.Draw.Event.EDITED,e=>{let invalid=false;e.layers.eachLayer(layer=>{const p=v.parcels.find(x=>x.id===layer._parcelId);if(!p)return;const g=layer.toGeoJSON().geometry;if(validGeometry(g))p.geometry=g;else{invalid=true;const original=L.geoJSON(p.geometry).getLayers()[0];layer.setLatLngs(original.getLatLngs());}});persist(v).catch(()=>{});refreshParcelList();toast(invalid?'Se descartaron cambios con geometría inválida.':'Cambios guardados.',invalid);});
 map.on(L.Draw.Event.DELETED,e=>{const ids=[];e.layers.eachLayer(l=>ids.push(l._parcelId));v.parcels=v.parcels.filter(p=>!ids.includes(p.id));v.photos.forEach(p=>{if(ids.includes(p.parcelId))p.parcelId='';});persist(v).catch(()=>{});refreshParcelList();toast('Parcela eliminada.');});
 map.on('click',e=>{if(!photoToLocate)return;const p=v.photos.find(x=>x.id===photoToLocate);if(!p){photoToLocate=null;return;}p.lat=e.latlng.lat;p.lng=e.latlng.lng;p.accuracy=null;p.locationSource='Manual';p.locationTime=new Date().toISOString();photoToLocate=null;$('#manual-banner')?.classList.add('hidden');persist(v).catch(()=>{});refreshPhotos();toast('Ubicación manual guardada.');});
 setTimeout(()=>map?.invalidateSize(),100);
}
function refreshParcelList(){const el=$('#parcel-list');if(el)el.innerHTML=parcelList();const count=$('#parcel-count');if(count)count.textContent=current().parcels.length;const button=$('#map-export-parcels');if(button)button.disabled=!current().parcels.length;refreshPhotos();updateProgress();}
function geolocate(){return new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error('Este navegador no ofrece geolocalización.'));return;}navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0});});}
function locationError(e){return e?.code===1?'Permiso de ubicación denegado.':e?.code===3?'No se obtuvo una ubicación a tiempo.':'No fue posible obtener la ubicación.';}
function featuresFrom(input){const result=[];function collect(obj,props={}){if(!obj)return;if(obj.type==='FeatureCollection')obj.features.forEach(f=>collect(f));else if(obj.type==='Feature')collect(obj.geometry,obj.properties||{});else if(obj.type==='GeometryCollection')obj.geometries.forEach(g=>collect(g,props));else if(obj.type==='Polygon')result.push({geometry:obj,properties:props});else if(obj.type==='MultiPolygon')obj.coordinates.forEach(c=>result.push({geometry:{type:'Polygon',coordinates:c},properties:props}));}collect(input);return result;}
async function importParcels(file){const v=current();let geo;
 if(file.name.toLowerCase().endsWith('.zip')){const buf=await file.arrayBuffer(),zip=await JSZip.loadAsync(buf),shps=Object.keys(zip.files).filter(x=>/\.shp$/i.test(x)&&!zip.files[x].dir);if(!shps.length)throw new Error('El ZIP no contiene archivos .shp.');for(const filename of shps){const base=filename.replace(/\.shp$/i,'').toLowerCase();if(!Object.keys(zip.files).some(k=>k.toLowerCase()===`${base}.prj`))throw new Error('Falta el archivo .prj del shapefile. Es necesario para identificar el sistema de coordenadas.');}geo=await shp(buf);}
 else if(file.name.toLowerCase().endsWith('.kml')){const doc=new DOMParser().parseFromString(await file.text(),'text/xml');if(doc.querySelector('parsererror'))throw new Error('El KML no pudo leerse.');geo=kml(doc);}
 else {geo=JSON.parse(await file.text());const crs=geo.crs?.properties?.name;if(crs&&!/4326|CRS84/i.test(crs))throw new Error('El GeoJSON debe estar en coordenadas WGS 84 (EPSG:4326).');}
 const source=Array.isArray(geo)?geo.flatMap(featuresFrom):featuresFrom(geo);if(!source.length)throw new Error('No se encontraron polígonos en el archivo.');let ok=0,bad=0;for(const f of source){if(!validGeometry(f.geometry)){bad++;continue;}const props=f.properties||{};v.parcels.push({id:uid(),name:String(props.NOMBRE||props.nombre||props.name||`Parcela ${v.parcels.length+1}`).slice(0,100),geometry:f.geometry});ok++;}
 if(!ok)throw new Error('Los polígonos no son válidos o sus coordenadas no están en WGS 84.');await persist(v);setView('map');toast(`Se importaron ${ok} parcela(s).${bad?` ${bad} geometría(s) inválida(s) se omitieron.`:''}`);
}
function readDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
async function supportedImage(file){const data=await readDataURL(file);if(/^data:image\/(jpeg|png);/i.test(data))return data;return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);const converted=canvas.toDataURL('image/jpeg',.92);if(!converted.startsWith('data:image/jpeg'))throw new Error('Formato de imagen no compatible.');resolve(converted);}catch(e){reject(e);}};img.onerror=()=>reject(new Error('El navegador no pudo abrir este formato de imagen.'));img.src=data;});}
function openModal(content,footer=''){const root=$('#modal-root');root.innerHTML=`<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-label="Cámara"><div class="modal-header"><h2>Tomar fotografía</h2><button class="modal-close" data-action="close-modal" aria-label="Cerrar">${ic('x')}</button></div><div class="modal-content">${content}</div><div class="modal-footer">${footer}</div></section></div>`;}
function closeModal(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}$('#modal-root').innerHTML='';}
async function startCamera(){
 openModal('<p class="hint">Abriendo la cámara del dispositivo…</p><video class="camera-video" autoplay playsinline muted></video><p class="hint">Al capturar se solicitará también una ubicación del dispositivo. Puedes ajustar la ubicación después.</p>',`<button class="btn btn-outline" data-action="close-modal">Cancelar</button><button class="btn btn-primary" data-action="capture-photo" disabled>${ic('camera')} Capturar fotografía</button>`);
 try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Cámara no disponible en este navegador.');cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});const video=$('.camera-video');if(!video){closeModal();return;}video.srcObject=cameraStream;await video.play();const b=$('[data-action="capture-photo"]');if(b)b.disabled=false;}
 catch(e){const c=$('.modal-content');if(c)c.innerHTML=`<div class="callout warn">No se pudo abrir la cámara. Revisa los permisos del navegador o agrega una foto desde el dispositivo.</div>`;const b=$('[data-action="capture-photo"]');if(b)b.disabled=true;toast('No fue posible abrir la cámara.',true);}
}
async function capturePhoto(){const v=current(),video=$('.camera-video');if(!v||!video||!video.videoWidth){toast('La cámara aún no está lista.',true);return;}const positionRequest=geolocate().then(value=>({value}),error=>({error}));const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const p={id:uid(),image:canvas.toDataURL('image/jpeg',.92),capturedAt:new Date().toISOString(),description:'',inReport:true,lat:null,lng:null,accuracy:null,locationSource:'',locationTime:null,parcelId:''};v.photos.push(p);closeModal();await persist(v);if(currentId===v.id&&currentView==='map')refreshPhotos();toast('Fotografía guardada. Buscando ubicación…');
 try{const result=await positionRequest;if(result.error)throw result.error;const position=result.value;if(!visits.some(x=>x.id===v.id)||!v.photos.some(x=>x.id===p.id)||p.locationSource)return;p.lat=position.coords.latitude;p.lng=position.coords.longitude;p.accuracy=Number.isFinite(position.coords.accuracy)?position.coords.accuracy:null;p.locationSource='Dispositivo';p.locationTime=new Date(position.timestamp).toISOString();await persist(v);if(currentId===v.id&&currentView==='map'){refreshPhotos();if(!v.parcels.length)map?.setView([p.lat,p.lng],17);}toast('Ubicación del dispositivo registrada.');}
 catch(e){if(currentId===v.id&&currentView==='map')refreshPhotos();toast(`${locationError(e)} Puedes ubicar la foto manualmente.`,true);}
}
async function addPhotos(files){const v=current();let done=0;for(const file of files){try{if(!file.type.startsWith('image/'))continue;const image=await supportedImage(file);let gps=null,meta=null;try{gps=await exifr.gps(file);}catch{}try{meta=await exifr.parse(file,['DateTimeOriginal','CreateDate']);}catch{}let when=meta?.DateTimeOriginal||meta?.CreateDate;when=when instanceof Date&&!Number.isNaN(+when)?when.toISOString():null;v.photos.push({id:uid(),image,capturedAt:when,importedAt:new Date().toISOString(),description:'',inReport:true,lat:Number.isFinite(gps?.latitude)?gps.latitude:null,lng:Number.isFinite(gps?.longitude)?gps.longitude:null,accuracy:null,locationSource:Number.isFinite(gps?.latitude)?'EXIF':'',locationTime:null,parcelId:''});done++;}catch(e){console.warn(e);}}
 if(done){await persist(v);if(currentId===v.id&&currentView==='map'){refreshPhotos();if(!v.parcels.length&&photoMarkers?.getLayers().length)map?.fitBounds(photoMarkers.getBounds().pad(.2),{maxZoom:17});}toast(`${done} fotografía(s) agregada(s).`);}else toast('No se pudieron agregar las fotografías.',true);
}
async function backup(){await saveQueue;const zip=new JSZip();zip.file('geofoto.json',JSON.stringify({app:'GeoFoto',version:1,createdAt:new Date().toISOString(),visits}));downloadBlob(await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}}),`GeoFoto_respaldo_${new Date().toISOString().slice(0,10)}.zip`);toast('Respaldo descargado.');}
async function restore(file){const zip=await JSZip.loadAsync(file),entry=zip.file('geofoto.json');if(!entry)throw new Error('El ZIP no contiene un respaldo GeoFoto válido.');const obj=JSON.parse(await entry.async('string'));if(obj.app!=='GeoFoto'||obj.version!==1||!Array.isArray(obj.visits))throw new Error('El formato de respaldo no es compatible.');let count=0;for(const old of obj.visits){if(!old||typeof old.data!=='object'||!Array.isArray(old.parcels)||!Array.isArray(old.photos))continue;const v=structuredClone(old);v.id=uid();v.updatedAt=new Date().toISOString();const ids=new Map();v.parcels=v.parcels.filter(p=>validGeometry(p.geometry)).map(p=>{const id=uid();ids.set(p.id,id);return {...p,id};});v.photos=v.photos.filter(p=>typeof p.image==='string'&&p.image.startsWith('data:image/')).map(p=>({...p,id:uid(),parcelId:ids.get(p.parcelId)||''}));await putVisit(v);visits.push(v);count++;}renderBackup();toast(`${count} visita(s) restaurada(s) como copias.`);}
let saveTimer=null,pendingVisit=null;
function scheduleSave(v){pendingVisit=v;clearTimeout(saveTimer);setSaveStatus('Guardando…');saveTimer=setTimeout(()=>{saveTimer=null;const x=pendingVisit;pendingVisit=null;persist(x).catch(()=>{});},450);}
function flushPending(){if(saveTimer){clearTimeout(saveTimer);saveTimer=null;const x=pendingVisit;pendingVisit=null;persist(x).catch(()=>{});}return saveQueue;}
document.addEventListener('input',e=>{const target=e.target,v=current();if(!v)return;if(target.matches('[data-field]')){v.data[target.dataset.field]=target.value;scheduleSave(v);updateProgress();}else if(target.matches('[data-photo-description]')){const p=v.photos.find(x=>x.id===target.dataset.photoDescription);if(p){p.description=target.value;scheduleSave(v);}}});
document.addEventListener('change',async e=>{const target=e.target,v=current();try{
 if(target.matches('[data-photo-report]')){const p=v?.photos.find(x=>x.id===target.dataset.photoReport);if(p){p.inReport=target.checked;scheduleSave(v);}}
 else if(target.matches('[data-photo-parcel]')){const p=v?.photos.find(x=>x.id===target.dataset.photoParcel);if(p){p.parcelId=target.value;scheduleSave(v);}}
 else if(target.id==='parcel-file'&&target.files?.length)await importParcels(target.files[0]);
 else if(target.id==='photo-file'&&target.files?.length)await addPhotos(target.files);
 else if(target.id==='backup-file'&&target.files?.length)await restore(target.files[0]);
 }catch(err){console.error(err);toast(err.message||'No se pudo completar la operación.',true);}finally{if(target.type==='file')target.value='';}});
document.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button||button.disabled)return;if(button.dataset.view){flushPending();setView(button.dataset.view);return;}const action=button.dataset.action;if(!action)return;const v=current();try{
 if(action==='new-visit'){await flushPending();const n=newVisit();visits.push(n);currentId=n.id;await persist(n);navigator.storage?.persist?.().catch(()=>{});setView('data');}
 else if(action==='open-visit'){await flushPending();currentId=button.dataset.id;setView('data');}
 else if(action==='delete-visit'){if(confirm('¿Eliminar esta visita y todas sus fotografías del dispositivo?')){await flushPending().catch(()=>{});await deleteVisit(v.id);visits=visits.filter(x=>x.id!==v.id);currentId=null;setView('visits');toast('Visita eliminada.');}}
 else if(action==='locate'){button.disabled=true;try{const p=await geolocate();map?.setView([p.coords.latitude,p.coords.longitude],17);toast(`Ubicación obtenida · precisión reportada ±${Math.round(p.coords.accuracy)} m.`);}catch(err){toast(locationError(err),true);}finally{button.disabled=false;}}
 else if(action==='import-parcels')$('#parcel-file')?.click();
 else if(action==='zoom-parcel'){const layer=drawn?.getLayers().find(l=>l._parcelId===button.dataset.id);if(layer)map.fitBounds(layer.getBounds().pad(.2),{maxZoom:18});}
 else if(action==='rename-parcel'){const p=v.parcels.find(x=>x.id===button.dataset.id);const name=prompt('Nombre de la parcela:',p?.name||'');if(p&&name!==null&&name.trim()){p.name=name.trim().slice(0,100);await persist(v);refreshParcelList();}}
 else if(action==='delete-parcel'){const p=v.parcels.find(x=>x.id===button.dataset.id);if(p&&confirm(`¿Eliminar ${p.name}?`)){v.parcels=v.parcels.filter(x=>x.id!==p.id);v.photos.forEach(x=>{if(x.parcelId===p.id)x.parcelId='';});await persist(v);setView('map');}}
 else if(action==='cancel-place'){photoToLocate=null;$('#manual-banner')?.classList.add('hidden');}
 else if(action==='place-photo'){await flushPending();photoToLocate=button.dataset.id;$('#manual-banner')?.classList.remove('hidden');$('#map')?.scrollIntoView({behavior:'smooth',block:'start'});toast('Toca el lugar de la fotografía en el mapa.');}
 else if(action==='zoom-photo'){const p=v.photos.find(x=>x.id===button.dataset.id);if(p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)){map?.setView([p.lat,p.lng],Math.max(map.getZoom(),17));photoMarkerById.get(p.id)?.openPopup();$('#map')?.scrollIntoView({behavior:'smooth',block:'start'});}}
 else if(action==='delete-photo'){if(confirm('¿Eliminar esta fotografía de la visita?')){v.photos=v.photos.filter(x=>x.id!==button.dataset.id);if(photoToLocate===button.dataset.id){photoToLocate=null;$('#manual-banner')?.classList.add('hidden');}await persist(v);refreshPhotos();}}
 else if(action==='camera')await startCamera();
 else if(action==='close-modal')closeModal();
 else if(action==='capture-photo'){button.disabled=true;await capturePhoto();}
 else if(action==='upload-photos')$('#photo-file')?.click();
 else if(action==='export-parcels'){await flushPending();if(!v?.parcels.length){toast('Agrega al menos una parcela.');return;}downloadBlob(await polygonZip(v),`GeoFoto_parcelas_${cleanFile(v.data.acreditado)}.zip`);toast('Shapefile de parcelas descargado.');}
 else if(action==='export-photos'){await flushPending();if(!v?.photos.some(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng))){toast('No hay fotografías ubicadas.');return;}downloadBlob(await photoZip(v),`GeoFoto_fotos_${cleanFile(v.data.acreditado)}.zip`);toast('Shapefile de fotografías descargado.');}
 else if(action==='pdf'){await flushPending();button.disabled=true;button.textContent='Preparando reporte…';try{await createReport(structuredClone(v));toast('Reporte PDF generado.');}finally{button.disabled=false;button.innerHTML=`${ic('download')} Generar reporte PDF`;}}
 else if(action==='backup'){await flushPending();button.disabled=true;try{await backup();}finally{button.disabled=false;}}
 else if(action==='restore')$('#backup-file')?.click();
 }catch(err){console.error(err);toast(err.message||'No fue posible completar la operación.',true);}
});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#install-btn').classList.remove('hidden');});
$('#install-btn').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#install-btn').classList.add('hidden');});
window.addEventListener('appinstalled',()=>{$('#install-btn').classList.add('hidden');toast('GeoFoto se instaló correctamente.');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushPending();});
async function init(){try{await import('leaflet-draw');visits=await getVisits();visits=visits.filter(v=>v&&v.data&&Array.isArray(v.parcels)&&Array.isArray(v.photos));render();if('serviceWorker'in navigator)navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.warn);}catch(e){console.error(e);view.innerHTML=`<div class="callout warn">No se pudo iniciar el almacenamiento local. Revisa que tu navegador permita guardar datos y vuelve a cargar la página.</div>`;}}
init();
