/* ── constantes ─────────────────────────────────────── */
const CSYM = {EUR:'€',USD:'$',MXN:'$',PEN:'S/',COP:'$',CLP:'$',GBP:'£',ARS:'$',PAB:'B/.', VES:'Bs.'};
const PM   = {CARD:'Tarjeta',CASH:'Efectivo',TRANSFER:'Transferencia',OTHER:'Otro'};
const TL   = {expense:'Gasto',income:'Ingreso',tax:'Impuesto',payment_account:'Cta. de pago'};

/* ── refs ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const frm=$('frm'), dz=$('dz'), fi=$('fi'), browse=$('browse'),
      fc=$('fc'), btn=$('btn'), prog=$('prog'), pf=$('pf'), pl=$('pl'),
      res=$('res'), errEl=$('err'),
      histBody=$('histBody'), histMeta=$('histMeta');

/* ── navbar scroll shadow ────────────────────────────── */
window.addEventListener('scroll', () => {
  $('navbar').classList.toggle('scrolled', window.scrollY > 8);
}, {passive:true});

/* ── nav active link on scroll ───────────────────────── */
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if(!e.isIntersecting) return;
    const id = e.target.id;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if(id==='upload')    $('lnkUpload').classList.add('active');
    if(id==='historial') $('lnkHist').classList.add('active');
  });
}, {threshold: 0.4});
obs.observe(document.getElementById('upload'));
obs.observe(document.getElementById('historial'));

/* ── drag & drop ─────────────────────────────────────── */
browse.onclick = () => fi.click();
dz.addEventListener('click', e => { if(e.target!==browse) fi.click(); });
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', ()=> dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); pick(e.dataTransfer.files[0]); });
fi.addEventListener('change', ()=> { if(fi.files[0]) pick(fi.files[0]); });
function pick(f){ fc.textContent=`${f.name}  ·  ${(f.size/1024).toFixed(1)} KB`; btn.disabled=false; }

/* ── helpers ─────────────────────────────────────────── */
function money(v,cur){
  if(v==null) return '—';
  try { return new Intl.NumberFormat('es-ES',{style:'currency',currency:cur||'USD'}).format(v); }
  catch { return `${CSYM[cur]||''}${Number(v).toLocaleString('es',{minimumFractionDigits:2})}`; }
}
function esc(s){
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function show(id){ $(id).style.display='block'; }
function hide(id){ $(id).style.display='none'; }
function initial(s){ return (s||'?').charAt(0).toUpperCase(); }
function fileUrlLink(url, label='URL pública'){
  if(!url) return '<span class="muted">—</span>';
  return `<a class="file-url" href="${esc(url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="${esc(url)}">${esc(label)}</a>`;
}
function storageCell(receipt){
  if(receipt?.fileUrl) return fileUrlLink(receipt.fileUrl);
  if(receipt?.storagePath) return '<span class="muted">Local</span>';
  return '<span class="muted">—</span>';
}

/* ── progress ────────────────────────────────────────── */
const STEPS=[
  {p:12,l:'Subiendo archivo…'},
  {p:30,l:'OCR con Tesseract (eng+spa)…'},
  {p:52,l:'Parseando campos…'},
  {p:72,l:'Estructurando con IA…'},
  {p:88,l:'Categorizando gasto…'},
  {p:96,l:'Guardando en base de datos…'},
];
function startProg(){
  let i=0; prog.classList.add('on'); pf.style.width='4%';
  const t=setInterval(()=>{
    if(i>=STEPS.length){clearInterval(t);return;}
    pf.style.width=STEPS[i].p+'%'; pl.textContent=STEPS[i].l; i++;
  },950);
  return t;
}

/* ── render resultado ────────────────────────────────── */
function render(data){
  const j=data.json??data, cur=j.currency||'USD';

  if(j.vendorName){
    $('vAv').textContent=initial(j.vendorName);
    $('vName').textContent=j.vendorName;
    const m=[];
    if(j.date) m.push(j.date);
    if(j.invoiceNumber) m.push(`Fac. ${j.invoiceNumber}`);
    if(j.paymentMethod) m.push(PM[j.paymentMethod]||j.paymentMethod);
    $('vMeta').textContent=m.join('  ·  ');
    $('vIds').innerHTML=(j.vendorIdentifications??[]).map(x=>`<span class="badge b-purple">${esc(x)}</span>`).join('');
    show('cVendor');
  }
  if(j.customerName){
    $('cuAv').textContent=initial(j.customerName);
    $('cuName').textContent=j.customerName;
    $('cuIds').innerHTML=(j.customerIdentifications??[]).map(x=>`<span class="badge b-green">${esc(x)}</span>`).join('');
    show('cCustomer');
  }
  if(j.amount!=null||j.subtotalAmount!=null||j.taxAmount!=null){
    $('fin').innerHTML=
      fcell(false,'Subtotal',money(j.subtotalAmount,cur),null)+
      fcell(false,'Impuesto',money(j.taxAmount,cur),j.taxPercentage!=null?`${j.taxPercentage}%`:null)+
      fcell(true,'Total',money(j.amount,cur),cur);
    show('cFin');
  }
  const cn=j.categoryName||(j.category!=null?`Cuenta #${j.category}`:null);
  if(cn){
    $('cIcon').textContent=initial(j.categoryName||'C');
    $('cIcon').className='cat-av found';
    $('cName').textContent=cn; $('cName').className='cat-name';
    const tl=j.categoryType?TL[j.categoryType]||j.categoryType:'';
    $('cSub').innerHTML=[j.category!=null?`ID: ${j.category}`:'',tl?`<span class="badge b-green">${esc(tl)}</span>`:''].filter(Boolean).join('  ');
  }
  const items=j.items??[];
  if(items.length){
    $('iTbody').innerHTML=items.map(it=>`<tr>
      <td>${esc(it.description??'—')}</td>
      <td style="text-align:center">${it.quantity??1}</td>
      <td style="text-align:right">${money(it.unitPrice,cur)}</td>
      <td style="text-align:right">${money(it.total,cur)}</td>
    </tr>`).join('');
    show('cItems');
  }
  const dr=[
    ['Fecha',j.date],['No. Factura',j.invoiceNumber],
    ['Moneda',j.currency?`${CSYM[j.currency]||''} ${j.currency}`.trim():null],
    ['Método de pago',j.paymentMethod?PM[j.paymentMethod]:null],
    ['Tipo',j.type?(j.type==='income'?'Ingreso':'Gasto'):null],
    ['Archivo',storageCell(data)],
    ['Descripción',j.description],
  ].filter(([,v])=>v!=null&&v!=='');
  if(dr.length){
    $('dg').innerHTML=dr.map(([l,v])=>`<div class="dg-cell"><div class="dg-lbl">${esc(l)}</div><div class="dg-val">${l==='Archivo'?v:esc(v)}</div></div>`).join('');
    show('cDetail');
  }
  const extra=j.extraFields||{};
  const extraKeys=Object.keys(extra);
  if(extraKeys.length){
    $('dgExtra').innerHTML=extraKeys.map(k=>`<div class="dg-cell"><div class="dg-lbl">${esc(k)}</div><div class="dg-val">${esc(extra[k])}</div></div>`).join('');
    show('cExtraFields');
  }
  $('mRow').innerHTML=`<span class="pill">OCR: ${esc(data.ocrProvider||'—')}</span><span class="pill">IA: ${esc(data.aiProvider||'—')}</span>`;
  $('mId').textContent=`ID: ${data.id||''}`;
  $('jPre').textContent=JSON.stringify(data,null,2);
  show('cMeta');
}
function fcell(m,l,v,s){
  return `<div class="fin-cell${m?' main':''}"><div class="fin-lbl">${l}</div><div class="fin-val">${v}</div>${s?`<div class="fin-sub">${s}</div>`:''}</div>`;
}
function resetResult(){
  ['cVendor','cCustomer','cFin','cItems','cDetail','cExtraFields','cMeta'].forEach(hide);
  $('cIcon').className='cat-av missing'; $('cIcon').textContent='—';
  $('cName').className='cat-name missing'; $('cName').textContent='Sin categoría';
  $('cSub').innerHTML='No determinada';
}
function closeResult(){ hide('res'); resetResult(); }

/* ── modal ───────────────────────────────────────────── */
let allReceipts=[];

function openModal(id){
  const r=allReceipts.find(x=>x.id===id);
  if(!r) return;
  const j=r.json??{}, cur=j.currency||'USD';

  $('modalTitle').textContent=j.vendorName||r.originalName||'—';
  $('modalFile').textContent=r.originalName||'';

  const sections=[];

  if(j.amount!=null||j.subtotalAmount!=null||j.taxAmount!=null){
    sections.push(`<div class="modal-section">
      <div class="sec">Financiero</div>
      <div class="modal-fin">
        <div class="fin-cell"><div class="fin-lbl">Subtotal</div><div class="fin-val">${money(j.subtotalAmount,cur)}</div></div>
        <div class="fin-cell"><div class="fin-lbl">Impuesto${j.taxPercentage!=null?` (${j.taxPercentage}%)`:''}</div><div class="fin-val">${money(j.taxAmount,cur)}</div></div>
        <div class="fin-cell main"><div class="fin-lbl">Total</div><div class="fin-val">${money(j.amount,cur)}</div>${cur?`<div class="fin-sub">${cur}</div>`:''}</div>
      </div>
    </div>`);
  }

  if(j.vendorName){
    sections.push(`<div class="modal-section">
      <div class="sec">Vendor</div>
      <div class="modal-row">
        <div class="modal-av">${esc(initial(j.vendorName))}</div>
        <div>
          <div class="modal-vendor-name">${esc(j.vendorName)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
            ${(j.vendorIdentifications??[]).map(x=>`<span class="badge b-purple">${esc(x)}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>`);
  }

  if(j.customerName){
    sections.push(`<div class="modal-section">
      <div class="sec">Cliente</div>
      <div class="modal-row">
        <div class="modal-av green">${esc(initial(j.customerName))}</div>
        <div>
          <div class="modal-vendor-name">${esc(j.customerName)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
            ${(j.customerIdentifications??[]).map(x=>`<span class="badge b-green">${esc(x)}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>`);
  }

  const kvItems=[];
  if(j.categoryName||j.category!=null){
    const cn=j.categoryName||(j.category!=null?`Cuenta #${j.category}`:'—');
    const tl=j.categoryType?TL[j.categoryType]||j.categoryType:'';
    kvItems.push(['Categoría',`${esc(cn)}${tl?` <span class="badge b-green" style="margin-left:4px">${esc(tl)}</span>`:''}`]);
  }
  if(j.date) kvItems.push(['Fecha',j.date]);
  if(j.invoiceNumber) kvItems.push(['No. Factura',j.invoiceNumber]);
  if(j.paymentMethod) kvItems.push(['Pago',PM[j.paymentMethod]||j.paymentMethod]);
  if(j.currency) kvItems.push(['Moneda',`${CSYM[j.currency]||''} ${j.currency}`.trim()]);
  if(j.type) kvItems.push(['Tipo',j.type==='income'?'Ingreso':'Gasto']);
  if(j.description) kvItems.push(['Descripción',j.description]);
  if(r.fileUrl) kvItems.push(['Archivo',fileUrlLink(r.fileUrl, r.fileUrl)]);
  else if(r.storagePath) kvItems.push(['Archivo','<span class="muted">Local</span>']);
  if(kvItems.length){
    sections.push(`<div class="modal-section">
      <div class="sec">Detalles</div>
      <div class="modal-kv">
        ${kvItems.map(([l,v])=>`<div class="modal-cell"><div class="modal-lbl">${esc(l)}</div><div class="modal-val">${v}</div></div>`).join('')}
      </div>
    </div>`);
  }

  const extra=j.extraFields||{};
  const extraKeys=Object.keys(extra);
  if(extraKeys.length){
    sections.push(`<div class="modal-section">
      <div class="sec">Campos Extra</div>
      <div class="modal-kv">
        ${extraKeys.map(k=>`<div class="modal-cell"><div class="modal-lbl">${esc(k)}</div><div class="modal-val">${esc(extra[k])}</div></div>`).join('')}
      </div>
    </div>`);
  }

  const items=j.items??[];
  if(items.length){
    sections.push(`<div class="modal-section">
      <div class="sec">Líneas de detalle</div>
      <table class="m-items-tbl">
        <thead><tr><th>Descripción</th><th style="text-align:center">Cant.</th><th style="text-align:right">P.Unit</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${items.map(it=>`<tr>
          <td>${esc(it.description??'—')}</td>
          <td style="text-align:center">${it.quantity??1}</td>
          <td style="text-align:right">${money(it.unitPrice,cur)}</td>
          <td style="text-align:right">${money(it.total,cur)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`);
  }

  /* OCR raw text — collapsible */
  if(r.rawText){
    sections.push(`<div class="modal-section">
      <details>
        <summary>Ver texto OCR crudo</summary>
        <pre>${esc(r.rawText)}</pre>
      </details>
    </div>`);
  }

  $('modalBody').innerHTML=sections.join('');

  $('modalFooter').innerHTML=`
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="pill">OCR: ${esc(r.ocrProvider||'—')}</span>
      <span class="pill">IA: ${esc(r.aiProvider||'—')}</span>
    </div>
    <span style="font-family:'Roboto Mono',monospace;font-size:.64rem;color:var(--g400)">${esc(r.id||'')}</span>`;

  $('modalBackdrop').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeModal(){
  $('modalBackdrop').classList.remove('open');
  document.body.style.overflow='';
}

function handleBackdropClick(e){
  if(e.target===$('modalBackdrop')) closeModal();
}

document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

/* ── historial ───────────────────────────────────────── */
async function loadHistory(){
  try{
    const r=await fetch('/api/receipts');
    if(!r.ok) throw new Error();
    allReceipts=await r.json();
    renderTable();
  } catch {
    histBody.innerHTML='<tr><td colspan="7"><div class="tbl-empty">No se pudo cargar el historial.</div></td></tr>';
  }
}

function renderTable(){
  if(!allReceipts.length){
    histMeta.textContent='';
    histBody.innerHTML=`<tr><td colspan="7"><div class="tbl-empty">
      Sin facturas aún
      <p>Sube una imagen o PDF para comenzar</p>
    </div></td></tr>`;
    return;
  }
  histMeta.textContent=`${allReceipts.length} registro${allReceipts.length!==1?'s':''}`;
  histBody.innerHTML=allReceipts.map((r,i)=>rowHTML(r,i)).join('');
}

function rowHTML(r, idx=0){
  const j=r.json??{}, cur=j.currency||'USD';
  const name=j.vendorName||r.originalName||'—';
  const date=j.date||'—';
  const catName=j.categoryName||'Sin categoría';
  const delay=Math.min(idx*0.04, 0.4);
  return `
<tr class="row-main" data-id="${r.id}" onclick="openModal('${r.id}')" style="animation-delay:${delay}s">
  <td><div class="t-vendor">
    <div class="t-av">${esc(name.charAt(0).toUpperCase())}</div>
    <div>
      <div class="t-name">${esc(name)}</div>
      <div class="t-file">${esc(r.originalName||'')}</div>
    </div>
  </div></td>
  <td>${esc(date)}</td>
  <td><span class="badge b-purple">${esc(catName)}</span></td>
  <td>${storageCell(r)}</td>
  <td class="r"><span class="t-amount">${money(j.amount,cur)}</span></td>
  <td class="c"><span class="pill" style="font-size:.64rem">${esc(r.aiProvider||'—')}</span></td>
  <td class="c"><span class="t-arrow">›</span></td>
</tr>`;
}

/* ── submit ──────────────────────────────────────────── */
frm.addEventListener('submit', async e=>{
  e.preventDefault();
  errEl.style.display='none';
  hide('res'); resetResult();
  btn.disabled=true;
  const timer=startProg();

  let data;
  try{
    const r=await fetch('/api/receipts',{method:'POST',body:new FormData(frm)});
    clearInterval(timer); pf.style.width='100%'; pl.textContent='Completado';
    data=await r.json();
    if(!r.ok) throw new Error(data.message||`Error ${r.status}`);
  } catch(err){
    clearInterval(timer); pf.style.width='100%'; pl.textContent='Error.';
    errEl.textContent=err.message; errEl.style.display='block';
    btn.disabled=false; return;
  }

  await loadHistory();
  show('res');
  render(data);
  btn.disabled=false;
  res.scrollIntoView({behavior:'smooth',block:'start'});
});

/* ── init ────────────────────────────────────────────── */
loadHistory();
